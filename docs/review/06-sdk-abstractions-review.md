# 06 — SDK Abstractions Review

## Proxy

主要問題已列於 YOIN-005。Map/Array proxy 的測試只檢查建立、簡單 set/push 和 warning，沒有覆蓋 remote refresh、nested object、delete、iteration、serialization、push return 或 failure。

## React

- [`react/index.tsx:43-75`](../../packages/client/src/react/index.tsx) 的 map/array hooks 使用 `useSyncExternalStore`，remote update 會透過 `notifyListeners` 觸發，方向合理。
- `getServerSnapshot` 未提供；SSR 使用需明確限制或補 server snapshot。
- `useYoinStatus` 以 `window.addEventListener` 為主，未提供 SSR guard；在 server render/import 之外的使用情境可能不相容。
- `YoinProvider` 不負責 destroy，這是合理的 ownership 選擇，但文件應明確說 client 由誰管理。
- `subscribeNetwork` 無 unsubscribe，狀態 hook 目前也不是直接使用 network status callback。

## Plugin

- install/destroy contract 缺少 async、dependency、failure rollback；見 YOIN-006。
- DB plugin 同時使用 `onDocUpdate` 和 `onAfterUpdate` 來 debounce，功能上會清除前一個 timer，但屬重複事件來源，增加順序複雜度。
- Undo plugin 以 `(client as any)` monkey-patch 公開方法，型別與多次安裝/多 plugin instance 的行為未定義。

## 建議最小測試集合

1. Strict Mode mount/unmount/mount。
2. Provider client 切換時舊 client 不再觸發 render。
3. SSR `useYoinMap`/`useYoinStatus` 的明確預期。
4. plugin install throw、destroy twice、async persistence。
5. multiple subscribers unsubscribe 後 listener count。

