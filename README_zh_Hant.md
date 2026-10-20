[繁體中文](README_zh_Hant.md) | [English](README.md)

# Yoin (餘韻)

**Local-First 即時協作狀態同步框架 — 基於 Rust WASM (Yrs) + TypeScript 微核心**

[![Tests](https://img.shields.io/badge/tests-123%20passed-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-74%25-green)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()
[![Rust](https://img.shields.io/badge/Rust-WASM-orange)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## 什麼是 Yoin？

Yoin 是一個輕量級的 **Local-First 即時協作引擎**，將 [Yrs](https://github.com/y-crdt/y-crdt)（Yjs 的 Rust 實作）透過 WebAssembly 封裝為前端可直接使用的 TypeScript SDK。

**核心特色**：

- **CRDT 無衝突合併** — 基於 Yrs，支援富文本 Text Delta（含格式屬性與多具名文字區塊）、Map（完整 CRUD、原生型別保真、深層巢狀與批量事務）、Array（push / insert / delete / move）三種資料結構
- **Local-First 架構** — 本地操作零延遲，IndexedDB 自動持久化（單例連線快取）+ 離線非暫態佇列 + 指數退避自動重連
- **精細化容器級訂閱** — 支援 `subscribeMap`、`subscribeArray`、`subscribeText` 容器隔離通知，確保 60FPS 畫布拖曳與文字編輯互不干擾
- **微核心 + 插件系統** — 核心保持精簡，透過 `YoinPlugin` 介面擴展功能（持久化、全容器 Undo/Redo、日誌等）
- **Proxy 透明讀寫** — 用原生 JS 屬性賦值（`proxy.key = val`、`delete proxy.key`、`arr.splice(...)`）直接操作 CRDT，自動同步到所有連線端
- **React 18 Hooks** — 基於 `useSyncExternalStore`，提供 `<YoinProvider>`、`useYoinMap`、`useYoinArray`、`useYoinText`、`useYoinAwareness`、`useYoinStatus`、`useYoinUndo`
- **即時感知 (Awareness)** — 游標位置、選取範圍、線上狀態、裝置類型的即時廣播（含暫態封包佇列過濾與自動垃圾回收）
- **快照預載與廣播風暴抑制** — 支援 `applySnapshot` / `exportSnapshot` 伺服器快照預熱，並在三向交握時自動攔截空 diff 封包
- **Schema 驗證** — 整合 [Zod](https://zod.dev/)，在寫入（含 `setMap`、`batchSet`、`pushArray`、`insertArray`）前即時驗證資料結構

---

## 快速開始

### 環境需求

- **Node.js** ≥ 18
- **pnpm** ≥ 9
- **Rust** + **wasm-pack**（僅修改 Core 時需要）

### 安裝與建置

```bash
# 複製專案
git clone <repo-url>
cd yoin

# 安裝依賴
pnpm install

# 建置全部（WASM Core → Client SDK）
pnpm build
```

> 完整的範例應用程式、測試沙盒、Node.js Relay 伺服器與 Cloudflare Worker 已獨立拆分至 [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) 儲存庫。

### 30 秒上手

**Vanilla TypeScript**：

```typescript
import { initYoin, YoinClient, createMapProxy, createDbPlugin, createUndoPlugin } from '@yoin/client';

// 1. 初始化 WASM 引擎（全域僅需一次）
await initYoin();

// 2. 建立客戶端並掛載插件
const { plugin: dbPlugin } = createDbPlugin({ dbName: 'my-app' });
const { plugin: undoPlugin, undo, redo } = createUndoPlugin();

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'my-room',
})
  .use(dbPlugin)
  .use(undoPlugin);

// 3. 用 Proxy 直接讀寫 — 自動 CRDT 同步！
const state = createMapProxy<{ count: number; title: string }>(client, 'app-state');
state.count = 1;           // → 自動同步到所有連線端（保留原生 number 型別）
state.title = 'Hello Yoin';

// 4. 針對特定容器精準訂閱變更
client.subscribeMap('app-state', () => {
  console.log('State updated:', state.count, state.title);
});
```

**React**：

```tsx
import {
  YoinProvider,
  useYoinMap,
  useYoinText,
  useYoinAwareness,
  useYoinStatus,
  useYoinUndo,
} from '@yoin/client/react';

function App() {
  return (
    <YoinProvider config={{ url: 'wss://...', docId: 'my-room' }}>
      <Counter />
    </YoinProvider>
  );
}

function Counter() {
  const state = useYoinMap<{ count: number }>('app-state');
  const { text, insert, format } = useYoinText('content');
  const { states, setLocalState } = useYoinAwareness();
  const status = useYoinStatus();
  const { undo, redo } = useYoinUndo();

  return (
    <div>
      <p>狀態：{status} | 線上：{states.size} 人</p>
      <button onClick={() => { state.count = (state.count || 0) + 1; }}>
        計數：{state.count ?? 0}
      </button>
      <button onClick={undo}>復原</button>
      <button onClick={redo}>重做</button>
    </div>
  );
}
```

---

## 專案結構

```
yoin/
├── packages/
│   ├── core/               # @yoin/core — Rust CRDT 核心 (Yrs → WASM)
│   └── client/             # @yoin/client — TypeScript 微核心 SDK + React Hooks
├── docs/                   # 完整技術文件
└── tests/                  # Monorepo 整合測試
```

| 套件 | 說明 | 大小 |
|------|------|------|
| `@yoin/core` | Rust Yrs 封裝，編譯為 WebAssembly，原生支援 `yrs::Any` 與富文本 Delta | ~236 KB (WASM) |
| `@yoin/client` | TypeScript 微核心 SDK + Plugins + Proxy | ~26 KB (ESM) |
| `@yoin/client/react` | React 18 Hooks（`useYoinMap`、`useYoinArray`、`useYoinText` 等） | ~3.5 KB (ESM) |

---

## 架構總覽

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│            React Hooks  /  Proxy  /  Direct API          │
├─────────────────────────────────────────────────────────┤
│                  @yoin/client (TS SDK)                    │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌────────────┐  │
│  │YoinClient │ │ Network  │ │ Storage │ │  Plugins   │  │
│  │ (微核心)   │ │(WebSocket│ │(Indexed │ │ (DB/Undo/  │  │
│  │           │ │ +重連佇列)│ │  DB)    │ │  Logger)   │  │
│  └─────┬─────┘ └────┬─────┘ └─────────┘ └────────────┘  │
├────────┼────────────┼───────────────────────────────────┤
│        ▼            ▼                                    │
│  ┌───────────┐ ┌──────────────────────────────────────┐  │
│  │@yoin/core │ │        Relay Server / Worker         │  │
│  │(Rust WASM)│ │ (Cloudflare DO / Node.js WS Relay)   │  │
│  └───────────┘ └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 常用指令

```bash
# 開發與建置
pnpm build              # 完整建置（WASM → SDK）
pnpm build:wasm         # 僅建置 Rust → WASM
pnpm build:client       # 僅建置 Client SDK

# 測試與檢查
pnpm test               # 執行所有測試（Unit + Real WASM + Integration）
pnpm test:unit          # 單元測試與真實 WASM 整合測試（Vitest，123 項）
pnpm test:integration   # Monorepo 結構測試（54 項）
pnpm test:coverage      # 測試覆蓋率報告
pnpm typecheck          # TypeScript 型別檢查
```

---

## 文件導覽

| 文件 | 內容 |
|------|------|
| **[新手 Demo 指南](BEGINNER_DEMO_GUIDE.md)** | 零基礎手把手教學，建立雙分頁即時同步便利貼應用 |
| **[API 新手教學](docs/API_TUTORIAL._zh_Hant.md)** | 基於 v0.1.2 實測驗證的完整功能與範例教學 |
| **[API 參考手冊](docs/API.md)** | 所有公開類別、函式、型別、Hooks、插件的完整簽名與範例 |
| **[架構設計文件](docs/ARCHITECTURE.md)** | 系統分層、CRDT 資料流、三向交握協議、微核心設計理念 |
| **[開發與貢獻指南](docs/CONTRIBUTING.md)** | 環境建置、開發工作流程、測試撰寫、提交規範 |
| **[更新日誌](CHANGELOG.md)** | 版本發布紀錄與破壞性變更說明 |

---

## 技術棧

| 層級 | 技術 |
|------|------|
| **CRDT 核心** | Rust, [Yrs](https://docs.rs/yrs) 0.18, wasm-bindgen |
| **Client SDK** | TypeScript (strict), tsup (ESM + CJS), Zod |
| **前端整合** | React 18 (`useSyncExternalStore`), JavaScript Proxy |
| **離線儲存** | IndexedDB (`StorageAdapter` 連線快取) |
| **測試框架** | Vitest, happy-dom, 真實 WASM 整合測試 |
| **Monorepo** | pnpm workspace |

---

## 授權

MIT
