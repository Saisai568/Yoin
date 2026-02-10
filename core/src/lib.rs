use wasm_bindgen::prelude::*;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;

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
}