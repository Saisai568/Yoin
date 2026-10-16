# Yoin 全專案技術審查規格書

**文件版本：** 1.0  
**審查對象：** Yoin — Local-First Real-time Collaborative State Synchronization Framework  
**專案版本基準：** 0.1.0  
**審查類型：** Architecture Review、Code Review、Reliability Review、Security Review  
**主要技術：** Rust、Yrs、WebAssembly、TypeScript、React、IndexedDB、WebSocket、Cloudflare Workers、Durable Objects

---

## 1. 審查目標

本次審查的目的，是確認 Yoin 是否具備成為可靠、可維護、可供其他開發者採用的 Local-First 協作 SDK 的技術基礎。

Yoin 並非單純的 Yrs API wrapper，而是整合以下能力的協作框架：

- Rust + Yrs CRDT 核心，透過 WebAssembly 在瀏覽器執行。
- TypeScript SDK 與 YoinClient micro-kernel。
- Plugin 系統及擴充介面。
- Proxy 透明寫入與深層資料操作。
- React Provider、Hooks 與響應式狀態訂閱。
- IndexedDB 本地持久化與離線更新佇列。
- WebSocket 連線、重新連線及遠端同步。
- Cloudflare Workers + Durable Objects Relay。
- Awareness、Undo / Redo 與 Zod Schema Validation。
- Vitest、Playwright 與瀏覽器 API Test Runner。

審查的核心問題：

1. 各模組的責任邊界是否清楚，實際行為是否符合文件描述？
2. CRDT 更新能否在多客戶端、離線及故障情境下正確收斂？
3. 本地持久化、離線佇列與網路同步之間是否存在資料遺失窗口？
4. Proxy 與 React API 是否具有正確且可預期的 JavaScript 語意？
5. Cloudflare Relay 是否具備正確的房間隔離、連線生命週期與必要的存取控制？
6. Plugin、Undo、Awareness 與 Schema Validation 是否符合各自的功能承諾？
7. 測試是否真正覆蓋關鍵失敗路徑，而不只是正常操作？
8. 哪些設計已經足夠成熟，哪些需要修改，哪些尚未有足夠證據判斷？

本次審查應以實際原始碼、測試結果及可重現的行為為依據，不得只根據 README 推測實作品質。

## 2. 審查範圍與限制

### 2.1 必須檢查的範圍

請檢查以下模組及其實際相依關係：

| 模組 | 主要檢查內容 |
|---|---|
| `packages/core/` | Rust/Yrs API、WASM bindings、文件生命週期、更新交換 |
| `packages/client/src/YoinClient.ts` | 核心 API、狀態管理、事件、資源清理 |
| `packages/client/src/network.ts` | WebSocket、離線佇列、重連、同步協定 |
| `packages/client/src/storage.ts` | IndexedDB 操作、持久化、恢復、失敗處理 |
| `packages/client/src/proxy.ts` | Map/Array Proxy、深層寫入、刪除與讀取語意 |
| `packages/client/src/plugin.ts` | Plugin contract、初始化、清理、錯誤隔離 |
| `packages/client/src/plugins/db.ts` | 文件持久化、載入順序、更新保存與恢復 |
| `packages/client/src/plugins/undo.ts` | Undo/Redo、交易來源、遠端更新隔離 |
| `packages/client/src/react/` | Provider、Hooks、訂閱、React render 與 cleanup |
| Awareness 相關模組 | 狀態傳輸、過期清理、節流與使用者隔離 |
| `yoin-worker/` | Durable Objects、WebSocket Relay、房間隔離、訊息驗證 |
| `apps/api-test/` | API 測試範圍、測試斷言及錯誤情境 |
| `apps/demo/` | 真實使用方式、API 一致性與功能整合 |
| 專案根目錄 | package scripts、依賴版本、建置流程、CI、部署設定 |
| `docs/` | API 文件、架構文件、已知限制及文件與實作的一致性 |

以上是預期範圍。若目錄或檔案名稱與實際 Repository 不一致，請先探索專案結構，找到對應實作，不得直接假設檔案不存在或自行建立替代實作。

### 2.2 審查限制

本次任務首先是 Review，不是直接重構。

- 第一階段只讀取與分析，不修改原始碼。
- 不得直接修改 API、資料結構、依賴版本或部署設定。
- 不得為了讓測試通過而刪除既有測試、降低斷言強度或跳過測試。
- 不得將未執行的測試描述為已通過。
- 不得將靜態分析推論描述為已確認的執行時 Bug。
- 不得假設所有建議修改都必須採用。
- 不得將合理的產品取捨一律視為錯誤。
- 若受限於環境、憑證、網路或 Cloudflare 帳號而無法驗證，必須記錄限制。
- 不得將機密、API Token、環境變數值或使用者資料寫入審查報告。

---

## 3. 審查工作流程

請依序完成以下階段。每一階段應產生可供後續階段使用的分析結果。

### Phase 1：專案結構與功能盤點

目標：建立實際實作地圖。

工作項目：

1. 檢查 Repository 目錄、Workspace、套件依賴與 package scripts。
2. 找出核心入口、主要類別、事件介面及公開匯出。
3. 整理各模組的責任與依賴關係。
4. 追蹤一次本地資料修改從 API 到 CRDT、持久化、網路傳輸及遠端套用的完整流程。
5. 追蹤一次遠端更新從 Worker 到客戶端、CRDT、持久化及 UI 更新的完整流程。
6. 追蹤文件初始化、恢復、斷線、重連與銷毀的生命週期。
7. 將 README 中宣稱的功能與實際程式碼對照。

產出：

- `01-project-map.md`
- 模組依賴關係。
- 兩條端到端資料流。
- 公開 API 與主要生命週期摘要。
- 文件與實作的初步差異清單。

### Phase 2：核心架構與 API Review

目標：判斷抽象層是否合理，以及是否存在不必要的複雜度。

請檢查：

1. `YoinClient` 是否承擔過多責任。
2. CRDT、網路、持久化與 Plugin 之間是否有不合理的耦合。
3. 模組之間是否存在重複狀態或互相競爭的資料來源。
4. Plugin 是否具有明確且一致的初始化與銷毀契約。
5. 公開 API 的回傳值、錯誤、非同步行為及狀態轉換是否容易理解。
6. API 是否可能讓使用者誤以為某個操作已持久化或已同步，但實際上尚未完成。
7. Proxy API 是否能表達 JavaScript 使用者預期的操作語意。
8. 是否存在過度抽象、重複封裝或沒有明確使用場景的擴充介面。
9. TypeScript 型別是否與執行時實際行為一致。
10. 是否存在循環依賴、重複事件傳遞或無法管理的副作用。

產出：

- `02-architecture-review.md`
- `03-api-review.md`
- 具體的設計優點、設計風險與改善建議。
- 每項發現均需附檔案路徑與行號。

### Phase 3：CRDT 正確性與跨端互通性

目標：確認 Yoin 的核心協作語意正確。

請檢查：

1. Yrs 更新的編碼、解碼與交換方式。
2. State Vector、增量更新與初始同步的實際使用方式。
3. 多個客戶端同時修改同一份文件時的收斂行為。
4. 更新重複、亂序、延遲及斷線重送時的處理。
5. Map、Array、Text 的插入、刪除與巢狀操作。
6. 文件初始化時，是否存在本地持久化與遠端同步互相覆蓋的風險。
7. 本地與遠端更新是否可能因事件處理順序而遺失。
8. Undo/Redo 是否正確區分本地與遠端交易。
9. Awareness 是否與持久化文件資料正確分離。
10. Yoin 是否能與標準 JavaScript Yjs 文件交換更新。

請特別區分：

- Yrs 本身的 CRDT 保證。
- Yoin 自己實作的同步協定保證。
- Relay 與持久化層提供的保證。
- 尚未被測試證明的行為。

若專案已有 JavaScript Yjs 測試環境，請優先加入或執行跨實作互通性測試；若沒有，不得擅自認定不相容，應將其列為驗證缺口並提出最小測試方案。

產出：

- `04-crdt-correctness.md`
- 更新交換流程圖或文字時序圖。
- 已驗證的相容性範圍。
- 尚未驗證的同步情境。
- 可重現的最小失敗案例（若有）。

### Phase 4：離線、持久化與網路可靠性

目標：驗證資料在故障情境下能否恢復。

請沿著以下資料路徑檢查：

本地操作 → CRDT 更新 → IndexedDB → 離線佇列 → WebSocket → Worker → 其他客戶端。

反向路徑亦須檢查。

至少分析以下情境：

1. 網路在本地操作前已中斷。
2. 更新已產生，但尚未寫入 IndexedDB。
3. 更新已保存，但尚未傳送。
4. 更新已傳送，但未收到任何確認。
5. 伺服器已收到更新，但客戶端在確認前斷線。
6. 客戶端重新連線時重複送出更新。
7. IndexedDB 開啟、讀取、寫入或交易失敗。
8. 使用者重新整理或關閉瀏覽器後重新開啟。
9. 多個更新在重連時集中送出。
10. 文件載入期間又發生新的本地修改。
11. Plugin 與 Client 初始化順序不一致。
12. 呼叫 `destroy()` 時仍有待完成的非同步工作。
13. Durable Object 休眠後重新喚醒。
14. 所有客戶端離線後，新客戶端加入房間。
15. 網路連線反覆成功與失敗。

對每個情境，請說明：

- 實際控制流程。
- 資料是否可能遺失。
- 是否可能無限重試或重複處理副作用。
- 系統能否偵測失敗。
- 是否有可驗證的恢復保證。
- 建議新增的測試。

不得僅因為底層使用 CRDT 就認定資料必然不會遺失。

產出：

- `05-reliability-review.md`
- 故障情境矩陣。
- 資料持久化與同步的保證邊界。
- 依風險排序的修正建議。

### Phase 5：Proxy、React 與 Plugin Review

目標：確認高階 SDK 抽象沒有隱藏錯誤語意。

#### Proxy

檢查：

- 一層與多層屬性賦值。
- 巢狀物件與陣列的取得、修改及刪除。
- `push`、`splice`、索引修改與陣列長度變化。
- 不支援的 JavaScript 型別與循環參照。
- Proxy 讀取是否取得最新狀態。
- Proxy 是否會意外暴露可被直接修改的內部快照。
- `Object.keys`、迭代、序列化及屬性存在性檢查。
- 物件替換、空值及缺失欄位的語意。
- 寫入失敗時的回傳與錯誤處理。

請依實際支援範圍判斷，不得要求所有 JavaScript 原生物件語意都必須支援。

#### React

檢查：

- 遠端更新是否觸發正確的重新 render。
- 快照是否符合 React 訂閱模型的要求。
- Provider 卸載與重新掛載。
- React Strict Mode 下的初始化及清理。
- 多個元件訂閱同一份文件。
- 文件切換時是否讀取錯誤的舊狀態。
- 訂閱回呼、事件 listener 與記憶體釋放。
- SSR 與瀏覽器專屬 API 的相容性宣告。

#### Plugin

檢查：

- 初始化順序與依賴關係。
- 重複安裝及重複初始化。
- 初始化失敗後的部分資源清理。
- Client 銷毀時的 cleanup。
- Plugin 之間的事件順序。
- Plugin 是否能在不破壞核心的情況下獨立運作。
- 非同步工作與錯誤傳播。

產出：

- `06-sdk-abstractions-review.md`
- API 語意與相容性問題。
- 最小重現案例及建議測試。

### Phase 6：Cloudflare Relay 與安全性 Review

目標：檢查網路邊界及多房間隔離。

請檢查：

1. WebSocket 升級流程及連線失敗處理。
2. `docId` 與 Durable Object 實例的對應方式。
3. 不同文件之間是否存在資料洩漏或訊息錯誤轉送。
4. 是否有身分驗證與房間存取授權。
5. 未授權客戶端是否可能加入、讀取或修改文件。
6. 訊息大小、頻率及連線數是否有合理限制。
7. 非法訊息、未知訊息類型與異常 payload 的處理。
8. Awareness 中的身分資訊是否被錯誤地當作可信任的授權依據。
9. Durable Object Hibernation 前後的狀態管理。
10. 伺服器端是否依賴無法恢復的記憶體狀態。
11. 例外與日誌是否可能洩漏敏感資料。
12. 部署設定、CORS 與環境變數是否存在不安全預設值。

請區分公開協作房間與受保護文件的產品需求。若 Yoin 目前刻意採用公開房間模型，應將其記錄為明確的安全模型與產品限制，而不是直接判定為漏洞。

所有安全性測試均限於本地測試環境、專案擁有的測試環境或明確授權的部署。

產出：

- `07-security-review.md`
- 威脅模型與信任邊界。
- 可重現的安全問題。
- 必要的安全預設與文件建議。

### Phase 7：測試品質、建置與發布流程

目標：判斷專案是否能持續維護及可靠發布。

請檢查：

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:e2e`
- `pnpm test:coverage`
- WASM build 與初始化流程。
- ESM / CJS 輸出及套件匯出設定。
- npm package 中是否包含必要的 WASM 檔案與執行資源。
- 套件安裝後能否依文件執行。
- 測試是否有不穩定、跳過、空斷言或只測正常流程的情形。
- 依賴版本與 lockfile 是否一致。
- CI 是否執行必要檢查。
- CHANGELOG、版本號與實際 API 變更是否一致。
- 發布包是否意外包含憑證、環境設定或不必要的開發檔案。

請記錄實際執行的命令、退出碼與失敗訊息摘要。

若因缺少 Cloudflare 憑證、瀏覽器或系統相依套件而無法執行，請清楚記錄，不得以靜態檢查取代實際測試結果。

產出：

- `08-test-build-release-review.md`
- 命令執行結果。
- 測試覆蓋缺口。
- 發布與套件整合風險。

---

## 4. 統一問題分級

所有問題均須使用以下優先級。

### P0 — Critical

可能造成重大資料遺失、跨租戶資料洩漏、未授權讀寫、核心同步不正確，或讓主要功能無法安全使用的問題。

### P1 — High

重要功能在常見故障情境下不可靠、主要 API 語意錯誤、資源洩漏、恢復失敗，或公開承諾與實際行為有重大落差。

### P2 — Medium

邊界情境、可維護性、效能、型別品質、文件與測試不足等問題，尚未證明會造成重大資料或安全風險。

### P3 — Low

命名、風格、非必要重構、輕微文件問題及不影響正確性的改善建議。

分級原則：

- 不得因為問題看起來複雜，就直接列為 P0。
- 每個 P0/P1 都必須說明影響範圍及觸發條件。
- 區分已確認 Bug、潛在風險、設計取捨與尚未驗證的假設。
- 同一根因造成的多個現象應盡可能合併。
- 不得為了讓報告看起來嚴重而重複列出相同問題。

---

## 5. 每項問題的固定格式

每個問題必須包含以下欄位：

### [ID] 問題標題

- **Severity：** P0 / P1 / P2 / P3
- **Category：** Correctness / Reliability / Security / Architecture / API / Performance / Testing / Documentation
- **Status：** Confirmed / Likely / Unverified / Informational
- **Location：** 檔案路徑與行號
- **Affected flow：** 受影響的功能或資料路徑
- **Evidence：** 相關程式碼、測試結果或可觀察行為
- **Trigger：** 觸發問題的具體條件
- **Impact：** 對使用者、資料、安全性或維護成本的影響
- **Reproduction：** 可重現步驟；若無法重現，說明原因
- **Recommendation：** 最小且合理的修正方向
- **Regression test：** 修正後應新增或更新的測試
- **Confidence：** High / Medium / Low

沒有直接證據的問題必須明確標記為推論或待驗證事項，不得偽裝成已確認 Bug。

---

## 6. 必須交付的最終報告

完成審查後，請在 `docs/review/` 產出下列報告：

1. `00-executive-summary.md`
2. `01-project-map.md`
3. `02-architecture-review.md`
4. `03-api-review.md`
5. `04-crdt-correctness.md`
6. `05-reliability-review.md`
7. `06-sdk-abstractions-review.md`
8. `07-security-review.md`
9. `08-test-build-release-review.md`
10. `09-prioritized-action-plan.md`

若專案已經存在相同名稱或用途的文件，請勿覆蓋原始文件；改用獨立的審查輸出目錄或帶日期的目錄。

### Executive Summary 必須回答

- Yoin 目前最值得保留的三項設計。
- 最重要的五項風險。
- 是否有已確認的 P0/P1 問題。
- 哪些風險已被測試證實，哪些只是尚未驗證。
- 目前是否適合繼續公開發布 0.x 版本。
- 在進入 1.0.0 前，最值得完成的工作。
- 哪些功能可以維持現狀，不需要重構。

### Prioritized Action Plan 必須包含

每項行動均需說明：

- 對應的問題 ID。
- 預期改善。
- 建議修改範圍。
- 相依任務。
- 風險與回歸測試。
- 優先級。
- 建議完成順序。

請將任務分為：

1. 發布前必須修復。
2. 近期應完成。
3. 中期架構改善。
4. 暫時不值得投入的工作。

---

## 7. 整體品質評估

請從以下面向各自評分 1–10 分，並提供具體證據：

- CRDT 正確性與互通性。
- 本地持久化與離線恢復。
- 網路同步可靠性。
- API 設計與開發者體驗。
- Plugin 架構與可維護性。
- React 整合品質。
- 安全性與房間隔離。
- 測試品質。
- 文件品質。
- 發布與部署成熟度。

評分定義：

- **1–3：** 有明顯重大缺陷，或核心能力尚未建立。
- **4–5：** 有基本實作，但關鍵風險或驗證缺口明顯。
- **6–7：** 整體合理，仍有值得優先改善的地方。
- **8–9：** 有充分實作證據及可靠的測試支持。
- **10：** 有完整、可重現的證據，且在評估範圍內具備極高成熟度。

若沒有足夠證據，請標記「無法評分」，不可僅憑 README 給予高分。

另請明確區分：

- 程式碼實作品質。
- 測試所證明的品質。
- 實際部署環境的可靠性。

三者不可混為一談。

---

## 8. 審查完成條件

本次審查只有在以下條件滿足時才算完成：

- 已建立實際模組與資料流地圖。
- 已檢查所有主要功能的實際實作。
- 已追蹤本地與遠端更新的完整生命週期。
- 已分析離線、重連、持久化及程序重啟風險。
- 已檢查 Proxy、React、Plugin 的核心語意。
- 已評估 Worker 的房間隔離及安全邊界。
- 已記錄實際執行與未能執行的測試。
- 已將問題依照嚴重程度排序。
- 每個重大問題都有程式碼證據或清楚標示的驗證缺口。
- 已提出可分階段執行的改善計畫。
- 本階段未擅自修改產品原始碼。

如果審查過程發現問題無法在目前環境驗證，請留下具體的驗證步驟，而不是直接略過。

---

## 9. 給執行 Agent 的最終指令

請以資深 Rust、TypeScript、CRDT、分散式系統及應用安全工程師的標準執行本次審查。

請保持技術判斷客觀：

- 不要因為專案採用 Rust、WASM、CRDT 或 Cloudflare，就預設架構一定正確。
- 不要為了顯示審查價值而刻意挑剔正常的設計取捨。
- 不要把理論上的可能性直接當成已發生的漏洞。
- 不要只列出最佳實踐，必須指出它與本專案實際實作的關係。
- 不要為了追求抽象一致性而建議無必要的重構。
- 優先找出影響資料正確性、安全性與開發者信任的問題。
- 任何效能或可靠性結論，都應盡可能提供測試或量測依據。
- 若發現現有設計已經合理，應明確建議保留。

**第一輪只進行審查與產出報告，不實作修正。完成後等待使用者確認，再依優先級安排後續修復工作。**