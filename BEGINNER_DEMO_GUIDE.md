# Yoin 新手 Demo 指南

> 版本：`@yoin/client@0.1.2` · `@yoin/core@0.1.2`  
> 需求：Node.js >= 18

---

## 1. Vite + TypeScript（推薦）

### 建立專案

```bash
npm create vite@latest my-yoin-demo -- --template vanilla-ts
cd my-yoin-demo
npm install
npm install @yoin/client @yoin/core
```

### 修改 `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { yoinViteConfig } from '@yoin/client/vite';

export default defineConfig({
  ...yoinViteConfig(),
});
```

### 修改 `src/main.ts`

```typescript
import { initYoin, YoinClient, createUndoPlugin } from '@yoin/client';

async function main() {
  await initYoin();

  const client = new YoinClient({
    url: 'wss://<YOUR_WORKER>.workers.dev', // 替換為你的 Worker URL，見下方部署教學
    docId: 'demo-' + (new URLSearchParams(location.search).get('room') || 'default'),
  });

  const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
  client.use(undoPlugin);

  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <h1>Yoin Demo</h1>
    <button id="inc">Count: 0</button>
    <button id="undo">Undo</button>
    <button id="redo">Redo</button>
    <pre id="state">{}</pre>
  `;

  const btn = document.querySelector<HTMLButtonElement>('#inc')!;
  const pre = document.querySelector<HTMLPreElement>('#state')!;

  const render = () => {
    const state = client.getMap('state');
    btn.textContent = `Count: ${state?.count ?? 0}`;
    pre.textContent = JSON.stringify(state, null, 2);
  };

  btn.addEventListener('click', () => {
    client.setMap('state', 'count', (client.getMap('state')?.count ?? 0) + 1);
  });
  document.querySelector('#undo')!.addEventListener('click', undo);
  document.querySelector('#redo')!.addEventListener('click', redo);

  client.subscribe(render);
  render();
}

main();
```

### 啟動

```bash
npm run dev
```

開啟 **http://localhost:5173** · 多開幾個分頁測試即時同步！

---

## 2. React + TypeScript

### 建立專案

```bash
npm create vite@latest my-yoin-react -- --template react-ts
cd my-yoin-react
npm install
npm install @yoin/client @yoin/core
```

### 修改 `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { yoinVitePlugin, yoinViteServerConfig } from '@yoin/client/vite';

export default defineConfig({
  plugins: [...yoinVitePlugin(), react()],
  server: yoinViteServerConfig(),
});
```

### 修改 `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initYoin, YoinClient, createUndoPlugin } from '@yoin/client';
import App from './App';

async function bootstrap() {
  await initYoin();

  const client = new YoinClient({
    url: 'wss://<YOUR_WORKER>.workers.dev', // 替換為你的 Worker URL，見下方部署教學
    docId: 'react-demo-' + (new URLSearchParams(location.search).get('room') || 'default'),
  });

  const { plugin: undoPlugin, undo, redo } = createUndoPlugin();
  client.use(undoPlugin);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App client={client} undo={undo} redo={redo} />
    </React.StrictMode>
  );
}

bootstrap();
```

### 修改 `src/App.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import type { YoinClient } from '@yoin/client';

interface Props {
  client: YoinClient;
  undo: () => void;
  redo: () => void;
}

export default function App({ client, undo, redo }: Props) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    return client.subscribe(() => {
      setCount(client.getMap('state')?.count ?? 0);
    });
  }, [client]);

  const increment = () => {
    client.setMap('state', 'count', count + 1);
  };

  return (
    <div>
      <h1>Yoin React Demo</h1>
      <button onClick={increment}>Count: {count}</button>
      <button onClick={undo}>Undo</button>
      <button onClick={redo}>Redo</button>
    </div>
  );
}
```

### 啟動

```bash
npm run dev
```

---

## 房間共享

在 URL 加上 `?room=任意名稱` 讓不同裝置進入同一房間即時同步：

```
http://localhost:5173?room=my-room
```

---

## 常見問題

**Q: WASM 載入失敗**  
確認 `vite.config.ts` 使用了 `yoinViteConfig()` 或 `yoinVitePlugin()`，並完整執行過 `npm install`。

**Q: 連線失敗 / WebSocket 錯誤**  
確認已正確部署 Worker 並將 URL 替換為你的 `wss://<YOUR_WORKER>.workers.dev`。

**Q: TypeScript 找不到 `@yoin/client/vite`**  
重新執行 `npm install`，確認 `node_modules/@yoin/client/dist/vite.d.ts` 存在。

---

## 部署自己的 Yoin Worker

Yoin 使用 [Cloudflare Workers](https://workers.cloudflare.com/) 作為即時同步後端，需要免費註冊 Cloudflare 帳號。

### 步驟 1：安裝 Wrangler CLI

```bash
npm install -g wrangler
```

### 步驟 2：登入 Cloudflare

```bash
wrangler login
```

瀏覽器會自動開啟授權頁面，登入並授權即可。

### 步驟 3：取得 yoin-worker 程式碼

```bash
git clone https://github.com/Saisai568/yoin.git
cd yoin/yoin-worker
```

或者如果你已經有 yoin 原始碼：

```bash
cd path/to/yoin/yoin-worker
```

### 步驟 4：安裝依賴

```bash
npm install
```

### 步驟 5：部署

```bash
npm run deploy
```

部署成功後會顯示你的 Worker URL：

```
✅  https://yoin-worker.<你的帳號名稱>.workers.dev
```

### 步驟 6：在 demo 中使用你的 Worker URL

將 `src/main.ts`（或 `src/main.tsx`）中的 URL 換成你的：

```typescript
const client = new YoinClient({
  url: 'wss://yoin-worker.<你的帳號名稱>.workers.dev',
  docId: 'demo-default',
});
```

> **注意**：Cloudflare Workers 免費方案每天有 100,000 次請求限制，個人 demo 和小型專案完全足夠，商業級別的worker，請使用者自行升級付費方案及處理相關付費事宜，或自行找尋更適宜的雲端worker商。
