[繁體中文](README_zh_Hant.md) | [English](README.md)

# Yoin

**Local-First 即時協作狀態同步框架**

Yoin 是一個基於 CRDT 的即時協作框架，讓開發者能在幾行程式碼內為應用加入多人即時同步能力。核心引擎以 Rust 編寫並透過 WebAssembly 在瀏覽器端執行，搭配 Cloudflare Durable Objects 提供 WebSocket 中繼，實現低延遲、可離線、自動合併的協作體驗。

## 特色

- **CRDT 引擎（Rust + WASM）** — 基於 [Yrs](https://github.com/y-crdt/y-crdt) 的衝突自由合併，任何裝置離線編輯後自動收斂
- **TypeScript SDK** — YoinClient 微核心 + Plugin 系統 + Proxy 透明寫入 + React Hooks
- **Cloudflare Edge** — Durable Objects 房間隔離 + Hibernation API，按需喚醒零冷啟動
- **離線優先** — IndexedDB 持久化 + 離線佇列，斷網後仍可操作，重連自動同步
- **Awareness 系統** — 即時游標、在線狀態、選取範圍廣播（rAF 節流 + Ghost Busting）
- **Undo / Redo** — 僅撤銷自己的操作，不影響遠端協作者
- **Schema 驗證** — 整合 Zod，寫入時自動驗證資料結構
- **Proxy 語法** — 用原生 JS `obj.key = value` 語法操作 CRDT，支援深層巢狀

## 快速開始

### 安裝

```bash
npm install @yoin/client @yoin/core
# 或
pnpm add @yoin/client @yoin/core
```

### 基本使用

```typescript
import { initYoin, YoinClient, createDbPlugin, createUndoPlugin } from '@yoin/client';

// 1. 初始化 WASM 引擎
await initYoin();

// 2. 建立客戶端，連線到 Cloudflare Worker
const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'my-document',
});

// 3. 安裝插件
const { plugin: dbPlugin } = createDbPlugin({ dbName: 'my-app' });
const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
client.use(dbPlugin).use(undoPlugin);

// 4. 操作資料 - 文字
client.insertText(0, 'Hello World');
console.log(client.getText()); // "Hello World"

// 5. 操作資料 - Map
client.setMap('settings', 'theme', 'dark');
client.setMapDeep('settings', ['nested', 'value'], 42);
console.log(client.getMap('settings')); // { theme: "dark", nested: { value: 42 } }

// 6. 操作資料 - Array
client.pushArray('logs', { action: 'login', time: Date.now() });
console.log(client.getArray('logs'));

// 7. 訂閱變更
const unsubscribe = client.subscribe((text) => {
  document.getElementById('editor')!.textContent = text;
});

// 8. 清理
client.destroy();
```

### Proxy 透明寫入

```typescript
import { createMapProxy, createArrayProxy } from '@yoin/client';

const settings = createMapProxy<{ theme: string; fontSize: number }>(client, 'settings');
settings.theme = 'dark';       // 自動觸發 CRDT 寫入 + 網路同步
settings.fontSize = 16;

const logs = createArrayProxy<string>(client, 'logs');
logs.push('user joined');      // 自動觸發 pushArray
```

### React 整合

```tsx
import { YoinProvider, useYoinMap, useYoinArray, useYoinAwareness } from '@yoin/client/react';

function App() {
  return (
    <YoinProvider client={client}>
      <SettingsPanel />
      <UserList />
    </YoinProvider>
  );
}

function SettingsPanel() {
  const settings = useYoinMap<{ theme: string }>('app-settings');
  return (
    <select value={settings.theme} onChange={e => settings.theme = e.target.value}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}

function UserList() {
  const awareness = useYoinAwareness();
  return (
    <ul>
      {[...awareness.values()].map(user => (
        <li key={user.clientId} style={{ color: user.color }}>{user.name}</li>
      ))}
    </ul>
  );
}
```

## 專案結構

```
yoin/
├── packages/
│   ├── core/           # Rust CRDT 引擎 → WebAssembly
│   │   ├── src/lib.rs  # YoinDoc：Text / Map / Array / Undo / Sync API
│   │   └── pkg-web/    # wasm-pack 輸出（自動生成）
│   └── client/         # @yoin/client TypeScript SDK
│       └── src/
│           ├── YoinClient.ts    # 微核心：CRDT + 網路 + 插件
│           ├── network.ts       # WebSocket + 離線佇列 + 自動重連
│           ├── storage.ts       # IndexedDB 適配器
│           ├── proxy.ts         # Map / Array Proxy 透明寫入
│           ├── plugin.ts        # Plugin 介面定義
│           ├── plugins/db.ts    # IndexedDB 持久化插件
│           ├── plugins/undo.ts  # Undo / Redo 插件
│           ├── logger.ts        # 開發除錯日誌插件
│           ├── react/index.tsx  # React Hooks（Provider / useYoinMap / ...）
│           └── wasm/loader.ts   # WASM 初始化器
├── yoin-worker/        # Cloudflare Worker（Durable Objects WebSocket Relay）
├── apps/
│   └── demo/           # 展示用 Demo（Vanilla JS + React）
├── server/             # Node.js 開發用伺服器
├── docs/               # 技術文件
└── deploy.bat          # 一鍵全端部署腳本
```

## 開發指南

### 環境需求

- Node.js ≥ 18
- pnpm ≥ 9
- Rust toolchain + wasm-pack（建置 Core）
- Cloudflare 帳號（部署 Worker / Pages）

### 常用指令

```bash
# 安裝依賴
pnpm install

# 完整建置（WASM → SDK → Demo）
pnpm build

# 啟動 Demo 開發伺服器
pnpm dev:demo

# 執行測試
pnpm test            # 單元 + 整合測試
pnpm test:e2e        # Playwright E2E 測試
pnpm test:coverage   # 覆蓋率報告

# 型別檢查
pnpm typecheck

# 完整部署
.\deploy.bat         # Windows
# 或分步部署
pnpm deploy:worker   # 僅部署 Worker
pnpm deploy:pages    # 建置 + 部署 Pages
```

## 技術棧

| 層級 | 技術 | 說明 |
|------|------|------|
| CRDT 引擎 | Rust + Yrs + wasm-bindgen | 衝突自動合併，增量差異同步 |
| 客戶端 SDK | TypeScript + tsup | 微核心架構，雙格式輸出（ESM / CJS） |
| 後端中繼 | Cloudflare Workers + Durable Objects | Hibernation API，按需喚醒 |
| 前端框架 | React 19 / Vanilla JS | Hooks + Proxy 整合 |
| 建置工具 | Vite 7 + wasm-pack + tsup | WASM 支援 + 熱更新 |
| 測試 | Vitest + Playwright | 單元 / E2E 雙軌測試 |
| 部署 | Cloudflare Pages + Workers | 全球 Edge 分發 |

## 授權與版權

MIT License
