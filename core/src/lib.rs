use wasm_bindgen::prelude::*;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encode, Encoder};
use yrs::{Array, Doc, GetString, Map, MapPrelim, ReadTxn, StateVector, Text, Transact, Update, Origin};
use yrs::types::{ToJson, Value};
use yrs::updates::decoder::{DecoderV1};
use yrs::updates::encoder::{EncoderV1};
use yrs::undo::{UndoManager, Options}; 
use std::collections::{HashMap, HashSet};
use std::cell::RefCell;
use std::rc::Rc;
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

const ORIGIN_LOCAL: &str = "local";
const ORIGIN_REMOTE: &str = "remote";

#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,
    undo_manager: RefCell<UndoManager<()>>,
}

#[wasm_bindgen]
impl YoinDoc {
    #[wasm_bindgen(constructor)]
    pub fn new() -> YoinDoc {
        let doc = Doc::new();

        let content = doc.get_or_insert_text("content");
        let root_map = doc.get_or_insert_map("root_map");
        
        // Configuration options for UndoManager
        // We use JS Date.now() to avoid panic on wasm32-unknown-unknown
        let options = Options {
            capture_timeout_millis: 500,
            tracked_origins: HashSet::from([Origin::from(ORIGIN_LOCAL)]),
            capture_transaction: Rc::new(|_| true),
            timestamp: Rc::new(|| now() as u64), 
        };

        let mut undo_manager = UndoManager::<()>::with_options(&doc, &content, options);
        undo_manager.expand_scope(&root_map);

        YoinDoc {
            doc,
            undo_manager: RefCell::new(undo_manager),
        }
    }

    // ==========================================
    // ↩️ Undo / Redo API
    // ==========================================

    pub fn undo(&self) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        let mut mgr = self.undo_manager.borrow_mut();
        
        let result = mgr.undo();

        match result {
            Ok(changed) => {
                if changed {
                    let diff = self.doc.transact().encode_diff_v1(&sv_before);
                    Ok(diff)
                } else {
                    Ok(vec![])
                }
            },
            Err(e) => Err(JsValue::from_str(&format!("Undo failed: {:?}", e)))
        }
    }

    pub fn redo(&self) -> Result<Vec<u8>, JsValue> {
        let sv_before = self.doc.transact().state_vector();
        let mut mgr = self.undo_manager.borrow_mut();
        
        let result = mgr.redo();

        match result {
            Ok(changed) => {
                if changed {
                    let diff = self.doc.transact().encode_diff_v1(&sv_before);
                    Ok(diff)
                } else {
                    Ok(vec![])
                }
            },
            Err(e) => Err(JsValue::from_str(&format!("Redo failed: {:?}", e)))
        }
    }

    // ==========================================
    // 📝 Write Operations (Marked as LOCAL)
    // ==========================================

    pub fn insert_text(&self, name: &str, index: u32, chunk: &str) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(ORIGIN_LOCAL);
            text.insert(&mut txn, index, chunk);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn delete_text(&self, name: &str, index: u32, length: u32) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(ORIGIN_LOCAL);
            text.remove_range(&mut txn, index, length); 
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn map_set(&self, map_name: &str, key: &str, value: &str) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(ORIGIN_LOCAL);
            map.insert(&mut txn, key, value);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
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
            let mut txn = self.doc.transact_mut_with(ORIGIN_LOCAL);
            
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

    // ==========================================
    // 🔍 Read Operations
    // ==========================================

    pub fn get_text(&self, name: &str) -> String {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        text.get_string(&txn)
    }

    pub fn map_get_all(&self, map_name: &str) -> String {
         let map = self.doc.get_or_insert_map(map_name);
         let txn = self.doc.transact();
         let any_data = map.to_json(&txn);
         serde_json::to_string(&any_data).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn map_get_json(&self, map_name: &str) -> JsValue {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        let any_value = map.to_json(&txn);
        serde_wasm_bindgen::to_value(&any_value).unwrap_or(JsValue::NULL)
    }

    pub fn map_get(&self, map_name: &str, key: &str) -> String {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        match map.get(&txn, key) {
            Some(val) => serde_json::to_string(&val.to_json(&txn)).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        }
    }

    pub fn array_push(&self, array_name: &str, value: &str) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(ORIGIN_LOCAL);
            arr.push_back(&mut txn, value);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn array_get_all(&self, array_name: &str) -> String {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        let any_data = arr.to_json(&txn);
        serde_json::to_string(&any_data).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn array_get(&self, array_name: &str, index: u32) -> String {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        match arr.get(&txn, index) {
            Some(val) => serde_json::to_string(&val.to_json(&txn)).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        }
    }

    // ==========================================
    // 🔄 Sync & Remote Operations
    // ==========================================

    pub fn apply_update(&self, update: &[u8]) {
        // 🔥 IMPORTANT: Use transact_mut_with(ORIGIN_REMOTE)
        // This ensures these changes are IGNORED by UndoManager
        let mut txn = self.doc.transact_mut_with(ORIGIN_REMOTE);
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