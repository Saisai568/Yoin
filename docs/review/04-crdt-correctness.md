# 04 — CRDT Correctness 與跨端互通性

## 已確認的實作品質

- [`lib.rs:120-156`](../../packages/core/src/lib.rs) 的 local text/map/array writes 以交易前 state vector 產生 V1 diff。
- [`lib.rs:320-350`](../../packages/core/src/lib.rs) 的 `apply_update` 使用 remote origin；Yrs 本身負責重複/亂序 update 的 CRDT 合併。
- [`YoinClient.ts:115-153`](../../packages/client/src/YoinClient.ts) 對 state vector 與 diff 的交換方向和 `lib.rs` API 對得上。
- `cargo check` 通過；client mock 單元測試通過，但不是 WASM/跨 client 證據。

## 未驗證或風險

### YOIN-004 — Undo/Redo 不走完整 update pipeline，scope 也不涵蓋所有資料類型

- **Severity：** P1
- **Category：** Correctness / Reliability
- **Status：** Confirmed
- **Location：** [`plugins/undo.ts:22-46,51-76`](../../packages/client/src/plugins/undo.ts)、[`YoinClient.ts:211-218`](../../packages/client/src/YoinClient.ts)
- **Evidence：** undo/redo 呼叫 `broadcastUpdate`；該方法只 broadcast + notifyListeners，沒有 `onBeforeUpdate`、`onAfterUpdate`、`emitDocUpdate` 或 `emitLocalUpdate`。Rust UndoManager 初始 scope 是 content/root_map，plugin 只對 map/setMapDeep expand，`pushArray` 不 expand。
- **Trigger：** 使用 DB plugin 後 undo/redo，或對 named array 做 push 後 undo。
- **Impact：** undo/redo 後的狀態可能未被 IndexedDB 保存；array undo 行為與文件承諾不一致；自訂 plugin 看不到此類 update。
- **Recommendation：** 將 undo/redo 產生的 diff 送入同一個 local update pipeline；為 array/text/map 定義 scope 和測試。
- **Regression test：** undo/redo 後 reload 保留狀態；remote client 收到；array undo/redo；plugin hooks exactly once。
- **Confidence：** High

## 互通性結論

Yrs V1 encoding 理論上可與同版本 Yjs/Yrs 交換，但 repository 沒有 JavaScript Yjs fixture 或跨實作 test，不能把「使用 Yrs」當成已證明的 Yjs interoperability。最小驗證應用同一 initial state、交換 `encodeStateAsUpdateV1`/state vector、雙向 apply，並比較 Text/Map/Array nested JSON。

## 同步時序與限制

目前是 blind relay 的三向 state-vector handshake。因 server 不保存 snapshot，所有客戶端離線時 relay 喚醒後沒有文件可供新客戶端同步；資料只能從仍持有本地 replica 的客戶端恢復。這是架構保證邊界，不是 Yrs CRDT 保證。

