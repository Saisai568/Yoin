# 03 — API Review

## 問題

### YOIN-005 — Proxy 讀寫語意不是 live/native object semantics

- **Severity：** P2
- **Category：** API / Correctness
- **Status：** Confirmed
- **Location：** [`proxy.ts:7-29,33-78,83-136`](../../packages/client/src/proxy.ts)
- **Affected flow：** `createMapProxy`/`createArrayProxy` 讀寫與 React render。
- **Evidence：** Array 在建立時只讀一次 snapshot；index assignment 只 warn 並回傳 true；push 回傳 `items.length` 而非新 array length；Map 沒有 `delete`/`has`/`ownKeys`，deep read 只解析原始 map value，不會把 `setMap` JSON object 轉成 nested proxy。
- **Trigger：** 建立 proxy 後收到 remote update、使用 `logs[0] = x`、`logs.push(a,b)`、或 `settings.options.enabled`（其中 options 是 `setMap` 的 JSON object）。
- **Impact：** UI 可能看到舊資料；使用者以為操作成功但實際未寫入；標準 JS 直覺與文件「transparent writes」不一致。
- **Recommendation：** 明確縮小 API（改名 snapshot/write facade）或實作 live reads、supported operation guards、正確 push return、delete/has/iteration contract。
- **Regression test：** remote update 後讀取、nested object、push return、unsupported assignment 應 throw 或明確回傳 false。
- **Confidence：** High

### YOIN-009 — API 文件與 runtime status 型別不一致

- **Severity：** P2
- **Category：** API / Documentation
- **Status：** Confirmed
- **Location：** [`types.ts:31`](../../packages/client/src/types.ts)、[`docs/API.md:883`](../../docs/API.md)
- **Evidence：** runtime type 有 `'failed'`，API 文件列出的 union 只有 connecting/online/offline。
- **Impact：** 使用者無法依文件完整處理 terminal reconnect failure。
- **Recommendation：** 同步文件與型別，並說明 `failed` 後 `reconnect()` 的行為。
- **Regression test：** docs/API snippet type-check，failure transition test。
- **Confidence：** High

## 其他 API 觀察

- `insertText`、`deleteText` 回傳 `Promise<void>`，但實際沒有 awaitable network/IDB completion；文件應說明「local CRDT mutation accepted」而非 persisted/synced。
- `subscribeNetwork` 沒有 unsubscribe return，與其他 subscribe API 不一致，可能造成長壽命頁面 listener 累積。
- `getMap`/`getArray` 在 decode 失敗時靜默把字串當 raw string，需文件化資料型別限制或提供明確 serialization contract。

