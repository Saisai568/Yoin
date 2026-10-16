# 02 — Architecture Review

## 優點

- Yrs document 與 transport 分離，relay 不需要理解 CRDT。
- `NetworkProvider`、Storage adapter、Plugin、React adapter 有清楚的檔案邊界。
- local/remote origin 的設計保留了未來 Undo/Redo 正確隔離的基礎。

## 問題

### YOIN-002 — DB plugin lifecycle 沒有 ready/flush contract

- **Severity：** P1
- **Category：** Reliability / Architecture
- **Status：** Confirmed（競爭窗口由程式碼直接可見）
- **Location：** [`plugins/db.ts:26-32,44-48,56-85`](../../packages/client/src/plugins/db.ts)
- **Affected flow：** plugin install → restore → local update → destroy。
- **Evidence：** `onInstall` 未 await `loadFromDisk()` 就註冊 listener；`onDestroy` 只 clear timeout，不 await 或 flush pending `persist()`。
- **Trigger：** IndexedDB read 尚未完成時立即寫入，或 debounce 尚未到期就呼叫 `destroy()`。
- **Impact：** local write 可能沒有被 schedule；destroy 後 pending update 可能不會寫入。錯誤也會成為未處理 rejection。
- **Reproduction：** mock `storage.load` 延遲，install 後立即 `setMap`；另在 debounce 到期前 destroy，重新建立 client 檢查 snapshot。
- **Recommendation：** 提供 awaitable `ready`/`restore`；在 restore 完成前排隊 local writes；destroy 先 await/flush save，並明確回報 IDB error。
- **Regression test：** delayed load + immediate write、destroy with pending debounce、load/save rejection。
- **Confidence：** High

### YOIN-006 — Plugin contract 無初始化失敗回滾或非同步 cleanup

- **Severity：** P2
- **Category：** Architecture / API
- **Status：** Confirmed
- **Location：** [`YoinClient.ts:172-178`](../../packages/client/src/YoinClient.ts)、[`plugin.ts:3-16`](../../packages/client/src/plugin.ts)
- **Evidence：** plugin 先 push 再呼叫同步 `onInstall`；interface 沒有 `onInstall` return/Promise，也沒有 dependency/order/error contract。
- **Trigger：** plugin `onInstall` throw，或 plugin 需要非同步 restore。
- **Impact：** client 保留一個未完成 plugin；後續 update 仍可能呼叫它；部分資源無法清理。
- **Recommendation：** 定義 install result/Promise、失敗 rollback、一次性 install/destroy 狀態與明確錯誤傳播。
- **Regression test：** install throw 後 update/destroy 不再呼叫殘留 plugin；async cleanup 完成前 destroy 可 await。
- **Confidence：** High

## 模組責任評估

`YoinClient` 同時管理 doc、protocol、network lifecycle、awareness、schema、plugin hooks 和 CRUD，已是 micro-kernel 名稱下的高耦合中心。此刻不建議全面重構；先抽出「統一 update pipeline」與 lifecycle state machine，因為它們直接解決 YOIN-001/YOIN-002/YOIN-004。

