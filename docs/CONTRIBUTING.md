[繁體中文](CONTRIBUTING.md) | [English](CONTRIBUTING_en.md)

# 開發與貢獻指南

感謝你對 Yoin 的興趣！本文件說明如何參與開發。

## 目錄

- [環境設定](#環境設定)
- [專案結構](#專案結構)
- [開發工作流程](#開發工作流程)
- [建置指令](#建置指令)
- [測試](#測試)
- [程式碼風格](#程式碼風格)
- [Git 工作流程](#git-工作流程)
- [新增功能指南](#新增功能指南)
- [常見問題](#常見問題)

---

## 環境設定

### 必要工具

| 工具 | 版本 | 說明 |
|------|------|------|
| **Node.js** | ≥ 18 | JavaScript 執行環境 |
| **pnpm** | ≥ 9 | 套件管理器。安裝：`npm install -g pnpm` |
| **Rust** | stable | CRDT Core 編譯。安裝：[rustup.rs](https://rustup.rs/) |
| **wasm-pack / wasm-bindgen** | latest | Rust → WASM 建置。安裝：`cargo install wasm-pack` 或 `cargo install wasm-bindgen-cli` |
| **wasm32 target** | — | `rustup target add wasm32-unknown-unknown` |

### 初次設定

```bash
# 1. 複製專案
git clone <repo-url>
cd yoin

# 2. 安裝所有依賴（pnpm workspace 會自動連結各套件）
pnpm install

# 3. 建置 WASM Core（必須先執行，Client 套件依賴其產物）
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
│   │   ├── src/lib.rs      # 核心邏輯（YoinDoc、js_to_any、Rich Text Delta、UndoManager）
│   │   ├── Cargo.toml      # Rust 依賴
│   │   └── pkg-web/        # wasm-pack 產物（自動生成，勿手動編輯）
│   └── client/             # @yoin/client — TypeScript SDK
│       ├── src/
│       │   ├── YoinClient.ts    # 微核心（含容器級訂閱、快照預載、空 diff 抑制）
│       │   ├── network.ts       # WebSocket 管理與暫態離線佇列
│       │   ├── storage.ts       # IndexedDB 封裝（含連線快取）
│       │   ├── proxy.ts         # Proxy 透明讀寫（Map / Array）
│       │   ├── plugin.ts        # 插件介面
│       │   ├── plugins/         # 內建插件（db, undo）
│       │   ├── logger.ts        # Logger 插件
│       │   ├── react/           # React 18 Hooks
│       │   ├── wasm/            # WASM 載入器
│       │   └── __tests__/       # Vitest 單元測試與真實 WASM 整合測試
│       ├── tsup.config.ts       # 打包設定
│       └── vitest.config.ts     # 測試設定
├── docs/                   # 技術文件
└── tests/                  # Monorepo 結構整合測試
```

> 完整的範例應用程式（Vanilla / React Demo、API 測試沙盒）、Cloudflare Worker (`yoin-worker`) 與 Node.js Relay 伺服器 (`server`) 位於獨立的 [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) 儲存庫。

### 套件依賴關係

```
@yoin/core        ← 無內部依賴（Rust 獨立編譯）
    ↑
@yoin/client      ← 依賴 @yoin/core (workspace:*) 於建置期打包
```

建置順序必須為：**Core → Client**。

---

## 開發工作流程

### 日常開發

```bash
# 啟動 Client SDK watch 模式
cd packages/client && pnpm dev

# 如果修改了 Rust Core
pnpm build:wasm
pnpm build:client
```

### 修改不同層級時的注意事項

| 修改範圍 | 需要執行的步驟 |
|----------|----------------|
| Rust Core (`lib.rs`) | `pnpm build:wasm` → `pnpm build:client` → `pnpm test` |
| Client SDK | `pnpm build:client` → `pnpm typecheck` → `pnpm test` |
| React Hooks | 同上（包含在 Client SDK 內，匯出路徑為 `@yoin/client/react`） |

---

## 建置指令

### Root 層級指令

| 指令 | 說明 |
|------|------|
| `pnpm build` | 完整建置（WASM → SDK） |
| `pnpm build:wasm` | 僅建置 Rust Core → WASM |
| `pnpm build:client` | 僅建置 `@yoin/client` SDK |
| `pnpm typecheck` | 所有套件的 TypeScript 型別檢查 |
| `pnpm clean` | 清除所有 `dist` 與快取檔案 |

### 各套件獨立指令

```bash
# packages/core
cd packages/core
wasm-pack build --target web --out-dir pkg-web

# packages/client
cd packages/client
pnpm build          # tsup 打包
pnpm dev            # tsup watch 模式
pnpm test           # vitest 測試（123 項）
pnpm test:coverage  # vitest 測試覆蓋率報告
pnpm typecheck      # tsc --noEmit
```

---

## 測試

### 測試架構

| 類型 | 工具 | 指令 | 範圍 |
|------|------|------|------|
| 單元測試 + 真實 WASM 測試 | Vitest + happy-dom | `pnpm test:unit` | `@yoin/client` SDK 與 `@yoin/core` WASM 整合（123 項測試） |
| 整合測試 | Node.js 腳本 | `pnpm test:integration` | Monorepo 結構與建置產物驗證（54 項檢查） |
| 覆蓋率 | Vitest + v8 | `pnpm test:coverage` | `@yoin/client`（目前 ~74% statements / ~76% lines） |

### 執行測試

```bash
# 全部測試
pnpm test

# 僅單元與真實 WASM 測試
pnpm test:unit

# 僅結構整合測試
pnpm test:integration

# 覆蓋率報告
pnpm test:coverage
```

---

## 程式碼風格

### TypeScript

- 使用 `strict` 模式
- 優先使用 `interface` 而非 `type`（除非需要聯合型別）
- 函式參數使用明確型別標註
- 公開 API 加上 JSDoc 註解
- 使用 `const` 優先，避免 `var`

### Rust

- 遵循 `cargo fmt` 格式
- 所有公開 API 標註 `#[wasm_bindgen]`
- 每個寫入操作遵循 **sv_before → 操作 → encode_diff_v1** 模式，並使用 `js_to_any` 保留原生 JS 型別
- 測試使用 `#[cfg(test)]` 模組

### Commit 訊息格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增功能
fix: 修復 Bug
docs: 文件更新
refactor: 重構（不影響外部行為）
test: 新增或修改測試
chore: 建置工具、依賴更新等
perf: 效能改善
```

---

## Git 工作流程

### 提交 Pull Request

1. 從 `main` 建立功能分支：`git checkout -b feat/my-feature`
2. 開發並提交變更
3. 確保所有檢查通過：
   ```bash
   pnpm build
   pnpm typecheck
   pnpm test
   ```
4. 推送並建立 PR

---

## 新增功能指南

### 新增一個 CRDT 操作

1. **Rust Core**：在 `packages/core/src/lib.rs` 的 `YoinDoc impl` 區塊新增 `#[wasm_bindgen]` 方法
2. **重建 WASM**：`pnpm build:wasm`
3. **Client SDK**：在 `packages/client/src/YoinClient.ts` 新增公開方法，呼叫 `this.doc.xxx()` + `applyLocalUpdate(diff, () => this.notifyXxxSubscribers(name))`
4. **Undo 追蹤**：在 `packages/client/src/plugins/undo.ts` 中確認該操作有自動觸發 `expand_undo_scope_for`
5. **匯出與文件**：在 `packages/client/src/index.ts` 匯出，並同步更新 `docs/API.md` 與 `docs/API_en.md`
6. **測試**：在 `packages/client/src/__tests__/`（包含 `real-wasm.test.ts`）新增測試案例

---

## 常見問題

### Q: `pnpm build:wasm` 失敗

確認已安裝 Rust 工具鏈與 WASM target：
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Q: 修改 Rust 後 TypeScript 型別報錯

`pkg-web/core.d.ts` 是自動生成的，修改 Rust API 後需要重新建置：
```bash
pnpm build:wasm
pnpm build:client
```
