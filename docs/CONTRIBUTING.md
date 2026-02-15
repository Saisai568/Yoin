[繁體中文](CONTRIBUTING.md) | [English](CONTRIBUTING_en.md)

# 貢獻指南

感謝你對 Yoin 的興趣！這份文件說明如何參與開發。

## 目錄

- [環境準備](#環境準備)
- [專案結構](#專案結構)
- [開發流程](#開發流程)
- [建置指令](#建置指令)
- [測試](#測試)
- [程式碼規範](#程式碼規範)
- [Git 工作流程](#git-工作流程)
- [新增功能指引](#新增功能指引)
- [常見問題](#常見問題)

---

## 環境準備

### 必要工具

| 工具 | 版本 | 說明 |
|------|------|------|
| **Node.js** | ≥ 18 | JavaScript runtime |
| **pnpm** | ≥ 9 | 套件管理器。安裝：`npm install -g pnpm` |
| **Rust** | stable | CRDT Core 編譯。安裝：[rustup.rs](https://rustup.rs/) |
| **wasm-pack** | latest | Rust → WASM 建置。安裝：`cargo install wasm-pack` |
| **wasm32 target** | — | `rustup target add wasm32-unknown-unknown` |

### 可選工具

| 工具 | 用途 |
|------|------|
| **Wrangler** | Cloudflare Worker 本地開發 / 部署（已在各套件中安裝為 devDependency） |
| **Playwright** | E2E 測試。首次使用需 `pnpm exec playwright install` |

### 初始設定

```bash
# 1. Clone 專案
git clone <repo-url>
cd yoin

# 2. 安裝所有依賴（pnpm workspace 會自動連結套件）
pnpm install

# 3. 建置 WASM Core（必須先完成，其他套件依賴它）
pnpm build:wasm

# 4. 建置 Client SDK
pnpm build:client

# 5. 驗證一切正常
pnpm typecheck
pnpm test
```

---

## 專案結構

```
yoin/
├── packages/
│   ├── core/               # @yoin/core — Rust CRDT 引擎
│   │   ├── src/lib.rs      # 核心邏輯 (~300 行)
│   │   ├── Cargo.toml      # Rust 依賴
│   │   └── pkg-web/        # wasm-pack 輸出（自動生成，勿手動修改）
│   └── client/             # @yoin/client — TypeScript SDK
│       ├── src/
│       │   ├── YoinClient.ts    # 微核心
│       │   ├── network.ts       # WebSocket 管理
│       │   ├── storage.ts       # IndexedDB
│       │   ├── proxy.ts         # Proxy 透明寫入
│       │   ├── plugin.ts        # Plugin 介面
│       │   ├── plugins/         # 內建插件 (db, undo)
│       │   ├── logger.ts        # Logger 插件
│       │   ├── react/           # React Hooks
│       │   └── wasm/            # WASM 載入器
│       ├── tsup.config.ts       # 建置設定
│       └── vitest.config.ts     # 測試設定
├── yoin-worker/            # Cloudflare Worker
│   ├── src/index.ts        # Durable Objects + 路由
│   └── wrangler.jsonc      # Worker 設定
├── apps/
│   └── demo/               # 展示 Demo
│       ├── src/
│       │   ├── main.ts     # Vanilla JS Demo
│       │   ├── App.tsx     # React Demo
│       │   └── renderers.ts# 游標 / 頭像渲染
│       └── tests/          # Playwright E2E 測試
├── server/                 # Node.js 開發伺服器
├── docs/                   # 技術文件
├── tests/                  # Monorepo 整合測試
└── deploy.bat              # 一鍵部署腳本
```

### 套件依賴關係

```
@yoin/core        ← 無內部依賴（Rust 獨立編譯）
    ↑
@yoin/client      ← 依賴 @yoin/core (workspace:*)
    ↑
@yoin/demo        ← 依賴 @yoin/client, @yoin/core

yoin-worker       ← 完全獨立（無 workspace 內部依賴）
```

建置必須按此順序：**Core → Client → Demo**。

---

## 開發流程

### 日常開發

```bash
# 啟動 Demo 開發伺服器（含 HMR）
pnpm dev:demo

# 在另一個終端開啟 SDK watch 模式
cd packages/client && pnpm dev

# 如果修改了 Rust Core
pnpm build:wasm
```

### 修改不同區域的指引

| 修改範圍 | 需要做什麼 |
|---------|-----------|
| Rust Core (`lib.rs`) | `pnpm build:wasm` → `pnpm build:client` → 重啟 Demo |
| Client SDK | SDK 的 `pnpm dev` 會自動 watch。Demo 的 Vite HMR 會自動重載 |
| React Hooks | 同上（包含在 Client SDK 中） |
| Worker | `cd yoin-worker && pnpm run deploy`（或本地 `wrangler dev`） |
| Demo | `pnpm dev:demo`（Vite HMR 自動重載） |

---

## 建置指令

### 根目錄指令

| 指令 | 說明 |
|------|------|
| `pnpm build` | 完整建置（WASM → SDK → Demo） |
| `pnpm build:wasm` | 僅建置 Rust Core → WASM |
| `pnpm build:client` | 僅建置 @yoin/client SDK |
| `pnpm build:demo` | 僅建置 Demo |
| `pnpm deploy` | 完整建置 + 部署（Worker + Pages） |
| `pnpm deploy:worker` | 僅部署 Worker |
| `pnpm deploy:pages` | 建置 + 部署 Pages |
| `pnpm dev:demo` | 啟動 Demo 開發伺服器 |
| `pnpm typecheck` | 所有套件 TypeScript 型別檢查 |
| `pnpm clean` | 清除所有 dist 與快取 |

### 各套件指令

```bash
# packages/core
cd packages/core
wasm-pack build --target web --out-dir pkg-web

# packages/client
cd packages/client
pnpm build      # tsup 建置
pnpm dev        # tsup watch 模式
pnpm test       # vitest 測試
pnpm typecheck  # tsc --noEmit

# apps/demo
cd apps/demo
pnpm dev        # Vite 開發伺服器
pnpm build      # Vite 生產建置
pnpm test       # Playwright E2E

# yoin-worker
cd yoin-worker
wrangler dev    # 本地開發伺服器
pnpm run deploy # 部署到 Cloudflare
```

---

## 測試

### 測試架構

| 類型 | 工具 | 指令 | 範圍 |
|------|------|------|------|
| 單元測試 | Vitest + happy-dom | `pnpm test:unit` | @yoin/client SDK |
| 整合測試 | Node.js scripts | `pnpm test:integration` | Monorepo 結構驗證 |
| E2E 測試 | Playwright | `pnpm test:e2e` | 雙人協作流程 |
| 覆蓋率 | Vitest + v8 | `pnpm test:coverage` | @yoin/client |

### 執行測試

```bash
# 所有測試
pnpm test

# 僅單元測試
pnpm test:unit

# 僅 E2E（需先安裝瀏覽器）
pnpm exec playwright install
pnpm test:e2e

# 覆蓋率報告
pnpm test:coverage
```

### 撰寫測試

**單元測試**位於 `packages/client/` 中，使用 Vitest：

```typescript
// packages/client/src/__tests__/example.test.ts
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should work correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**E2E 測試**位於 `apps/demo/tests/`，使用 Playwright：

```typescript
// apps/demo/tests/example.spec.ts
import { test, expect } from '@playwright/test';

test('collaboration', async ({ page, context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await page1.goto('/');
  await page2.goto('/');
  // ... 測試雙人協作
});
```

---

## 程式碼規範

### TypeScript

- 使用 `strict` 模式
- 偏好 `interface` 而非 `type`（除非需要聯合型別）
- 函式參數使用明確型別標注
- 公開 API 加上 JSDoc 註解
- 偏好 `const` 聲明，避免 `var`

### Rust

- 遵循 `cargo fmt` 格式化
- 使用 `#[wasm_bindgen]` 標注所有公開 API
- 每個寫入操作遵循 **sv_before → 操作 → encode_diff** 模式
- 測試使用 `#[cfg(test)]` 模組

### 檔案命名

- TypeScript：**camelCase**（`YoinClient.ts`、`network.ts`）
- Rust：**snake_case**（`lib.rs`）
- 測試：`*.test.ts`（Vitest）、`*.spec.ts`（Playwright）

### 提交訊息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增功能
fix: 修復 Bug
docs: 文件更新
refactor: 重構（不影響功能）
test: 新增/修改測試
chore: 建置/工具變更
perf: 效能優化
```

範例：

```
feat(client): add setMapDeep for nested Map writes
fix(worker): handle WebSocket close events gracefully
docs: update API.md with new React hooks
refactor(core): simplify undo manager initialization
test(e2e): add multi-browser collaboration test
```

---

## Git 工作流程

### 分支策略

```
main           ← 穩定版本，隨時可部署
  └── feat/*   ← 功能開發分支
  └── fix/*    ← Bug 修復分支
  └── docs/*   ← 文件更新分支
```

### 提交 Pull Request

1. 從 `main` 建立功能分支：
   ```bash
   git checkout -b feat/my-feature
   ```

2. 開發並提交：
   ```bash
   git add .
   git commit -m "feat(client): add new feature"
   ```

3. 確保所有檢查通過：
   ```bash
   pnpm build
   pnpm typecheck
   pnpm test
   ```

4. 推送並建立 PR：
   ```bash
   git push origin feat/my-feature
   ```

### PR Checklist

- [ ] `pnpm build` 成功
- [ ] `pnpm typecheck` 無錯誤
- [ ] `pnpm test` 全部通過
- [ ] 公開 API 變更已更新 `API.md`
- [ ] 架構變更已更新 `ARCHITECTURE.md`
- [ ] 新增功能有對應測試

---

## 新增功能指引

### 新增 CRDT 操作

1. **Rust Core**：在 `packages/core/src/lib.rs` 的 `YoinDoc impl` 中新增 `#[wasm_bindgen]` 方法
2. **重建 WASM**：`pnpm build:wasm`
3. **Client SDK**：在 `packages/client/src/YoinClient.ts` 新增公開方法，呼叫 `this.doc.xxx()` + `applyLocalUpdate()`
4. **匯出**：在 `packages/client/src/index.ts` 匯出新型別 / 方法
5. **文件**：更新 `API.md`
6. **測試**：新增 Vitest 單元測試

### 新增 Plugin

1. 在 `packages/client/src/plugins/` 新增檔案
2. 實作 `YoinPlugin` 介面
3. 提供 `createXxxPlugin()` 工廠函式
4. 在 `packages/client/src/plugins/index.ts` 匯出
5. 在 `packages/client/src/index.ts` 匯出
6. 更新 `API.md` 文件

```typescript
// packages/client/src/plugins/my-plugin.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';

export class MyPlugin implements YoinPlugin {
  readonly name = 'my-plugin';

  onInstall(client: YoinClient): void {
    // 初始化邏輯
  }

  onAfterUpdate(update: Uint8Array): void {
    // 每次更新後的邏輯
  }

  onDestroy(): void {
    // 清理資源
  }
}

export function createMyPlugin() {
  const instance = new MyPlugin();
  return { plugin: instance };
}
```

### 新增 React Hook

1. 在 `packages/client/src/react/index.tsx` 新增 Hook
2. 使用 `useYoinClient()` 取得 client
3. 使用 `useSyncExternalStore` 建立響應式訂閱
4. 在 `packages/client/src/react/index.tsx` 匯出
5. 更新 `API.md`

### 修改 Worker

1. 修改 `yoin-worker/src/index.ts`
2. 本地測試：`cd yoin-worker && wrangler dev`
3. 部署：`pnpm deploy:worker`

> 注意：Worker 與 Client 的通訊協議常數（`MSG_SYNC_STEP_1` 等）必須保持一致。修改協議時兩邊都要更新。

---

## 常見問題

### Q: `pnpm build:wasm` 失敗

確認已安裝 Rust 工具鏈與 WASM 目標：
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Q: Client SDK 的 `@yoin/core` 找不到

確認已先建置 Core：
```bash
pnpm build:wasm
```
pnpm workspace 會自動連結 `packages/core` 作為 `@yoin/core`。

### Q: Playwright 測試失敗

確認已安裝瀏覽器：
```bash
npx playwright install
```

### Q: Worker 部署失敗

確認已登入 Cloudflare：
```bash
npx wrangler login
```

### Q: 修改 Rust 後 TypeScript 報型別錯誤

`pkg-web/core.d.ts` 由 `wasm-pack` 自動生成。修改 Rust API 後需重新建置：
```bash
pnpm build:wasm
pnpm build:client
```

### Q: 如何在本地測試完整協作流程

```bash
# 終端 1：啟動 Worker 本地模式
cd yoin-worker && wrangler dev

# 終端 2：啟動 Demo（修改 URL 指向 localhost）
pnpm dev:demo

# 開啟兩個瀏覽器分頁，即可測試即時同步
```
