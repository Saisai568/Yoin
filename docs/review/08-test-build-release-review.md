# 08 — Test、Build、Release Review

## 實際命令結果

| 命令 | 結果 | 摘要 |
|---|---|---|
| `pnpm test` | PASS (0) | 7 files / 97 tests |
| `pnpm test:coverage` | PASS (0) | 60.29% lines、47.66% branches；storage/db 未覆蓋 |
| `pnpm typecheck` | FAIL (2) | `@yoin/core` 的 `pkg-web/core.d.ts` 不存在 |
| `pnpm build` | FAIL (1) | `wasm-pack` 不在環境 |
| `pnpm test:e2e` | FAIL (1) / 未執行 | 9 tests 均缺 Playwright browser executable |
| `cargo check --manifest-path packages/core/Cargo.toml` | PASS (0) | Rust core compile check |
| `tsc --noEmit -p yoin-worker/tsconfig.json` | PASS (0) | Worker typecheck |

## 測試缺口

- 現有 client 測試大量 mock `@yoin/core` 與 WebSocket；不能證明真實 WASM。
- 沒有 storage/db tests，coverage 明確顯示 `storage.ts`、`db.ts` 0%。
- 沒有 real WebSocket/Worker integration、fault injection、multi-client convergence、Yjs fixture、browser IndexedDB test。
- Playwright config [`apps/demo/playwright.config.ts:36-74`](../../apps/demo/playwright.config.ts) 啟用三瀏覽器但未設定 `webServer`；clean environment 也未保證 browser binaries。
- collaboration spec 含有假設 selector/DOM（例如 `#btn-insert`、`#display`），即使安裝 browser 也應先確認與實際 demo 一致。

## Build/release 風險

- [`packages/client/package.json:30-37`](../../packages/client/package.json) build 依賴 `../core/pkg-web/core_bg.wasm`；clean checkout 沒有此輸出就不能 build。
- core `Cargo.toml` version 是 0.2.0，core package 0.1.2，client 0.1.2，root/README/CHANGELOG 多處 0.1.0；CHANGELOG 仍宣稱已統一版本。
- `@yoin/core` 的 package export 只提供 ESM import，client 同時宣稱 CJS output；需要 package smoke test 驗證 require/import 與 WASM asset。
- 建置需要 wasm-pack，但 root manifest 沒有工具版本 pin；CI/發布 pipeline 未見可重現的 wasm-pack setup。

### YOIN-007 — Clean checkout 的 build/release contract 不可重現

- **Severity：** P1
- **Category：** Testing / Release
- **Status：** Confirmed（本環境實際命令失敗）
- **Location：** [`package.json:7-16`](../../package.json)、[`packages/core/package.json:19-19`](../../packages/core/package.json)、[`packages/client/package.json:30-31`](../../packages/client/package.json)
- **Impact：** 未安裝 wasm-pack 或未先生成 pkg-web 時，typecheck/build/package smoke test 無法執行。
- **Recommendation：** CI pin/install wasm-pack，明確分離 `build:wasm` artifact dependency，加入 clean checkout package smoke test 和版本一致性檢查。
- **Regression test：** fresh checkout 執行 install → build → pack → temp consumer import/require。
- **Confidence：** High

