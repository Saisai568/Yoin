# 01 — 現況盤點：SyncSpace 1.0 與 Yoin 0.1.2

[← 回總覽](README.md)

---

## 1. SyncSpace 1.0

### 1.1 Repository 狀態

| 分支 | 內容 |
|---|---|
| `main` / `v1-legacy` | V1 完整程式碼（132 個檔案），commit `92f2ade`「archiving V1 legacy codebase before V2 refactor」 |
| `refator/arch-1` | 兩次重構 + 論文結論 commit，程式碼樹與 `main` 相同 |
| `v2-main`（目前 checkout） | 僅 `V2_RULES.md`（V2 開發規範） |
| `origin/feature/chat_voice` 等 | 已合併的歷史功能分支 |

既有的 V2 相關文件：`docs/SyncSpace_2_0_Proposal.md`（2026-02 草案，已提出改用 Yoin 與 Rust 後端，並附 V1 Code Review）、`V2_RULES.md`。本計畫延續並具體化這兩份文件。

### 1.2 技術棧與規模

| 層 | 技術 | 規模 |
|---|---|---|
| Frontend | React 18、Vite 5、TS、Tailwind、Konva/react-konva、Tiptap 3（聊天輸入）、`yjs` 13 + `y-websocket` 1.5、LiveKit client | `frontend/src` ≈ 7,000 行 |
| Backend | Go 1.24、Gin、Gorilla WebSocket、GORM(PostgreSQL)、go-redis、golang-jwt | `backend` ≈ 4,900 行 |
| Infra | Docker Compose：backend、frontend(dev)、redis、postgres 15、livekit(dev mode) | — |
| Tests | Go 整合測試（`Tests/refator-1`、`Tests/W10`）、一支 JS 協作測試 | 無前端單元測試 |

超過 200 行（違反 V2_RULES SRP 門檻）的前端檔案：`Whiteboard.tsx` 1207、`GitHubContext.tsx` 556、`App.tsx` 356、`IssuePanel.tsx` 337、`Dashboard.tsx` 321、`VoicePanel.tsx` 260、`GitHubConnect.tsx` 210、`IssueCommentsPanel.tsx` 206。

### 1.3 功能清單（V2 需達成的產品需求來源）

| 模組 | 功能 | V1 實作位置 |
|---|---|---|
| 房間 | 一般房間（記憶體）、Pro 房間（PG 持久化 + 密碼）、房間列表/刪除、管理員後台 | `room/manager.go`、`service/room_service.go`、`Dashboard.tsx`、`AdminLogin.tsx` |
| 認證 | 以名稱註冊取得 JWT、管理員登入、GitHub OAuth | `api/handlers.go`、`auth/*`、`api/github_oauth.go` |
| 文字協作 | 共享純文字編輯（`Y.Text 'shared-text'`） | `Editor.tsx` |
| 白板 | 矩形/圓/筆刷/箭頭/文字/圖片（貼上）、縮放平移、Transformer、刪除、z-order、游標 | `Whiteboard.tsx` |
| GitHub | Issue 列表、拖曳 Issue 至白板成 Widget、Kanban Zone（To Do/Done）同步 open/closed、評論檢視/回覆 | `IssuePanel`、`IssueWidgetKonva`、`BoardZones`、`GitHubContext`、`api/github*.go` |
| 聊天 | Discord 風格聊天、回覆、@mention、Issue 引用、typing | `ChatPanel`、`ChatInput`、`useChat*`、`ws/client.go`(JSON 協定) |
| 語音 | LiveKit 語音、靜音、發話提示、螢幕分享 | `VoicePanel.tsx`、`api/livekit.go` |

### 1.4 協作層的關鍵缺陷（V2 必須消除）

| # | 缺陷 | 證據 | 影響 |
|---|---|---|---|
| V1-C1 | 編輯器 LWW 覆寫 | `Editor.tsx`：`yText.delete(0, yText.length); yText.insert(0, newText)` | 並發輸入互相覆蓋；CRDT 退化為 Last-Write-Wins；游標跳動 |
| V1-C2 | 白板物件整體覆寫 | `Whiteboard.tsx`：`ymap.set(id, { ...shape, ... })` | A 移動、B 改色 → 其中一方修改遺失；無屬性級合併 |
| V1-C3 | 伺服器「快照」實為原始封包串接 | `hub.go handleBroadcast` 對 **所有** binary 訊息呼叫 `OnYjsUpdate` → `manager.go`：`room.YjsBuffer = append(room.YjsBuffer, data...)` | Buffer 無限成長（OOM）；混入 y-websocket 的 SyncStep1、Awareness 等非 update 封包；新使用者加入時收到一大串歷史封包。**Pro 房間 DB 中的 `YjsData` 不是合法的 Yjs update**，這是 D3 建議不遷移的原因 |
| V1-C4 | Dumb Relay | `BinaryForwardHandler` 只轉發 | 無法校驗、無法做權限、無法壓縮 |
| V1-C5 | 圖片以 Data URL 存入 CRDT | `Whiteboard.tsx`：`reader.readAsDataURL(blob)` | 文件體積暴增、同步延遲 |
| V1-C6 | 狀態來源分散 | React state / Yjs / Redis online / Context 並存 | 使用者列表等資料不一致 |

### 1.5 安全性缺陷

| # | 缺陷 | 證據 |
|---|---|---|
| V1-S1 | 只憑名稱即可註冊取得 JWT；JWT 以 query string 傳遞 | `api.Register`、`auth/middleware.go`（`c.Query("token")`） |
| V1-S2 | 房間密碼明文儲存、明文比對，且透過 query string 傳遞 | `models.Room.Password`、`manager.VerifyPassword`、`ServeYjs` |
| V1-S3 | CORS `*`、WebSocket `CheckOrigin` 永遠 true | `main.go corsMiddleware`、`ws/handler.go` |
| V1-S4 | 預設機密寫在 compose：`JWT_SECRET=your-very-secret-key`、`admin/admin123`、LiveKit `--dev` | `docker-compose.yml` |
| V1-S5 | WebSocket 無速率限制；同步訊息未驗證 | `ws/client.go` |

### 1.6 可保留的資產（僅限外觀與外部整合邏輯）

| 類別 | 資產 | 處置 |
|---|---|---|
| UI 外觀 | `LandingPage`、`Dashboard`、`SidePanel`、`PasswordModal`、`ConnectionStatus`、`ErrorDisplay`、`OverlayNotification`、`IssueWidgetKonva`、`BoardZones`(幾何)、Tailwind 設定、icon | 重新拆分為無狀態元件後搬入 |
| 外部整合 | GitHub REST/OAuth 呼叫流程（`github*.go` ≈ 30 KB）、LiveKit token 簽發、Issue/Label 型別（`types/github.ts`） | 依 D1 移植為 Rust service 或暫留 Go |
| 聊天輸入 | Tiptap + Mention + Emoji（不涉及 Yjs） | 保留套件，重寫狀態層 |
| 測試資產 | Go API/WS 整合測試的「測試案例清單」 | 轉為 V2 驗收案例，不沿用程式碼 |

**全數捨棄**：`yjs`、`y-websocket`、`y-prosemirror`、`@tiptap/y-tiptap`、`@tiptap/extension-collaboration(-cursor)`、`useYjsConnection`、`Editor.tsx`、`Whiteboard.tsx` 的狀態邏輯、Go `BinaryForwardHandler`/`YjsBuffer`/`room.Manager`。

---

## 2. Yoin 0.1.2

### 2.1 Repository 狀態

| 項目 | 現況 |
|---|---|
| 套件 | `@yoin/core`（Rust → WASM，[lib.rs](../../packages/core/src/lib.rs) 575 行）、`@yoin/client`（TS SDK，[YoinClient.ts](../../packages/client/src/YoinClient.ts) 952 行） |
| Relay / Worker / Demo | 已拆至 `Yoin-apps-example` repo；本地 `apps/`、`examples/`、`server/`、`yoin-worker/` 僅剩空目錄或 `node_modules` |
| 版本 | root `package.json` 0.1.0、client/core 0.1.2；Rust crate 名稱為泛用的 `core`；repo 內提交了 `*.tgz` 打包產物 |
| 測試 | Vitest（mock + 真實 WASM 8 項）＋ monorepo integrity；無真實多客戶端、IndexedDB、Relay E2E |
| 已知審查 | [docs/review](../review/00-executive-summary.md)：YOIN-001/002/004 已於 client 修復，YOIN-003（Relay 無認證）未修復 |

### 2.2 能力盤點

| 能力 | 實作 | 備註 |
|---|---|---|
| Text / Rich Text | `insert_text`、`format_text`、`apply_text_delta`、`get_text_delta`，多具名容器 | Quill 相容 Delta |
| Map | `map_set`、`map_delete`、`map_set_deep`、`batch_set` | `map_set(obj)` 存的是 **原子 `Any::Map`**；只有 `map_set_deep` 會建立巢狀 `YMap`，且每次只寫一個葉節點 |
| Array | `array_push/insert/delete`；`moveArray` = delete + insert | 非 CRDT 原生 move，並發移動可能產生重複 |
| 同步 | State Vector + V1 diff；三向交握 `STEP_1 / STEP_2 / STEP_1_REPLY`；空 diff 抑制 | **對等網狀（mesh）語意**：STEP_1 廣播給房間所有 peer，各自回覆 |
| 網路 | 1-byte header（0–4）、指數退避重連、非暫態離線佇列、in-flight 回收重送 | 無 ACK、無認證訊息、無錯誤訊息、無協定版本 |
| Awareness | JSON、30ms 節流、心跳 + GC | `AwarenessState` 欄位寫死（cursorX/Y、selection…）；`clientId` 為客戶端自產亂數 |
| 持久化 | `YoinDbPlugin`（IndexedDB） | 無伺服器端持久化 |
| Undo/Redo | Yrs `UndoManager`，只追蹤 local origin | 涵蓋 map/text/array |
| React | `YoinProvider`、`useYoinMap/Array/Text/Awareness/Status/Undo` | `useSyncExternalStore` |
| Schema | Zod 驗證 `setMap`/`batchSet`/array | — |

### 2.3 與 YoinSpace 直接相關的技術觀察

| # | 觀察 | 位置 | 對 YoinSpace 的意義 |
|---|---|---|---|
| Y-O1 | `apply_update` 解碼失敗時靜默忽略 | `lib.rs apply_update` | 伺服器/客戶端無法偵測損壞封包 |
| Y-O2 | 遠端更新後 `notifyListeners()` 重算 **所有** 已訂閱容器（`map_get_all` 全量序列化） | `YoinClient.ts` `MSG_SYNC_STEP_2` 分支 | 白板 1000+ 物件、多人拖曳時有效能風險；也拿不到遠端 Text delta，編輯器綁定只能做全量 diff |
| Y-O3 | 建構子立即連線，URL 固定 | `YoinClient constructor` → `NetworkProvider.connect()` | 無法在取得 token 後才連線，重連時也無法刷新 token |
| Y-O4 | 無 Relative Position（StickyIndex）API | `lib.rs` | 文字協作游標/選取範圍會在他人編輯後漂移 |
| Y-O5 | 無 XmlFragment | `lib.rs` | 無法使用 Tiptap/ProseMirror 協作（D2） |
| Y-O6 | `cdylib` + wasm-bindgen 單一 crate | `Cargo.toml` | 伺服器無法直接重用 Yoin 的 Rust 邏輯；需拆出純 Rust crate |
| Y-O7 | 協定為 mesh：伺服器若作為權威節點，需區分「回覆 peer」與「回覆 server」 | `YoinClient` message switch | 需新增 server-authoritative 模式 |

