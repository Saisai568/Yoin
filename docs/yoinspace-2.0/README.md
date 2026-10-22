# YoinSpace 2.0 重構計畫 — 文件總覽

> 狀態：Draft v0.1 ｜ 建立日期：2026-10-21
> 範圍：將 SyncSpace 1.0（React + Yjs + Go）重構為 **YoinSpace 2.0**（React + Yoin + 權威同步伺服器）
> 分析基準：
> - SyncSpace：`Saisai568/SyncSpace` 分支 `main`（= `v1-legacy`，commit `92f2ade`；`refator/arch-1` 程式碼樹與其相同）與 `v2-main`（僅含 `V2_RULES.md`）
> - Yoin：本 repository `main`（commit `99100e7`，`@yoin/core` / `@yoin/client` v0.1.2）

## 文件導覽

| 文件 | 內容 |
|---|---|
| [01-current-state-analysis.md](01-current-state-analysis.md) | SyncSpace 1.0 與 Yoin 0.1.2 的現況盤點（架構、程式碼、技術債） |
| [02-fit-gap-analysis.md](02-fit-gap-analysis.md) | 兩者適配性分析：SyncSpace 需求 × Yoin 能力差距矩陣 |
| [03-refactor-plan.md](03-refactor-plan.md) | YoinSpace 2.0 目標架構、同步協定、資料模型、階段計畫與風險 |
| [04-readiness-checklist.md](04-readiness-checklist.md) | 重構準備清單：Yoin 側（框架補強）與 SyncSpace 側（產品/資產準備） |
| [05-yrs-upgrade-evaluation.md](05-yrs-upgrade-evaluation.md) | Yrs 0.18 vs 0.28+ 評估報告（二進位相容性與升級策略） |
| [06-sync-server-implementation.md](06-sync-server-implementation.md) | Phase 2 權威同步伺服器實作報告（Actor 模型、Protocol v2、持久化與整合測試） |
| [07-web-skeleton-implementation.md](07-web-skeleton-implementation.md) | Phase 3 前端骨架與連線整合實作報告（分層架構、V2 規範、useRoomSession） |
| [08-whiteboard-module-implementation.md](08-whiteboard-module-implementation.md) | Phase 4 白板協同模組實作報告（Konva 渲染、幾何引擎、Fractional Indexing、巢狀 Map 並發合併） |

## 一頁結論

1. **方向可行，但 Yoin 0.1.2 尚不能「直接替換」Yjs。** Yoin 的 CRDT 基礎（Yrs、State Vector Diff、IndexedDB、Undo、Awareness、React Hooks）足以承接 SyncSpace 的白板與文字協作，且與 Yjs v1 二進位格式相容；但缺少 YoinSpace 必要的 **巢狀 Map 建立 API、遠端變更事件、伺服器權威模式（認證/ACK/錯誤）、可擴充的 Awareness 型別** 等能力（見 02 的 P0 差距）。
2. **SyncSpace 1.0 的協作層幾乎沒有可保留的實作。** 編輯器是 LWW 覆寫（`delete(0,len)+insert`）、白板以整個 JSON 物件覆寫、後端把原始 y-websocket 封包無限 append 成「快照」。這三者都應整段重寫；可保留的是 UI 元件、GitHub/LiveKit 整合邏輯與產品需求本身。
3. **最大的架構轉變是「盲轉發 → 權威同步節點」。** YoinSpace 需要一個實例化 Yrs 的伺服器（建議 Rust/Axum，透過拆出純 Rust 的 `yoin-core` crate 達成前後端同構），負責認證、驗證、持久化與壓縮。這同時解決 SyncSpace V1 的 `YjsBuffer` 問題與 Yoin 的 YOIN-001/003 風險。
4. **建議節奏：先補 Yoin（Phase 1），再建伺服器（Phase 2），最後移植產品功能（Phase 3–6）。** 預估 13–19 週（單人），Yoin 補強與 YoinSpace 前端骨架可部分平行。

## 待決策事項（需要專案負責人確認）

| # | 決策 | 選項 | 本文件建議 |
|---|---|---|---|
| D1 | 後端語言 | (A) 全面改寫為 Rust/Axum ｜ (B) Rust 同步伺服器 + 暫留 Go 業務 API（Strangler）｜ (C) 維持 Go | **B → A**：先上 Rust 同步伺服器，業務 API 逐步移植 |
| D2 | 文字編輯器 | (A) Quill/Delta 綁定（Yoin 已有 Delta）｜ (B) Tiptap（需 Yoin 新增 XmlFragment） | **A** 作為 2.0 MVP；B 列為 2.x |
| D3 | V1 資料 | (A) 寫遷移腳本轉入 V2 Schema ｜ (B) 不遷移、全新開始 | **B**（V1 Pro 房間資料格式本身已損壞，見 01 §1.4） |
| D4 | Repository | (A) SyncSpace repo 的 `v2-main` 改名 ｜ (B) 新建 `YoinSpace` repo | **B**，SyncSpace 封存為 V1 |
| D5 | 部署 | (A) 自架 Docker Compose ｜ (B) Cloudflare Worker + DO | **A**（需要 PostgreSQL、LiveKit 與權威伺服器） |

> [!IMPORTANT]
> 依 SyncSpace `V2_RULES.md`：「除非明確要求，否則禁止參考或延用 V1 的任何實作模式」。本計畫中所有「可保留」的 V1 資產僅限於 **UI 外觀、外部 API 呼叫邏輯與產品需求**；協作、狀態管理、後端架構一律以 V2 規範重寫。

