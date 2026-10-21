# 09 — Prioritized Action Plan

## 1. 發布前必須修復

### 本次修復狀態（2026-10-19）

| ID | 狀態 | 已完成內容 | 未完成邊界 |
|---|---|---|---|
| YOIN-001 | Client 已修復 | 斷線事件會回收 in-flight 訊息，重連後重送；加入 close-during-send 回歸測試 | relay ACK、durable queue 與跨頁面 crash recovery 仍需部署端協定/整合測試 |
| YOIN-002 | 已修復 | DB restore 成為 save 前置條件；auto-save 錯誤可觀測；`forceSave` 與 async `destroy` 會等待 pending persistence | 真實 IndexedDB failure/delayed-load integration test 仍待補 |
| YOIN-003 | 未修復（部署端） | 文件明確標示目前是 public blind relay，不可承載受保護文件 | 本 repository 沒有 `yoin-worker` 原始碼；token ACL、訊息驗證、rate/connection limits 需在 Worker repository 完成 |
| YOIN-004 | Client/core 已修復 | undo/redo 使用完整 local update hooks；undo scope 涵蓋 map/text/array；array plugin 自動擴 scope | 真實 WASM + reload/multi-client convergence test 仍待補 |

| 順序 | ID | 行動與預期改善 | 範圍/相依 | 風險與回歸測試 |
|---|---|---|---|---|
| 1 | YOIN-003 | 決定 public 或 protected room；protected 時加 token ACL、protocol validation、message/connection limits | Worker、文件；需先定產品安全模型 | 防止跨使用者讀寫；本地 unauthorized/unknown/high-rate tests |
| 2 | YOIN-001 | 建立 update ACK 或可靠重送 pending set，定義 duplicate/queue/backpressure | network + protocol + Worker ACK | 可能增加流量；close-after-send、duplicate、reconnect tests |
| 3 | YOIN-002 | restore ready、write ordering、destroy flush、persist error surface | DB plugin、client lifecycle、storage tests | 避免關閉時資料遺失；delayed IDB tests |
| 4 | YOIN-004 | undo/redo 走統一 update pipeline，補足 array/text scope | core/plugin/client | 需確認 Yrs UndoManager semantics；multi-client + reload tests |
| 5 | YOIN-007 | pin wasm-pack/CI，建立 clean package smoke test，統一版本 | root CI、package manifests、release docs | build pipeline 變動；fresh checkout verification |

## 2. 近期應完成

| ID | 預期改善 | 建議修改範圍 | 相依/回歸 |
|---|---|---|---|
| YOIN-005 | 降低 Proxy 假成功與 stale snapshot | proxy contract、delete/iteration/unsupported guards | 依 API 決策；proxy semantic suite |
| YOIN-006 | plugin 失敗可回滾且 cleanup 可等待 | plugin interface/client.use/destroy | lifecycle state tests |
| YOIN-009 | 文件與 runtime type 一致 | API docs、examples、typecheck snippets | docs CI |

## 3. 中期架構改善

1. 將 `YoinClient` 的 protocol/session、awareness、persistence coordination 分離，但只在測試顯示目前邊界無法維護時進行。
2. 增加真實 browser IndexedDB、WASM、WebSocket relay、Yjs interoperability、multi-client convergence 測試。
3. 若需要 all-clients-offline recovery，為 server/DO 增加持久 snapshot 或明確改用外部 persistence。

## 4. 暫時不值得投入

- 為了抽象美觀而全面重寫 micro-kernel。
- 在沒有量測前優化 JSON serialization、WASM size 或 relay placement。
- 要求 Proxy 支援所有 JavaScript 原生物件語意；應先決定最小明確 contract。
- 將 awareness 的 transient protocol 改成 CRDT persistence；目前分離方向合理。

---

## 5. Phase 1 (YoinSpace 2.0) ����{�p��s (2026-10-21)

- **YOIN-001 (ACK �P�i�a���e)**�G�w�b Phase 1 (Y-04) �z�L Protocol v2 MSG_UPDATE_ACK (17)�B�Ǹ��l�ܡBpendingUpdates �P synced ���A���������C
- **YOIN-003 (�w���ҫ��P�ж��v��)**�G�[�c�M�� (D1 B��A) �M�w�� Rust �v�¦��A�� (yoin-sync-server) ��s�u���ⶥ�q�z�L Ticket / JWT ���ҡA�åH MSG_HELLO (16) �мg�����P��Ū�v���C
- **YOIN-004 (Undo/Redo)**�GWASM expand_undo_scope_for �P�Ȥ�ݴ�����e�� Undo �w��X�C
- **YOIN-005 (Proxy Contract)**�G�w�b Y-10 ���T��w�ާ@�����A�ù諾�����޽�ȻP���䴩����k�ߥX TypeError�C
- **YOIN-006 (Plugin �ͩR�g��)**�G�w�b Y-11 ��@ onInstall ���Ѧ۰ʦ^�u�P destroy() �D�P�B�`�ǵ��ݡC
- **YOIN-007 (�����Τ@�P Repo ��z)**�G�w�b Y-09 ���� repo ���Ҧ� *.tgz�A�P�B root/core/client �� 0.1.2�A�é� integrity test ���j�����ҡC
- **YOIN-009 (���P���O�@�P)**�GNetworkStatus �w�ɻ� 'synced' �P 'failed'�Adocs/API.md �P docs/ARCHITECTURE.md �w�����P�B�C
