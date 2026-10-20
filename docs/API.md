[繁體中文](API.md) | [English](API_en.md)

# Yoin API 參考手冊

> 版本：`@yoin/client` v0.1.2

## 目錄

- [初始化](#初始化)
  - [`initYoin(wasmInput?)`](#inityoinwasminput)
  - [`isYoinInitialized()`](#isyoininitialized)
- [YoinClient 核心類別](#yoinclient-核心類別)
  - [建構子與設定](#建構子與設定)
  - [Text API（富文本與多文字容器）](#text-api富文本與多文字容器)
  - [Map API（完整 CRUD 與原生型別保真）](#map-api完整-crud-與原生型別保真)
  - [Array API（Push / Insert / Delete / Move）](#array-apipush--insert--delete--move)
  - [容器級精準訂閱與生命週期](#容器級精準訂閱與生命週期)
  - [伺服器快照預載與同步控制](#伺服器快照預載與同步控制)
  - [Hook API（插件系統使用）](#hook-api插件系統使用)
  - [Awareness API](#awareness-api)
  - [存取器與工具方法](#存取器與工具方法)
- [Proxy 透明讀寫](#proxy-透明讀寫)
  - [`createMapProxy<T>(client, mapName)`](#createmapProxyTclient-mapname)
  - [`createArrayProxy<T>(client, arrayName)`](#createarrayproxytclient-arrayname)
- [插件系統](#插件系統)
  - [`YoinPlugin` 介面](#yoinplugin-介面)
  - [`createDbPlugin(options)` — IndexedDB 持久化](#createdbpluginoptions--indexeddb-持久化)
  - [`createUndoPlugin()` — 復原/重做](#createundoplugin--復原重做)
  - [`createLoggerPlugin(prefix?)` — 除錯日誌](#createloggerpluginprefix--除錯日誌)
  - [自訂插件範例](#自訂插件範例)
- [React Hooks (`@yoin/client/react`)](#react-hooks-yoinclientreact)
  - [`<YoinProvider>`](#yoinprovider)
  - [`useYoinClient()`](#useyoinclient)
  - [`useYoinMap<T>(mapName)`](#useyoinmaptmapname)
  - [`useYoinArray<T>(arrayName)`](#useyoinarraytarrayname)
  - [`useYoinText(textName?)`](#useyointexttextname)
  - [`useYoinAwareness()`](#useyoinawareness)
  - [`useYoinStatus()`](#useyoinstatus)
  - [`useYoinUndo()`](#useyoinundo)
- [底層模組](#底層模組)
  - [`NetworkManager`](#networkmanager)
  - [`StorageAdapter`](#storageadapter)
- [Schema 驗證（Zod 整合）](#schema-驗證zod-整合)
- [型別定義](#型別定義)
- [通訊協議](#通訊協議)

---

## 初始化

在使用任何 Yoin 功能之前，必須先載入並初始化底層的 Rust WebAssembly 引擎。

### `initYoin(wasmInput?)`

```typescript
function initYoin(wasmInput?: unknown): Promise<void>
```

載入並初始化 Yoin 的 WASM CRDT 引擎。全域只需呼叫一次，重複呼叫是冪等的（直接回傳已完成的 Promise），同時具備並行鎖防止重複載入。

**參數**：
- `wasmInput` *(選填)*：自訂的 WASM 模組來源（`RequestInfo | URL | Response | BufferSource | WebAssembly.Module`）。省略時使用套件內建的 `core_bg.wasm`。

**範例**：

```typescript
import { initYoin } from '@yoin/client';

// 標準用法 — 自動載入內建 WASM
await initYoin();

// 自訂 WASM 路徑（例如從 CDN 載入）
await initYoin('https://cdn.example.com/core_bg.wasm');
```

### `isYoinInitialized()`

```typescript
function isYoinInitialized(): boolean
```

檢查 WASM 引擎是否已完成初始化。

---

## YoinClient 核心類別

`YoinClient` 是 Yoin 的微核心（Micro-Kernel），負責管理 CRDT 文件實例、WebSocket 網路通訊、Awareness 感知狀態，以及插件生命週期。

### 建構子與設定

```typescript
const client = new YoinClient(config: YoinConfig)
```

> **注意**：建構 `YoinClient` 前必須先完成 `await initYoin()`，否則會拋出錯誤。

**`YoinConfig` 介面**：

| 屬性 | 型別 | 必填 | 預設值 | 說明 |
|------|------|------|--------|------|
| `url` | `string` | 是 | — | WebSocket 伺服器基礎網址（如 `'wss://yoin-worker.example.workers.dev'` 或 `'ws://localhost:8080'`） |
| `docId` | `string` | 是 | — | 文件/房間的唯一識別碼。最終連線網址為 `${url}/${docId}` |
| `dbName` | `string` | 否 | — | IndexedDB 資料庫名稱（搭配 `createDbPlugin` 使用） |
| `awarenessThrottleMs` | `number` | 否 | `30` | Awareness 廣播節流間隔（毫秒），預設 ~33fps |
| `heartbeatIntervalMs` | `number` | 否 | `5000` | Awareness 心跳廣播間隔（毫秒） |
| `heartbeatTimeoutMs` | `number` | 否 | `30000` | 遠端客戶端無回應視為離線的逾時時間（毫秒） |
| `schemas` | `Record<string, z.ZodTypeAny>` | 否 | — | Zod Schema 定義，用於寫入前自動驗證（詳見 [Schema 驗證](#schema-驗證zod-整合)） |

---

### Text API（富文本與多文字容器）

支援在單一文件內建立多個具名文字容器（預設容器名稱為 `'content'`），並支援與 Quill / Tiptap 相容的富文本格式屬性與 Delta 操作。

#### `insertText(index, text, attributes?, textName?)`

```typescript
async insertText(
  index: number,
  text: string,
  attributes?: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

在指定文字容器的 `index` 位置插入文字，可選擇附帶富文本格式屬性（如 `{ bold: true, color: '#ff0000' }`）。

#### `deleteText(index, length, textName?)`

```typescript
async deleteText(
  index: number,
  length: number,
  textName: string = 'content'
): Promise<void>
```

從指定文字容器的 `index` 位置開始刪除 `length` 個字元。

#### `formatText(index, length, attributes, textName?)`

```typescript
async formatText(
  index: number,
  length: number,
  attributes: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

對指定文字容器 `[index, index + length)` 區間內的文字套用富文本格式屬性（例如 `{ italic: true, bold: null }`）。

#### `applyTextDelta(ops, textName?)`

```typescript
async applyTextDelta(
  ops: TextDeltaOp[],
  textName: string = 'content'
): Promise<void>
```

將 Quill 相容的 Delta 操作陣列（支援 `insert`、`retain`、`delete` 與 `attributes`）以單一 CRDT 事務套用至指定文字容器。

```typescript
await client.applyTextDelta(
  [
    { insert: 'Hello ', attributes: { bold: true } },
    { insert: 'World\n' },
  ],
  'article'
);
```

#### `clearText(textName?)`

```typescript
async clearText(textName: string = 'content'): Promise<void>
```

清空指定文字容器的所有文字內容。

#### `getText(textName?)`

```typescript
getText(textName: string = 'content'): string
```

取得指定文字容器目前的純文字字串。

#### `getTextDelta(textName?)`

```typescript
getTextDelta(textName: string = 'content'): TextDeltaOp[]
```

取得指定文字容器目前的富文本 Delta 陣列（格式為 `Array<{ insert: string, attributes?: Record<string, any> }>`）。

---

### Map API（完整 CRUD 與原生型別保真）

操作具名的 CRDT Map（鍵值對結構）。底層透過 Rust `yrs::Any` 原生儲存所有基礎型別與巢狀結構，**不會發生 `"123"` 轉數字或 `"true"` 轉布林的型別失真**。

#### `setMap(mapName, key, value)`

```typescript
async setMap(mapName: string, key: string, value: any): Promise<void>
```

在名為 `mapName` 的 Map 中設定 `key` 的值。若設定了對應的 Zod Schema，會在寫入前自動驗證。

```typescript
await client.setMap('settings', 'theme', 'dark');
await client.setMap('settings', 'code', '123');     // 保持為 string "123"
await client.setMap('settings', 'fontSize', 16);    // 保持為 number 16
await client.setMap('settings', 'profile', { name: 'Alice', role: 'admin' });
```

#### `deleteMap(mapName, key)` / `deleteMapKey(mapName, key)`

```typescript
async deleteMap(mapName: string, key: string): Promise<void>
async deleteMapKey(mapName: string, key: string): Promise<void>
```

從名為 `mapName` 的 Map 中刪除指定的 `key`，並自動同步至所有連線端。`deleteMapKey` 為 `deleteMap` 的語意別名。

```typescript
await client.deleteMap('settings', 'code');
```

#### `hasMapKey(mapName, key)`

```typescript
hasMapKey(mapName: string, key: string): boolean
```

檢查名為 `mapName` 的 Map 中是否存在指定的 `key`。

#### `getMap(mapName)`

```typescript
getMap(mapName: string): Record<string, any>
```

取得名為 `mapName` 的 Map 中所有鍵值對，回傳原生 JavaScript 物件。

#### `setMapDeep(mapName, path, value)`

```typescript
setMapDeep(mapName: string, path: string[], value: any): void
```

在巢狀 Map 結構中，沿著 `path` 路徑深入設定任意 JS 型別的 `value`（支援數字、字串、布林、物件、陣列與 `null`）。路徑上不存在的中間層 `MapPrelim` 會自動建立。

```typescript
// 等同於設定 canvas.node_1.position.x = 150
client.setMapDeep('canvas', ['node_1', 'position', 'x'], 150);
// 亦支援字串或物件
client.setMapDeep('canvas', ['node_1', 'label'], 'Hero Card');
```

#### `batchSet(entries)`

```typescript
batchSet(entries: Array<[string, string, any]>): void
```

在**單一 CRDT 事務**中批次寫入多筆 Map 資料，只產生一次 diff 與一次網路廣播。若設定了 Zod Schema，會在寫入前對所有項目執行驗證。

```typescript
client.batchSet([
  ['node-1', 'x', 100],
  ['node-1', 'y', 200],
  ['node-2', 'x', 300],
  ['node-2', 'y', 400],
]);
```

---

### Array API（Push / Insert / Delete / Move）

操作具名的 CRDT Array（有序列表結構）。

#### `pushArray(arrayName, item)`

```typescript
async pushArray(arrayName: string, item: any): Promise<void>
```

將 `item` 推入名為 `arrayName` 的 Array 尾端（支援任意原生 JS 型別與物件）。若設定了對應的 Zod Schema，會在寫入前自動驗證。

#### `insertArray(arrayName, index, item)`

```typescript
async insertArray(arrayName: string, index: number, item: any): Promise<void>
```

在名為 `arrayName` 的 Array 的指定 `index` 位置插入 `item`。若設定了對應的 Zod Schema，會在寫入前自動驗證。

#### `deleteArray(arrayName, index, length?)`

```typescript
async deleteArray(arrayName: string, index: number, length: number = 1): Promise<void>
```

從名為 `arrayName` 的 Array 的 `index` 位置開始刪除 `length` 個元素（預設刪除 1 個）。

#### `moveArray(arrayName, fromIndex, toIndex)`

```typescript
async moveArray(arrayName: string, fromIndex: number, toIndex: number): Promise<void>
```

將名為 `arrayName` 的 Array 中位於 `fromIndex` 的元素移動至 `toIndex`（適用於圖層 z-index 排序、看板卡片拖曳排序）。

#### `getArray(arrayName)`

```typescript
getArray(arrayName: string): any[]
```

取得名為 `arrayName` 的 Array 中所有元素。

---

### 容器級精準訂閱與生命週期

#### `subscribeMap(mapName, listener)`

```typescript
subscribeMap(mapName: string, listener: () => void): () => void
```

僅訂閱指定 `mapName` 容器的變更。本地修改其他容器（例如打字或修改其他 Map）時**不會**觸發此回呼；收到遠端增量更新或快照時會自動觸發。訂閱時會立即觸發一次初始呼叫，並回傳取消訂閱函式。

#### `subscribeArray(arrayName, listener)`

```typescript
subscribeArray(arrayName: string, listener: () => void): () => void
```

僅訂閱指定 `arrayName` 容器的變更。訂閱時會立即觸發一次初始呼叫，並回傳取消訂閱函式。

#### `subscribeText(textName, listener)`

```typescript
subscribeText(textName: string, listener: (text: string) => void): () => void
```

僅訂閱指定 `textName` 文字容器的變更，回呼參數為該容器目前的純文字字串。訂閱時會立即觸發一次初始呼叫，並回傳取消訂閱函式。

#### `subscribe(listener)`

```typescript
subscribe(listener: (text: string) => void): () => void
```

全域訂閱文件變更（任何本地或遠端變更皆會觸發）。訂閱時會立即以目前 `getText()` 的值觸發一次。

#### `subscribeNetwork(cb)`

```typescript
subscribeNetwork(cb: (status: NetworkStatus) => void): () => void
```

訂閱網路連線狀態變更（`'connecting' | 'online' | 'offline' | 'failed'`）。支援註冊多個監聽器，訂閱時立即以目前狀態觸發一次，並回傳取消訂閱函式。

#### `use(plugin)`

```typescript
use(plugin: YoinPlugin): this
```

掛載一個插件到客戶端。支援鏈式呼叫，且同一個插件實例不會被重複安裝。

#### `destroy()`

```typescript
destroy(): void
```

銷毀客戶端實例，釋放所有資源：
1. 清除心跳與垃圾回收計時器
2. 呼叫所有已安裝插件的 `onDestroy()`（包含關閉 IndexedDB 連線）
3. 發送離線 Awareness 廣播並關閉 WebSocket 連線
4. 清除所有訂閱者與佇列
5. 呼叫 `this.doc.free?.()` 釋放底層 Rust WASM 線性記憶體

---

### 伺服器快照預載與同步控制

#### `exportSnapshot()`

```typescript
exportSnapshot(): Uint8Array
```

將目前整個 CRDT 文件狀態匯出為完整的二進位快照（等同於對空 State Vector 計算完整 diff），可直接儲存至後端資料庫（如 PostgreSQL `bytea` 或 S3）。

#### `applySnapshot(snapshot)`

```typescript
applySnapshot(snapshot: Uint8Array): void
```

將外部（例如伺服器 REST API 預載或本地備份）的二進位快照套用至當前 CRDT 文件，並通知所有容器與全域訂閱者。

#### `syncWithPeers()`

```typescript
syncWithPeers(): void
```

主動向房間內所有已連線同儕發送 `MSG_SYNC_STEP_1`（State Vector）請求差異同步（例如在 IndexedDB 非同步載入完成後自動呼叫）。

---

### Hook API（插件系統使用）

#### `onDocUpdate(cb)`

```typescript
onDocUpdate(cb: (update: Uint8Array) => void): () => void
```

註冊一個在**任何更新**（本地操作或遠端同步）發生後都會被呼叫的回呼。回傳取消註冊函式。

#### `onLocalUpdate(cb)`

```typescript
onLocalUpdate(cb: (update: Uint8Array) => void): () => void
```

註冊一個**僅在本地操作**產生 diff 時被呼叫的回呼。回傳取消註冊函式。

---

### Awareness API

Awareness 用於傳遞**暫態（Ephemeral）的使用者存在資訊**（游標位置、選取範圍、名稱、顏色等），不經過 CRDT 歷史記錄，且在離線時標記為 `{ transient: true }` 不會塞入離線重送佇列。

#### `setAwareness(state)`

```typescript
setAwareness(state: AwarenessPartial): void
```

更新本地端的 Awareness 狀態並廣播給其他連線端（內建節流機制，預設 30ms）。

#### `onAwarenessChange(cb)`

```typescript
onAwarenessChange(cb: AwarenessCallback): () => void
```

訂閱所有連線端的 Awareness 狀態變更。回傳取消訂閱函式。

#### `getAwarenessStates()`

```typescript
getAwarenessStates(): Map<string, AwarenessState>
```

取得目前所有連線端（包含自己）的 Awareness 狀態 Map，key 為 `clientId`。

#### `leaveAwareness()`

```typescript
leaveAwareness(): void
```

主動通知其他連線端本客戶端已離開。

#### `bindCursorTracking(container, renderer)`

```typescript
bindCursorTracking(container: HTMLElement, renderer: CursorRenderer): () => void
```

自動在指定的 HTML 容器上綁定滑鼠移動事件，並自動渲染所有遠端使用者的游標 DOM 元素。回傳清理函式。

---

### 存取器與工具方法

| 方法 | 回傳型別 | 說明 |
|------|----------|------|
| `getDoc()` | `YoinDoc` | 取得底層的 WASM `YoinDoc` 實例（供進階操作或插件使用） |
| `getConfig()` | `YoinConfig` | 取得建構時傳入的設定物件 |
| `getClientId()` | `string` | 取得本客戶端的隨機 8 碼識別碼 |

---

## Proxy 透明讀寫

Proxy 模組讓你用原生 JavaScript 的屬性賦值與陣列方法直接操作 CRDT，無需手動呼叫 `setMap` / `deleteMap` / `pushArray`。

### `createMapProxy<T>(client, mapName)`

```typescript
function createMapProxy<T extends Record<string, any>>(
  client: YoinClient,
  mapName: string
): T
```

建立一個綁定到指定 CRDT Map 的透明 Proxy 物件：
- **讀取 (`proxy.key`)**：即時從 `client.getMap(mapName)` 取值；若鍵不存在回傳 `undefined`。若值為巢狀物件，回傳支援深層讀寫的 Proxy。
- **寫入 (`proxy.key = val` / `proxy.a.b = val`)**：頂層自動呼叫 `client.setMap`，深層自動呼叫 `client.setMapDeep`。
- **刪除 (`delete proxy.key`)**：自動呼叫 `client.deleteMap(mapName, key)`。
- **鍵檢查與列舉 (`'key' in proxy` / `Object.keys(proxy)`)**：直接反映 CRDT Map 目前的所有鍵。

```typescript
import { createMapProxy } from '@yoin/client';

interface BoardState {
  title: string;
  zoom: number;
  viewport?: { x: number; y: number };
}

const board = createMapProxy<BoardState>(client, 'board');

board.title = '專案白板';
board.zoom = 1.5;
board.viewport = { x: 0, y: 0 };
board.viewport.x = 120;         // 深層寫入 → 自動呼叫 setMapDeep
delete (board as any).zoom;     // 刪除鍵 → 自動呼叫 deleteMap
```

### `createArrayProxy<T>(client, arrayName)`

```typescript
function createArrayProxy<T>(
  client: YoinClient,
  arrayName: string
): T[]
```

建立一個綁定到指定 CRDT Array 的透明 Proxy 陣列，每次讀取（如 `arr[0]`、`arr.length`、`arr.map(...)`）皆即時從 `client.getArray(arrayName)` 取得最新狀態，並支援以下變異方法：
- **`.push(...items)`** → 呼叫 `client.pushArray`
- **`.splice(start, deleteCount?, ...items)`** → 組合呼叫 `client.deleteArray` 與 `client.insertArray`
- **`.pop()`** → 刪除並回傳最後一個元素
- **`.shift()`** → 刪除並回傳第一個元素
- **`.unshift(...items)`** → 在開頭依序插入元素

```typescript
import { createArrayProxy } from '@yoin/client';

const todos = createArrayProxy<{ text: string; done: boolean }>(client, 'todos');

todos.push({ text: '完成 API 文件', done: false });
todos.splice(0, 1, { text: '完成 v0.1.2 升級', done: true });
```

---

## 插件系統

Yoin 採用微核心架構，將非核心功能（持久化、復原/重做、日誌等）解耦為獨立插件。

### `YoinPlugin` 介面

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

### `createDbPlugin(options)` — IndexedDB 持久化

```typescript
function createDbPlugin(options: YoinDbPluginOptions): {
  plugin: YoinDbPlugin;
  forceSave: () => Promise<void>;
}
```

自動將 CRDT 文件快照持久化到瀏覽器的 IndexedDB（內建 `IDBDatabase` 連線快取）：
1. **安裝時**：自動從 IndexedDB 載入歷史快照並合併到當前文件；若此時網路已連線，會自動呼叫 `client.syncWithPeers()` 與遠端同儕交換差異。
2. **更新時**：每次文件變更（本地或遠端）後，以防抖（Debounce，預設 `1000ms`）方式自動排程存檔。
3. **銷毀時**：自動取消計時器並關閉 IndexedDB 連線。

### `createUndoPlugin()` — 復原/重做

```typescript
function createUndoPlugin(): {
  plugin: YoinUndoPlugin;
  undo: () => void;
  redo: () => void;
}
```

基於 Yrs 內建的 `UndoManager`，提供本地操作的復原（Undo）與重做（Redo）功能：
- 安裝時自動啟用預設 `'content'` Text 的追蹤。
- 當使用者透過 `setMap`、`deleteMap`、`setMapDeep`、`batchSet`、`pushArray`、`insertArray`、`deleteArray`、`moveArray` 或自訂 `textName` 的文字方法操作容器時，**自動將該容器加入 Undo 追蹤範圍**（透過底層 `expand_undo_scope_for`）。
- 只會復原**本地端**的操作，不會復原其他協作者的變更。

### `createLoggerPlugin(prefix?)` — 除錯日誌

```typescript
function createLoggerPlugin(prefix?: string): YoinPlugin
```

### 自訂插件範例

```typescript
import type { YoinPlugin } from '@yoin/client';

const analyticsPlugin: YoinPlugin = {
  name: 'analytics-plugin',
  onInstall(client) {
    console.log(`Analytics mounted for doc: ${client.getConfig().docId}`);
  },
  onAfterUpdate(update) {
    navigator.sendBeacon('/api/metrics', JSON.stringify({ bytes: update.byteLength }));
  },
};
```

---

## React Hooks (`@yoin/client/react`)

從 `@yoin/client/react` 匯入。所有狀態型 Hooks 皆基於 React 18 的 `useSyncExternalStore` 實作，並採用容器級訂閱以確保最佳渲染效能。

### `<YoinProvider>`

```tsx
function YoinProvider(props: {
  config: YoinConfig;
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element
```

### `useYoinClient()`

```typescript
function useYoinClient(): YoinClient
```

### `useYoinMap<T>(mapName)`

```typescript
function useYoinMap<T extends Record<string, any>>(mapName: string): T
```

回傳一個綁定到指定 CRDT Map 的**響應式 Proxy 物件**。底層使用 `client.subscribeMap(mapName, ...)`，僅在該 Map 變更時觸發元件重新渲染，並自動更新 Proxy 參考以確保 React 子元件能正確偵測 props 變更。

### `useYoinArray<T>(arrayName)`

```typescript
function useYoinArray<T = any>(arrayName: string): T[]
```

回傳一個綁定到指定 CRDT Array 的**響應式 Proxy 陣列**。底層使用 `client.subscribeArray(arrayName, ...)`，支援 `.push()`、`.splice()`、`.pop()`、`.shift()`、`.unshift()` 與索引讀取。

### `useYoinText(textName?)`

```typescript
function useYoinText(textName: string = 'content'): {
  text: string;
  delta: TextDeltaOp[];
  insert: (index: number, content: string, attributes?: Record<string, any>) => Promise<void>;
  deleteText: (index: number, length: number) => Promise<void>;
  format: (index: number, length: number, attributes: Record<string, any>) => Promise<void>;
  applyDelta: (ops: TextDeltaOp[]) => Promise<void>;
  clear: () => Promise<void>;
}
```

訂閱並操作指定的具名 CRDT 文字容器（預設為 `'content'`），提供純文字 `text`、富文本 `delta` 以及完整的編輯方法。

### `useYoinAwareness()`

```typescript
function useYoinAwareness(): {
  states: Map<string, AwarenessState>;
  setLocalState: (state: AwarenessPartial) => void;
}
```

### `useYoinStatus()`

```typescript
function useYoinStatus(): NetworkStatus
```

取得目前的 WebSocket 網路連線狀態（`'connecting' | 'online' | 'offline' | 'failed'`）。底層使用 `client.subscribeNetwork`，可安全在多個元件中同時使用。

### `useYoinUndo()`

```typescript
function useYoinUndo(): {
  undo: () => void;
  redo: () => void;
}
```

---

## 底層模組

### `NetworkManager`

```typescript
class NetworkManager {
  constructor(url: string, docId: string, onMessageCallback: (data: Uint8Array) => void);
  onStatusChange?: (status: NetworkStatus) => void;
  connect(): void;
  broadcast(data: Uint8Array, options?: BroadcastOptions): void;
  getQueueLength(): number;
  clearQueue(): void;
  disconnect(): void;
}
```

- **指數退避重連**：斷線後自動重連，延遲從 `1000ms` 開始倍增，上限 `30000ms`，最多重試 `50` 次；超過上限時發出 `'failed'` 狀態。
- **暫態訊息過濾 (`BroadcastOptions.transient`)**：當 `options.transient === true` 時（如 Awareness、心跳、三向交握封包），離線期間會直接丟棄而不進入 `messageQueue`，確保重連時只重送真正的 CRDT 資料變更。

### `StorageAdapter`

```typescript
class StorageAdapter {
  constructor(dbName: string);
  saveSnapshot(docId: string, snapshotBytes: Uint8Array): Promise<void>;
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  close(): void;
}
```

封裝瀏覽器 IndexedDB（Object Store 名稱為 `'snapshots'`），內建 `IDBDatabase` 連線實例快取，避免高頻存檔時重複開啟資料庫連線。

---

## Schema 驗證（Zod 整合）

Yoin 支援透過 [Zod](https://zod.dev/) 在寫入 CRDT 前驗證資料結構。只要在 `YoinConfig.schemas` 中定義對應 Map 或 Array 名稱的 Schema，`setMap`、`batchSet`、`pushArray`、`insertArray` 都會在寫入前自動執行驗證。

---

## 型別定義

### `TextDeltaOp`

```typescript
interface TextDeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, any>;
}
```

### `BroadcastOptions`

```typescript
interface BroadcastOptions {
  transient?: boolean;
}
```

### `NetworkStatus`

```typescript
type NetworkStatus = 'connecting' | 'online' | 'offline' | 'failed';
```

### `YoinConfig` / `AwarenessState` / `AwarenessPartial` / `YoinPlugin`

（完整定義請見上方各章節）

---

## 通訊協議

Yoin 使用 1-byte Header 的二進位協議進行 WebSocket 通訊：

| 類型 | 常數名稱 | 值 | 方向 | 說明 |
|------|----------|----|------|------|
| Sync Step 1 | `MSG_SYNC_STEP_1` | `0` | Client → Server → Client | 發送 State Vector 請求同步 |
| Sync Step 2 | `MSG_SYNC_STEP_2` | `1` | 雙向 | 傳送非空的 CRDT Update / Diff |
| Sync Step 1 Reply | `MSG_SYNC_STEP_1_REPLY` | `2` | Client → Server → Client | 回應自己的 State Vector |
| Awareness | `MSG_AWARENESS` | `3` | 雙向 | 感知狀態廣播（JSON over binary，標記為 `transient`） |
| Join Room | `MSG_JOIN_ROOM` | `4` | Client → Server | 加入房間通知（標記為 `transient`） |
