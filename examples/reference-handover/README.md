# Yoin 協作交班板（外部 Consumer）

這是一個刻意**不加入 pnpm workspace** 的 Vite + React 專案。它只從
`../../packages/client/yoin-client-0.1.2.tgz` 安裝已封裝的 `@yoin/client`，用來驗證
Yoin 能被另一個專案使用，而不是剛好在 monorepo 內可執行。

`vite.config.ts` 同時設定 `build.target: 'esnext'`，因為 Yoin 的 WASM Vite
整合使用 top-level await；這是外部 Vite 專案需要保留的設定。

## 使用方式

在專案根目錄先產生最新套件封裝：

```powershell
pnpm --filter @yoin/client build
Push-Location packages/client
npm pack
Pop-Location
```

再安裝並啟動這個獨立專案：

```powershell
Set-Location examples/reference-handover
npm install
$env:VITE_YOIN_WORKER_URL = 'ws://localhost:8080'
npm run dev
```

另一個 PowerShell 視窗可啟動本機 relay：

```powershell
Set-Location server
npm install
node server.js
```

開啟兩個 `http://localhost:5173/?room=morning-handover` 視窗，輸入不同名稱並更新狀態或新增事件，即可檢查同步。斷開 relay 後繼續輸入，再啟動 relay 並按「重新連線」，即可觀察離線佇列與 CRDT 收斂。

## 驗證範圍

- `handover` Map：共同狀態與交班摘要
- `events` Array：不可變事件時間線
- Awareness：在線成員
- IndexedDB：同一瀏覽器重整後還原
- Undo / Redo：復原本機 CRDT 操作
- `@yoin/client/vite`：從已封裝套件載入 Vite/WASM 設定

> 這個範例不處理身份驗證或資料庫備份；production 使用前仍應在 Worker 前加上授權與持久化策略。
