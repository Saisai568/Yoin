[繁體中文](ARCHITECTURE.md) | [English](ARCHITECTURE_en.md)

# Yoin 系統架構設計文件

> 版本：`@yoin/client` v0.1.2

## 目錄

- [設計哲學](#設計哲學)
- [系統分層架構](#系統分層架構)
- [Monorepo 結構](#monorepo-結構)
- [Layer 1：Rust CRDT 核心 (`@yoin/core`)](#layer-1rust-crdt-核心-yoincore)
  - [為什麼選擇 Yrs + WASM](#為什麼選擇-yrs--wasm)
  - [YoinDoc 內部結構與型別保真](#yoindoc-內部結構與型別保真)
  - [差量更新機制（State Vector Diff）](#差量更新機制state-vector-diff)
- [Layer 2：TypeScript 微核心 SDK (`@yoin/client`)](#layer-2typescript-微核心-sdk-yoinclient)
  - [微核心 + 插件架構](#微核心--插件架構)
  - [資料流：本地寫入與容器隔離通知](#資料流本地寫入與容器隔離通知)
  - [資料流：遠端同步與快照預載](#資料流遠端同步與快照預載)
  - [三向交握同步協議（含空 Diff 抑制）](#三向交握同步協議含空-diff-抑制)
  - [Awareness 感知子系統](#awareness-感知子系統)
  - [網路層與暫態離線佇列](#網路層與暫態離線佇列)
  - [Proxy 透明讀寫原理](#proxy-透明讀寫原理)
  - [React 18 整合原理](#react-18-整合原理)
- [Layer 3：中繼伺服器與持久化架構](#layer-3中繼伺服器與持久化架構)
- [測試架構](#測試架構)
- [建置管線](#建置管線)

---

## 設計哲學

Yoin 的設計圍繞四個核心原則：

1. **Local-First（本地優先）**
   所有讀寫操作直接在本地記憶體中的 WASM CRDT 文件上執行，延遲為零。網路層僅負責在背景非同步傳遞二進位差量（Diff），即使完全離線也能正常編輯與持久化。

2. **Micro-Kernel（微核心）**
   `YoinClient` 核心僅保留「CRDT 操作、網路同步、容器級訂閱、Awareness 感知」四項職責。IndexedDB 持久化、全容器 Undo/Redo、除錯日誌等功能全部透過 `YoinPlugin` 介面以插件形式掛載。

3. **Zero-Config Sync（零設定同步）**
   開發者只需透過 `createMapProxy`、`createArrayProxy` 或 React Hooks（`useYoinMap`、`useYoinArray`、`useYoinText`）讀寫普通 JavaScript 物件，底層自動完成 CRDT 事務編碼、二進位封包組裝與 WebSocket 廣播。

4. **Dumb Pipe Relay + Snapshot Hydration（無狀態轉發 + 快照預載）**
   WebSocket 中繼層（Cloudflare Worker Durable Objects 或 Node.js Relay）不需要解析 CRDT 內容，所有合併運算都在客戶端 WASM 中完成；同時支援透過 `exportSnapshot()` / `applySnapshot()` 與後端資料庫結合，實現新房間秒級預載。

---

## 系統分層架構

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                            │
│   React Components (useYoinMap / useYoinArray / useYoinText)        │
│   Vanilla JS (createMapProxy / createArrayProxy / Direct API)       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     @yoin/client (TypeScript)                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    YoinClient (Micro-Kernel)                   │  │
│  │  • Text / Rich-Text Delta / Map CRUD / Array CRUD             │  │
│  │  • Container-Scoped Subscriptions (Map / Array / Text)        │  │
│  │  • Snapshot Hydration (applySnapshot / exportSnapshot)        │  │
│  │  • Zod Schema Validation (setMap / batchSet / Array)          │  │
│  │  • Awareness Engine (Throttle 30ms + Heartbeat + GC)          │  │
│  └──────┬────────────────────┬────────────────────┬──────────────┘  │
│         │                    │                    │                  │
│  ┌──────▼──────┐     ┌──────▼───────┐     ┌──────▼──────────────┐  │
│  │   Plugins   │     │NetworkManager│     │   WASM Loader       │  │
│  │ • DbPlugin  │     │ • WebSocket  │     │ • Singleton Lock    │  │
│  │ • UndoPlugin│     │ • Non-Trans  │     │ • Memory Cleanup    │  │
│  │ • Logger    │     │   Offline Q  │     │   (doc.free)        │  │
│  └─────────────┘     └──────┬───────┘     └──────┬──────────────┘  │
└─────────────────────────────┼────────────────────┼──────────────────┘
                              │                    │
               WebSocket      │                    │ FFI (wasm-bindgen)
            (Binary Protocol) │                    │
┌─────────────────────────────┼────────────────────▼──────────────────┐
│                             │         @yoin/core (Rust WASM)        │
│                             │  ┌─────────────────────────────────┐  │
│                             │  │ YoinDoc                         │  │
│                             │  │  • yrs::Doc                     │  │
│                             │  │  • yrs::UndoManager (All Types) │  │
│                             │  │  • js_to_any / any_to_js        │  │
│                             │  │  • Rich Text Delta + Formatting │  │
│                             │  └─────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                Relay Server (Yoin-apps-example)                     │
│  • Cloudflare Worker + Durable Objects / Node.js WS Relay           │
│  • Room Routing + Binary Broadcast (excluding sender)               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Monorepo 結構

```
yoin/
├── pnpm-workspace.yaml          # Workspace 定義 (packages/*)
├── package.json                 # Root scripts & devDependencies
├── packages/
│   ├── core/                    # @yoin/core — Rust WASM CRDT 引擎
│   │   ├── Cargo.toml           # Rust 依賴 (yrs 0.18, wasm-bindgen, serde, js-sys)
│   │   ├── src/
│   │   │   └── lib.rs           # YoinDoc 完整實作
│   │   └── pkg-web/             # wasm-pack 編譯產物 (core.js, core_bg.wasm, core.d.ts)
│   └── client/                  # @yoin/client — TypeScript SDK
│       ├── package.json         # Dual Exports: "." 與 "./react"
│       ├── tsup.config.ts       # ESM + CJS 雙格式打包設定
│       ├── vitest.config.ts     # 單元測試與覆蓋率設定
│       └── src/
│           ├── index.ts         # 主入口匯出
│           ├── YoinClient.ts    # 微核心主類別
│           ├── types.ts         # 全域型別與協議常數 (含 TextDeltaOp)
│           ├── plugin.ts        # YoinPlugin 介面定義
│           ├── network.ts       # WebSocket 連線、重連、暫態過濾佇列
│           ├── storage.ts       # IndexedDB 封裝 (含連線單例快取與 close)
│           ├── proxy.ts         # createMapProxy / createArrayProxy
│           ├── logger.ts        # 內建 Logger 插件
│           ├── wasm/
│           │   └── loader.ts    # WASM 單例初始化器
│           ├── plugins/
│           │   ├── index.ts
│           │   ├── db.ts        # IndexedDB 自動防抖存檔與載入後同步插件
│           │   └── undo.ts      # 全容器自動擴展範圍之 Undo/Redo 插件
│           ├── react/
│           │   └── index.tsx    # React 18 Hooks (Provider, Map, Array, Text, Status, Undo)
│           └── __tests__/       # Vitest 單元測試與真實 WASM 整合測試 (123 tests)
├── tests/
│   └── monorepo-integrity.test.mjs  # Monorepo 結構完整性測試 (54 checks)
└── docs/                        # 技術文件
```

> 示範應用程式（Vanilla / React Demo、API 測試沙盒）、Node.js Relay 伺服器與 Cloudflare Worker 位於獨立的 [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) 儲存庫。

---

## Layer 1：Rust CRDT 核心 (`@yoin/core`)

### 為什麼選擇 Yrs + WASM

- **極致效能與二進位體積**：Yrs 是 Yjs 官方的 Rust 移植版，記憶體佔用更低，編譯出的 `core_bg.wasm` 約 236 KB。
- **跨語言一致的二進位格式**：使用 Yjs v1 Encoding（`encode_state_as_update_v1` / `Update::decode_v1`），與整個 Yjs 生態系二進位完全相容。

### YoinDoc 內部結構與型別保真

`packages/core/src/lib.rs` 定義了匯出給 JavaScript 的 `YoinDoc` 結構體：

```rust
#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,
    undo_manager: Option<UndoManager>,
}
```

**原生型別保真 (`js_to_any` / `any_to_js`)**：
在 v0.1.2 中，Yoin 移除了早期將字串透過 `serde_json::from_str` 強制解析的做法，改為在 Rust 端實作遞迴的 `js_to_any(&JsValue) -> yrs::Any` 與 `any_to_js(&yrs::Any) -> JsValue` 雙向轉換：
- JavaScript 的 `"123"` 對應 `Any::String("123")`，`123` 對應 `Any::Number(123.0)`，`"true"` 對應 `Any::String("true")`，`true` 對應 `Any::Bool(true)`。
- 巢狀 JavaScript Array 與 Object 遞迴轉換為 `Any::Array` 與 `Any::Map`。

**支援的 CRDT 操作一覽**：

| 類別 | Rust 方法 | 對應 Yrs 型別 | 說明 |
|------|-----------|---------------|------|
| **Text / Rich Text** | `insert_text`, `insert_text_with_attrs`, `delete_text`, `format_text`, `apply_text_delta`, `clear_text`, `get_text`, `get_text_delta` | `TextRef` | 支援多具名文字容器、格式屬性與 Quill Delta |
| **Map** | `map_set`, `map_delete`, `map_get`, `map_get_all`, `map_set_deep`, `batch_set` | `MapRef` + `MapPrelim` | 完整鍵值 CRUD、深層任意型別更新與批量事務 |
| **Array** | `array_push`, `array_insert`, `array_delete`, `array_get_all` | `ArrayRef` | 有序列表新增、定點插入、區間刪除與查詢 |
| **Sync** | `encode_state_vector`, `encode_diff`, `apply_update` | `StateVector` + `Update` | 二進位狀態向量與差量同步 |
| **Undo** | `init_undo_manager`, `expand_undo_scope`, `expand_undo_scope_for`, `undo`, `redo` | `UndoManager` | 支援動態擴展 Map / Array / Text 容器的撤銷範圍 |

### 差量更新機制（State Vector Diff）

每個寫入操作都遵循相同的模式，只回傳**本次操作產生的最小二進位差量（Diff）**：

```rust
let sv_before = self.doc.transact().state_vector();
{
    let mut txn = self.doc.transact_mut();
    // 執行 CRDT 寫入...
}
let txn = self.doc.transact();
txn.encode_diff_v1(&sv_before)
```

---

## Layer 2：TypeScript 微核心 SDK (`@yoin/client`)

### 微核心 + 插件架構

```
                    ┌─────────────────────┐
                    │   Local Mutation    │
                    │ (setMap/insertText) │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  WASM YoinDoc Op    │
                    │  → returns diff     │
                    └──────────┬──────────┘
                               │
              ┌────────────────▼────────────────┐
              │  Plugin: onBeforeUpdate(diff)   │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │  Network: broadcast([1, ...diff])│
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │  Plugin: onAfterUpdate(diff)    │
              │  Hooks:  onLocalUpdate / onDoc  │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │  Container-Scoped Subscribers   │
              │  (Map / Array / Text + Global)  │
              └─────────────────────────────────┘
```

### 資料流：本地寫入與容器隔離通知

當本地呼叫 `client.setMap('shapes', 'rect1', data)` 時：
1. WASM 計算出二進位 `diff` 並透過 WebSocket 廣播。
2. `notifyMapSubscribers('shapes')` **只會通知訂閱了 `'shapes'` 的元件**（以及全域 `subscribe` 監聽器），正在編輯 `'article'` 文字容器或 `'layers'` 陣列的元件完全不會重新渲染，確保 60FPS 畫布流暢度。

### 資料流：遠端同步與快照預載

當收到遠端 `MSG_SYNC_STEP_2` 或呼叫 `applySnapshot(snapshot)` 時：
1. `this.doc.apply_update(payload)` 將二進位更新無衝突合併進本地 WASM 文件。
2. 觸發 `onDocUpdate` 鉤子（讓 `YoinDbPlugin` 排程防抖存檔）。
3. 呼叫 `notifyAllSubscribers()` 更新所有已訂閱的 Map、Array、Text 與全域監聽器。

### 三向交握同步協議（含空 Diff 抑制）

為了避免多人在線時產生 $O(N^2)$ 空封包廣播風暴，`YoinClient` 內建 `hasNonEmptyUpdate(diff)` 檢查（忽略長度為 0 或 `[0, 0]` 的空 Yrs update），僅在確實存在差異時才發送 `MSG_SYNC_STEP_2`。

### Awareness 感知子系統

Awareness 採用獨立通道（`MSG_AWARENESS = 3`），並包含：
- **節流機制（Throttling）**：預設 30ms 節流，最高約 33 次/秒。
- **心跳與垃圾回收（GC）**：每 5 秒廣播一次心跳，超過 30 秒未回應自動移除游標 DOM。
- **暫態標記（`{ transient: true }`）**：離線期間不會排入 `NetworkManager` 的重送佇列。

### 網路層與暫態離線佇列

`NetworkManager` 支援：
- **指數退避重連**：`1000ms * 2^attempt`（上限 30 秒，最多 50 次；耗盡後轉為 `'failed'` 狀態）。
- **非暫態離線佇列**：離線期間僅將實際的 CRDT 更新（`MSG_SYNC_STEP_2`）放入 `messageQueue`，忽略 `transient: true` 的封包，重連成功後依序沖刷（Flush）。

### Proxy 透明讀寫原理

- **`createMapProxy`**：攔截 `get`（不存在鍵回傳 `undefined`，巢狀物件自動包覆深層 Proxy）、`set`（自動呼叫 `setMap` 或 `setMapDeep`）、`deleteProperty`（自動呼叫 `deleteMap`）、`has` 與 `ownKeys`。
- **`createArrayProxy`**：每次存取皆從 `client.getArray` 讀取即時狀態，並攔截 `.push()`、`.splice()`、`.pop()`、`.shift()`、`.unshift()` 自動轉換為 `pushArray` / `insertArray` / `deleteArray`。

### React 18 整合原理

`@yoin/client/react` 使用 React 18 的 `useSyncExternalStore`：
- `useYoinMap(mapName)` 綁定 `client.subscribeMap(mapName, cb)`，並在快照變更時更新 Proxy 物件參考。
- `useYoinArray(arrayName)` 綁定 `client.subscribeArray(arrayName, cb)`。
- `useYoinText(textName)` 綁定 `client.subscribeText(textName, cb)`，同時回傳純文字 `text`、富文本 `delta` 與編輯方法。

---

## Layer 3：中繼伺服器與持久化架構

Yoin 客戶端可搭配任意支援上述 1-byte Header 協議的 WebSocket Relay 運作（範例實作位於 `Yoin-apps-example`）：
- **Cloudflare Worker + Durable Objects (`yoin-worker`)**：邊緣無狀態轉發。
- **Node.js WebSocket Relay (`server`)**：輕量本地開發與自架中繼。
- **快照預載整合**：後端可定期或於房間關閉時儲存 `client.exportSnapshot()` 的二進位結果；新客戶端進房時先呼叫 `client.applySnapshot(snapshot)` 即可秒級完成大型文件載入。

---

## 測試架構

```
┌─────────────────────────────────────────────────────────────┐
│                   Test Pyramid (177 Checks)                  │
│                                                             │
│          ┌───────────────────────────────────┐              │
│          │   Monorepo Integrity (54 checks)  │              │
│          │   tests/monorepo-integrity.test   │              │
│          ├───────────────────────────────────┤              │
│          │   Real WASM Integration (8 tests) │              │
│          │   src/__tests__/real-wasm.test.ts │              │
│          ├───────────────────────────────────┤              │
│          │   Unit Tests (115 tests)          │              │
│          │   Vitest + happy-dom + fake-idb   │              │
│          └───────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

| 測試檔案 | 測試數量 | 涵蓋模組 |
|----------|----------|----------|
| `real-wasm.test.ts` | 8 | 真實 `core_bg.wasm` 整合測試（型別保真、Map/Array CRUD、富文本 Delta、雙端同步、Undo/Redo） |
| `YoinClient.test.ts` | 36 | `YoinClient` 全方法、容器訂閱、快照預載、空 diff 抑制、Schema 驗證、Awareness |
| `plugins.test.ts` | 21 | `YoinDbPlugin`、`YoinUndoPlugin`（含全容器自動擴展）、`LoggerPlugin` |
| `network.test.ts` | 15 | `NetworkManager` 連線、重連退避、暫態離線佇列過濾 |
| `proxy.test.ts` | 15 | `createMapProxy`（含 `delete`/`in`/`keys`）、`createArrayProxy`（含 `splice`/`pop`/`unshift`） |
| `storage.test.ts` | 12 | `StorageAdapter` IndexedDB 快照存取與連線快取 |
| `loader.test.ts` | 9 | `initYoin` 單例鎖、並行呼叫、錯誤恢復 |
| `types.test.ts` | 7 | 協議常數驗證 |
| `monorepo-integrity.test.mjs` | 54 | Workspace 結構、套件匯出、建置產物驗證 |

---

## 建置管線

```
Step 1: pnpm build:wasm
  packages/core/src/lib.rs
    ──(cargo build --target wasm32-unknown-unknown --release)──►
    ──(wasm-bindgen --target web --out-dir pkg-web)──►
  packages/core/pkg-web/
    ├── core.js          (JS glue code)
    ├── core_bg.wasm     (~236 KB WebAssembly binary)
    └── core.d.ts        (TypeScript declarations)

Step 2: pnpm build:client
  packages/client/src/{index.ts, react/index.tsx}
    ──(tsup: esbuild + dts)──►
  packages/client/dist/
    ├── index.js / index.cjs / index.d.ts     (Main SDK)
    ├── react.js / react.cjs / react.d.ts     (React Hooks)
    └── core_bg.wasm                          (Copied by onSuccess hook)
```
