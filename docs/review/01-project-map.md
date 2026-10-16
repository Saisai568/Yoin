# 01 — 專案與資料流地圖

## 實際結構

- [`packages/core/src/lib.rs`](../../packages/core/src/lib.rs)：Yrs `Doc` 的 wasm-bindgen API，提供 Text/Map/Array、state vector、V1 update、UndoManager。
- [`packages/client/src/YoinClient.ts`](../../packages/client/src/YoinClient.ts)：文件、protocol header、listeners、awareness、plugin callbacks 與 public CRUD API。
- [`packages/client/src/network.ts`](../../packages/client/src/network.ts)：WebSocket、offline queue、重連。
- [`packages/client/src/storage.ts`](../../packages/client/src/storage.ts)：IndexedDB `documents` object store。
- [`packages/client/src/plugins/db.ts`](../../packages/client/src/plugins/db.ts)：debounced full snapshot persistence。
- [`packages/client/src/plugins/undo.ts`](../../packages/client/src/plugins/undo.ts)：啟用 Yrs UndoManager 並 monkey-patch map writers。
- [`packages/client/src/proxy.ts`](../../packages/client/src/proxy.ts)：Map/Array snapshot proxy。
- [`packages/client/src/react/index.tsx`](../../packages/client/src/react/index.tsx)：Provider、map/array/awareness/status hooks。
- [`yoin-worker/src/index.ts`](../../yoin-worker/src/index.ts)：room URL router 與 Durable Object blind relay。
- [`apps/demo/`](../../apps/demo/)：Vite demo 及 Playwright specs；[`apps/api-test/`](../../apps/api-test/)：browser API test app。

相依方向是 core → client → demo；worker 不直接依賴 client/core。

## 本地寫入資料流

1. App 呼叫 `insertText`/`setMap`/`pushArray` 或 Proxy set。
2. `YoinDoc` 以 local origin 執行交易，從交易前 state vector 編碼 V1 diff。
3. `YoinClient.applyLocalUpdate` 依序執行 plugin before、network broadcast、UI listeners、plugin after、local/doc listeners。
4. Network open 時直接 `WebSocket.send`，非 open 時放進記憶體 queue。
5. DB plugin 將 doc 全量 `export_update()` debounce 寫入 IndexedDB。
6. Worker 只轉發給同一 DO 中的其他 sockets，不保存 update。

## 遠端更新資料流

1. Worker relay 將 binary message 廣播給其他 sockets。
2. client 以第一 byte 判斷 type；`MSG_SYNC_STEP_2` 呼叫 `YoinDoc.apply_update`。
3. client 通知 text listeners、plugin `onAfterUpdate`、doc listeners；DB plugin 因此安排 snapshot save。
4. React hooks 以 JSON snapshot 重新取得資料。

## 初始化/恢復/銷毀

- `initYoin()` 必須先完成，`YoinClient` constructor 才允許建立。
- constructor 立即建立 WebSocket 與 heartbeat；plugin 只能在 constructor 後 `.use()`。
- DB plugin `.onInstall()` fire-and-forget `loadFromDisk()`，沒有 ready promise。
- destroy 清 timer、呼叫 plugin destroy、廣播 awareness offline、再 disconnect network。

## 文件與實作初步差異

- 文件描述「重連後 queue flush」但沒有 delivery acknowledgement；已送出 update 的斷線窗口不在 queue。
- 文件宣稱 public API/production-ready，但 E2E、WASM build、IndexedDB restore 和 relay security 尚未由現有測試證明。
- `CHANGELOG.md` 曾宣稱所有 package 統一為 0.1.0，但目前 root 0.1.0、client/core 0.1.2、Cargo package 0.2.0。
- API 文件列的 `NetworkStatus` 未包含程式實際使用的 `failed`。

