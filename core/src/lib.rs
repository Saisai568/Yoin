use wasm_bindgen::prelude::*;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
// 在 lib.rs 最上方的 use 區塊，加入 Map, Array
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update, Map, Array};
use yrs::types::ToJson; //  加入這行！把 ToJson 特徵帶入作用域

#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,
}

#[wasm_bindgen]
impl YoinDoc {
    #[wasm_bindgen(constructor)]
    pub fn new() -> YoinDoc {
        // 設定 ClientID 選項
        let options = yrs::Options::default();
        YoinDoc { doc: Doc::with_options(options) }
    }

    pub fn get_text(&self, name: &str) -> String {
        let text = self.doc.get_or_insert_text(name);
        let txn = self.doc.transact();
        // 這裡現在可以編譯了，因為我們引入了 GetString Trait
        text.get_string(&txn)
    }

    pub fn insert_text(&self, name: &str, index: u32, chunk: &str) {
        let text = self.doc.get_or_insert_text(name);
        let mut txn = self.doc.transact_mut();
        // insert 方法通常來自 Text Trait，所以上面也引入了 Text
        text.insert(&mut txn, index, chunk);
    }

    pub fn export_update(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        // 這裡使用的是 ReadTxn Trait 提供的方法，不需要 Encode Trait
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    pub fn apply_update(&self, update: &[u8]) {
        let mut txn = self.doc.transact_mut();
        // 這裡需要 Decode Trait (已引入)
        let update = Update::decode_v1(update).expect("failed to decode update");
        txn.apply_update(update);
    }
    // 新增：獲取目前的狀態向量 (State Vector)
    // 這代表了目前這份文件的「時間點」或「進度條」
    pub fn get_state_vector(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.state_vector().encode_v1()
    }

    // 新增：根據外部提供的 State Vector，匯出增量更新
    // 想像成：對方跟我說「我目前進度到 X」，我回覆「X 之後的所有內容」
    pub fn export_diff(&self, remote_sv_bin: &[u8]) -> Vec<u8> {
        let txn = self.doc.transact();
        let remote_sv = StateVector::decode_v1(remote_sv_bin)
            .expect("Failed to decode remote StateVector");
        
        // 只編碼 remote_sv 之後的變更
        txn.encode_diff_v1(&remote_sv)
    }

    // 核心優化：insert_text 現在直接回傳它產生的 update
    // 這樣前端就不需要再去計算 diff，直接拿這個 return 去廣播即可
    pub fn insert_and_get_update(&self, name: &str, index: u32, chunk: &str) -> Vec<u8> {
        // 1. 記錄操作前的狀態
        let sv_before = {
            let txn = self.doc.transact();
            txn.state_vector()
        };

        // 2. 執行插入
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut();
            text.insert(&mut txn, index, chunk);
        }

        // 3. 匯出「剛才那個動作」產生的增量
        let txn = self.doc.transact();
        txn.encode_diff_v1(&sv_before)
    }

    /// 刪除指定範圍的文字，並回傳增量 Update
    pub fn delete_text_and_get_update(&self, name: &str, index: u32, length: u32) -> Vec<u8> {
        // 1. 記錄動作前的狀態
        let sv_before = { self.doc.transact().state_vector() };
        
        // 2. 執行刪除動作
        {
            let text = self.doc.get_or_insert_text(name);
            let mut txn = self.doc.transact_mut();
            // 呼叫 yrs 內建的 remove 方法
            text.remove_range(&mut txn, index, length); 
        }
        
        // 3. 計算並回傳 Diff
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    // ==========================================
    // 📦 MAP (鍵值對) 操作 API
    // ==========================================

    /// 設定 Map 中的 Key-Value，並回傳增量 Update
    pub fn map_set_and_get_update(&self, map_name: &str, key: &str, value: &str) -> Vec<u8> {
        let sv_before = { self.doc.transact().state_vector() };
        {
            let map = self.doc.get_or_insert_map(map_name);
            let mut txn = self.doc.transact_mut();
            map.insert(&mut txn, key, value); // 將值寫入 Map
        }
        // 回傳此動作產生的 Diff
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    /// 取得整個 Map 的內容 (以 JSON 字串格式回傳)
    pub fn map_get_all(&self, map_name: &str) -> String {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        let any_data = map.to_json(&txn);
        
        //  使用 serde_json 保證轉出 100% 標準的 JSON 字串 如果轉換失敗，則 fallback 回傳空的 JSON 物件 "{}"
        serde_json::to_string(&any_data).unwrap_or_else(|_| "{}".to_string())
    }

    /// 只讀取 Map 中的特定 Key，避免全量序列化
    pub fn map_get(&self, map_name: &str, key: &str) -> String {
        let map = self.doc.get_or_insert_map(map_name);
        let txn = self.doc.transact();
        
        match map.get(&txn, key) {
            Some(val) => serde_json::to_string(&val.to_json(&txn)).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        }
    }

    // ==========================================
    // 📚 ARRAY (陣列) 操作 API
    // ==========================================

    /// 在 Array 尾端推入新資料，並回傳增量 Update
    pub fn array_push_and_get_update(&self, array_name: &str, value: &str) -> Vec<u8> {
        let sv_before = { self.doc.transact().state_vector() };
        {
            let arr = self.doc.get_or_insert_array(array_name);
            let mut txn = self.doc.transact_mut();
            arr.push_back(&mut txn, value); // 推入 Array
        }
        self.doc.transact().encode_diff_v1(&sv_before)
    }

    /// 取得整個 Array 的內容 (以 JSON 字串格式回傳)
    pub fn array_get_all(&self, array_name: &str) -> String {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        let any_data = arr.to_json(&txn);
    
        serde_json::to_string(&any_data).unwrap_or_else(|_| "[]".to_string())
    }

    /// 只讀取 Array 中的特定 Index
    pub fn array_get(&self, array_name: &str, index: u32) -> String {
        let arr = self.doc.get_or_insert_array(array_name);
        let txn = self.doc.transact();
        
        match arr.get(&txn, index) {
            Some(val) => serde_json::to_string(&val.to_json(&txn)).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        }
    }
}