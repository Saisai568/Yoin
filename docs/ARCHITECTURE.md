[繁體中文](ARCHITECTURE.md) | [English](ARCHITECTURE_en.md)

# Yoin 架構文件

## 目錄

- [系統總覽](#系統總覽)
- [四層架構](#四層架構)
- [Layer 1：CRDT 引擎（Rust + WASM）](#layer-1crdt-引擎rust--wasm)
- [Layer 2：WebSocket 中繼（Cloudflare Worker）](#layer-2websocket-中繼cloudflare-worker)
- [Layer 3：客戶端 SDK（TypeScript）](#layer-3客戶端-sdktypescript)
- [Layer 4：應用層](#layer-4應用層)
- [通訊協議](#通訊協議)
- [同步機制](#同步機制)
- [離線與持久化](#離線與持久化)
- [Awareness 系統](#awareness-系統)
- [Monorepo 基礎設施](#monorepo-基礎設施)
- [部署架構](#部署架構)
- [未來優化方向](#未來優化方向)

---

## 系統總覽

Yoin 是一個 **Local-First 即時協作狀態同步框架**。核心理念是讓任何 Web 應用在幾行程式碼內獲得多人即時協作能力，且在離線環境下仍可正常運作。

```
┌─────────────────────────────────────────────────┐
│                   Browser A                     │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  App UI │→ │ YoinClient│→ │ YoinDoc(WASM) │  │
│  └─────────┘  └────┬─────┘  └───────────────┘  │
│                    │ WebSocket                    │
└────────────────────┼────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │  Cloudflare Edge    │
          │  ┌────────────────┐ │
          │  │  YoinRoom (DO) │ │  ← Durable Object (按房間隔離)
          │  │  WebSocket     │ │
          │  │  Blind Relay   │ │
          │  └────────────────┘ │
          └──────────┬──────────┘
                     │
┌────────────────────┼────────────────────────────┐
│                    │ WebSocket                    │
│  ┌─────────┐  ┌───┴──────┐  ┌───────────────┐  │
│  │  App UI │→ │ YoinClient│→ │ YoinDoc(WASM) │  │
│  └─────────┘  └──────────┘  └───────────────┘  │
│                   Browser B                     │
└─────────────────────────────────────────────────┘
```

**設計哲學**：每個瀏覽器持有完整的 CRDT 文件副本（Replica），伺服器僅負責轉發。所有合併邏輯在客戶端由 Rust WASM 執行，確保即使伺服器不可用也能離線操作。

---

## 四層架構

```
┌─────────────────────────────────────────────┐
│  Layer 4: Application                       │
│  事件綁定、DOM 渲染、rAF 節流、React Hooks    │
├─────────────────────────────────────────────┤
│  Layer 3: @yoin/client (SDK)                │
│  YoinClient 微核心 + Plugin + Proxy         │
│  ├── network.ts    WebSocket + 離線佇列      │
│  ├── storage.ts    IndexedDB 適配器          │
│  ├── proxy.ts      Map/Array Proxy 透明寫入  │
│  ├── plugin.ts     Plugin 介面              │
│  ├── plugins/      db, undo 內建插件         │
│  ├── logger.ts     除錯日誌插件              │
│  ├── react/        React Hooks 整合層        │
│  └── wasm/         WASM 初始化器             │
├─────────────────────────────────────────────┤
│  Layer 2: yoin-worker                       │
│  Cloudflare Durable Objects WebSocket Relay │
├─────────────────────────────────────────────┤
│  Layer 1: @yoin/core (Rust → WASM)          │
│  Yrs CRDT 引擎 + wasm-bindgen 綁定          │
└─────────────────────────────────────────────┘
```

每一層只依賴下層，不可跨層呼叫。Layer 2（Worker）與 Layer 3（Client）透過二進制協議溝通，兩者程式碼完全獨立。

---

## Layer 1：CRDT 引擎（Rust + WASM）

### 技術選型

| 選擇 | 原因 |
|------|------|
| **Yrs** (Yjs Rust 實作) | 成熟的 CRDT 函式庫，支援 Text / Map / Array / UndoManager |
| **wasm-bindgen** | Rust ↔ JS 零成本互操作 |
| **serde-wasm-bindgen** | 直接序列化為原生 JS 物件，省去 JSON.parse 成本 |
| **wee_alloc** | 專為 WASM 設計的微型記憶體分配器 |

### YoinDoc 核心結構

```rust
#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,                               // Yrs CRDT Document
    undo_manager: RefCell<Option<UndoManager>>, // Lazy 初始化
}
```

**增量差異模式**：所有寫入 API 遵循相同流程：

```
sv_before = doc.transact().state_vector()
  → 執行 CRDT 操作
  → diff = doc.transact().encode_diff_v1(&sv_before)
  → 回傳 diff (Uint8Array)
```

每次只回傳增量差異而非全量狀態，大幅減少網路傳輸量。

### Origin 追蹤

```rust
fn origin_local()  -> Origin { Origin::from("yoin-local") }
fn origin_remote() -> Origin { Origin::from("yoin-remote") }
```

- 本地操作使用 `origin_local()`
- 遠端 `apply_update` 使用 `origin_remote()`
- UndoManager 監聽 `origin_local()`，確保 undo 僅撤銷自己的操作

### API 矩陣

| 資料類型 | 寫入 | 讀取 |
|---------|------|------|
| **Text** | `insert_text`, `delete_text` | `get_text` |
| **Map** | `map_set`, `map_set_deep`, `batch_set` | `map_get`, `map_get_all`, `map_get_json` |
| **Array** | `array_push` | `array_get`, `array_get_all` |
| **Sync** | `apply_update` | `get_state_vector`, `export_update`, `export_diff`, `snapshot`, `get_missing_updates` |
| **Undo** | `undo`, `redo`, `enable_undo`, `expand_undo_scope` | — |

### 建置產出

```
packages/core/
├── src/lib.rs          # Rust 原始碼 (~300 行)
├── Cargo.toml          # opt-level="z", lto=true, strip=true
└── pkg-web/            # wasm-pack --target web 輸出
    ├── core_bg.wasm    # ~300 KB (gzip ~120 KB)
    ├── core.js         # JS glue code
    └── core.d.ts       # TypeScript 型別
```

---

## Layer 2：WebSocket 中繼（Cloudflare Worker）

### 架構：Durable Objects + Hibernation API

```
              ┌─────────────────────────────────┐
              │       Cloudflare Edge Node       │
              │                                  │
  Client A ──→│  Worker (Router)                 │
  Client B ──→│  ├─ /room/abc → YoinRoom("abc") │
  Client C ──→│  ├─ /room/xyz → YoinRoom("xyz") │
              │  └─ ?room=... → YoinRoom(...)    │
              │                                  │
              │  YoinRoom  (Durable Object)      │
              │  ├─ ctx.acceptWebSocket()        │
              │  ├─ webSocketMessage → 廣播       │
              │  └─ webSocketClose → 清理         │
              └─────────────────────────────────┘
```

### 關鍵設計

| 特性 | 說明 |
|------|------|
| **房間隔離** | 每個 `docId` 對應一個 Durable Object 實例，天然隔離 |
| **Hibernation API** | `ctx.acceptWebSocket()` 模式，DO 在無訊息時可休眠，節省計費時間 |
| **Blind Relay** | 伺服器不維護 CRDT 文件，收到二進制訊息直接轉發給同房間其他 WebSocket |
| **Join Room 過濾** | `MSG_JOIN_ROOM (type=4)` 由 Server 攔截，不轉發 |

### URL 路由

支援兩種格式：
- **路徑式**：`wss://worker.dev/room/{roomId}`
- **Query 式**：`wss://worker.dev?room={roomId}`

Worker 從 URL 提取 `roomId` → `env.YOIN_ROOM.idFromName(roomId)` → 取得 DO stub → `fetch()` 轉發。

### Wrangler 設定

```jsonc
{
  "name": "yoin-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-02-12",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "YOIN_ROOM", "class_name": "YoinRoom" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["YoinRoom"] }
  ]
}
```

---

## Layer 3：客戶端 SDK（TypeScript）

### 微核心架構

`YoinClient` 作為微核心，只包含最基本的功能：

```
YoinClient (微核心)
├── CRDT 操作 (Text / Map / Array)
├── 網路連線 (NetworkProvider)
├── Awareness 系統 (節流 + GC)
├── Schema 驗證 (Zod)
└── Plugin 生命週期管理
```

所有擴展功能（持久化、Undo、日誌）透過 Plugin 系統掛載。

### 模組職責

| 模組 | 職責 | 關鍵類別 / 函式 |
|------|------|-----------------|
| `YoinClient.ts` | 微核心：CRDT + 網路 + 插件 | `YoinClient` |
| `network.ts` | WebSocket 管理 + 離線佇列 + 自動重連 | `NetworkProvider` |
| `storage.ts` | IndexedDB 封裝 | `StorageAdapter` |
| `proxy.ts` | JS Proxy 透明寫入 | `createMapProxy`, `createArrayProxy` |
| `plugin.ts` | 插件介面定義 | `YoinPlugin` interface |
| `plugins/db.ts` | IndexedDB 持久化 | `YoinDbPlugin` |
| `plugins/undo.ts` | Undo / Redo | `YoinUndoPlugin` |
| `logger.ts` | 開發除錯日誌 | `createLoggerPlugin` |
| `react/index.tsx` | React Hooks 整合 | `YoinProvider`, `useYoinMap`, `useYoinArray` |
| `wasm/loader.ts` | WASM 初始化（冪等） | `initYoin`, `isYoinInitialized` |

### Plugin 生命週期

```
client.use(plugin)
    │
    ├─ plugin.onInstall(client)      ← 初始化
    │
    ├─ [本地寫入]
    │   ├─ plugin.onBeforeUpdate()   ← 廣播前
    │   └─ plugin.onAfterUpdate()    ← 廣播後
    │
    ├─ [遠端更新]
    │   └─ plugin.onAfterUpdate()    ← 套用後
    │
    └─ client.destroy()
        └─ plugin.onDestroy()        ← 清理
```

### 資料流

```
使用者操作 (UI Event)
    │
    ▼
YoinClient.setMap() / insertText() / pushArray()
    │
    ├─ Zod Schema 驗證 (若有定義)
    │
    ▼
YoinDoc (WASM) ── 執行 CRDT 操作 → 回傳增量 diff
    │
    ├─ plugins.onBeforeUpdate(diff)
    │
    ├─ NetworkProvider.broadcast(message)
    │   ├─ WebSocket 已連線 → 直接 send
    │   └─ 離線 → 放入 messageQueue
    │
    ├─ notifyListeners() → UI 更新
    │
    ├─ plugins.onAfterUpdate(diff)
    │
    └─ emitDocUpdate(diff) / emitLocalUpdate(diff)
```

### 建置產出

```
packages/client/
├── tsup.config.ts      # 雙入口 (index + react)，輸出 ESM + CJS + DTS
└── dist/
    ├── index.js        # ESM 主入口
    ├── index.cjs       # CJS 主入口
    ├── index.d.ts      # 型別定義
    ├── react.js        # React Hooks (ESM)
    ├── react.cjs       # React Hooks (CJS)
    └── react.d.ts      # React 型別定義
```

---

## Layer 4：應用層

### Demo 架構

Demo 同時展示兩種前端整合方式：

| 檔案 | 模式 | 說明 |
|------|------|------|
| `main.ts` | Vanilla JS | 直接操作 DOM + rAF 節流渲染 |
| `App.tsx` | React | Hook + Proxy 零樣板整合 |
| `renderers.ts` | 共用 | 純函式游標 / 頭像 DOM 工廠 |

---

## 通訊協議

### 1-Byte Header 二進制協議

```
┌──────────┬────────────────────────────┐
│ 1 byte   │ N bytes                    │
│ msg_type │ payload (Uint8Array)       │
└──────────┴────────────────────────────┘
```

| Type | 值 | Payload | 說明 |
|------|---|---------|------|
| `MSG_SYNC_STEP_1` | `0` | State Vector | 請求同步 |
| `MSG_SYNC_STEP_2` | `1` | CRDT Update / Diff | 資料傳輸 |
| `MSG_SYNC_STEP_1_REPLY` | `2` | State Vector | 回覆同步請求 |
| `MSG_AWARENESS` | `3` | JSON (UTF-8 encoded) | 感知狀態 |
| `MSG_JOIN_ROOM` | `4` | Room name (UTF-8) | 加入房間 |

---

## 同步機制

### 三向交握

新加入的 Client A 與既有 Client B 之間的同步流程：

```
Client A (新加入)         Server (Relay)          Client B (既有)
    │                         │                       │
    │── JOIN_ROOM ──────────→ │                       │
    │── SYNC_STEP_1 (sv_A) ─→│── SYNC_STEP_1 ──────→│
    │                         │                       │
    │                         │←── SYNC_STEP_2 ─────│  diff(sv_A)
    │←── SYNC_STEP_2 ────────│                       │
    │                         │←── SYNC_STEP_1_REPLY │  sv_B
    │←── SYNC_STEP_1_REPLY ──│                       │
    │                         │                       │
    │── SYNC_STEP_2 (diff) ─→│── SYNC_STEP_2 ──────→│  diff(sv_B)
    │                         │                       │
    ▼       雙方同步完成       ▼                       ▼
```

1. A 發送自己的 State Vector
2. B 根據 A 的 SV 計算 diff 並回傳，同時回傳 B 的 SV
3. A 根據 B 的 SV 計算 diff 給 B
4. 雙方 State 收斂

### 增量更新

每次本地操作：
1. 記錄 `sv_before`（操作前的 State Vector）
2. 執行 CRDT 操作
3. `encode_diff_v1(sv_before)` 取得增量差異
4. 只廣播差異（通常幾十到幾百 bytes）

---

## 離線與持久化

### 離線佇列（NetworkProvider）

```
Online:  操作 → broadcast() → WebSocket.send()
Offline: 操作 → broadcast() → messageQueue.push()
Reconnect: messageQueue.forEach(send) → 清空佇列
```

- WebSocket 斷線後 3 秒自動重連
- 重連後先 flush 佇列，再執行三向交握
- 佇列中的訊息保持順序

### IndexedDB 持久化（DbPlugin）

```
操作 → onDocUpdate → scheduleSave() ─[debounce 1s]→ persist()
                                                        │
                              IndexedDB ← export_update() (全量快照)
```

- 防抖機制避免頻繁寫入
- 啟動時 `loadFromDisk()` → `apply_update()` 還原狀態
- `forceSave()` 可手動觸發立即儲存

---

## Awareness 系統

### 設計

Awareness（感知狀態）用於廣播不寫入 CRDT 的瞬態資訊：游標位置、在線狀態、使用者名稱等。

```
使用者移動滑鼠
    │
    ▼ (rAF 節流)
setAwareness({ cursorX, cursorY })
    │
    ├─ 更新本地 awarenessStates Map
    ├─ 通知本地 Awareness 監聽器
    └─ 節流廣播 (leading-edge + trailing)
        │
        ▼ (30ms throttle)
    broadcastAwareness() → MSG_AWARENESS → WebSocket
```

### 節流機制

```
t=0    setAwareness()  → 立即廣播 (leading edge)
t=10   setAwareness()  → 標記 pending
t=20   setAwareness()  → 標記 pending (覆蓋)
t=30   throttle 到期   → 廣播最新 pending (trailing edge)
```

### Ghost Busting（幽靈清除）

```
每 3 秒掃描一次：
  for (clientId, state) in awarenessStates:
    if (now - state.timestamp > 30s) && (clientId ≠ myClientId):
      awarenessStates.delete(clientId)
      notifyAwarenessListeners()
```

心跳機制（每 5 秒）確保活躍用戶不被清除。

---

## Monorepo 基礎設施

### pnpm Workspace

```yaml
packages:
  - packages/*    # @yoin/core, @yoin/client
  - apps/*        # @yoin/demo
  - yoin-worker   # Cloudflare Worker
```

### 套件依賴圖

```
@yoin/core (Rust WASM, 無 JS 依賴)
    ↑
@yoin/client (workspace:*)
    ↑
@yoin/demo (workspace:*)

yoin-worker (獨立，無 workspace 內部依賴)
```

### 建置順序

```
1. wasm-pack build (packages/core)    → pkg-web/
2. tsup (packages/client)             → dist/
3. vite build (apps/demo)             → dist/
```

嚴格的拓撲排序：Core → Client → Demo。

---

## 部署架構

### Cloudflare 部署

```
                ┌──────────────────────┐
                │  Cloudflare Network  │
                │                      │
                │  Workers             │
  WebSocket ──→ │  ├─ yoin-worker      │
                │  └─ YoinRoom (DO)    │
                │                      │
                │  Pages               │
  HTTPS ──────→ │  └─ yoin-client      │ ← apps/demo/dist
                │     (Static Assets)  │
                └──────────────────────┘
```

| 服務 | 平台 | 部署指令 |
|------|------|---------|
| WebSocket Worker | Cloudflare Workers | `pnpm deploy:worker` |
| Demo 前端 | Cloudflare Pages | `pnpm deploy:pages` |
| 全棧一鍵 | 兩者 | `.\deploy.bat` 或 `pnpm deploy` |

### deploy.bat 流程

```
[1/5] wasm-pack build        → packages/core/pkg-web/
[2/5] tsup build             → packages/client/dist/
[3/5] wrangler deploy        → Cloudflare Workers
[4/5] vite build             → apps/demo/dist/
[5/5] wrangler pages deploy  → Cloudflare Pages
```

---

## 未來優化方向

### 短期（High Priority）

#### 1. Smart Server（伺服器端 CRDT）

目前 Worker 為 Blind Relay（盲轉發），不維護 CRDT 狀態。升級為 Smart Server：

- **Durable Object 內持有 `YoinDoc` 副本**（需在 Worker 內載入 WASM 或使用 Yjs JS 版本）
- 新 Client 加入時，Server 直接回傳全量 Snapshot，不需等待其他 Client
- **Server-side Compaction**：定期壓縮歷史，減少 State Vector 體積

```
Client A ──→ YoinRoom (DO) ←── Client B
                 │
                 ├─ 維護 CRDT Doc
                 ├─ 新連線 → 直接傳送 Snapshot
                 └─ 定期 Compaction
```

#### 2. 離線佇列持久化

目前 `messageQueue` 存在記憶體中，頁面重新整理後遺失。改為寫入 IndexedDB：

```
broadcast() → 離線 → IndexedDB queue → 重啟後恢復 → 重連時 flush
```

#### 3. 子文件（Sub-documents）

大型協作應用常需要多個獨立同步區域（如多個頁面、不同資料表）。利用 Yrs Sub-doc 機制：

- 按需載入子文件，減少初始傳輸量
- 每個 Sub-doc 可獨立同步、獨立持久化

### 中期

#### 4. 二進制 Awareness

目前 Awareness 使用 JSON over binary，改為純二進制編碼可再減少約 40% 頻寬。

#### 5. 衝突解析回呼

提供 `onConflict(local, remote)` 鉤子，讓開發者自訂合併策略：

```typescript
client.onConflict('settings', (local, remote) => {
  return remote.timestamp > local.timestamp ? remote : local;
});
```

#### 6. 選擇性同步

只同步目前使用者關注的 Map / Array，降低頻寬與 CPU：

```typescript
client.subscribe('settings', (data) => { /* 只收 settings 變更 */ });
```

#### 7. 權限控制

在 Worker 層加入 JWT 驗證與讀寫權限：

```
Client → JWT Token → Worker 驗證 → 允許/拒絕 → DO
```

### 長期

#### 8. 歷史版本瀏覽

利用 Yrs Snapshot 實現時間旅行：

```typescript
const history = client.getHistory();
const version = client.restoreSnapshot(history[5]);
```

#### 9. 大型文件支援

- 增量載入策略：首次只載入最新 Snapshot，歷史 diff 按需拉取
- 壓縮傳輸（Worker 端 gzip / brotli）

#### 10. 多框架支援

將 React Hooks 模式擴展到 Vue / Svelte / Solid：

```
@yoin/client           # 核心 SDK（框架無關）
@yoin/client/react     # React Hooks (已實現)
@yoin/client/vue       # Vue Composables
@yoin/client/svelte    # Svelte Stores
@yoin/client/solid     # Solid Signals
```

#### 11. SDK 發佈至 npm

將 `@yoin/client` 發佈為獨立 npm 套件，供外部開發者安裝使用。需要解決 WASM 檔案載入策略（CDN vs bundler 自動解析）。

#### 12. 監控與可觀測性

- Worker 端加入 Cloudflare Analytics
- Client 端加入效能指標（同步延遲、訊息大小、重連次數）
- 提供 Dashboard Plugin
