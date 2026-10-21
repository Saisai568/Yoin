use std::collections::{HashMap, HashSet};
use yrs::types::text::YChange;
use yrs::types::{Attrs, ToJson, Value};
use yrs::undo::{Options, UndoManager};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encode, Encoder, EncoderV1};
use yrs::{Any, Array, Assoc, Doc, GetString, IndexedSequence, Map, MapPrelim, Origin, ReadTxn, StateVector, StickyIndex, Text, Transact, Update};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const ORIGIN_LOCAL_TAG: u8 = 1;
pub const ORIGIN_REMOTE_TAG: u8 = 2;

pub fn origin_local() -> Origin {
    Origin::from(ORIGIN_LOCAL_TAG)
}

pub fn origin_remote() -> Origin {
    Origin::from(ORIGIN_REMOTE_TAG)
}

#[derive(Error, Debug)]
pub enum YoinError {
    #[error("Failed to decode update: {0}")]
    DecodeError(String),
    #[error("Undo operation failed: {0}")]
    UndoError(String),
    #[error("Redo operation failed: {0}")]
    RedoError(String),
    #[error("Invalid path: {0}")]
    PathError(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TextDeltaOp {
    pub insert: Any,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attributes: Option<HashMap<String, Any>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct ContainerScope {
    pub kind: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ResolvedPosition {
    pub index: u32,
    pub assoc: i8,
}

pub struct YoinDocCore {
    doc: Doc,
    undo_manager: Option<UndoManager<()>>,
}

impl YoinDocCore {
    pub fn new() -> Self {
        let doc = Doc::new();
        let _content = doc.get_or_insert_text("content");
        let _root_map = doc.get_or_insert_map("root_map");

        Self {
            doc,
            undo_manager: None,
        }
    }

    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    pub fn ensure_undo_manager(&mut self, now_ms: u64) {
        if self.undo_manager.is_none() {
            let content = self.doc.get_or_insert_text("content");
            let root_map = self.doc.get_or_insert_map("root_map");

            let options = Options {
                capture_timeout_millis: 500,
                tracked_origins: HashSet::from([origin_local()]),
                capture_transaction: std::rc::Rc::new(|_| true),
                timestamp: std::rc::Rc::new(move || now_ms),
            };

            let mut undo = UndoManager::<()>::with_options(&self.doc, &content, options);
            undo.expand_scope(&root_map);
            self.undo_manager = Some(undo);
        }
    }

    pub fn expand_undo_scope_for(&mut self, type_name: &str, kind: &str, now_ms: u64) {
        self.ensure_undo_manager(now_ms);
        if let Some(ref mut mgr) = self.undo_manager {
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

    pub fn undo(&mut self, now_ms: u64) -> Result<Vec<u8>, YoinError> {
        self.ensure_undo_manager(now_ms);
        let sv_before = self.doc.transact().state_vector();
        let mgr = self.undo_manager.as_mut().unwrap();
        match mgr.undo() {
            Ok(true) => Ok(self.doc.transact().encode_diff_v1(&sv_before)),
            Ok(false) => Ok(vec![]),
            Err(e) => Err(YoinError::UndoError(format!("{:?}", e))),
        }
    }

    pub fn redo(&mut self, now_ms: u64) -> Result<Vec<u8>, YoinError> {
        self.ensure_undo_manager(now_ms);
        let sv_before = self.doc.transact().state_vector();
        let mgr = self.undo_manager.as_mut().unwrap();
        match mgr.redo() {
            Ok(true) => Ok(self.doc.transact().encode_diff_v1(&sv_before)),
            Ok(false) => Ok(vec![]),
            Err(e) => Err(YoinError::RedoError(format!("{:?}", e))),
        }
    }

    // ==========================================
    // 📝 Text API
    // ==========================================

    pub fn insert_text(&self, name: &str, index: u32, chunk: &str) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.insert(&mut txn, index, chunk);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn insert_text_with_attrs(&self, name: &str, index: u32, chunk: &str, attrs: Attrs) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.insert_with_attributes(&mut txn, index, chunk, attrs);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn format_text(&self, name: &str, index: u32, length: u32, attrs: Attrs) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.format(&mut txn, index, length, attrs);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn delete_text(&self, name: &str, index: u32, length: u32) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            text.remove_range(&mut txn, index, length);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn get_text(&self, name: &str) -> String {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        text.get_string(&txn)
    }

    pub fn get_text_delta(&self, name: &str) -> Vec<TextDeltaOp> {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        let diffs = text.diff(&txn, YChange::identity);
        diffs
            .into_iter()
            .map(|d| {
                let insert = d.insert.to_json(&txn);
                let attributes = d.attributes.map(|boxed| {
                    boxed
                        .into_iter()
                        .map(|(k, v)| (k.to_string(), v))
                        .collect::<HashMap<String, Any>>()
                });
                TextDeltaOp { insert, attributes }
            })
            .collect()
    }

    /// Create a sticky relative position byte array for a given text container index (Y-07).
    /// assoc < 0 leans left (Before), assoc >= 0 leans right (After).
    pub fn create_relative_position(&self, name: &str, index: u32, assoc: i8) -> Result<Vec<u8>, YoinError> {
        let text = self.doc.get_or_insert_text(name);
        let mut txn = self.doc.transact_mut();
        let yrs_assoc = if assoc < 0 { Assoc::Before } else { Assoc::After };
        match text.sticky_index(&mut txn, index, yrs_assoc) {
            Some(sticky) => Ok(sticky.encode_v1()),
            None => Err(YoinError::PathError(format!("Index {} out of bounds for text '{}'", index, name))),
        }
    }

    /// Resolve a sticky relative position back to an absolute index in the current text document (Y-07).
    pub fn resolve_relative_position(&self, bytes: &[u8]) -> Result<Option<ResolvedPosition>, YoinError> {
        let sticky = StickyIndex::decode_v1(bytes)
            .map_err(|e| YoinError::DecodeError(format!("{:?}", e)))?;
        let txn = self.doc.transact();
        match sticky.get_offset(&txn) {
            Some(off) => Ok(Some(ResolvedPosition {
                index: off.index,
                assoc: if off.assoc == Assoc::Before { -1 } else { 0 },
            })),
            None => Ok(None),
        }
    }

    // ==========================================
    // 🗺️ Map API
    // ==========================================

    pub fn map_set(&self, map_name: &str, key: &str, value: Any) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            map.insert(&mut txn, key, value);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn map_delete(&self, map_name: &str, key: &str) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            map.remove(&mut txn, key);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn map_get(&self, map_name: &str, key: &str) -> Option<Any> {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        map.get(&txn, key).map(|v| v.to_json(&txn))
    }

    pub fn map_get_all(&self, map_name: &str) -> Any {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        map.to_json(&txn)
    }

    /// Insert or replace a nested map at `root_map[key]` with given key-value entries in a single atomic transaction.
    /// This enables property-level CRDT merges!
    pub fn map_insert_nested(&self, root_map_name: &str, key: &str, entries: HashMap<String, Any>) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let root = self.doc.get_or_insert_map(root_map_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            let prelim = MapPrelim::from(entries);
            root.insert(&mut txn, key, prelim);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    /// Update multiple fields of an existing nested map at `root_map[key]`.
    /// If the nested map doesn't exist, it will be created.
    pub fn map_update_nested(&self, root_map_name: &str, key: &str, updates: HashMap<String, Any>) -> Vec<u8> {
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

            for (k, v) in updates {
                nested_map.insert(&mut txn, k, v);
            }
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn map_set_deep(&self, root_map_name: &str, path: &[String], value: Any) -> Result<Vec<u8>, YoinError> {
        if path.is_empty() {
            return Err(YoinError::PathError("Path cannot be empty".to_string()));
        }

        let sv_before = self.doc.transact().state_vector();
        let mut current_map = self.doc.get_or_insert_map(root_map_name);

        {
            let mut txn = self.doc.transact_mut_with(origin_local());

            for key in &path[0..path.len() - 1] {
                let next_is_map = matches!(current_map.get(&txn, key), Some(Value::YMap(_)));

                if next_is_map {
                    if let Some(Value::YMap(m)) = current_map.get(&txn, key) {
                        current_map = m;
                    }
                } else {
                    let empty: HashMap<String, String> = HashMap::new();
                    let new_map = current_map.insert(&mut txn, key.as_str(), MapPrelim::from(empty));
                    current_map = new_map;
                }
            }

            let last_key = &path[path.len() - 1];
            current_map.insert(&mut txn, last_key.as_str(), value);
        }

        Ok(self.doc.transact().encode_diff_v1(&sv_before))
    }

    pub fn batch_set(&self, entries: Vec<(String, String, Any)>) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let mut txn = self.doc.transact_mut_with(origin_local());
            for (map_name, key, val) in entries {
                let map = self.doc.get_or_insert_map(&*map_name);
                map.insert(&mut txn, key, val);
            }
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    // ==========================================
    // 📚 Array API
    // ==========================================

    pub fn array_push(&self, array_name: &str, value: Any) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.push_back(&mut txn, value);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn array_insert(&self, array_name: &str, index: u32, value: Any) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.insert(&mut txn, index, value);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn array_delete(&self, array_name: &str, index: u32, length: u32) -> Vec<u8> {
        let sv_before = self.doc.transact().state_vector();
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut_with(origin_local());
            arr.remove_range(&mut txn, index, length);
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    pub fn array_get_all(&self, array_name: &str) -> Any {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        arr.to_json(&txn)
    }

    pub fn array_get(&self, array_name: &str, index: u32) -> Option<Any> {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        arr.get(&txn, index).map(|v| v.to_json(&txn))
    }

    // ==========================================
    // 🔄 Sync & Snapshot
    // ==========================================

    /// Apply an update binary, returning affected root container scopes (Y-03)
    /// or an error if decoding fails (Y-06).
    pub fn apply_update(&self, update: &[u8]) -> Result<Vec<ContainerScope>, YoinError> {
        let decoded = Update::decode_v1(update)
            .map_err(|e| YoinError::DecodeError(format!("{:?}", e)))?;
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

        Ok(scopes)
    }

    pub fn export_update(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    pub fn get_state_vector(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.state_vector().encode_v1()
    }

    pub fn export_diff(&self, remote_sv_bin: &[u8]) -> Result<Vec<u8>, YoinError> {
        let txn = self.doc.transact();
        let remote_sv = StateVector::decode_v1(remote_sv_bin)
            .map_err(|e| YoinError::DecodeError(format!("{:?}", e)))?;
        Ok(txn.encode_diff_v1(&remote_sv))
    }

    pub fn snapshot(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        let mut encoder = EncoderV1::new();
        txn.encode_state_as_update(&StateVector::default(), &mut encoder);
        encoder.to_vec()
    }
}

impl Default for YoinDocCore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nested_map_crud_and_merge() {
        let doc1 = YoinDocCore::new();
        let doc2 = YoinDocCore::new();

        // 1. Doc1 inserts a nested shape
        let mut shape1 = HashMap::new();
        shape1.insert("type".to_string(), Any::String("rect".into()));
        shape1.insert("x".to_string(), Any::Number(10.0));
        shape1.insert("y".to_string(), Any::Number(20.0));
        shape1.insert("fill".to_string(), Any::String("red".into()));

        let u1 = doc1.map_insert_nested("shapes", "rect_1", shape1);
        doc2.apply_update(&u1).unwrap();

        // 2. Doc1 updates x (moves shape), Doc2 updates fill (changes color)
        let mut move_update = HashMap::new();
        move_update.insert("x".to_string(), Any::Number(100.0));
        let u_move = doc1.map_update_nested("shapes", "rect_1", move_update);

        let mut color_update = HashMap::new();
        color_update.insert("fill".to_string(), Any::String("blue".into()));
        let u_color = doc2.map_update_nested("shapes", "rect_1", color_update);

        // 3. Sync between doc1 and doc2
        doc1.apply_update(&u_color).unwrap();
        doc2.apply_update(&u_move).unwrap();

        // 4. Verify property-level merge: both x=100 and fill="blue" are preserved!
        let shapes1 = doc1.map_get_all("shapes");
        let shapes2 = doc2.map_get_all("shapes");
        assert_eq!(shapes1, shapes2);

        if let Any::Map(map) = shapes1 {
            let rect_any = map.get("rect_1").expect("rect_1 must exist");
            if let Any::Map(rect) = rect_any {
                assert_eq!(rect.get("x"), Some(&Any::Number(100.0)));
                assert_eq!(rect.get("y"), Some(&Any::Number(20.0)));
                assert_eq!(rect.get("fill"), Some(&Any::String("blue".into())));
                assert_eq!(rect.get("type"), Some(&Any::String("rect".into())));
            } else {
                panic!("rect_1 should be a Map");
            }
        } else {
            panic!("shapes should be a Map");
        }
    }

    #[test]
    fn test_remote_change_events_scope_extraction() {
        let doc1 = YoinDocCore::new();
        let doc2 = YoinDocCore::new();

        // Pre-register containers so Yrs recognizes their branch types
        let _ = doc2.doc.get_or_insert_text("notes");
        let _ = doc2.doc.get_or_insert_map("shapes");
        let _ = doc2.doc.get_or_insert_array("items");

        // 1. Text update on doc1 -> apply to doc2 -> should return text:notes scope
        let u_text = doc1.insert_text("notes", 0, "hello");
        let scopes1 = doc2.apply_update(&u_text).unwrap();
        assert_eq!(scopes1.len(), 1);
        assert_eq!(scopes1[0], ContainerScope { kind: "text".into(), name: "notes".into() });

        // 2. Nested map insertion on doc1 -> apply to doc2 -> should return map:shapes scope
        let mut shape = HashMap::new();
        shape.insert("type".to_string(), Any::String("circle".into()));
        let u_nested = doc1.map_insert_nested("shapes", "c1", shape);
        let scopes2 = doc2.apply_update(&u_nested).unwrap();
        assert_eq!(scopes2.len(), 1);
        assert_eq!(scopes2[0], ContainerScope { kind: "map".into(), name: "shapes".into() });

        // 3. Array push on doc1 -> apply to doc2 -> should return array:items scope
        let u_arr = doc1.array_push("items", Any::String("task_1".into()));
        let scopes3 = doc2.apply_update(&u_arr).unwrap();
        assert_eq!(scopes3.len(), 1);
        assert_eq!(scopes3[0], ContainerScope { kind: "array".into(), name: "items".into() });
    }

    #[test]
    fn test_relative_position_tracking() {
        let doc1 = YoinDocCore::new();
        let doc2 = YoinDocCore::new();

        let _ = doc2.doc.get_or_insert_text("content");

        // 1. Initial text: "hello world"
        let u1 = doc1.insert_text("content", 0, "hello world");
        let _ = doc2.apply_update(&u1).unwrap();

        // 2. Create relative position at index 5 (right after "hello", assoc: After)
        let rel_pos = doc2.create_relative_position("content", 5, 0).unwrap();
        let resolved_before = doc2.resolve_relative_position(&rel_pos).unwrap().unwrap();
        assert_eq!(resolved_before.index, 5);

        // 3. Insert "(prepended) " (12 chars) at index 0 on doc1
        let u2 = doc1.insert_text("content", 0, "(prepended) ");
        let _ = doc2.apply_update(&u2).unwrap();

        // 4. Resolve relative position on doc2 -> index must stick to 5 + 12 = 17!
        let resolved_after = doc2.resolve_relative_position(&rel_pos).unwrap().unwrap();
        assert_eq!(resolved_after.index, 17);
    }
}
