use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encode, Encoder};
use yrs::{Any, Array, Assoc, Doc, GetString, IndexedSequence, Map, MapPrelim, Origin, ReadTxn, StateVector, StickyIndex, Text, Transact, Update};
use yrs::types::{Attrs, ToJson, Value};
use yrs::types::text::YChange;
use yrs::updates::decoder::DecoderV1;
use yrs::updates::encoder::EncoderV1;
use yrs::undo::{UndoManager, Options};
use std::collections::{HashMap, HashSet};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use serde::Serialize;
extern crate console_error_panic_hook;
use std::panic;

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

/// Helper: convert any JsValue into yrs::Any preserving native types (string, f64, bool, null, Array, Object)
fn js_to_any(val: &JsValue) -> Any {
    if val.is_null() {
        Any::Null
    } else if val.is_undefined() {
        Any::Undefined
    } else if let Some(b) = val.as_bool() {
        Any::Bool(b)
    } else if let Some(n) = val.as_f64() {
        Any::Number(n)
    } else if let Some(s) = val.as_string() {
        Any::String(s.into())
    } else if js_sys::Array::is_array(val) {
        let arr = js_sys::Array::from(val);
        let mut vec = Vec::with_capacity(arr.length() as usize);
        for i in 0..arr.length() {
            vec.push(js_to_any(&arr.get(i)));
        }
        Any::Array(vec.into())
    } else if val.is_object() {
        let obj: &js_sys::Object = val.unchecked_ref();
        let entries = js_sys::Object::entries(obj);
        let mut map = HashMap::with_capacity(entries.length() as usize);
        for i in 0..entries.length() {
            let pair = js_sys::Array::from(&entries.get(i));
            if let Some(k) = pair.get(0).as_string() {
                map.insert(k, js_to_any(&pair.get(1)));
            }
        }
        Any::Map(map.into())
    } else {
        Any::Null
    }
}

/// Helper: convert a JS object of formatting attributes into yrs::types::Attrs
fn js_to_attrs(attrs_val: &JsValue) -> Attrs {
    let mut attrs: Attrs = HashMap::new();
    if attrs_val.is_object() && !attrs_val.is_null() && !js_sys::Array::is_array(attrs_val) {
        let obj: &js_sys::Object = attrs_val.unchecked_ref();
        let entries = js_sys::Object::entries(obj);
        for i in 0..entries.length() {
            let pair = js_sys::Array::from(&entries.get(i));
            if let Some(k) = pair.get(0).as_string() {
                attrs.insert(Arc::from(k.as_str()), js_to_any(&pair.get(1)));
            }
        }
    }
    attrs
}

#[derive(Serialize)]
struct DeltaOp {
    insert: Any,
    #[serde(skip_serializing_if = "Option::is_none")]
    attributes: Option<HashMap<String, Any>>,
}

#[derive(Serialize)]
struct ContainerScope {
    kind: String,
    name: String,
}

#[derive(Serialize)]
struct ResolvedPosition {
    index: u32,
    assoc: i8,
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
            let map = self.doc.get_or_insert_map(type_name);
            mgr.expand_scope(&map);
        }
    }

    /// Expand undo scope for a specific shared type kind ("map" | "text" | "array")
    /// without colliding root branch types on the same key.
    pub fn expand_undo_scope_for(&self, type_name: &str, kind: &str) {
        self.ensure_undo_manager();
        let mut mgr = self.undo_manager.borrow_mut();
        if let Some(ref mut mgr) = *mgr {
            match kind {
                "text" => {
                    let text = self.doc.get_or_insert_text(type_name);
                    mgr.expand_scope(&text);
                }
                "array" => {
                    let array = self.doc.get_or_insert_array(type_name);
                    mgr.expand_scope(&array);
                }
                _ => {
                    let map = self.doc.get_or_insert_map(type_name);
                    mgr.expand_scope(&map);
                }
            }
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

    /// Insert rich text with formatting attributes (e.g., { bold: true, color: "#ff0000" })
    pub fn insert_text_with_attrs(&self, name: &str, index: u32, chunk: &str, attrs: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            let yrs_attrs = js_to_attrs(&attrs);
            text.insert_with_attributes(&mut txn, index, chunk, yrs_attrs);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    /// Format an existing range of text with attributes (Quill/Tiptap compatible)
    pub fn format_text(&self, name: &str, index: u32, length: u32, attrs: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            let yrs_attrs = js_to_attrs(&attrs);
            text.format(&mut txn, index, length, yrs_attrs);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    /// Apply a sequence of Quill-compatible Delta operations ({ insert?, delete?, retain?, attributes? })
    /// in a single atomic transaction.
    pub fn apply_text_delta(&self, name: &str, ops: js_sys::Array) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            let mut cursor: u32 = 0;

            for i in 0..ops.length() {
                let op = ops.get(i);
                if !op.is_object() || op.is_null() {
                    continue;
                }
                let insert_val = js_sys::Reflect::get(&op, &JsValue::from_str("insert")).unwrap_or(JsValue::UNDEFINED);
                let delete_val = js_sys::Reflect::get(&op, &JsValue::from_str("delete")).unwrap_or(JsValue::UNDEFINED);
                let retain_val = js_sys::Reflect::get(&op, &JsValue::from_str("retain")).unwrap_or(JsValue::UNDEFINED);
                let attrs_val = js_sys::Reflect::get(&op, &JsValue::from_str("attributes")).unwrap_or(JsValue::UNDEFINED);

                if let Some(chunk) = insert_val.as_string() {
                    let char_len = chunk.encode_utf16().count() as u32;
                    if attrs_val.is_object() && !attrs_val.is_null() {
                        let yrs_attrs = js_to_attrs(&attrs_val);
                        text.insert_with_attributes(&mut txn, cursor, &chunk, yrs_attrs);
                    } else {
                        text.insert(&mut txn, cursor, &chunk);
                    }
                    cursor += char_len;
                } else if let Some(del_len) = delete_val.as_f64() {
                    let len = del_len as u32;
                    if len > 0 {
                        text.remove_range(&mut txn, cursor, len);
                    }
                } else if let Some(ret_len) = retain_val.as_f64() {
                    let len = ret_len as u32;
                    if len > 0 && attrs_val.is_object() && !attrs_val.is_null() {
                        let yrs_attrs = js_to_attrs(&attrs_val);
                        text.format(&mut txn, cursor, len, yrs_attrs);
                    }
                    cursor += len;
                }
            }
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

    pub fn map_set(&self, map_name: &str, key: &str, value: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            map.insert(&mut txn, key, js_to_any(&value));
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn map_delete(&self, map_name: &str, key: &str) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            map.remove(&mut txn, key);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    /// Insert or replace a nested map at `root_map[key]` with given key-value entries in a single atomic transaction.
    /// This enables property-level CRDT merges!
    #[wasm_bindgen]
    pub fn map_insert_nested(&self, root_map_name: &str, key: &str, entries_obj: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let root = self.doc.get_or_insert_map(root_map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());

            let mut map_entries: HashMap<String, Any> = HashMap::new();
            if entries_obj.is_object() && !entries_obj.is_null() && !js_sys::Array::is_array(&entries_obj) {
                let obj: &js_sys::Object = entries_obj.unchecked_ref();
                let entries = js_sys::Object::entries(obj);
                for i in 0..entries.length() {
                    let pair = js_sys::Array::from(&entries.get(i));
                    if let Some(k) = pair.get(0).as_string() {
                        map_entries.insert(k, js_to_any(&pair.get(1)));
                    }
                }
            }

            let prelim = MapPrelim::from(map_entries);
            root.insert(&mut txn, key, prelim);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    /// Update multiple fields of an existing nested map at `root_map[key]`.
    /// If the nested map doesn't exist, it will be created.
    #[wasm_bindgen]
    pub fn map_update_nested(&self, root_map_name: &str, key: &str, updates_obj: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let root = self.doc.get_or_insert_map(root_map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());

            let nested_map = match root.get(&txn, key) {
                Some(Value::YMap(m)) => m,
                _ => {
                    let empty: HashMap<String, Any> = HashMap::new();
                    root.insert(&mut txn, key, MapPrelim::from(empty))
                }
            };

            if updates_obj.is_object() && !updates_obj.is_null() && !js_sys::Array::is_array(&updates_obj) {
                let obj: &js_sys::Object = updates_obj.unchecked_ref();
                let entries = js_sys::Object::entries(obj);
                for i in 0..entries.length() {
                    let pair = js_sys::Array::from(&entries.get(i));
                    if let Some(k) = pair.get(0).as_string() {
                        nested_map.insert(&mut txn, k.as_str(), js_to_any(&pair.get(1)));
                    }
                }
            }
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

            current_map.insert(&mut txn, last_key, js_to_any(&value));
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
            val: Any,
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
            let val = js_to_any(&entry.get(2));
            let map = self.doc.get_or_insert_map(&*map_name);
            batch.push(BatchEntry { map, key, val });
        }

        {
            let mut txn = self.doc.transact_mut_with(origin_local());
            for e in batch {
                e.map.insert(&mut txn, e.key, e.val);
            }
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn array_push(&self, array_name: &str, value: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.push_back(&mut txn, js_to_any(&value));
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn array_insert(&self, array_name: &str, index: u32, value: JsValue) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.insert(&mut txn, index, js_to_any(&value));
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn array_delete(&self, array_name: &str, index: u32, length: u32) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.remove_range(&mut txn, index, length);
        }
        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    // ==========================================
    // 🔍 Read Operations (JsValue zero-copy to JS)
    // ==========================================

    pub fn get_text(&self, name: &str) -> String {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        text.get_string(&txn)
    }

    /// Returns Quill-compatible Delta array: [{ insert: string, attributes?: Record<string, any> }]
    pub fn get_text_delta(&self, name: &str) -> JsValue {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        let diffs = text.diff(&txn, YChange::identity);
        let ops: Vec<DeltaOp> = diffs
            .into_iter()
            .map(|d| {
                let insert = d.insert.to_json(&txn);
                let attributes = d.attributes.map(|boxed| {
                    boxed
                        .into_iter()
                        .map(|(k, v)| (k.to_string(), v))
                        .collect::<HashMap<String, Any>>()
                });
                DeltaOp { insert, attributes }
            })
            .collect();
        to_js_value(&ops)
    }

    /// Create a sticky relative position byte array for a given text container index (Y-07).
    /// assoc < 0 leans left (Before), assoc >= 0 leans right (After).
    pub fn create_relative_position(&self, name: &str, index: u32, assoc: i8) -> Result<Vec<u8>, JsValue> {
        let text = self.doc.get_or_insert_text(name);
        let mut txn = self.doc.transact_mut();
        let yrs_assoc = if assoc < 0 { yrs::Assoc::Before } else { yrs::Assoc::After };
        match text.sticky_index(&mut txn, index, yrs_assoc) {
            Some(sticky) => Ok(sticky.encode_v1()),
            None => Err(JsValue::from_str(&format!("Index {} out of bounds for text '{}'", index, name))),
        }
    }

    /// Resolve a sticky relative position back to an absolute index in the current text document (Y-07).
    pub fn resolve_relative_position(&self, bytes: &[u8]) -> Result<JsValue, JsValue> {
        let sticky = yrs::StickyIndex::decode_v1(bytes)
            .map_err(|e| JsValue::from_str(&format!("Failed to decode sticky index: {:?}", e)))?;
        let txn = self.doc.transact();
        match sticky.get_offset(&txn) {
            Some(off) => {
                let res = ResolvedPosition {
                    index: off.index,
                    assoc: if off.assoc == yrs::Assoc::Before { -1 } else { 0 },
                };
                Ok(to_js_value(&res))
            }
            None => Ok(JsValue::NULL),
        }
    }

    /// Returns native JS object directly via serde-wasm-bindgen (no JSON stringify/parse)
    pub fn map_get_all(&self, map_name: &str) -> JsValue {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        let any_data = map.to_json(&txn);
        to_js_value(&any_data)
    }

    /// Kept for backward compatibility - alias of map_get_all
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

    pub fn apply_update(&self, update: &[u8]) -> Result<JsValue, JsValue> {
        // IMPORTANT: Use origin_remote() so UndoManager ignores these
        let decoded = Update::decode_v1(update)
            .map_err(|e| JsValue::from_str(&format!("Failed to decode update: {:?}", e)))?;
        let mut txn = self.doc.transact_mut_with(origin_remote());
        txn.apply_update(decoded);
        txn.commit();

        let mut scopes = Vec::new();
        let mut seen = HashSet::new();

        for branch in txn.changed_parent_types() {
            let kind = match branch.type_ref() {
                yrs::types::TypeRef::Text => "text",
                yrs::types::TypeRef::Map => "map",
                yrs::types::TypeRef::Array => "array",
                _ => continue,
            };
            if let yrs::branch::BranchID::Root(name) = branch.id() {
                let name_str = name.to_string();
                if seen.insert((kind.to_string(), name_str.clone())) {
                    scopes.push(ContainerScope {
                        kind: kind.to_string(),
                        name: name_str,
                    });
                }
            }
        }

        Ok(to_js_value(&scopes))
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
