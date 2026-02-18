# Yoin 新手教學

> 基於 `@yoin/client` v0.1.2 實測驗證。本文件涵蓋所有**經測試可正常運作**的功能。
> 
> API測試應用程式，放置於apps/api-test內，請自行測試

## 目錄

- [Yoin 新手教學](#yoin-新手教學)
  - [目錄](#目錄)
  - [安裝與初始化](#安裝與初始化)
    - [安裝](#安裝)
    - [初始化 WASM 引擎](#初始化-wasm-引擎)
  - [建立連線](#建立連線)
    - [取得連線資訊](#取得連線資訊)
  - [Text API — 協作文字](#text-api--協作文字)
    - [監聽文字變更](#監聽文字變更)
  - [Map API — 鍵值資料](#map-api--鍵值資料)
    - [基本讀寫](#基本讀寫)
    - [深層巢狀寫入](#深層巢狀寫入)
    - [批量寫入](#批量寫入)
  - [Array API — 列表資料](#array-api--列表資料)
  - [Proxy 透明寫入](#proxy-透明寫入)
    - [Map Proxy](#map-proxy)
    - [Array Proxy](#array-proxy)
  - [Awareness — 即時感知](#awareness--即時感知)
  - [網路狀態監聽](#網路狀態監聽)
  - [Plugin 系統](#plugin-系統)
    - [Logger 插件](#logger-插件)
    - [IndexedDB 持久化插件](#indexeddb-持久化插件)
    - [Undo / Redo 插件](#undo--redo-插件)
    - [自訂插件](#自訂插件)
  - [Hook API — 進階訂閱](#hook-api--進階訂閱)
  - [銷毀與清理](#銷毀與清理)
  - [完整範例](#完整範例)
  - [API 測試結果總覽](#api-測試結果總覽)

---

## 安裝與初始化

### 安裝

```bash
npm install @yoin/client
```

如使用 Vite，請在 `vite.config.ts` 加入 WASM 支援：

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
});
```

### 初始化 WASM 引擎

**任何 Yoin 操作前，都必須先初始化 WASM**。這只需呼叫一次，重複呼叫安全無害。

```typescript
import { initYoin, isYoinInitialized } from '@yoin/client';

// 第一步：載入 WASM（僅需一次）
await initYoin();

// 可以隨時檢查是否已初始化
console.log(isYoinInitialized()); // true
```

---

## 建立連線

```typescript
import { YoinClient } from '@yoin/client';

const client = new YoinClient({
  url: 'wss://your-server.workers.dev',  // WebSocket 伺服器
  docId: 'my-room',                       // 房間/文件 ID
});
```

建構時會自動：
1. 建立 CRDT 文件
2. 連線 WebSocket
3. 執行同步交握

### 取得連線資訊

```typescript
client.getClientId();  // 本機客戶端 ID，如 "a3f8k2m1"
client.getConfig();    // 取回建構時的設定
client.getDoc();       // 取得底層 CRDT 文件物件（進階用途）
```

---

## Text API — 協作文字

最基本的共同編輯功能：多人同時編輯同一段文字。

```typescript
// 插入文字
await client.insertText(0, 'Hello');
await client.insertText(5, ' World');
console.log(client.getText()); // "Hello World"

// 刪除文字（從位置 5 開始刪 6 個字元）
await client.deleteText(5, 6);
console.log(client.getText()); // "Hello"

// 清空所有文字
await client.clearText();
console.log(client.getText()); // ""
```

### 監聽文字變更

```typescript
// 訂閱：本地和遠端的修改都會觸發
const unsubscribe = client.subscribe((text) => {
  console.log('文字更新：', text);
});

// 不再需要時取消訂閱
unsubscribe();
```

---

## Map API — 鍵值資料

適合儲存設定值、狀態物件等結構化資料。

### 基本讀寫

```typescript
// 寫入字串
await client.setMap('settings', 'theme', 'dark');

// 寫入數值
await client.setMap('settings', 'fontSize', 16);

// 寫入物件（自動 JSON 序列化）
await client.setMap('settings', 'options', { sidebar: true, compact: false });

// 讀取整個 Map
const settings = client.getMap('settings');
console.log(settings.theme);    // "dark"
console.log(settings.fontSize); // 16
console.log(settings.options);  // { sidebar: true, compact: false }
```

### 深層巢狀寫入

使用 `setMapDeep` 可精確更新巢狀路徑，不會覆蓋同層其他值：

```typescript
client.setMapDeep('config', ['ui', 'sidebar', 'width'], 300);
client.setMapDeep('config', ['ui', 'sidebar', 'visible'], true);

const config = client.getMap('config');
console.log(config.ui.sidebar);
// { width: 300, visible: true }
```

### 批量寫入

多個操作合併為單一 CRDT 事務，效能更好：

```typescript
client.batchSet([
  ['settings', 'theme', 'dark'],
  ['settings', 'lang', 'zh-TW'],
  ['profile', 'name', 'Alice'],
]);
```

---

## Array API — 列表資料

適合日誌、訊息列表、標籤等場景。

```typescript
// 推入物件
await client.pushArray('logs', { action: 'click', time: Date.now() });

// 推入字串
await client.pushArray('logs', 'simple-string');

// 讀取
const logs = client.getArray('logs');
console.log(logs);
// [{ action: "click", time: 1707955200000 }, "simple-string"]
```

---

## Proxy 透明寫入

用原生 JS 語法操作 CRDT 資料，寫起來更直覺。

### Map Proxy

```typescript
import { createMapProxy } from '@yoin/client';

interface Settings {
  color: string;
  size: number;
}

const settings = createMapProxy<Settings>(client, 'my-settings');

// 直接賦值 → 自動呼叫 setMap
settings.color = 'red';
settings.size = 42;

// 讀取
console.log(settings.color); // "red"
```

### Array Proxy

```typescript
import { createArrayProxy } from '@yoin/client';

const tags = createArrayProxy<string>(client, 'tags');

// push → 自動呼叫 pushArray
tags.push('important');
tags.push('urgent');
```

> ⚠️ Array Proxy 目前僅支援 `.push()` 操作。

---

## Awareness — 即時感知

廣播使用者的即時狀態（游標位置、姓名、顏色等），**不寫入 CRDT 文件**。

```typescript
// 設定自己的狀態
client.setAwareness({
  name: 'Alice',
  color: '#ff6b6b',
  cursorX: 120,
  cursorY: 450,
});

// 讀取所有人的狀態
const states = client.getAwarenessStates();
for (const [clientId, state] of states) {
  console.log(`${state.name} 在 (${state.cursorX}, ${state.cursorY})`);
}

// 訂閱變更（訂閱時立即觸發一次）
const unsub = client.onAwarenessChange((states) => {
  console.log('線上人數：', states.size);
});

// 離開（自動在 destroy() 時呼叫）
client.leaveAwareness();
```

---

## 網路狀態監聽

```typescript
client.subscribeNetwork((status) => {
  // status: 'connecting' | 'online' | 'offline' | 'failed'
  console.log('網路狀態：', status);
});
```

---

## Plugin 系統

Yoin 使用插件架構擴展功能。使用 `client.use()` 安裝，支援鏈式呼叫。

### Logger 插件

開發除錯用，在 Console 輸出 update 日誌。

```typescript
import { createLoggerPlugin } from '@yoin/client';

client.use(createLoggerPlugin('[Debug]'));
// Console: [Debug] Plugin installed!
// Console: [Debug] Update detected, size: 42 bytes
```

### IndexedDB 持久化插件

自動將文件快照儲存到 IndexedDB，實現離線持久化 + 頁面重載恢復。

```typescript
import { createDbPlugin } from '@yoin/client';

const { plugin, forceSave } = createDbPlugin({
  dbName: 'my-app-db',   // IndexedDB 資料庫名稱
  debounceMs: 500,        // 自動存檔防抖（預設 1000ms）
});

client.use(plugin);

// 手動立即存檔
await forceSave();
```

**行為**：
- 安裝時自動從 IndexedDB 恢復資料
- 每次操作後自動排程防抖存檔
- `forceSave()` 立即寫入

### Undo / Redo 插件

撤銷/重做本地操作。安裝後自動啟用，無需手動設定。

```typescript
import { createUndoPlugin } from '@yoin/client';

const { plugin, undo, redo } = createUndoPlugin();
client.use(plugin);

// 使用
await client.setMap('state', 'count', 1);
await client.setMap('state', 'count', 2);
undo(); // count 回到 1
redo(); // count 回到 2
```

**特性**：
- 安裝時自動啟用 WASM undo manager
- 首次寫入某個 Map 時自動追蹤該 Map 的變更
- 僅撤銷本地操作，不影響遠端操作
- 撤銷/重做後自動廣播 diff 給遠端

### 自訂插件

實作 `YoinPlugin` 介面即可：

```typescript
import type { YoinPlugin } from '@yoin/client';

const analyticsPlugin: YoinPlugin = {
  name: 'my-analytics',

  onInstall(client) {
    console.log(`連線到文件：${client.getConfig().docId}`);
  },

  onBeforeUpdate(update) {
    // 在廣播前觸發
    console.log('即將發送', update.length, 'bytes');
  },

  onAfterUpdate(update) {
    // 在廣播後觸發
    console.log('已發送', update.length, 'bytes');
  },

  onDestroy() {
    console.log('插件銷毀');
  },
};

client.use(analyticsPlugin);
```

| 鉤子 | 觸發時機 | 用途 |
|------|----------|------|
| `onInstall` | `client.use()` 時 | 初始化 |
| `onBeforeUpdate` | 本地寫入後、廣播前 | 攔截/日誌 |
| `onAfterUpdate` | 廣播後 | 持久化/分析 |
| `onDestroy` | `client.destroy()` 時 | 清理資源 |

---

## Hook API — 進階訂閱

```typescript
// 訂閱所有文件更新（本地 + 遠端）
const unsub1 = client.onDocUpdate((update) => {
  console.log('文件更新', update.length, 'bytes');
});

// 僅訂閱本地操作
const unsub2 = client.onLocalUpdate((update) => {
  console.log('本地操作', update.length, 'bytes');
});

// 取消訂閱
unsub1();
unsub2();
```

---

## 銷毀與清理

```typescript
client.destroy();
```

銷毀時自動：
1. 清除心跳/GC 計時器
2. 呼叫所有插件的 `onDestroy()`
3. 廣播離線 Awareness
4. 斷開 WebSocket

---

## 完整範例

一個計數器 + 離線持久化的完整應用：

```typescript
import { initYoin, YoinClient, createDbPlugin } from '@yoin/client';

async function main() {
  // 1. 初始化 WASM
  await initYoin();

  // 2. 建立客戶端
  const client = new YoinClient({
    url: 'wss://your-server.workers.dev',
    docId: 'counter-room',
  });

  // 3. 安裝 DB 插件（離線持久化）
  const { plugin: dbPlugin } = createDbPlugin({
    dbName: 'counter-app',
  });
  client.use(dbPlugin);

  // 4. 建立 UI
  document.querySelector('#app')!.innerHTML = `
    <h1>協作計數器</h1>
    <button id="inc">Count: 0</button>
  `;

  const btn = document.querySelector<HTMLButtonElement>('#inc')!;

  // 5. 監聽狀態變更（本地 + 遠端）
  client.subscribe(() => {
    const state = client.getMap('state');
    btn.textContent = `Count: ${state?.count ?? 0}`;
  });

  // 6. 點擊 +1
  btn.addEventListener('click', () => {
    const current = client.getMap('state')?.count ?? 0;
    client.setMap('state', 'count', current + 1);
  });

  // 7. 頁面關閉時清理
  window.addEventListener('beforeunload', () => {
    client.destroy();
  });
}

main();
```

---

## API 測試結果總覽

以下為實測結果（35/35 通過）：

| 功能 | 狀態 | 備註 |
|------|------|------|
| `initYoin()` | ✅ | 含冪等呼叫 |
| `isYoinInitialized()` | ✅ | |
| `new YoinClient()` | ✅ | |
| `getDoc()` / `getConfig()` / `getClientId()` | ✅ | |
| `insertText()` / `deleteText()` / `clearText()` / `getText()` | ✅ | |
| `subscribe()` / `unsubscribe` | ✅ | |
| `setMap()` / `getMap()` | ✅ | 字串/數值/物件 |
| `setMapDeep()` | ✅ | |
| `batchSet()` | ✅ | |
| `pushArray()` / `getArray()` | ✅ | |
| `createMapProxy()` | ✅ | |
| `createArrayProxy()` | ✅ | |
| `setAwareness()` / `getAwarenessStates()` | ✅ | |
| `onAwarenessChange()` | ✅ | |
| `leaveAwareness()` | ✅ | |
| `subscribeNetwork()` | ✅ | |
| `createLoggerPlugin()` | ✅ | |
| `createDbPlugin()` + `forceSave()` | ✅ | IndexedDB 讀寫正常 |
| 自訂 Plugin（所有 Hook） | ✅ | |
| `onDocUpdate()` / `onLocalUpdate()` | ✅ | |
| `map_get_all()` / `array_get_all()` | ✅ | |
| `destroy()` | ✅ | |
| `createUndoPlugin()` | ✅ | undo / redo 正常運作 |
