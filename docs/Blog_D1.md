# **用 Rust 與 WASM 打造 Local-First 同步引擎：從零到 MVP 的實戰紀錄**(Day 1 MVP)

**前言：**

在這個雲端優先的時代，我們習慣了「沒網路就沒功能」。但 Local-First 軟體（如 Linear, Notion）正在改變這一切。我的目標是用一年的時間，打造一個高效能、開發者友善的狀態同步框架。今天，我完成了第一個 MVP：一個具備離線儲存與即時協作功能的原型。

**技術堆疊 (The Stack)：**

為了追求極致效能與安全性，我選擇了這套架構：

- **Core:** Rust + `yrs` (CRDT library) — 負責處理複雜的合併邏輯與衝突解決。
- **Runtime:** WebAssembly (WASM) — 讓 Rust 核心在瀏覽器中高效運行。
- **Storage:** IndexedDB — 實現「離線是常態」，資料優先寫入本地。
- **Network:** WebSocket (Node.js Relay) — 負責將二進制更新廣播給其他客戶端。

**核心突破 (The Breakthrough)：**

今天的挑戰在於打通 Rust 與 JavaScript 的任督二脈。

透過 `wasm-bindgen`，我成功將 Rust 的 `SyncDoc` 封裝成 JS 類別。當使用者在前端輸入文字時：

1. JS 呼叫 WASM，Rust 核心計算出 Update。
2. 這個二進制 Update 同時被寫入 IndexedDB (持久化) 與 WebSocket (廣播)。
3. 另一端的客戶端收到二進制流，直接餵給 WASM 進行 `apply_update`。

**成果展示：** 目前已實現兩個瀏覽器視窗的「即時同步」。A 視窗輸入文字，B 視窗在毫秒級內自動更新，且支援斷線重連後的資料還原。最重要的是，**這一切都不依賴中心化資料庫來保存狀態，伺服器僅僅是一個傳聲筒**。 

**下一步：** 目前的同步是「全量傳輸」（Full State），隨著文件變大，頻寬消耗會很驚人。下一階段將挑戰 **增量更新 (Incremental Updates)**，只傳送「修改的那一點點」差異。

## 🚀 下次 To-Do List (優先級排序)

目前的 MVP 雖然能動，但在效能上有一個巨大的隱患：**全量更新**。如果不解決，你的框架之後會因為傳輸量太大而卡死。

1. **[Critical] 實作增量更新 (Incremental Updates)**
   - **現狀：** 每次打字，你都呼叫 `export_update()` 匯出整份文件傳給對方。
   - **目標：** 修改 Rust 端，讓 `insert_text` 直接回傳該次操作的 `Update` (binary blob)。
   - **預期效果：** 網路封包大小從幾 KB 縮小到 **幾十 Bytes**。
2. **[High] 優化 WebSocket 處理**
   - **目標：** 目前是廣播給「除了自己以外」的人。需要實作更穩健的邏輯，例如：
      - 避免「迴音」（Echo）：確認自己發出的訊息不會被 Server 彈回來又 Apply 一次（雖然 CRDT 不怕重複 Apply，但浪費效能）。
      - Awareness：加入「誰在線上」的游標功能（Yjs 有現成的 Awareness Protocol 可以參考）。
3. **[Medium] 引入 TypeScript**
   - **目標：** 現在的 `index.html` 裡的 JS 已經有點亂了。開始將前端邏輯移入 `.ts` 檔案，並定義清晰的介面（Interface）。

---

## 📊 整體進度表 (Year 1 Roadmap)

我們現在處於 **Q1 的中間點**，進度**超前**。

| 階段 | 時間          | 目標                   | 狀態     | 備註                                                        |
| -- | ----------- | -------------------- | ------ | --------------------------------------------------------- |
| Q1 | Month 1     | Rust Core & WASM 基礎  | ✅ 已完成  | 成功編譯 WASM，打通 JS 互操作                                       |
|    | Month 2     | 本地存儲與基礎同步            | 🟡 進行中 | IndexedDB 存取 (Done), WebSocket 廣播 (MVP Done), 增量更新 (Todo) |
|    | Month 3     | 解決衝突與一致性測試           | ⚪ 未開始  | 測試斷網後多人編輯的合併結果                                            |
| Q2 | Month 4-6   | 網路協議優化 & Server      | ⚪ 未開始  | 實作高效的 Sync Protocol                                       |
| Q3 | Month 7-9   | SDK 封裝 (React Hooks) | ⚪ 未開始  | useDoc, useSync                                           |
| Q4 | Month 10-12 | Demo App & Release   | ⚪ 未開始  | 整合進你的 Blog Generator                                      |

### 給你的評語

你今天完成的不僅是程式碼，而是驗證了 **「這條路走得通」**。

很多 Side Project 死在「想得太複雜，寫不出第一行 Code」。你已經跨過了最危險的階段。

**好好休息，下次我們來挑戰把傳輸量砍掉 99% 的「增量更新」！**

