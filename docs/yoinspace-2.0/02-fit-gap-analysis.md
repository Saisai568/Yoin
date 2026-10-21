# 02 — 適配性分析：SyncSpace 需求 × Yoin 能力

[← 回總覽](README.md)

---

## 1. 整體適配度

| 面向 | Yoin 適配度 | 說明 |
|---|---|---|
| CRDT 正確性 | ★★★★☆ | 底層為 Yrs，與 Yjs v1 二進位相容；正確使用即可徹底消除 V1-C1/C2 |
| 白板資料模型 | ★★★☆☆ | 有巢狀 YMap 能力，但缺「一次建立含多屬性的巢狀 Map」API，且遠端通知粒度粗 |
| 文字編輯器 | ★★☆☆☆ | 有 Delta 但無遠端 delta 事件、無 Relative Position、無 XmlFragment |
| Local-First / 離線 | ★★★★☆ | IndexedDB plugin + 離線佇列已具備，是相對 V1 的最大增益 |
| 伺服器整合 | ★☆☆☆☆ | 僅有盲轉發 relay；無認證、ACK、伺服器持久化、權威模式 |
| React 整合 | ★★★★☆ | Hooks 完整；房間切換需以 `key` 重建 Provider |
| Awareness | ★★★☆☆ | 機制可用，型別固定、身分不可信 |
| 工程成熟度 | ★★☆☆☆ | 0.x、缺 E2E、版本/打包不一致 |

**結論：** Yoin 適合作為 YoinSpace 的協作底層，但必須先完成 §3 的 P0 補強；否則 YoinSpace 會被迫在應用層重造輪子，違反 V2_RULES「模組化導向：能獨立成 Library 的就模組化」。

---

## 2. 需求 × 能力差距矩陣

圖例：✅ 可直接使用 ｜ 🟡 可用但需調整 ｜ ❌ 缺少

| # | YoinSpace 需求 | V1 作法 | Yoin 0.1.2 | 狀態 | 補強動作（→ 04 清單編號） |
|---|---|---|---|---|---|
| R1 | 白板物件屬性級合併 | `Y.Map<id, JSON>` 整體覆寫 | `map_set_deep` 可寫葉節點；`setMap(obj)` 為原子值 | 🟡 | 新增巢狀 Map 建立/讀取 API（Y-02）；YoinSpace 禁止以 `setMap` 寫入物件 |
| R2 | 白板物件新增（多屬性一次寫入） | `ymap.set(id, obj)` | 需 N 次 `map_set_deep` = N 個 transaction | ❌ | `map_insert_nested(root, key, obj)` 單一 transaction（Y-02） |
| R3 | 遠端變更只重繪受影響容器 | `ymap.observe` | 遠端更新通知全部容器 | 🟡 | 以 Yrs `observe_deep`/transaction 事件回傳變更容器與 key（Y-03） |
| R4 | z-order | `zIndex: Date.now()` | Array move 非原生 | 🟡 | YoinSpace 使用 fractional index 屬性，不依賴 Array move |
| R5 | 筆刷即時預覽 | 每點寫入 CRDT（或結束時寫入） | Awareness 30ms 節流 | 🟡 | 繪製中的筆跡走 Awareness 暫態，放開滑鼠才寫入 CRDT；需 Awareness 自訂欄位（Y-05） |
| R6 | 圖片 | Data URL 存入 CRDT | 無 Blob 型別 | 🟡 | 上傳至伺服器物件儲存，CRDT 只存 URL（不需 Yoin 變更） |
| R7 | 純文字/富文字並發編輯 | textarea LWW | `applyTextDelta` 可寫；遠端只拿到全量 delta | 🟡 | 遠端 Text delta 事件（Y-03）；MVP 可先用 Quill `Delta.diff` 全量比對 |
| R8 | 文字游標/選取區同步 | 無 | 無 Relative Position | ❌ | StickyIndex 編解碼 API（Y-07） |
| R9 | Tiptap/ProseMirror 協作 | 未使用 | 無 XmlFragment | ❌ | 2.x 再做（D2），2.0 採 Quill |
| R10 | 畫布游標 | `awareness.setLocalStateField('cursor')` | `cursorX/cursorY` | ✅ | — |
| R11 | Awareness 自訂資料（工具、選取物件、筆跡） | 任意欄位 | 型別寫死 | 🟡 | `AwarenessState<T>` 泛型（Y-05） |
| R12 | 身分可信（顯示名稱/頭像） | JWT → Go 填入 | `clientId` 亂數、名稱自報 | ❌ | 伺服器依 JWT 覆寫 awareness 身分欄位（Y-05 + 伺服器） |
| R13 | 認證連線 | token 放 query | 無 | ❌ | `getToken()` provider + AUTH/錯誤訊息（Y-04） |
| R14 | 延遲連線/房間切換 | hook 內 new provider | 建構即連線 | 🟡 | `autoConnect: false` + `connect()`（Y-04） |
| R15 | 伺服器持久化（Pro 房間） | Buffer append | 無（僅 IndexedDB） | ❌ | 權威同步伺服器（03 §3） |
| R16 | 送達保證 | 無 | in-flight 重送、無 ACK | 🟡 | UPDATE_ACK（Y-04） |
| R17 | 權限（唯讀/可編輯） | 無 | 無 | ❌ | 伺服器拒絕 viewer 的 update；客戶端顯示唯讀（Y-04 錯誤碼） |
| R18 | 離線編輯 | 無 | IndexedDB plugin | ✅ | 確認 per-room dbName 與登出清除策略 |
| R19 | Undo/Redo | 無 | UndoManager | ✅ | 白板與編輯器分別 scope |
| R20 | 連線狀態 UI | `status` event | `useYoinStatus` | ✅ | 增加「已同步/同步中」狀態（依 ACK） |
| R21 | 聊天 | JSON WS + PG | 不適用 | — | 維持伺服器權威訊息，不放進 CRDT |
| R22 | GitHub Kanban 狀態同步 | 本地拖曳觸發 REST | 不適用 | — | 副作用只由「本地操作」觸發，不由觀察遠端狀態觸發 |
| R23 | 語音 | LiveKit | 不適用 | — | 沿用 LiveKit，token 由新後端簽發 |

---

## 3. 差距優先級

| 優先級 | 差距 | 理由 |
|---|---|---|
| **P0（阻塞 MVP）** | R2/R1 巢狀 Map API、R3 遠端變更事件、R13/R14/R16/R17 伺服器權威模式、R11/R12 Awareness 泛型與身分、Y-O1 錯誤回報、Y-O6 crate 拆分 | 缺任何一項，白板或伺服器無法以 V2 規範實作 |
| **P1（2.0 發布前）** | R8 Relative Position、真實多客戶端 E2E、打包/版本一致、Proxy contract（YOIN-005） | 影響編輯器體驗與發布品質 |
| **P2（2.x）** | R9 XmlFragment、Sub-documents、Blob | 新功能，不阻塞 2.0 |

---

## 4. 兩個專案各自的適配性評估

### 4.1 SyncSpace 作為「被重構方」

| 優勢 | 劣勢 |
|---|---|
| 產品需求明確、功能已驗證（W1–W10 DoD 文件齊全） | 協作層與後端持久化需全部重寫 |
| Yjs 資料結構（Text/Map）與 Yoin 概念一一對應，心智模型可延續 | `Whiteboard.tsx` 1207 行單檔混合 UI/狀態/同步，拆分成本高 |
| GitHub/LiveKit 整合是獨立的 REST 邏輯，易於移植 | V1 Pro 房間資料不可用（V1-C3） |
| 已有 `V2_RULES.md` 分層規範可直接作為驗收標準 | 安全基線需從零建立 |

### 4.2 Yoin 作為「新底層」

| 優勢 | 劣勢 |
|---|---|
| 同一作者維護，可依 YoinSpace 需求調整 API | 0.x，API 尚會變動；YoinSpace 同時是 Yoin 的第一個大型消費者 |
| Rust 核心可同構至伺服器（拆 crate 後） | 目前伺服器端零實作；relay/worker 不在本 repo |
| Local-First、Undo、Zod 為 V1 沒有的增益 | 遠端事件粒度、Awareness 型別等設計需調整 |
| 與 Yjs 二進位相容，必要時可用 Yjs 工具除錯 | 測試多為 mock，跨端收斂未被證明 |

> [!TIP]
> 把 YoinSpace 視為 Yoin 的 **reference application**：每個 P0 補強都應先在 Yoin repo 內以測試完成並發版，YoinSpace 只透過公開 API 使用 Yoin，避免在應用層修補框架缺陷。

