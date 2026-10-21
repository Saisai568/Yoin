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

