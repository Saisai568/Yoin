use wasm_bindgen::prelude::*;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encode, Encoder};
use yrs::{Array, Doc, GetString, Map, MapPrelim, ReadTxn, StateVector, Text, Transact, Update, Origin};
use yrs::types::{ToJson, Value};
use yrs::updates::decoder::DecoderV1;
use yrs::updates::encoder::EncoderV1;
use yrs::undo::{UndoManager, Options};
use std::collections::{HashMap, HashSet};
use std::cell::RefCell;
use std::rc::Rc;
use serde::Serialize;
extern crate console_error_panic_hook;
use std::panic;

// ==========================================
// 🗜️ Smaller allocator for reduced WASM size
// ==========================================
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub fn init_panic_hook() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

// ==========================================
// 🕒 Time Binding (Essential for UndoManager)
// ==========================================
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Date)]
    fn now() -> f64;
}

// ==========================================
// 🏷️ Origin Constants (u8-based for fast comparison)
// ==========================================
const ORIGIN_LOCAL_TAG: u8 = 1;
const ORIGIN_REMOTE_TAG: u8 = 2;

/// Helper: create Origin from u8 tag
fn origin_local() -> Origin {
    Origin::from(ORIGIN_LOCAL_TAG)
}

fn origin_remote() -> Origin {
    Origin::from(ORIGIN_REMOTE_TAG)
}

/// Helper: serialize any Serialize-able value to JsValue with maps-as-objects
fn to_js_value(val: &impl Serialize) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    val.serialize(&serializer).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,
    /// Lazy-initialized UndoManager: None until first undo/redo/enable_undo call
    undo_manager: RefCell<Option<UndoManager<()>>>,
}

#[wasm_bindgen]
impl YoinDoc {
    #[wasm_bindgen(constructor)]
    pub fn new() -> YoinDoc {
        let doc = Doc::new();
        // Pre-register commonly used shared types so they exist in the doc
        let _content = doc.get_or_insert_text("content");
        let _root_map = doc.get_or_insert_map("root_map");

        YoinDoc {
            doc,
            undo_manager: RefCell::new(None), // Lazy: not created until needed
        }
    }

    // ==========================================
    // 🔧 UndoManager Lazy Initialization
    // ==========================================

    /// Explicitly enable undo support. Called automatically on first undo()/redo().
    /// JS can also call this to eagerly initialize.
    pub fn enable_undo(&self) {
        self.ensure_undo_manager();
    }

    /// Expand undo scope to track a named shared type (map/text/array).
    /// Must be called after enable_undo or before first undo/redo.
    pub fn expand_undo_scope(&self, type_name: &str) {
        self.ensure_undo_manager();
        let mut mgr = self.undo_manager.borrow_mut();
        if let Some(ref mut mgr) = *mgr {
            // Try map first, then text, then array
            let map = self.doc.get_or_insert_map(type_name);
            mgr.expand_scope(&map);
        }
    }

    /// Internal: Initialize UndoManager if not already created
    fn ensure_undo_manager(&self) {
        let mut mgr = self.undo_manager.borrow_mut();
        if mgr.is_none() {
            let content = self.doc.get_or_insert_text("content");
            let root_map = self.doc.get_or_insert_map("root_map");

            let options = Options {
                capture_timeout_millis: 500,
                tracked_origins: HashSet::from([origin_local()]),
                capture_transaction: Rc::new(|_| true),
                timestamp: Rc::new(|| now() as u64),
            };

            let mut undo = UndoManager::<()>::with_options(&self.doc, &content, options);
            undo.expand_scope(&root_map);
            *mgr = Some(undo);
        }
    }

    // ==========================================
    // ↩️ Undo / Redo API
    // ==========================================

    pub fn undo(&self) -> Result<Vec<u8>, JsValue> {
        self.ensure_undo_manager();
        let sv_before = self.doc.transact().state_vector();
        let mut mgr = self.undo_manager.borrow_mut();
        let result = mgr.as_mut().unwrap().undo();

        match result {
            Ok(true) => Ok(self.doc.transact().encode_diff_v1(&sv_before)),
            Ok(false) => Ok(vec![]),
            Err(e) => Err(JsValue::from_str(&format!("Undo failed: {:?}", e))),
        }
    }

    pub fn redo(&self) -> Result<Vec<u8>, JsValue> {
        self.ensure_undo_manager();
        let sv_before = self.doc.transact().state_vector();
        let mut mgr = self.undo_manager.borrow_mut();
        let result = mgr.as_mut().unwrap().redo();

        match result {
            Ok(true) => Ok(self.doc.transact().encode_diff_v1(&sv_before)),
            Ok(false) => Ok(vec![]),
            Err(e) => Err(JsValue::from_str(&format!("Redo failed: {:?}", e))),
        }
    }

    // ==========================================
    // 📝 Write Operations (Marked as LOCAL)
    // ==========================================

    pub fn insert_text(&self, name: &str, index: u32, chunk: &str) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.insert(&mut txn, index, chunk);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn delete_text(&self, name: &str, index: u32, length: u32) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.remove_range(&mut txn, index, length);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn map_set(&self, map_name: &str, key: &str, value: &str) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            map.insert(&mut txn, key, value);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    #[wasm_bindgen]
    pub fn map_set_deep(&self, root_map_name: &str, path: js_sys::Array, value: JsValue) -> Result<Vec<u8>, JsValue> {
        let path_len = path.length();
        if path_len == 0 {
            return Err(JsValue::from_str("Path cannot be empty"));
        }

        let sv_before = self.doc.transact().state_vector();
        let mut current_map = self.doc.get_or_insert_map(root_map_name);

        {
            let mut txn = self.doc.transact_mut_with(origin_local());

            for i in 0..path_len - 1 {
                let key_js = path.get(i);
                let key = key_js.as_string().ok_or_else(|| JsValue::from_str("Path elements must be strings"))?;

                let next_is_map = matches!(current_map.get(&txn, &key), Some(Value::YMap(_)));

                if next_is_map {
                    if let Some(Value::YMap(m)) = current_map.get(&txn, &key) {
                        current_map = m;
                    }
                } else {
                    let empty: HashMap<String, String> = HashMap::new();
                    let new_map = current_map.insert(&mut txn, key, MapPrelim::from(empty));
                    current_map = new_map;
                }
            }

            let last_key_js = path.get(path_len - 1);
            let last_key = last_key_js.as_string().ok_or_else(|| JsValue::from_str("Last path element must be a string"))?;

            if let Some(s) = value.as_string() {
                current_map.insert(&mut txn, last_key, s);
            } else if let Some(n) = value.as_f64() {
                current_map.insert(&mut txn, last_key, n);
            } else if let Some(b) = value.as_bool() {
                current_map.insert(&mut txn, last_key, b);
            } else {
                return Err(JsValue::from_str("Unsupported type for deep set"));
            }
        }

        let diff = self.doc.transact().encode_diff_v1(&sv_before);
        Ok(diff)
    }

    /// Batch write: execute multiple map_set operations in a single transaction.
    /// entries is a JS Array of [mapName, key, value] triples.
    #[wasm_bindgen]
    pub fn batch_set(&self, entries: js_sys::Array) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();

        // Pre-parse and pre-collect map refs BEFORE opening the mutable transaction
        struct BatchEntry {
            map: yrs::MapRef,
            key: String,
            val: JsValue,
        }

        let mut batch: Vec<BatchEntry> = Vec::new();
        for i in 0..entries.length() {
            let entry = js_sys::Array::from(&entries.get(i));
            if entry.length() < 3 {
                return Err(JsValue::from_str("Each entry must be [mapName, key, value]"));
            }
            let map_name = entry.get(0).as_string()
                .ok_or_else(|| JsValue::from_str("mapName must be a string"))?;
            let key = entry.get(1).as_string()
                .ok_or_else(|| JsValue::from_str("key must be a string"))?;
            let val = entry.get(2);
            let map = self.doc.get_or_insert_map(&*map_name);
            batch.push(BatchEntry { map, key, val });
        }

        {
            let mut txn = self.doc.transact_mut_with(origin_local());
            for e in batch {
                if let Some(s) = e.val.as_string() {
                    e.map.insert(&mut txn, e.key, s);
                } else if let Some(n) = e.val.as_f64() {
                    e.map.insert(&mut txn, e.key, n);
                } else if let Some(b) = e.val.as_bool() {
                    e.map.insert(&mut txn, e.key, b);
                } else {
                    let s = js_sys::JSON::stringify(&e.val)
                        .map(|js_str| js_str.as_string().unwrap_or_default())
                        .unwrap_or_default();
                    e.map.insert(&mut txn, e.key, s);
                }
            }
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn array_push(&self, array_name: &str, value: &str) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.push_back(&mut txn, value);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    // ==========================================
    // 🔍 Read Operations (JsValue — zero-copy to JS)
    // ==========================================

    pub fn get_text(&self, name: &str) -> String {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        text.get_string(&txn)
    }

    /// Returns native JS object directly via serde-wasm-bindgen (no JSON stringify/parse)
    pub fn map_get_all(&self, map_name: &str) -> JsValue {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        let any_data = map.to_json(&txn);
        to_js_value(&any_data)
    }

    /// Kept for backward compatibility — alias of map_get_all
    pub fn map_get_json(&self, map_name: &str) -> JsValue {
        self.map_get_all(map_name)
    }

    /// Returns native JS value for a single key via serde-wasm-bindgen
    pub fn map_get(&self, map_name: &str, key: &str) -> JsValue {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        match map.get(&txn, key) {
            Some(val) => to_js_value(&val.to_json(&txn)),
            None => JsValue::NULL,
        }
    }

    /// Returns native JS array directly via serde-wasm-bindgen (no JSON stringify/parse)
    pub fn array_get_all(&self, array_name: &str) -> JsValue {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        let any_data = arr.to_json(&txn);
        to_js_value(&any_data)
    }

    /// Returns native JS value for a single array index
    pub fn array_get(&self, array_name: &str, index: u32) -> JsValue {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        match arr.get(&txn, index) {
            Some(val) => to_js_value(&val.to_json(&txn)),
            None => JsValue::NULL,
        }
    }

    // ==========================================
    // 🔄 Sync & Remote Operations
    // ==========================================

    pub fn apply_update(&self, update: &[u8]) {
        // 🔥 IMPORTANT: Use origin_remote() so UndoManager ignores these
        let mut txn = self.doc.transact_mut_with(origin_remote());
        if let Ok(update) = Update::decode_v1(update) {
            txn.apply_update(update);
        }
    }

    pub fn export_update(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    pub fn get_state_vector(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.state_vector().encode_v1()
    }

    pub fn export_diff(&self, remote_sv_bin: &[u8]) -> Vec<u8> {
        let txn = self.doc.transact();
        let remote_sv = StateVector::decode_v1(remote_sv_bin).unwrap_or_default();
        txn.encode_diff_v1(&remote_sv)
    }

    // ==========================================
    // 🖥️ Server-side Support
    // ==========================================

    pub fn snapshot(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        let mut encoder = EncoderV1::new();
        txn.encode_state_as_update(&StateVector::default(), &mut encoder);
        encoder.to_vec()
    }

    pub fn get_missing_updates(&self, client_sv_u8: &[u8]) -> Vec<u8> {
        let txn = self.doc.transact();
        let mut decoder = DecoderV1::from(client_sv_u8);
        let client_sv = StateVector::decode(&mut decoder).unwrap_or_default();

        let mut encoder = EncoderV1::new();
        txn.encode_state_as_update(&client_sv, &mut encoder);
        encoder.to_vec()
    }
}

impl Default for YoinDoc {
    fn default() -> Self {
        Self::new()
    }
}