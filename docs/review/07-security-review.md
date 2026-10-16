# 07 — Security Review

## Threat model

目前 Worker 是 public blind relay：任何可取得 room URL 的 client 都能連線、讀取同 room 的流量、送出任意 protocol bytes。Worker 不解密/驗證 CRDT payload，因此它不是資料授權層。

### YOIN-003 — Relay 沒有 authentication/authorization 與完整訊息驗證

- **Severity：** P1（若用於受保護文件）；public-room 模型下為明確產品限制
- **Category：** Security
- **Status：** Confirmed
- **Location：** [`yoin-worker/src/index.ts:74-112,149-203`](../../yoin-worker/src/index.ts)
- **Affected flow：** WebSocket upgrade → room routing → binary broadcast。
- **Evidence：** `fetch` 僅檢查 Upgrade；room ID 直接 `idFromName`；沒有 token/session/room ACL。`webSocketMessage` 只限制 ArrayBuffer 1 MB，未檢查 empty frame、未知 type、payload encoding 或 sender membership。CORS `Access-Control-Allow-Origin: *`。
- **Trigger：** 未授權者取得/猜到 room ID，或送未知 protocol type/高頻小訊息。
- **Impact：** room 內資料可被讀寫；高頻訊息可消耗 relay/瀏覽器資源。不能安全承載需要存取控制的文件。
- **Recommendation：** 若產品只做 public collaboration，將此模型與 room ID secrecy 明確寫入文件；若支援 protected docs，在 upgrade 前驗證短期 token 與 room scope，並 whitelist message types、非空 payload、per-socket message rate、connection limits 和 audit-safe errors。
- **Regression test：** unauthorized upgrade rejected、wrong room scope rejected、unknown/oversized/high-rate message rejected、same-room-only broadcast。
- **Confidence：** High

## 其他安全觀察

- Rate limiter 是 module-level、per-IP，且只套在 HTTP request；WebSocket 建立後的訊息不受它限制，也不代表跨 isolate/global quota。
- `MSG_AWARENESS` 直接採信 client-provided `clientId`、name、color、timestamp；它不應作為授權依據。這點目前未見被當成 ACL，但應在 contract 中明文。
- Worker 不記錄 payload，降低敏感資料 log 洩漏風險；但前端 console 會把 map/deep values 與 awareness name log 出來，應避免在 production 啟用敏感資料 logging。

