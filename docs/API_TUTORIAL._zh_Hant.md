# Yoin 新手教學

> 基於 `@yoin/client` v0.1.2 實測驗證。本文件涵蓋所有**經測試可正常運作**的功能（包含五大核心升級：Map/Array 完整 CRUD 與原生型別保真、富文本 Delta 與多文字容器、容器級精準訂閱、伺服器快照預載與防廣播風暴、強化版 Proxy 與 React Hooks）。
>
> 完整範例與 API 測試沙盒放置於 [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) 儲存庫中。

## 目錄

- [安裝與初始化](#安裝與初始化)
  - [安裝](#安裝)
  - [初始化 WASM 引擎](#初始化-wasm-引擎)
- [建立連線](#建立連線)
  - [取得連線資訊](#取得連線資訊)
- [Text API — 協作文字與富文本 Delta](#text-api--協作文字與富文本-delta)
  - [基本讀寫與多文字容器](#基本讀寫與多文字容器)
  - [富文本格式化與 Delta 操作](#富文本格式化與-delta-操作)
  - [監聽文字變更](#監聽文字變更)
- [Map API — 鍵值資料 (完整 CRUD + 原生型別保真)](#map-api--鍵值資料-完整-crud--原生型別保真)
  - [基本讀寫與刪除](#基本讀寫與刪除)
  - [深層巢狀寫入](#深層巢狀寫入)
  - [批量寫入](#批量寫入)
- [Array API — 列表資料 (Push / Insert / Delete / Move)](#array-api--列表資料-push--insert--delete--move)
- [容器級精準訂閱 (Container-Scoped Subscriptions)](#容器級精準訂閱-container-scoped-subscriptions)
- [Proxy 透明讀寫](#proxy-透明讀寫)
  - [Map Proxy](#map-proxy)
  - [Array Proxy](#array-proxy)
- [React Hooks (`@yoin/client/react`)](#react-hooks-yoinclientreact)
- [伺服器快照預載與匯出 (Snapshot Hydration)](#伺服器快照預載與匯出-snapshot-hydration)
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

如使用 Vite，請安裝選用的 WASM 支援插件並在 `vite.config.ts` 中啟用：

```bash
npm install -D vite-plugin-wasm vite-plugin-top-level-await
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
```

### 初始化 WASM 引擎

**任何 Yoin 操作前，都必須先初始化 WASM**。這只需呼叫一次，重複呼叫安全無害（具備單例鎖保護）。

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
3. 執行三向同步交握（自動抑制空 diff 封包）

### 取得連線資訊

```typescript
client.getClientId();  // 本機客戶端 ID，如 "a3f8k2m1"
client.getConfig();    // 取回建構時的設定
client.getDoc();       // 取得底層 CRDT 文件物件（進階用途）
```

---

## Text API — 協作文字與富文本 Delta

支援預設 `'content'` 容器或多個自訂具名文字容器，並支援與 Quill / Tiptap 相容的富文本屬性與 Delta 格式。

### 基本讀寫與多文字容器

```typescript
// 插入文字（預設寫入 'content' 容器）
await client.insertText(0, 'Hello');
await client.insertText(5, ' World');
console.log(client.getText()); // "Hello World"

// 刪除文字（從位置 5 開始刪 6 個字元）
await client.deleteText(5, 6);
console.log(client.getText()); // "Hello"

// 清空文字
await client.clearText();
console.log(client.getText()); // ""

// 操作指定的具名文字容器（例如卡片標題 'card-title-1'）
await client.insertText(0, 'Sprint Planning', undefined, 'card-title-1');
console.log(client.getText('card-title-1')); // "Sprint Planning"
```

### 富文本格式化與 Delta 操作

```typescript
// 插入帶格式屬性的文字
await client.insertText(0, 'Bold Title', { bold: true, color: '#ff0000' }, 'article');

// 對既有文字區間套用格式（例如將索引 0~4 設為斜體）
await client.formatText(0, 4, { italic: true }, 'article');

// 套用 Quill 相容的 Delta 陣列（支援 insert / retain / delete）
await client.applyTextDelta(
  [
    { retain: 10 },
    { insert: '\nSubtitle', attributes: { header: 2 } },
  ],
  'article'
);

// 讀取包含屬性的完整 Delta 陣列
const delta = client.getTextDelta('article');
// [
//   { insert: 'Bold', attributes: { bold: true, color: '#ff0000', italic: true } },
//   { insert: ' Title', attributes: { bold: true, color: '#ff0000' } },
//   { insert: '\nSubtitle', attributes: { header: 2 } }
// ]
```

### 監聽文字變更

```typescript
// 精準訂閱特定文字容器（推薦）
const unsubText = client.subscribeText('article', (text) => {
  console.log('article 文字更新：', text);
});

// 或使用全域訂閱（监听預設 'content' 容器與所有變更）
const unsubscribe = client.subscribe((text) => {
  console.log('文字更新：', text);
});

unsubText();
unsubscribe();
```

---

## Map API — 鍵值資料 (完整 CRUD + 原生型別保真)

適合儲存設定值、畫布節點、狀態物件等結構化資料。底層透過 Rust `yrs::Any` 原生儲存所有型別，字串 `"123"` 與數字 `123`、字串 `"true"` 與布林 `true` 皆維持 100% 型別保真。

### 基本讀寫與刪除

```typescript
// 寫入字串、數值、布林、物件（原生型別保真）
await client.setMap('settings', 'theme', 'dark');
await client.setMap('settings', 'code', '123');     // 保持為字串 "123"
await client.setMap('settings', 'fontSize', 16);    // 保持為數字 16
await client.setMap('settings', 'options', { sidebar: true, compact: false });

// 檢查鍵是否存在
console.log(client.hasMapKey('settings', 'theme')); // true

// 讀取整個 Map
const settings = client.getMap('settings');
console.log(settings.theme);    // "dark"
console.log(settings.code);     // "123" (string)
console.log(settings.fontSize); // 16 (number)
console.log(settings.options);  // { sidebar: true, compact: false }

// 刪除指定鍵（亦可呼叫別名 client.deleteMapKey('settings', 'code')）
await client.deleteMap('settings', 'code');
console.log(client.hasMapKey('settings', 'code')); // false
```

### 深層巢狀寫入

使用 `setMapDeep` 可精確更新巢狀路徑（支援任意型別：數字、字串、布林、物件、陣列），不會覆蓋同層其他值：

```typescript
client.setMapDeep('config', ['ui', 'sidebar', 'width'], 300);
client.setMapDeep('config', ['ui', 'sidebar', 'visible'], true);
client.setMapDeep('config', ['ui', 'sidebar', 'title'], 'Navigation');

const config = client.getMap('config');
console.log(config.ui.sidebar);
// { width: 300, visible: true, title: "Navigation" }
```

### 批量寫入

多個操作合併為單一 CRDT 事務（且會在寫入前完整執行 Zod Schema 驗證），只產生一次網路廣播：

```typescript
client.batchSet([
  ['settings', 'theme', 'dark'],
  ['settings', 'lang', 'zh-TW'],
  ['profile', 'name', 'Alice'],
]);
```

---

## Array API — 列表資料 (Push / Insert / Delete / Move)

適合圖層順序 (z-index)、待辦事項、看板欄位、訊息列表等有序資料。

```typescript
// 1. 尾部推入元素 (pushArray)
await client.pushArray('layers', 'background');
await client.pushArray('layers', 'content');

// 2. 指定位置插入元素 (insertArray)
await client.insertArray('layers', 1, 'grid');
console.log(client.getArray('layers'));
// ["background", "grid", "content"]

// 3. 移動元素順序 (moveArray)
await client.moveArray('layers', 2, 0);
console.log(client.getArray('layers'));
// ["content", "background", "grid"]

// 4. 刪除指定區間元素 (deleteArray)
await client.deleteArray('layers', 1, 1);
console.log(client.getArray('layers'));
// ["content", "grid"]
```

---

## 容器級精準訂閱 (Container-Scoped Subscriptions)

在複雜應用（如白板 + 富文本筆記本）中，使用容器級訂閱可確保只有關注該容器的元件重新渲染：

```typescript
// 僅在 'shapes' Map 變更時觸發
const unsubShapes = client.subscribeMap('shapes', () => {
  console.log('Shapes updated:', client.getMap('shapes'));
});

// 僅在 'layer-order' Array 變更時觸發
const unsubLayers = client.subscribeArray('layer-order', () => {
  console.log('Layers updated:', client.getArray('layer-order'));
});

// 僅在 'doc-body' Text 變更時觸發
const unsubText = client.subscribeText('doc-body', (text) => {
  console.log('Text updated:', text);
});
```

---

## Proxy 透明讀寫

用原生 JS 語法操作 CRDT 資料，寫起來最直覺。

### Map Proxy

支援屬性讀寫、深層物件存取、`delete proxy.key`、`'key' in proxy`、`Object.keys(proxy)`，不存在的鍵會回傳標準的 `undefined`：

```typescript
import { createMapProxy } from '@yoin/client';

interface Settings {
  color: string;
  size: number;
  ui?: { sidebarWidth: number };
}

const settings = createMapProxy<Settings>(client, 'my-settings');

// 直接賦值 → 自動呼叫 setMap
settings.color = 'red';
settings.size = 42;

// 深層屬性寫入 → 自動呼叫 setMapDeep
settings.ui = { sidebarWidth: 240 };
settings.ui.sidebarWidth = 300;

// 讀取與檢查
console.log(settings.color);         // "red"
console.log('color' in settings);    // true
console.log(Object.keys(settings));  // ["color", "size", "ui"]

// 刪除鍵 → 自動呼叫 deleteMap
delete (settings as Partial<Settings>).size;
```

### Array Proxy

每次讀取皆即時從 CRDT 取得最新狀態，並完整支援 `.push()`、`.splice()`、`.pop()`、`.shift()`、`.unshift()`：

```typescript
import { createArrayProxy } from '@yoin/client';

const tags = createArrayProxy<string>(client, 'tags');

tags.push('important', 'urgent');
tags.unshift('pinned');     // ["pinned", "important", "urgent"]
tags.splice(1, 1, 'review'); // ["pinned", "review", "urgent"]
const last = tags.pop();     // "urgent"
console.log(tags.length);    // 2
```

---

## React Hooks (`@yoin/client/react`)

提供開箱即用的 React 18 整合，底層已採用容器級訂閱（`subscribeMap` / `subscribeArray` / `subscribeText`），不會造成跨容器無效渲染：

```tsx
import {
  YoinProvider,
  useYoinMap,
  useYoinArray,
  useYoinText,
  useYoinAwareness,
  useYoinStatus,
  useYoinUndo,
} from '@yoin/client/react';

function Editor() {
  const board = useYoinMap<{ title: string }>('board-meta');
  const items = useYoinArray<string>('todo-list');
  const { text, delta, insert, format, clear } = useYoinText('article');
  const { states, setLocalState } = useYoinAwareness();
  const status = useYoinStatus();
  const { undo, redo } = useYoinUndo();

  return (
    <div>
      <h1>{board.title ?? '未命名'} ({status})</h1>
      <button onClick={() => { board.title = 'SyncSpace 2.0'; }}>改標題</button>
      <button onClick={() => items.push(`Task #${items.length + 1}`)}>新增任務</button>
      <button onClick={() => insert(text.length, ' Hello', { bold: true })}>插入粗體字</button>
      <button onClick={undo}>Undo</button>
      <button onClick={redo}>Redo</button>
    </div>
  );
}
```

---

## 伺服器快照預載與匯出 (Snapshot Hydration)

支援將完整 CRDT 狀態匯出為二進位快照，或在連線時直接匯入來自資料庫（如 PostgreSQL / S3）的快照：

```typescript
// 匯出目前完整狀態快照 (Uint8Array)
const snapshot = client.exportSnapshot();

// 在新客戶端套用伺服器快照並通知所有訂閱者
client2.applySnapshot(snapshot);

// 主動與已連線的同儕觸發 State Vector 同步
client2.syncWithPeers();
```

---

## Awareness — 即時感知

廣播使用者的即時狀態（游標位置、姓名、顏色等），**不寫入 CRDT 文件**，且在離線時標記為 `transient` 不會塞爆離線重送佇列。

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

`subscribeNetwork` 會立即回報當前狀態，並回傳取消訂閱函式（支援多個監聽器共存）：

```typescript
const unsubNet = client.subscribeNetwork((status) => {
  // status: 'connecting' | 'online' | 'offline' | 'failed'
  console.log('網路狀態：', status);
});

// 取消監聽
unsubNet();
```

---

## Plugin 系統

Yoin 使用插件架構擴展功能。使用 `client.use()` 安裝，支援鏈式呼叫。

### Logger 插件

```typescript
import { createLoggerPlugin } from '@yoin/client';

client.use(createLoggerPlugin('[Debug]'));
```

### IndexedDB 持久化插件

自動將文件快照儲存到 IndexedDB（內建 `IDBDatabase` 連線快取），並在載入完成後自動與已連線的同儕觸發 `syncWithPeers()`。

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

### Undo / Redo 插件

撤銷/重做本地操作。安裝後自動追蹤所有 Map（`setMap`、`deleteMap`、`setMapDeep`、`batchSet`）、Array（`pushArray`、`insertArray`、`deleteArray`、`moveArray`）與所有具名 Text 容器。

```typescript
import { createUndoPlugin } from '@yoin/client';

const { plugin, undo, redo } = createUndoPlugin();
client.use(plugin);

await client.setMap('state', 'count', 1);
await client.setMap('state', 'count', 2);
undo(); // count 回到 1
redo(); // count 回到 2
```

### 自訂插件

```typescript
import type { YoinPlugin } from '@yoin/client';

const analyticsPlugin: YoinPlugin = {
  name: 'my-analytics',
  onInstall(client) {
    console.log(`連線到文件：${client.getConfig().docId}`);
  },
  onBeforeUpdate(update) {
    console.log('即將發送', update.length, 'bytes');
  },
  onAfterUpdate(update) {
    console.log('已發送', update.length, 'bytes');
  },
  onDestroy() {
    console.log('插件銷毀');
  },
};

client.use(analyticsPlugin);
```

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

unsub1();
unsub2();
```

---

## 銷毀與清理

```typescript
client.destroy();
```

銷毀時自動：
1. 清除心跳與游標 GC 計時器
2. 呼叫所有插件的 `onDestroy()`（包含關閉 IndexedDB 連線）
3. 廣播離線 Awareness 狀態並斷開 WebSocket
4. 呼叫 `doc.free()` 釋放底層 Rust WASM 線性記憶體

---

## 完整範例

```typescript
import { initYoin, YoinClient, createDbPlugin, createUndoPlugin } from '@yoin/client';

async function main() {
  await initYoin();

  const client = new YoinClient({
    url: 'wss://your-server.workers.dev',
    docId: 'counter-room',
  });

  const { plugin: dbPlugin } = createDbPlugin({ dbName: 'counter-app' });
  const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
  client.use(dbPlugin).use(undoPlugin);

  document.querySelector('#app')!.innerHTML = `
    <h1>協作計數器</h1>
    <button id="inc">Count: 0</button>
    <button id="undo">Undo</button>
    <button id="redo">Redo</button>
  `;

  const btn = document.querySelector<HTMLButtonElement>('#inc')!;

  client.subscribeMap('state', () => {
    const state = client.getMap('state');
    btn.textContent = `Count: ${state?.count ?? 0}`;
  });

  btn.addEventListener('click', () => {
    const current = (client.getMap('state')?.count as number) ?? 0;
    client.setMap('state', 'count', current + 1);
  });

  document.querySelector('#undo')!.addEventListener('click', () => undo());
  document.querySelector('#redo')!.addEventListener('click', () => redo());

  window.addEventListener('beforeunload', () => {
    client.destroy();
  });
}

main();
```

---

## API 測試結果總覽

以下為 `@yoin/client` v0.1.2 實測結果（123 項單元與真實 WASM 整合測試 + 54 項 Monorepo 結構測試全數通過）：

| 功能 | 狀態 | 備註 |
|------|------|------|
| `initYoin()` / `isYoinInitialized()` | ✅ | 含並行單例鎖與冪等呼叫 |
| `new YoinClient()` / `destroy()` | ✅ | 含 `doc.free()` WASM 記憶體釋放 |
| `insertText()` / `deleteText()` / `clearText()` / `getText()` | ✅ | 支援多具名容器 `textName` |
| `formatText()` / `applyTextDelta()` / `getTextDelta()` | ✅ | Quill 相容富文本屬性與 Delta |
| `setMap()` / `getMap()` / `deleteMap()` / `hasMapKey()` | ✅ | `yrs::Any` 原生型別保真 |
| `setMapDeep()` / `batchSet()` | ✅ | 支援任意 JS 型別與 Zod 驗證 |
| `pushArray()` / `insertArray()` / `deleteArray()` / `moveArray()` / `getArray()` | ✅ | 完整 Array CRUD |
| `subscribeMap()` / `subscribeArray()` / `subscribeText()` / `subscribe()` | ✅ | 容器級精準隔離訂閱 |
| `applySnapshot()` / `exportSnapshot()` / `syncWithPeers()` | ✅ | 伺服器快照預載與空 diff 抑制 |
| `createMapProxy()` / `createArrayProxy()` | ✅ | 支援 `delete`、`in`、`splice` 等原生操作 |
| `useYoinMap()` / `useYoinArray()` / `useYoinText()` / `useYoinStatus()` | ✅ | React 18 Hooks |
| `setAwareness()` / `getAwarenessStates()` / `onAwarenessChange()` / `leaveAwareness()` | ✅ | 暫態封包不進入離線佇列 |
| `createDbPlugin()` / `createUndoPlugin()` / `createLoggerPlugin()` | ✅ | 全容器 Undo 追蹤與 IndexedDB 快取 |
