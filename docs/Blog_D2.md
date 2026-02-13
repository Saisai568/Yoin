# 從零打造 Local-First 同步引擎：Yoin 的架構全貌與實戰覆盤

在當今的 Web 開發中，多人即時協作（如 Figma、Notion）已經從「加分項」變成了「標準配備」。然而，要實作一個兼具**離線可用性**、**毫秒級延遲**與**完美衝突解決**的同步系統，往往需要耗費巨大的工程成本。

過去這段時間，我從底層基礎設施開始，打造了一款名為 **Yoin** 的狀態同步框架。截至目前，Yoin 已完成了從 MVP 到工業級引擎的蛻變——包含 Rust WASM 核心、模組化 TypeScript SDK、智慧型伺服器、以及完整的即時游標協作體驗。今天，我想完整地分享 Yoin 走到這一步的架構決策、技術細節，以及一路踩過的深坑。

---

## 💡 為什麼要有 Yoin？它的定位是什麼？

市場上已經有許多優秀的解決方案，為什麼還要從頭造輪子？

Yoin 的誕生，源自於對「純粹性」的追求。很多框架試圖包山包海，將狀態同步、富文本編輯器、甚至畫布引擎全部綁定在一起（Monolith 巨石架構）。這導致了極高的依賴耦合與臃腫的體積。

**Yoin 的定位非常明確：它是一個「純粹、輕量、高效的狀態同步引擎」。** 它不強迫你使用特定的 UI 元件，它只專注於做好一件事——**讓資料在多個終端之間，以最高效、最安全的方式保持一致。** 你可以輕易地將 Yoin 接上 React、Vue、Konva.js 畫布，或是任何你自己手寫的 Vanilla JS 介面。

---

## 🛠️ 核心架構：四層分離的工程哲學

Yoin 採用了嚴格的分層架構，每一層各司其職、互不侵犯：

```
┌─────────────────────────────────┐
│  Layer 4: App (main.ts)         │  事件綁定、rAF 節流、DOM Diffing
├─────────────────────────────────┤
│  Layer 4a: Renderers            │  純函式游標/頭像 DOM 工廠
├─────────────────────────────────┤
│  Layer 3: YoinClient (SDK)      │  CRDT 同步引擎 + Awareness 狀態管理
│  ├── network.ts                 │  WebSocket 協議 + 離線佇列
│  ├── storage.ts                 │  IndexedDB 適配器
│  └── types.ts                   │  型別契約 (Interface)
├─────────────────────────────────┤
│  Layer 2: Transport (Server)    │  Smart Relay + Room 隔離 + Compaction
├─────────────────────────────────┤
│  Layer 1: Core (Rust + WASM)    │  CRDT 引擎 (yrs) + serde 序列化
└─────────────────────────────────┘
```

### 大腦核心 (Rust + WebAssembly)

底層引入了強大的 `yrs` (Yjs 的 Rust 實作) 作為 CRDT（無衝突複製資料類型）引擎。Rust 核心（約 300 行）提供了完整的 API 矩陣：

| 資料類型 | 寫入 API | 讀取 API |
|---------|---------|---------|
| **Text** | `insert_and_get_update`, `delete_text_and_get_update` | `get_text` |
| **Map** | `map_set_and_get_update`, `map_set_deep` | `map_get`, `map_get_all`, `map_get_json` |
| **Array** | `array_push_and_get_update` | `array_get`, `array_get_all` |
| **Sync** | `apply_update` | `get_state_vector`, `export_diff`, `snapshot`, `get_missing_updates` |

每個「寫入」操作都遵循同一個模式：**記錄操作前的 State Vector → 執行變更 → 回傳增量 Diff**。這個設計讓前端只需將回傳的 `Uint8Array` 直接廣播，無需自行計算差異，封包大小從全量的數 KB 縮小到**僅僅幾十 Bytes**。

為了保證跨語言序列化的絕對安全，核心整合了 `serde_json` 與 `serde-wasm-bindgen`，徹底根絕了前端 `JSON.parse` 崩潰的風險。

### 通訊與封裝層 (TypeScript SDK)

前端開發者完全不需要接觸 WASM。Yoin 提供了一個極度乾淨的黑盒子 SDK (`YoinClient`)，約 550 行 TypeScript 碼，封裝了所有的網路重連、二進制協議解析、感知系統與本地存儲邏輯。透過 `index.ts` 統一匯出，外部只需一行 `import { initYoin, YoinClient } from './yoin'` 即可使用全部能力。

---

## ✨ 已實現的核心功能

### 1. 真正的 Local-First 與極致韌性

Yoin 預設將所有狀態透過防抖機制（1000ms Debounce）寫入瀏覽器的 `IndexedDB`。

- **零延遲體驗：** 使用者的任何操作都會立刻反映在畫面上，無需等待伺服器回應。
- **離線佇列：** 網路斷線時，所有操作會被暫存在記憶體佇列中。`NetworkProvider` 偵測到 WebSocket 關閉後，新的更新不會被丟棄，而是推入 `messageQueue`；連線恢復時自動 Flush。
- **三向交握（3-Way Handshake）：** 連線建立後，Client 送出 `MSG_SYNC_STEP_1`（State Vector）→ 對方回覆 `MSG_SYNC_STEP_2`（Diff）+ `MSG_SYNC_STEP_1_REPLY`（對方的 SV）→ 本方再補齊缺漏。整個流程在毫秒內完成，確保斷線期間的 Diff 不遺漏。

### 2. 極輕量的二進制通訊協議 & 多房間隔離

拋棄了臃腫的 JSON 傳輸，Yoin 實作了基於 `Uint8Array` 的自訂 **1-Byte 標頭路由協議**：

| Type ID | 名稱 | 方向 | 用途 |
|---------|------|------|------|
| `0` | `MSG_SYNC_STEP_1` | Client → Server | 發送 State Vector 請求同步 |
| `1` | `MSG_SYNC_STEP_2` | 雙向 | 傳送實質 CRDT Update / Diff |
| `2` | `MSG_SYNC_STEP_1_REPLY` | Server → Client | 回覆對方 State Vector |
| `3` | `MSG_AWARENESS` | 雙向 (Blind Relay) | 感知狀態廣播 |

配合 Node.js 後端的 Query String 動態路由（`?room=xxx`），每個房間擁有獨立的 `YoinDoc` 實例與客戶端集合，資料互不污染。前端的 IndexedDB 也以 `YoinDemoDB-{room}` 做到完美分房。

### 3. 智慧型伺服器：Snapshot & Compaction

這是 v2.0 升級的核心突破。伺服器從「盲轉發 (Dumb Relay)」進化為**智慧權威節點 (Smart Authority)**：

- **伺服器端 CRDT 實例：** 每個房間在記憶體中維護一個 Rust `YoinDoc`。收到 `MSG_SYNC_STEP_2` 時，伺服器會先 `apply_update` 到自己的文件，再廣播給其他人。
- **Compaction 壓縮：** 每累積 50 次更新，觸發 `snapshot()` 將歷史紀錄壓縮為單一狀態向量。經測試，1000 次操作後數據量可減少 **95% 以上**。
- **新用戶秒加入：** 收到 `MSG_SYNC_STEP_1` 後，伺服器直接呼叫 `get_missing_updates(clientSV)` 計算差異，新用戶只需下載壓縮後的 Diff，載入時間從 O(History) 降為 O(Size)。

### 4. 工業級感知系統 (Awareness & Presence)

協作軟體的靈魂在於「知道誰在線上」。Yoin 內建了一套獨立於 CRDT 之外的感知系統，設計為**短暫狀態（Ephemeral）**，不寫入 IndexedDB、不進入 CRDT 歷史：

- **Figma 級即時游標：** 配備 SVG 箭頭 + 名字標籤的標準游標，以及 Emoji 風格游標，支援開發者自定義 `CursorRenderer` 與動態切換。游標定位使用 **CSS `transform` 硬體加速**，配合 `transition: 100ms linear` 實現絲滑移動。
- **rAF + Throttle 雙重節流：** 前端滑鼠事件先經 `requestAnimationFrame` 批次收斂（Input 端），`setAwareness` 再施加可調節流（預設 30ms，Network 端），徹底避免廣播風暴。
- **DOM Diffing 渲染：** 游標 DOM 元素被快取在 `Map<string, HTMLElement>` 中。每次 Awareness 回呼時，只更新位置、新增/刪除節點，不會重建整顆 DOM 子樹。
- **自動除靈機制 (Ghost Busting)：** 結合 `beforeunload` 主動下線通知、定時心跳（每 5 秒帶 `timestamp`）與垃圾回收（每 3 秒掃描，30 秒未活動即清除），完美消滅異常斷線殘留的「幽靈使用者」。
- **白板選取同步：** 點擊白板物件時，透過 `setAwareness({ selection: shapeId })` 廣播選取狀態，其他用戶自動看到對應物件的色框。

### 5. 巢狀 Map 與屬性級合併

這是為白板協作場景設計的進階功能。傳統 JSON 覆蓋（Last Write Wins）會導致 User A 改 X 軸時覆蓋掉 User B 剛改的顏色。Yoin 透過 Rust 端的 `map_set_deep` 遞迴建立巢狀 CRDT Map 節點，實現**屬性級別的無衝突合併**。

```typescript
// User A: 改位置
client.setMapDeep('shapes', ['rect-1', 'x'], 150);

// User B: 同時改顏色
client.setMapDeep('shapes', ['rect-1', 'style', 'color'], '#ff0000');

// 結果：兩者完美合併，零衝突
client.getMapJSON('shapes');
// → { "rect-1": { "x": 150, "style": { "color": "#ff0000" } } }
```

### 6. 網路狀態 UI 反饋

底層 WebSocket 的 `connecting` / `online` / `offline` 狀態統一透過 `subscribeNetwork` 暴露給前端，應用層可精準實作連線燈號切換：

```typescript
client.subscribeNetwork((status) => {
    // status: 'connecting' | 'online' | 'offline'
    updateConnectionIndicator(status);
});
```

---

## 🔥 踩坑實錄：從崩潰到穩定

打造 Rust + WASM + TypeScript 的跨語言系統，踩坑是不可避免的。以下是最痛的幾個教訓：

### 坑一：WASM 殭屍鎖 (The Zombie Lock)

**現象：** `ExclusiveAcqFailed(BorrowMutError)`——看起來正確的程式碼卻永遠報錯。

**根因：** Rust 在之前的執行中 Panic，導致 `TransactMut` 的鎖未被 Drop。WASM 記憶體不會因為頁面刷新而重置。更隱蔽的是**自我死結**——在持有鎖的狀態下呼叫需要鎖的函數。

**解法：** 嚴格遵守「先拿 Ref (MapRef/ArrayRef)，再開 Transaction」的順序。遇到鎖死時，必須**關閉分頁 + 重啟 Dev Server**。

```rust
// ✅ 正確：先拿指標，再開鎖
let map = doc.get_or_insert_map(name);
let txn = doc.transact_mut();
map.insert(&mut txn, key, value);

// ❌ 錯誤：鎖開著又去拿 Map（需要讀取鎖 → 死結）
let txn = doc.transact_mut();
let map = doc.get_or_insert_map(name); // Boom!
```

### 坑二：WASM Panic 被吞掉 (Silent Panic)

**現象：** Console 只顯示 `RuntimeError: unreachable`，完全不知道 Rust 哪一行出錯。

**解法：** 引入 `console_error_panic_hook` crate，並在 `main.ts` 的**最一開始**就呼叫 `initPanicHook()`。這讓我們發現了好幾個原本隱藏在 `unwrap()` 中的炸彈。

### 坑三：型別初始化陷阱 (MapPrelim)

**現象：** `MapPrelim::default()` not found。

**解法：** `yrs` API 變更後，`MapPrelim` 不再支援 Default trait。改用 `HashMap<String, String>` 進行轉換：

```rust
let empty: HashMap<String, String> = HashMap::new();
let new_map = current_map.insert(&mut txn, key, MapPrelim::from(empty));
```

---

## 📊 開發里程碑

以下是 Yoin 從誕生到現在的完整里程碑：

| 階段 | 核心目標 | 狀態 |
|------|---------|------|
| **Phase 1: 基礎 MVP** | CRDT 雙向同步、純文字編輯、IndexedDB 存檔、WebSocket 廣播 | ✅ 已完成 |
| **Phase 2: 框架工業化** | 二進制協議、離線佇列、防抖儲存、Map/Array 支援、Awareness 基底 | ✅ 已完成 |
| **Phase 3: 模組化與 UX 打磨** | SDK 黑盒封裝、Figma 級即時游標、網路狀態 UI、多房間 URL 隔離 | ✅ 已完成 |
| **Phase 3.1: v2.0 核心升級** | Smart Server (Snapshot & Compaction)、巢狀 Map、Panic Hook、死結修復 | ✅ 已完成 |
| **Phase 4: 生態系整合與實戰** | React/Vue Hooks、npm 打包發布、Auth & Room 安全、E2E 測試 | ⏳ Next |

---

## 🧪 Code Review 摘要：待解決的技術債

經過兩輪完整的程式碼審查（Full Project Review + Comprehensive Review），以下是目前已識別但尚未修復的重要議題：

| 優先級 | 議題 | 說明 |
|--------|------|------|
| 🔴 High | Awareness 節流競態 | 多次快速呼叫 `setAwareness` 可能在 timeout 期間造成狀態不一致 |
| 🔴 High | 離線佇列無上限 | `messageQueue` 無容量限制，長時間離線可能導致記憶體耗盡 |
| 🟡 Medium | 無指數退避重連 | 斷線重連固定 3 秒，大量客戶端同時重連可能引發 Stampede |
| 🟡 Medium | YoinClient 職責過重 | Awareness、CRDT、Network 邏輯耦合，建議拆分為獨立 Manager |
| 🟡 Medium | Map 全量序列化效能 | `map_get_json` 每次呼叫都全量轉 JSON，大型 Map 可能阻塞主執行緒 |
| 🟠 Low | 無測試框架 | 目前零單元測試，CRDT 合併邏輯、協議解析等核心路徑缺乏覆蓋 |
| 🟠 Low | 無驗證機制 | WebSocket 無 Auth，僅適用於受信任環境 |

---

## 📐 專案現況數據

| 指標 | 數值 |
|------|------|
| Rust Core (lib.rs) | ~300 行 |
| TypeScript SDK (yoin/) | ~750 行 (4 模組) |
| Server (server.js) | ~130 行 |
| Demo App (main.ts + renderers.ts) | ~450 行 |
| 協議訊息類型 | 4 種 (1-byte header) |
| CRDT 資料類型 | 3 種 (Text, Map, Array) |
| Awareness 功能 | 游標、頭像、心跳、GC、選取同步 |

---

## 🚀 下一步：生態系與實戰整合

Yoin 核心引擎的開發已經從「概念驗證」蛻變為「可用的引擎」。接下來將進入 **Phase 4 (生態系整合)**，聚焦於三個方向：

1. **框架適配器：** 開發適用於 React/Vue/Solid 等現代框架的 Hooks（例如 `useYoin`、`useAwareness`），讓開發者一行程式碼就能接入協作能力。
2. **npm 打包與發布：** 利用 Vite Library Mode 將 `yoin/` 目錄打包為標準 npm 套件，附帶完整的 `.d.ts` 型別定義。
3. **實戰壓力測試：** 將 SDK 投入真實的應用場景（例如結合 Tauri 打造的高效能 GUI 編輯器）進行壓力與邏輯測試，同時補齊 Code Review 中識別的技術債。

這是一個從零開始、踩過無數分散式系統坑洞的奇妙旅程。從第一行 Rust 編譯出 WASM 的那一刻起，到現在擁有完整的即時游標、離線協作、智慧壓縮——每一步都在驗證「這條路走得通」。

Yoin SDK 的源碼與 npm 套件即將在近期整理後開源釋出，敬請期待！

$input = Get-Content .\core_bg.wasm -Encoding Byte
$stream = New-Object IO.MemoryStream
$gzip = New-Object IO.Compression.GZipStream($stream, [IO.Compression.CompressionMode]::Compress)
$gzip.Write($input, 0, $input.Length)
$gzip.Close()
$stream.ToArray().Length / 1KB