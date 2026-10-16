# Yoin 技術審查摘要

審查基準：`docs/AGENT_REVIEW_SPEC.md`；審查日期：2026-10-16。此次為只讀 review，未修改產品原始碼。

## 結論

Yoin 已有可工作的 0.x SDK 骨架：Rust/Yrs WASM 核心、TypeScript client、IndexedDB plugin、WebSocket relay、React 整合均存在，且目前 client 單元測試 97/97 通過。這些測試主要是 mock-based，尚不足以證明瀏覽器、真實 WASM、IndexedDB、Worker 或多客戶端同步的可靠性。

目前適合以「實驗性/早期 0.x」方式公開給受控使用者，不適合宣稱 production-ready 或用於未授權風險可接受度不明的私密文件。進入 1.0 前，首要工作是建立可確認 delivery/persistence 保證的測試與協定，再處理 public-room 的安全模型。

## 最值得保留的三項設計

1. `YoinDoc` 將本地交易標成 local origin、遠端套用標成 remote origin，並以 state vector + V1 diff 交換；這是合理的 Yrs 邊界。
2. Worker 以 room ID 對應 Durable Object，relay 本身不持有 CRDT 狀態，架構簡單且容易水平分區。
3. client 以 plugin、React external-store、network provider 分層，且 public API 有 unsubscribe/destroy 基本生命週期入口。

## 最重要的五項風險

| ID | 風險 | 判斷 |
|---|---|---|
| YOIN-001 | WebSocket 已送出但未確認的 update 不會重新入隊，斷線窗口可能遺失 | P1，Likely |
| YOIN-002 | DB plugin 載入與註冊 listener 非同步競爭，destroy 會清掉 pending save | P1，Confirmed/Likely |
| YOIN-003 | Worker 沒有身分驗證/授權，且訊息型別與 payload 幾乎未驗證 | P1，Confirmed；若產品刻意 public room，部分是產品限制 |
| YOIN-004 | Undo/Redo 沒有走完整 update hook，且 array scope 未自動納入；持久化/功能承諾不完整 | P1，Confirmed |
| YOIN-005 | Proxy 是 snapshot、只支援極少數操作；巢狀 object、delete、index assignment 與原生語意不一致 | P2，Confirmed |

## P0/P1 判定

未找到有直接執行證據的 P0。P1 風險如上，其中 YOIN-002、YOIN-003、YOIN-004 有直接程式碼證據；YOIN-001 的實際遺失需故障注入測試才能確認。

## 測試證據與限制

- `pnpm test`：退出碼 0，7 個 test files、97 tests 通過。
- `pnpm test:coverage`：退出碼 0，line coverage 60.29%，`storage.ts`、`db.ts` 沒有執行覆蓋。
- `cargo check --manifest-path packages/core/Cargo.toml`：退出碼 0。
- Worker `tsc --noEmit`：退出碼 0。
- `pnpm typecheck`：退出碼 2；clean workspace 沒有 `packages/core/pkg-web`，因此 client 找不到 `@yoin/core` 型別。
- `pnpm build`：退出碼 1；環境沒有 `wasm-pack`。
- `pnpm test:e2e`：退出碼 1；9 tests 均因 Playwright browser executable 未安裝而未啟動。設定也沒有啟用 `webServer`。

因此，CRDT 跨 client、真實 IndexedDB、Worker relay、重連、React render 與 package install 尚未被測試證明。

## 1.0 前工作

1. 定義 update delivery 語意（至少是可重送、冪等，最好有 server/client acknowledgement），並加入斷線故障注入測試。
2. 將 DB restore、local write、destroy、forceSave 變成可 await 的 lifecycle；persist failure 必須可觀測。
3. 明確選擇 public-room 或 authenticated-room；若支援受保護文件，於 Worker 驗證 token、room scope、payload type/size/frequency。
4. 讓所有狀態變更（含 undo/redo）通過同一個 local update pipeline，補足 array/text undo scope。
5. 加入真實 WASM + IndexedDB + WebSocket/Worker 的 integration/E2E 測試。

## 可維持現狀的部分

- Yrs 作為底層 CRDT 與 remote origin 分離的方向可保留。
- Relay 不持有文件狀態的簡化部署模型可保留，但必須在文件中明確寫出「沒有 server persistence」。
- 基本 awareness 與 React `useSyncExternalStore` 方向不需因抽象一致性而重寫；先補 SSR、unsubscribe 與 snapshot 行為測試即可。

