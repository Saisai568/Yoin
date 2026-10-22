# 04 — 重構準備清單

[← 回總覽](README.md)

> 使用方式：每個項目完成後勾選並附上 PR/commit。P0 全部完成才進入 YoinSpace 對應 Phase（見 [03 §6](03-refactor-plan.md#6-階段計畫)）。

---

## 1. Yoin 側：框架補強

### 1.1 P0 — 阻塞 YoinSpace MVP

- [x] **Y-01 Crate 拆分與命名**
  - 將 `packages/core` 拆為：`crates/yoin-core`（純 Rust，依賴 `yrs`，無 wasm-bindgen）＋ `packages/core`（`yoin-wasm`，僅做 JS 綁定）。
  - Rust crate 由 `core` 更名為 `yoin-core` / `yoin-wasm`，避免與標準庫 `core` 混淆。
  - 驗收：`cargo test -p yoin-core` 可在非 WASM 環境執行；YoinSpace 伺服器可 `use yoin_core::…`。
- [x] **Y-02 巢狀 Map API**
  - Rust：`map_insert_nested(root, key, obj)`（單一 transaction 以 `MapPrelim` 建立含多欄位的 YMap）、`map_update_nested(root, key, partial)`、`map_get_nested`。
  - TS：`client.setNested(root, key, obj)`、`client.updateNested(root, key, partial)`；`getMap` 對巢狀 YMap 回傳一般物件。
  - 文件明示：`setMap(root, key, object)` 存的是原子值，不能做屬性級合併。
  - 驗收：真實 WASM 測試「A 改 `x`、B 改 `fill`」雙端收斂後兩者皆保留。
- [x] **Y-03 遠端變更事件**
  - 第一步：`apply_update` 回傳本次變更的根容器清單（名稱 + 類型），`YoinClient` 只通知受影響容器（取代全量 `notifyListeners`）。
  - 第二步：Map 回傳變更 key；Text 回傳 Quill 相容 delta（`subscribeText` callback 增加 `delta` 參數的增量版本）。
  - 驗收：遠端修改 `wb.shapes` 時 `doc.main` 的訂閱者不被呼叫；benchmark 1000 物件時單次遠端更新處理時間記錄於文件。
- [x] **Y-04 伺服器權威模式（Protocol v2 客戶端）**
  - `YoinConfig` 新增：`mode: 'mesh' | 'server'`、`autoConnect?: boolean`、`getConnectParams?: () => Promise<{ url: string; protocols?: string[] }>`（每次重連重新取得 ticket）。
  - 實作 `HELLO` / `UPDATE_ACK` / `ERROR`（見 03 §3.1）；ACK 後才自 pending set 移除；`ERROR FORBIDDEN_READONLY` 時進入唯讀狀態。
  - 新增狀態：`synced`（無未 ACK 的 update）供 UI 顯示。
  - 驗收：故障注入測試（送出後斷線）不遺失、不重複套用；mesh 模式既有測試不回歸。
- [x] **Y-05 Awareness 泛型與身分**
  - `AwarenessState<T extends object>`、`setAwareness(partial: Partial<T>)`；保留既有欄位作為預設型別。
  - server 模式下 `clientId`/`userId` 以 `HELLO` 回傳值為準；文件說明伺服器會覆寫身分欄位。
  - 驗收：YoinSpace 可廣播 `{ tool, selectedIds, draftStroke }` 且型別安全、無 `any`。
- [x] **Y-06 錯誤回報**
  - `apply_update` 改為 `Result`，解碼失敗回傳錯誤；`YoinClient` 經 `onError` / logger 對外暴露。
  - 驗收：送入損壞封包時測試可觀察到錯誤，且文件狀態不變。

### 1.2 P1 — YoinSpace 2.0 發布前

- [x] **Y-07 Relative Position**：`createRelativePosition(textName, index)` / `resolveRelativePosition(bytes)`（Yrs `StickyIndex`），供文字游標與選取 Awareness 使用。
- [x] **Y-08 真實 E2E**：多客戶端雙向收斂、離線重連佇列、IndexedDB 快照還原整合測試（`convergence-e2e.test.ts`；Playwright 雙分頁 E2E 於 Phase 2 Rust 伺服器完成後接軌）。
- [x] **Y-09 打包與版本**：移除 repo 中的 `*.tgz`；root/client/core 版本一致；CI 固定 wasm-pack 版本並做 clean-checkout smoke test（YOIN-007）。
- [x] **Y-10 Proxy contract**：明確列出支援/不支援操作，不支援時拋錯（YOIN-005）。YoinSpace 白板不使用 Proxy，改用顯式 API。
- [x] **Y-11 Plugin 生命週期**：`use()` 失敗可回滾、`destroy` 可等待（YOIN-006）。
- [x] **Y-12 Yrs 升級評估**：評估由 `yrs 0.18` 升級至目前版本的 API 差異（V1 二進位格式不變，非強制；見 `05-yrs-upgrade-evaluation.md`）。

### 1.3 P2 — 2.x

- [ ] XmlFragment / XmlElement（支援 Tiptap，D2-B）
- [ ] Sub-documents（白板中的文件卡片延遲載入）
- [ ] Blob / 附件型別

### 1.4 文件同步

- [x] `docs/ARCHITECTURE.md` 增加「Server-Authoritative Mode」章節與 Protocol v2 表格
- [x] `docs/API.md` 補上 Y-02～Y-07 新 API
- [x] `docs/review/09-prioritized-action-plan.md` 更新 YOIN-001/003 狀態（由 YoinSpace 伺服器解決部署端部分）

### 1.5 Phase 2 — 權威同步伺服器 (crates/yoin-sync-server)

- [x] **S-01 Cargo Workspace 配置**：建立 monorepo 根目錄 `Cargo.toml`，納入 `crates/yoin-core`、`crates/yoin-sync-server`、`packages/core`。
- [x] **S-02 Protocol v2 編解碼器**：實作 `MSG_SYNC_STEP_1 (0)`、`MSG_SYNC_STEP_2 (1)`、`MSG_SYNC_STEP_1_REPLY (2)`、`MSG_AWARENESS (3)`、`MSG_JOIN_ROOM (4)`、`MSG_HELLO (16)`、`MSG_UPDATE_ACK (17)`、`MSG_ERROR (18)`。
- [x] **S-03 短效 Ticket 認證系統**：`TicketStore` 支援 60 秒一次性憑據驗證與過期清理；支援 `Sec-WebSocket-Protocol: yoin.v2, bearer.<ticket>` 與 query params。
- [x] **S-04 Room Actor 併發狀態機**：基於 Tokio Actor 模型，每房獨立 task 序列化處理訊息；維護 `YoinDocCore`，分配全域 `seq`，回覆 `UPDATE_ACK`，扇出廣播給房內其他成員。
- [x] **S-05 權限與限流防禦**：`viewer` 角色提交寫入時即時攔截並回傳 `FORBIDDEN_READONLY`；更新 > 1MB 回傳 `TOO_LARGE`；損壞二進位回傳 `INVALID_UPDATE`；Token Bucket 限流（update ≤ 60/s, awareness ≤ 30/s）。
- [x] **S-06 Awareness 身分覆寫防偽**：伺服器解析並注入驗證通過之 `userId`/`name`，防止惡意冒名偽造。
- [x] **S-07 持久化與壓縮 (Compaction)**：`RoomStorage` trait 抽象，提供 `MemoryStorage` 與零依賴 `FileStorage`；update log append-only，滿 500 筆或 1MB 或閒置時壓縮快照並清除 log。
- [x] **S-08 Axum REST & WebSocket 路由**：`/ws/sync/:room_id`、`POST /api/rooms/:id/ticket`、`GET /health`、`GET /api/admin/rooms`。
- [x] **S-09 整合測試套件**：6 個真實 WebSocket 端到端情境（多客戶端收斂、ACK 確認、唯讀拒絕、超大封包拒絕、損壞二進位拒絕、重啟後快照與增量恢復）100% 通過。

### 1.6 Phase 3 — 前端骨架與連線整合 (apps/web)

- [x] **W-01 Vite + React 19 + TypeScript + WASM 整合**：配置 `apps/web`，支援 `@yoin/client`、`vite-plugin-wasm` 與 `vite-plugin-top-level-await`。
- [x] **W-02 Config 層與 Zod 環境驗證**：`src/config/env.ts` 與 `src/config/constants.ts` 集中管理所有常數與伺服器端點。
- [x] **W-03 Core Engine 層純 TS 隔離**：`src/engine/` 禁止 import React / DOM，定義 `WhiteboardShape` 與 `MetaSchema` Zod 結構。
- [x] **W-04 Services 層**：`apiClient.ts`（REST 憑據與健康檢查）與 `yoinSession.ts`（動態短效 Ticket 換發與 Protocol v2 連線管理）。
- [x] **W-05 Hooks 層**：`useAuth`（身分維護與客體登入）與 `useRoomSession`（房間狀態綁定、在線成員 Awareness、讀寫權限管理、斷線重試）。
- [x] **W-06 UI 元件層**：`ConnectionBadge`（5 種同步狀態即時可視化）、`Header`、`RoomCard`、`CreateRoomModal`、`ErrorAlert`。
- [x] **W-07 Feature 頁面與輕量路由**：`LandingPage`（大廳/建房）、`RoomPage`（權威 CRDT 工作區）、`AdminPage`（伺服器指標監看）。
- [x] **W-08 V2 架構規範自動化檢查**：`scripts/lint-rules.mjs` 自動校驗無 `any`、單檔 ≤ 200 行、engine 純淨度；`tsc --noEmit` 0 錯誤；`vite build` 產出正常。

### 1.7 Phase 4 — 白板協同模組 (apps/web/src/{engine,ui}/whiteboard)

- [x] **WB-01 幾何與排序引擎 (Pure TS)**：`engine/whiteboard/geometry.ts`（座標換算、碰撞判定、外接框計算）與 `zIndex.ts`（Fractional Indexing 分數排序）。
- [x] **WB-02 巢狀 Map 命令模式**：`engine/whiteboard/commands.ts`，嚴格依據 03 §4 規則 1 透過 `setNested` 與 `updateNested` 存取 `wb.shapes`，杜絕全物件覆寫。
- [x] **WB-03 視圖平移與縮放 Hook**：`hooks/useCanvasViewport.ts`，滑鼠滾輪等比縮放（0.1x–5.0x）、空白鍵拖曳畫布與邊界防護。
- [x] **WB-04 防禦性形狀訂閱 Hook**：`hooks/useWhiteboardShapes.ts`，透過 Zod 安全過濾無效形狀，依 Fractional Index 升序排列。
- [x] **WB-05 畫布繪製與拖曳 Hook**：`hooks/useCanvasDrawing.ts`，平滑筆畫擷取、外接框自動規整化與游標 Awareness 即時廣播。
- [x] **WB-06 Konva 形狀與草稿渲染**：`ui/whiteboard/ShapeRenderer.tsx`（Rect, Circle, Line, Arrow, Text）、`DraftRenderer.tsx`、`CursorLayer.tsx`（遠端游標與即時動態）。
- [x] **WB-07 懸浮式白板工具列**：`ui/whiteboard/WhiteboardToolbar.tsx`，工具切換（V, R, C, P, A, T）、調色盤、筆刷粗細、縮放指示與刪除選取。
- [x] **WB-08 雙端並發合併驗證 (DoD)**：自動化驗證客戶端 A 平移 `(x, y)` 與客戶端 B 改色 `(fill)` 於收斂後兩者屬性同時保留（Property-level CRDT merge）。

---

## 2. SyncSpace / YoinSpace 側：產品與資產準備

### 2.1 專案治理

- [ ] 確認 README 中的決策 D1–D5
- [ ] SyncSpace：在 `v1-legacy` 打 tag `v1.0-final`；README 標示「V1 已封存，後繼專案 YoinSpace」
- [ ] 建立 `YoinSpace` repo；複製 `V2_RULES.md` 並更名專案名稱（V2 → YoinSpace 2.0）
- [ ] 將 V2_RULES 自我檢查清單轉為 PR template；CI 加入：`no-explicit-any`、單檔行數警告（> 200）、`engine/` 禁止 import React/DOM 的 lint 規則

### 2.2 需求與規格

- [ ] 由 [01 §1.3](01-current-state-analysis.md#13-功能清單v2-需達成的產品需求來源) 展開「功能對等驗收清單」（每項含操作步驟與預期結果）
- [ ] 參考 V1 `docs/Tasks/*`、`docs/DoD/*` 補齊遺漏的邊界案例
- [ ] 定稿 Yoin 文件 Schema（[03 §4](03-refactor-plan.md#4-資料模型yoin-文件-schema)）與 engine 層 Zod schema
- [ ] 定稿 Protocol v2 錯誤碼與限制值（[03 §3](03-refactor-plan.md#3-權威同步伺服器設計)），並放入 `packages/protocol`
- [ ] 決定房間角色模型（owner / editor / viewer）與預設值

### 2.3 安全基線（對應 V1-S1～S5）

- [ ] 帳號：guest 帳號（伺服器產生 ID）＋ GitHub OAuth；不再以「任意名稱」取得長效 JWT
- [ ] Token：短效 access token（≤ 15 分鐘）+ refresh；WS 使用一次性 ticket，不放 URL
- [ ] 房間密碼：Argon2id 雜湊；只在 `POST /join` body 傳遞
- [ ] CORS / WS Origin：白名單，由 config 提供
- [ ] 機密：compose 只引用 `.env`，不得有預設 secret；LiveKit 關閉 `--dev`
- [ ] 限流：REST 與 WS 皆有 per-user 限制
- [ ] GitHub token：伺服器端加密儲存，不回傳前端

### 2.4 資產搬遷清單

| 資產 | 動作 | 目標位置 | 狀態 |
|---|---|---|---|
| `LandingPage`、`Dashboard`、`SidePanel`、`PasswordModal`、`ConnectionStatus`、`ErrorDisplay`、`OverlayNotification` | 改寫為無狀態元件 | `apps/web/src/ui/` | [ ] |
| `IssueWidgetKonva`、`BoardZones` | 拆出幾何至 engine，渲染至 ui | `engine/board-zones/`、`ui/whiteboard/` | [ ] |
| `types/github.ts` | 以 Zod 重寫並共用 | `engine/github/schema.ts` | [ ] |
| `ChatInput`、`MentionList`、`suggestion.ts` | 保留 Tiptap 輸入，重寫狀態層 | `features/chat/` | [ ] |
| `VoicePanel` | 拆為 `useVoiceRoom` + UI | `features/voice/` | [ ] |
| Go `github*.go`、`livekit.go` | 移植（D1） | `apps/server/src/github/`、`livekit/` | [ ] |
| Tailwind 設定、icon | 直接搬移 | `apps/web/` | [ ] |
| Go/JS 測試案例 | 轉為驗收清單與 E2E 情境 | `docs/acceptance.md`、`apps/web/e2e/` | [ ] |

### 2.5 明確捨棄（避免 V1 慣性）

- [ ] 不安裝：`yjs`、`y-websocket`、`y-prosemirror`、`@tiptap/y-tiptap`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-cursor`
- [ ] 不移植：`useYjsConnection`、`Editor.tsx`、`Whiteboard.tsx` 狀態邏輯、Go `BinaryForwardHandler`、`room.Manager.YjsBuffer`、Redis online presence（改由伺服器 Room Actor 計算）
- [ ] 不遷移 V1 Pro 房間 `YjsData`（D3=B）；若改選 D3=A，需另寫腳本解析 y-websocket frame（lib0 varint）、抽出 update、套用後再轉換為 V2 Schema

---

## 3. 進入條件總表

| 進入 Phase | 必要條件 |
|---|---|
| Phase 1（Yoin 補強） | D1–D5 已決策 |
| Phase 2（同步伺服器） | Y-01、Y-06 完成；Protocol v2 定稿 |
| Phase 3（前端骨架） | YoinSpace repo + CI 就緒；安全基線 §2.3 設計定稿 |
| Phase 4（白板） | Y-02、Y-03（第一步）、Y-04、Y-05 完成並發布 0.2.0；Phase 2 可連線 |
| Phase 5（編輯器） | Y-03（第二步）完成；Y-07 建議完成 |
| Phase 7（發布） | 全部 P1 完成；功能對等驗收清單全數通過 |

