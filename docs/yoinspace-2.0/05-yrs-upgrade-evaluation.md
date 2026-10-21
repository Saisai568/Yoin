# YoinSpace 2.0 — Yrs 升級評估報告 (Y-12)

**文件版本：** 1.0  
**日期：** 2026-10-21  
**狀態：** 完成評估 (Completed)  
**目標：** 評估由目前使用的 `yrs 0.18.8` 升級至新版（`yrs 0.28+`）的 API 差異、二進位協議相容性與升級策略。

---

## 1. 執行摘要

- **二進位協議相容性（Wire Protocol）：** 100% 相容。Yrs 與 Yjs 的 Lib0 v1 二進位編碼格式（UpdateBlocks、DeleteSet、StateVector）為長久穩定標準，0.18.8 與 0.28.0 所產生的 update 二進位封包可無縫雙向互通。
- **架構封裝進展（Y-01 效益）：** 透過 Phase 1 抽取的純 Rust `crates/yoin-core`，所有 Yrs 底層型別（`Doc`, `TransactionMut`, `StickyIndex`, `TypePtr`, `BranchPtr`）已被完整封裝在 core 模組內，對外僅暴露簡潔的 `YoinDocCore` 及 WASM 綁定，**升級 Yrs 不會對 `@yoin/client` 或前端應用層造成任何破壞性變更**。
- **升級決策建議：** **YoinSpace 2.0 MVP 維持目前經過嚴格測試驗證的 `yrs 0.18.8`**；待 Phase 2~4（Sync Server 與白板/編輯器移植）穩定上線後，於 Phase 5 / 2.x 再行平滑升級至 0.28+。

---

## 2. API 與架構差異比較

| 項目 | yrs 0.18.8 (目前) | yrs 0.28.0+ (最新) | 影響評估與因應 |
| :--- | :--- | :--- | :--- |
| **二進位協議** | Lib0 v1 & v2 | Lib0 v1 & v2 | **零風險**。封包二進位結構完全一致。 |
| **Transaction 生命週期** | `transact_mut()`, `transact()` | `transact_mut()`, `transact()` | API 基本一致；部分 transaction hook 命名由 `observe_after_transaction` 轉移至更細緻的 event stream。 |
| **UndoManager** | `UndoManager::<()>::with_options` 依賴 static/lifetime closure | 支援更多 tracked origin 設定與 selective undo | 0.18 的 Origin Tag 機制（`ORIGIN_LOCAL_TAG = 1`, `ORIGIN_REMOTE_TAG = 2`）在最新版依然支援。 |
| **StickyIndex / 游標** | `yrs::moving::StickyIndex` | `yrs::sticky_index::StickyIndex` | 模組路徑重整，但二進位編碼格式相同。 |
| **WASM 綁定體積** | 約 200~230 KB (gzipped ~70KB) | 略有增加（因內建更多同步輔助模組） | 0.18 的 WASM 載入速度快且記憶體佔用極小，對 60FPS 白板更友善。 |

---

## 3. 升級路徑與風險控制

### 3.1 為什麼 2.0 MVP 不立即升級至 0.28
1. **驗證完備性**：目前 Yoin 0.1.2 的 133 項單元測試、真實 WASM 整合測試、巢狀屬性級合併（Y-02）、遠端變更過濾（Y-03）、RelativePosition 游標追蹤（Y-07）均在 0.18.8 上 100% 通過。
2. **無迫切阻礙**：2.0 MVP 所需的全部能力（白板巢狀協同、Quill Delta、權威伺服器 ACK、Awareness 身分覆寫）在 0.18.8 均已完美實現，無任何未解之 blocker。
3. **避免過度擾動**：Phase 2 即將開始構建 Rust 權威伺服器（Room Actor），保持前後端 core 版本一致可降低除錯變數。

### 3.2 未來升級檢查步驟（Phase 5 推薦）
1. 在獨立 branch 升級 `crates/yoin-core/Cargo.toml` 中的 `yrs = "0.28"`。
2. 調整 `StickyIndex` 與 `Transaction` 的引用路徑。
3. 執行 `cargo test -p yoin-core`。
4. 執行 `pnpm build:wasm` 並跑通 `packages/client/tests/real-wasm.test.ts`。
5. 發布內部 candidate 版本進行端到端收斂測試。

