# 05 — Reliability Review

## 故障情境矩陣

| 情境 | 控制流程/結果 | 遺失或重複風險 | 偵測/保證 | 必要測試 |
|---|---|---|---|---|
| 本地操作前斷線 | `broadcast` 將 message 放 queue | queue 記憶體內，頁面關閉會遺失 | 無 durable queue | reload/offline persistence |
| 已送出後斷線 | `send` 後直接丟棄，onclose 不回收 in-flight | 可能遺失；無 ACK | 無法偵測 server receipt | close-after-send fault injection |
| server 收到但未確認 | relay 無 ACK | client 只能重做 handshake，依存仍在線 replica | 無 protocol receipt | server drop/close |
| reconnect queue flush | open 時 `forEach(send)` 後清空 | send 失敗/close 中途可能仍清空 | 無 per-message result | close during flush |
| IDB read/write failure | Promise reject；plugin 未 catch | restore/save failure 可能 unhandled，狀態不明 | console/host rejection | reject load/save |
| local write 與 restore race | load fire-and-forget，listener 晚註冊 | local write 可能未 schedule save | 無 ready state | delayed load |
| destroy with pending save | timeout clear，未 flush | 最新 snapshot 可能遺失 | 無 destroy Promise | destroy before debounce |
| 多更新重連 | queue 只在 memory，按順序 flush | 順序通常保留；無 ACK/限額 | 無 queue size/backpressure | large queue/reconnect |
| Worker hibernation | relay 依 DO live sockets，無 doc storage | 全部客戶端離線後新客戶端無 snapshot | 文件有 blind relay 描述 | all clients leave/rejoin |
| 反覆成功/失敗 | 指數退避最多 10 次後 failed | queue 保留但無持久/通知 | status failed；需手動 reconnect | timer/reset tests |

## YOIN-001 — In-flight update 沒有 delivery guarantee

- **Severity：** P1
- **Category：** Reliability / Correctness
- **Status：** Likely
- **Location：** [`network.ts:68-91,137-145`](../../packages/client/src/network.ts)
- **Evidence：** open socket 時 `send` 後沒有 pending set；close 只 schedule reconnect。只有尚未 open 的 message 才進 `messageQueue`。
- **Trigger：** `WebSocket.send(update)` 後在 server receipt 前連線關閉。
- **Impact：** 本地 doc 已變更，但該 replica 的 diff 可能永遠沒有到達其他客戶端；若沒有其他持有該 update 的 replica，重連 handshake 無法恢復。
- **Recommendation：** 使用 update IDs/ACK 或把未確認 frame 保留到確認；重送必須依賴 CRDT idempotence，並有 queue size/backpressure。
- **Regression test：** fake socket 在 send 後 close，重連後驗證 frame 重送且 duplicate 不造成錯誤。
- **Confidence：** High（程式碼證據）；實際資料遺失需 integration test。

## 保證邊界

CRDT 可保證「已被另一個 replica 收到並 apply 的 update」能合併；目前不能保證 browser crash、IDB failure、in-flight disconnect、全客戶端離線後的新 client 可恢復。

