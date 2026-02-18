[繁體中文](API.md) | [English](API_en.md)

# Yoin API 文件

> `@yoin/client` v0.1.0 — TypeScript SDK for Real-time Collaborative Applications

## 目錄

- [初始化](#初始化)
- [YoinClient](#yoinclient)
  - [建構函式](#建構函式)
  - [Text API](#text-api)
  - [Map API](#map-api)
  - [Array API](#array-api)
  - [Awareness API](#awareness-api)
  - [網路狀態](#網路狀態)
  - [插件 API](#插件-api)
  - [底層存取](#底層存取)
  - [生命週期](#生命週期)
- [Proxy 透明寫入](#proxy-透明寫入)
- [Plugin 系統](#plugin-系統)
  - [插件介面](#插件介面)
  - [IndexedDB 持久化插件](#indexeddb-持久化插件)
  - [Undo / Redo 插件](#undo--redo-插件)
  - [Logger 插件](#logger-插件)
  - [自訂插件](#自訂插件)
- [React Hooks](#react-hooks)
- [Schema 驗證](#schema-驗證)
- [型別定義](#型別定義)
- [通訊協議](#通訊協議)

---

## 初始化

使用任何 Yoin API 前，必須先載入 WASM 引擎：

```typescript
import { initYoin, isYoinInitialized } from '@yoin/client';

await initYoin();          // 載入 WASM 模組（冪等，僅初始化一次）
isYoinInitialized();       // => true
```

### `initYoin(wasmInput?)`

| 參數 | 型別 | 說明 |
|------|------|------|
| `wasmInput` | `string \| URL \| BufferSource` | 可選。WASM 檔案路徑或二進制內容。省略時自動由 bundler 解析 |

**回傳**：`Promise<void>`

> 在 Vite 專案中搭配 `vite-plugin-wasm` 可自動解析，無需手動傳入路徑。

### `isYoinInitialized()`

**回傳**：`boolean` — WASM 是否已就緒。

---

## YoinClient

SDK 的核心類別，管理 CRDT 文件、WebSocket 連線、Awareness 與插件系統。

### 建構函式

```typescript
import { YoinClient } from '@yoin/client';

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'my-document',
  dbName: 'my-app',
  awarenessThrottleMs: 30,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 30000,
  schemas: { /* Zod schemas */ },
});
```

#### `YoinConfig`

| 屬性 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `url` | `string` | ✅ | — | WebSocket 伺服器 URL |
| `docId` | `string` | ✅ | — | 文件 / 房間 ID |
| `dbName` | `string` | — | — | IndexedDB 資料庫名稱（搭配 DbPlugin 使用） |
| `awarenessThrottleMs` | `number` | — | `30` | Awareness 廣播節流間隔（ms） |
| `heartbeatIntervalMs` | `number` | — | `5000` | 心跳發送間隔（ms） |
| `heartbeatTimeoutMs` | `number` | — | `30000` | 遠端用戶超時清除閾值（ms） |
| `schemas` | `Record<string, z.ZodTypeAny>` | — | — | Zod Schema 驗證規則 |

建構時自動：
1. 建立 `YoinDoc`（CRDT 文件）
2. 建立 WebSocket 連線到 `url/room/{docId}`
3. 執行三向交握同步（State Vector 交換）
4. 啟動心跳計時器 + Ghost Busting GC

---

### Text API

#### `insertText(index, text)`

插入文字到 `content` 文字區塊。

```typescript
client.insertText(0, 'Hello');
client.insertText(5, ' World');
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `index` | `number` | 插入位置（0-based） |
| `text` | `string` | 要插入的文字 |

**回傳**：`Promise<void>`

#### `deleteText(index, length)`

刪除文字。

```typescript
client.deleteText(5, 6); // 刪除 " World"
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `index` | `number` | 起始位置（0-based） |
| `length` | `number` | 刪除字元數 |

**回傳**：`Promise<void>`

#### `clearText()`

清空所有文字。

```typescript
client.clearText();
```

**回傳**：`Promise<void>`

#### `getText()`

讀取目前文字。

```typescript
const text = client.getText(); // "Hello"
```

**回傳**：`string`

#### `subscribe(listener)`

訂閱文字變更（本地 + 遠端皆觸發）。

```typescript
const unsubscribe = client.subscribe((text) => {
  console.log('Text changed:', text);
});

// 取消訂閱
unsubscribe();
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `listener` | `(text: string) => void` | 變更回呼 |

**回傳**：`() => void` — 取消訂閱函式

---

### Map API

#### `setMap(mapName, key, value)`

寫入 Map 鍵值。非字串值會自動 `JSON.stringify`。

```typescript
client.setMap('settings', 'theme', 'dark');
client.setMap('settings', 'fontSize', 16);
client.setMap('settings', 'options', { sidebar: true });
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `mapName` | `string` | Map 名稱 |
| `key` | `string` | 鍵名 |
| `value` | `any` | 值（自動序列化） |

**回傳**：`Promise<void>`

> 若有配置 Zod Schema，寫入前會自動驗證。驗證失敗時拋出錯誤。

#### `getMap(mapName)`

讀取整個 Map。字串值會嘗試 `JSON.parse` 還原。

```typescript
const settings = client.getMap('settings');
// { theme: "dark", fontSize: 16, options: { sidebar: true } }
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `mapName` | `string` | Map 名稱 |

**回傳**：`Record<string, any>`

#### `setMapDeep(mapName, path, value)`

深層巢狀 Map 寫入，在 CRDT 層級實現屬性級合併（不會覆蓋同層其他鍵）。

```typescript
client.setMapDeep('config', ['ui', 'sidebar', 'width'], 300);
client.setMapDeep('config', ['ui', 'sidebar', 'visible'], true);
// config = { ui: { sidebar: { width: 300, visible: true } } }
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `mapName` | `string` | 根 Map 名稱 |
| `path` | `string[]` | 巢狀路徑陣列 |
| `value` | `string \| number \| boolean` | 葉節點值 |

#### `batchSet(entries)`

批量 Map 寫入，所有操作合併為單一 CRDT 事務（單一 diff）。

```typescript
client.batchSet([
  ['settings', 'theme', 'dark'],
  ['settings', 'lang', 'zh-TW'],
  ['profile', 'name', 'Alice'],
]);
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `entries` | `[string, string, any][]` | `[mapName, key, value]` 陣列 |

---

### Array API

#### `pushArray(arrayName, item)`

將元素推入陣列尾端。非字串值自動 `JSON.stringify`。

```typescript
client.pushArray('logs', { action: 'click', time: Date.now() });
client.pushArray('tags', 'important');
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `arrayName` | `string` | Array 名稱 |
| `item` | `any` | 要推入的元素 |

**回傳**：`Promise<void>`

> 若有配置 Zod Schema（`z.array(...)` 型別），寫入前會驗證每個元素。

#### `getArray(arrayName)`

讀取整個 Array。字串元素會嘗試 `JSON.parse` 還原。

```typescript
const logs = client.getArray('logs');
// [{ action: "click", time: 1707955200000 }]
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `arrayName` | `string` | Array 名稱 |

**回傳**：`any[]`

---

### Awareness API

Awareness 系統用於廣播使用者的即時狀態（游標位置、在線狀態、選取範圍等），不寫入 CRDT 文件。

#### `setAwareness(partial)`

設定 / 更新本地 Awareness 狀態。自動合併既有狀態，並以節流方式廣播。

```typescript
client.setAwareness({
  name: 'Alice',
  color: '#ff6b6b',
  cursorX: 120,
  cursorY: 450,
  device: 'desktop',
});
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `partial` | `AwarenessPartial` | 要更新的欄位（部分更新） |

> 節流機制：預設 30ms leading-edge throttle + trailing pending update。

#### `onAwarenessChange(callback)`

訂閱 Awareness 狀態變更。訂閱時立即觸發一次回呼。

```typescript
const unsubscribe = client.onAwarenessChange((states) => {
  for (const [clientId, state] of states) {
    console.log(`${state.name} is at (${state.cursorX}, ${state.cursorY})`);
  }
});
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `callback` | `AwarenessCallback` | `(states: Map<string, AwarenessState>) => void` |

**回傳**：`() => void` — 取消訂閱函式

#### `leaveAwareness()`

廣播離線狀態並清除本地 Awareness。在 `destroy()` 時自動呼叫。

```typescript
client.leaveAwareness();
```

#### `getClientId()`

取得本客戶端的隨機 ID。

```typescript
const myId = client.getClientId(); // "a3f8k2m1"
```

**回傳**：`string`

---

### 網路狀態

#### `subscribeNetwork(callback)`

訂閱網路狀態變更。

```typescript
client.subscribeNetwork((status) => {
  // status: 'connecting' | 'online' | 'offline'
  updateStatusIndicator(status);
});
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `callback` | `(status: NetworkStatus) => void` | 狀態回呼 |

`NetworkProvider` 實例也可直接存取：

```typescript
client.network.isConnected  // boolean — WebSocket 是否已連線
```

---

### 插件 API

#### `use(plugin)`

安裝插件。支援鏈式呼叫。

```typescript
client
  .use(dbPlugin)
  .use(undoPlugin)
  .use(createLoggerPlugin('[Debug]'));
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `plugin` | `YoinPlugin` | 插件實例 |

**回傳**：`this`（鏈式呼叫）

---

### 底層存取

以下 API 主要供插件或進階使用者內部使用。

#### `getDoc()`

取得底層 `YoinDoc`（Rust CRDT 文件 WASM 物件）。

```typescript
const doc = client.getDoc();
const sv = doc.get_state_vector();
```

**回傳**：`YoinDoc`

#### `getConfig()`

取得建構時傳入的設定。

**回傳**：`YoinConfig`

#### `broadcastUpdate(update)`

手動廣播 CRDT update 到所有遠端節點。主要供 Undo 插件使用。

| 參數 | 型別 | 說明 |
|------|------|------|
| `update` | `Uint8Array` | CRDT 增量差異 |

#### `onDocUpdate(callback)`

訂閱所有文件更新（本地 + 遠端）。

**回傳**：`() => void` — 取消訂閱函式

#### `onLocalUpdate(callback)`

僅訂閱本地操作觸發的更新。

**回傳**：`() => void` — 取消訂閱函式

#### `notifyListeners()`

手動觸發所有 `subscribe()` 監聽器。

#### `notifyAwarenessListeners()`

手動觸發所有 Awareness 監聽器。

#### `map_get_all(mapName)`

底層 Map 讀取（不做 JSON.parse），供 React Hook 內部使用。

#### `array_get_all(arrayName)`

底層 Array 讀取（不做 JSON.parse），供 React Hook 內部使用。

#### `getAwarenessStates()`

取得 Awareness 狀態 Map。

**回傳**：`Map<string, AwarenessState>`

---

### 生命週期

#### `destroy()`

銷毀客戶端：清理所有計時器、銷毀插件、廣播離線狀態。

```typescript
client.destroy();
```

銷毀流程：
1. 清除心跳 / GC / Awareness 計時器
2. 呼叫每個插件的 `onDestroy()`
3. 廣播 `leaveAwareness()`

---

## Proxy 透明寫入

使用原生 JS 語法操作 CRDT 資料。

### `createMapProxy<T>(client, mapName)`

建立 Map 的 Proxy 物件。賦值自動呼叫 `setMap()`，巢狀賦值自動呼叫 `setMapDeep()`。

```typescript
import { createMapProxy } from '@yoin/client';

interface Settings {
  theme: string;
  fontSize: number;
  sidebar: { width: number; visible: boolean };
}

const settings = createMapProxy<Settings>(client, 'settings');

// 一層寫入 → setMap('settings', 'theme', 'dark')
settings.theme = 'dark';

// 深層寫入 → setMapDeep('settings', ['sidebar', 'width'], 280)
settings.sidebar.width = 280;

// 讀取（透過 CRDT 底層）
console.log(settings.theme);
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `client` | `YoinClient` | 客戶端實例 |
| `mapName` | `string` | Map 名稱 |

**回傳**：`T`（Proxy 物件）

### `createArrayProxy<T>(client, arrayName)`

建立 Array 的 Proxy 物件。`.push()` 自動呼叫 `pushArray()`。

```typescript
import { createArrayProxy } from '@yoin/client';

const logs = createArrayProxy<{ action: string }>(client, 'logs');
logs.push({ action: 'login' }); // → pushArray('logs', { action: 'login' })
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `client` | `YoinClient` | 客戶端實例 |
| `arrayName` | `string` | Array 名稱 |

**回傳**：`T[]`（Proxy 陣列）

> ⚠️ 目前僅支援 `.push()` 操作，直接 index 賦值會產生警告。

---

## Plugin 系統

### 插件介面

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

| 鉤子 | 時機 | 說明 |
|------|------|------|
| `onInstall` | `client.use(plugin)` 時 | 初始化，取得 client 參照 |
| `onBeforeUpdate` | 本地寫入後、廣播前 | 可用於攔截 / 日誌 |
| `onAfterUpdate` | 本地或遠端 update 套用後 | 可用於持久化 / 日誌 |
| `onDestroy` | `client.destroy()` 時 | 清理資源（計時器、訂閱） |

---

### IndexedDB 持久化插件

自動將 CRDT 文件快照寫入 IndexedDB，實現離線持久化。

```typescript
import { createDbPlugin } from '@yoin/client';

const { plugin, forceSave } = createDbPlugin({
  dbName: 'my-app',
  debounceMs: 1000,      // 預設 1000ms
});

client.use(plugin);

// 手動立即儲存
await forceSave();
```

#### `YoinDbPluginOptions`

| 屬性 | 型別 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `dbName` | `string` | ✅ | — | IndexedDB 資料庫名稱 |
| `debounceMs` | `number` | — | `1000` | 自動儲存防抖間隔（ms） |

**行為**：
- 安裝時從 IndexedDB 載入既有資料（`loadFromDisk`）
- 每次 doc update 後排程防抖儲存
- `forceSave()` 立即持久化

---

### Undo / Redo 插件

基於 Rust 端 `UndoManager`，僅撤銷 / 重做**本地**操作。

```typescript
import { createUndoPlugin } from '@yoin/client';

const { plugin, undo, redo } = createUndoPlugin();
client.use(plugin);

// 撤銷上一步本地操作
undo();

// 重做
redo();
```

**特性**：
- 使用 origin 標記區分本地 / 遠端操作
- Lazy 初始化：首次 `undo()` / `redo()` 時才建立 UndoManager
- 撤銷後自動廣播 diff 給遠端

---

### Logger 插件

開發除錯用，在 Console 輸出 update 日誌。

```typescript
import { createLoggerPlugin } from '@yoin/client';

client.use(createLoggerPlugin('[Debug]'));
// [Debug] Plugin installed!
// [Debug] Update detected, size: 42 bytes
```

| 參數 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `prefix` | `string` | `'[YoinLogger]'` | 日誌前綴 |

---

### 自訂插件

```typescript
import type { YoinPlugin } from '@yoin/client';

const myPlugin: YoinPlugin = {
  name: 'my-analytics',

  onInstall(client) {
    console.log(`Connected to doc: ${client.getConfig().docId}`);
  },

  onAfterUpdate(update) {
    analytics.track('crdt_update', { bytes: update.length });
  },

  onDestroy() {
    analytics.flush();
  },
};

client.use(myPlugin);
```

---

## React Hooks

匯入路徑：`@yoin/client/react`

### `YoinProvider`

Context Provider，包裹需要存取 Yoin 資料的子元件。

```tsx
import { YoinProvider } from '@yoin/client/react';

<YoinProvider client={client}>
  <App />
</YoinProvider>
```

| 屬性 | 型別 | 說明 |
|------|------|------|
| `client` | `YoinClient` | Yoin 客戶端實例 |
| `children` | `React.ReactNode` | 子元件 |

### `useYoinClient()`

取得 Context 中的 `YoinClient`。

```tsx
const client = useYoinClient();
```

**回傳**：`YoinClient`

> 若未在 `YoinProvider` 內使用，會拋出錯誤。

### `useYoinMap<T>(mapName)`

響應式 Map Hook。回傳 Proxy 物件，直接賦值觸發 CRDT 寫入 + React 重繪。

```tsx
interface AppSettings {
  theme: string;
  fontSize: number;
}

function SettingsPanel() {
  const settings = useYoinMap<AppSettings>('app-settings');

  return (
    <div>
      <p>Theme: {settings.theme}</p>
      <button onClick={() => settings.theme = 'dark'}>
        Dark Mode
      </button>
    </div>
  );
}
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `mapName` | `string` | CRDT Map 名稱 |

**回傳**：`T`（響應式 Proxy）

內部使用 `useSyncExternalStore` + `JSON.stringify` snapshot 做變更偵測。

### `useYoinArray<T>(arrayName)`

響應式 Array Hook。

```tsx
function LogList() {
  const logs = useYoinArray<{ action: string; time: number }>('logs');

  return (
    <ul>
      {logs.map((log, i) => <li key={i}>{log.action}</li>)}
      <button onClick={() => logs.push({ action: 'click', time: Date.now() })}>
        Add Log
      </button>
    </ul>
  );
}
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `arrayName` | `string` | CRDT Array 名稱 |

**回傳**：`T[]`（響應式 Proxy 陣列）

### `useYoinAwareness()`

響應式 Awareness Hook。

```tsx
function UserList() {
  const awareness = useYoinAwareness();

  return (
    <ul>
      {[...awareness.values()].map(user => (
        <li key={user.clientId} style={{ color: user.color }}>
          {user.name} ({user.device})
        </li>
      ))}
    </ul>
  );
}
```

**回傳**：`Map<string, AwarenessState>`

### `useYoinStatus()`

響應式連線狀態 Hook。

```tsx
function StatusBar() {
  const isConnected = useYoinStatus();

  return <span>{isConnected ? '🟢 Online' : '🔴 Offline'}</span>;
}
```

**回傳**：`boolean` — `true` 表示已連線

---

## Schema 驗證

Yoin 整合 [Zod](https://zod.dev/) 進行寫入時驗證。在 `YoinConfig.schemas` 中定義規則後，`setMap()` 和 `pushArray()` 會在寫入前自動驗證。

```typescript
import { z } from 'zod';

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'example',
  schemas: {
    // Map Schema — 使用 z.object()
    'app-settings': z.object({
      theme: z.enum(['light', 'dark']),
      fontSize: z.number().min(8).max(72),
      language: z.string(),
    }),

    // Array Schema — 使用 z.array()
    'action-logs': z.array(z.object({
      action: z.string(),
      timestamp: z.number(),
    })),
  },
});

// ✅ 驗證通過
client.setMap('app-settings', 'theme', 'dark');

// ❌ 驗證失敗，拋出 ZodError
client.setMap('app-settings', 'theme', 'rainbow');

// ✅ 驗證通過
client.pushArray('action-logs', { action: 'click', timestamp: Date.now() });

// ❌ 驗證失敗
client.pushArray('action-logs', { action: 123 });
```

**驗證邏輯**：
- `z.object()` Schema：驗證對應 `key` 的 field schema
- `z.record()` Schema：驗證 value schema
- `z.array()` Schema：驗證每個元素
- 未定義 Schema 的 Map / Array 不做驗證

---

## 型別定義

### `YoinConfig`

```typescript
interface YoinConfig {
  url: string;
  docId: string;
  dbName?: string;
  awarenessThrottleMs?: number;   // 預設 30
  heartbeatIntervalMs?: number;   // 預設 5000
  heartbeatTimeoutMs?: number;    // 預設 30000
  schemas?: Record<string, z.ZodTypeAny>;
}
```

### `AwarenessState`

```typescript
interface AwarenessState {
  clientId: string;
  name: string;
  color: string;
  cursorX?: number | null;
  cursorY?: number | null;
  selection?: string | null;
  offline?: boolean;
  device?: 'mobile' | 'desktop';
  lastActive?: number;
  timestamp: number;
}
```

### `AwarenessPartial`

```typescript
type AwarenessPartial = Partial<Omit<AwarenessState, 'clientId' | 'timestamp'>>;
```

### `CursorRenderer`

```typescript
type CursorRenderer = (color: string, name: string) => HTMLElement;
```

### `AwarenessCallback`

```typescript
type AwarenessCallback = (states: Map<string, AwarenessState>) => void;
```

### `NetworkStatus`

```typescript
type NetworkStatus = 'connecting' | 'online' | 'offline';
```

### `YoinPlugin`

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

### `YoinDbPluginOptions`

```typescript
interface YoinDbPluginOptions {
  dbName: string;
  debounceMs?: number;   // 預設 1000
}
```

---

## 通訊協議

Yoin 使用 1-byte header 二進制協議進行 WebSocket 通訊：

| Type | 常數 | 值 | 方向 | 說明 |
|------|------|---|------|------|
| Sync Step 1 | `MSG_SYNC_STEP_1` | `0` | Client → Server → Client | 發送 State Vector 請求同步 |
| Sync Step 2 | `MSG_SYNC_STEP_2` | `1` | 雙向 | 傳送 CRDT Update / Diff |
| Sync Step 1 Reply | `MSG_SYNC_STEP_1_REPLY` | `2` | Client → Server → Client | 回覆 State Vector |
| Awareness | `MSG_AWARENESS` | `3` | 雙向 | 感知狀態廣播（JSON over binary） |
| Join Room | `MSG_JOIN_ROOM` | `4` | Client → Server | 房間加入通知 |

### 訊息格式

```
┌──────────┬────────────────────────────┐
│ 1 byte   │ N bytes                    │
│ msg_type │ payload (Uint8Array)       │
└──────────┴────────────────────────────┘
```

### 同步流程（三向交握）

```
Client A (new)           Server / Relay           Client B (existing)
    │                         │                         │
    │── MSG_JOIN_ROOM ──────→ │                         │
    │── MSG_SYNC_STEP_1 ────→ │── MSG_SYNC_STEP_1 ───→ │
    │                         │                         │
    │                         │←── MSG_SYNC_STEP_2 ─── │  (diff based on A's SV)
    │←── MSG_SYNC_STEP_2 ─── │                         │
    │                         │←── MSG_SYNC_STEP_1_REPLY│  (B's own SV)
    │←── MSG_SYNC_STEP_1_REPLY│                         │
    │                         │                         │
    │── MSG_SYNC_STEP_2 ────→ │── MSG_SYNC_STEP_2 ───→ │  (diff based on B's SV)
    │                         │                         │
    ▼ Both sides synchronized ▼                         ▼
```
