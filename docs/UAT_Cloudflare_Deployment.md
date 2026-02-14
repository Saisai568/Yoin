# Yoin 線上環境全面功能驗收測試 (UAT)

**測試目標**：驗證 Yoin 專案部署至 Cloudflare Workers (Backend/DO) 與 Pages (Frontend/WASM) 之整合功能是否正常運作。
**測試日期**：2026/02/14
**環境 URL**：
- 前端 (Client): [https://yoin-example.sai568.cc](https://yoin-example.sai568.cc)
- 後端 (Worker): `wss://yoin-worker.saiguanen.workers.dev` (已內建於前端 Config)

---

## 1. 基礎連線與環境檢查 (Environment & Connectivity)

| ID | 測試項目 | 步驟 | 預期結果 | 狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **ENV-01** | HTTPS 安全連線 | 瀏覽器開啟 [yoin-example.sai568.cc](https://yoin-example.sai568.cc) | 網址列顯示鎖頭圖示，無 SSL 警告。 | ⬜ |
| **ENV-02** | WASM 載入正確 | 開啟 DevTools (F12) -> Network 分頁，過濾 `.wasm` | `core_bg.wasm` 請求成功 (Status 200)，且 Response Header 包含 `Cross-Origin-Opener-Policy: same-origin` / `Embedder-Policy: require-corp`。 | ⬜ |
| **ENV-03** | WebSocket 連線 | 開啟 DevTools (F12) -> Network -> WS 分頁 | 看到 `wss://yoin-worker.../room/...` 連線建立，Status 101 Switching Protocols。 | ⬜ |

---

## 2. 單人編輯功能 (Single User Editor)

| ID | 測試項目 | 步驟 | 預期結果 | 狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **EDT-01** | 文字輸入 | 在編輯器中輸入 "Hello Yoin Cloud" | 文字正常顯示，Console 無報錯。 | ⬜ |
| **EDT-02** | 本地刷新持久化 | 輸入文字後，按 F5 重新整理頁面 | 頁面重載後，剛剛輸入的文字 "Hello Yoin Cloud" 依然存在 (驗證 IndexedDB 運作)。 | ⬜ |
| **EDT-03** | 離線編輯測試 | 1. 斷開網路 (或 DevTools Offline 模式)<br>2. 輸入 "Offline Text"<br>3. 恢復網路 | 斷網期間可輸入；恢復網路後 Console 顯示 WebSocket Reconnected，且資料未遺失。 | ⬜ |

---

## 3. 多人即時協作 (Real-time Collaboration)

**前置條件**：開啟兩個瀏覽器視窗 (A 與 B)，並進入**同一個房間** (例如網址皆帶參數 `?room=test-room-01`)。

| ID | 測試項目 | 步驟 | 預期結果 | 狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **COL-01** | 文字同步 | 視窗 A 輸入 "User A typing..." | 視窗 B **幾乎同時** (<100ms) 出現相同文字。 | ⬜ |
| **COL-02** | 感知狀態 (Awareness) | 視窗 A 的滑鼠在畫面上移動 | 視窗 B 看到標示 User A 名字的游標跟隨軌跡移動。 | ⬜ |
| **COL-03** | 用戶加入/離開 | 關閉視窗 B | 視窗 A 的使用者列表中，User B 的頭像或狀態應消失 (或變灰)。 | ⬜ |
| **COL-04** | 衝突解決 (CRDT) | 斷開兩者網路 -> A 輸入 "111" -> B 輸入 "222" -> 同時恢復網路 | 兩端內容最終一致 (例如變成 "111222" 或 "222111"，不能缺漏)。 | ⬜ |

---

## 4. 進階 React 整合測試 (React Integration)

**前置條件**：進入 React Demo 頁面 (若預設為原生 JS 頁面，請確認 React 入口 URL，例如 `/react.html` 或首頁切換)。

| ID | 測試項目 | 步驟 | 預期結果 | 狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **RCT-01** | 計數器同步 (useYoinMap) | 視窗 A 點擊 "Counter +1" 按鈕 | 視窗 A 數值增加；視窗 B 的計數器數字同步增加。 | ⬜ |
| **RCT-02** | Todo List 同步 (useYoinArray) | 視窗 A 新增項目 "Buy Milk" | 視窗 B 的清單同步出現 "Buy Milk"。 | ⬜ |
| **RCT-03** | 佈景主題同步 (Schema) | 視窗 A 切換 Dark Mode | 視窗 B 若有訂閱設定，應同步切換為 Dark Mode (視實作邏輯)。 | ⬜ |

---

## 5. 異常狀況測試 (Edge Cases)

| ID | 測試項目 | 步驟 | 預期結果 | 狀態 |
| :--- | :--- | :--- | :--- | :--- |
| **ERR-01** | 錯誤的房間 ID | 手動修改網址嘗試注入特殊字元 `?room=../../hack` | 系統應正常載入或導向預設房間，後端無崩潰 (500 Error)。 | ⬜ |
| **ERR-02** | 長時間閒置 | 放置頁面 10 分鐘不動 | 回來操作時，WebSocket 若斷線應自動重連，編輯操作依然有效。 | ⬜ |

---

## 測試結果摘要

*   **測試者**: __________________
*   **總結狀態**: ✅ 通過 / ⚠️ 部分通過 / ❌ 失敗
*   **備註/待修問題**:
    1.
    2.
