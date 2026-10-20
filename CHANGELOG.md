# Changelog

All notable changes to the **Yoin** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.2] - 2026-10-21

### Added
- **Rich Text Delta & Multi-Text Support (`@yoin/core`, `@yoin/client`)**:
  - Added `insert_text_with_attrs`, `format_text`, `apply_text_delta`, and `get_text_delta` in Rust WASM (`YoinDoc`).
  - Added `formatText(index, length, attributes, textName?)`, `applyTextDelta(ops, textName?)`, and `getTextDelta(textName?)` on `YoinClient`, plus exported `TextDeltaOp` interface (Quill-compatible `[{ insert, attributes }]`).
  - Extended `insertText`, `deleteText`, `clearText`, and `getText` with an optional `textName` parameter (defaults to `'content'`) for multiple independent rich-text containers per document.
- **Full Map & Array CRUD Operations (`@yoin/core`, `@yoin/client`)**:
  - Added `deleteMap(mapName, key)` (and alias `deleteMapKey`), `hasMapKey(mapName, key)`.
  - Added `insertArray(arrayName, index, item)`, `deleteArray(arrayName, index, length?)`, and `moveArray(arrayName, fromIndex, toIndex)`.
  - Added `expand_undo_scope_for(container_type, name)` in Rust WASM so Undo/Redo tracks Map, Array, and Text containers dynamically.
- **Container-Scoped Subscriptions (`@yoin/client`)**:
  - Added `subscribeMap(mapName, listener)`, `subscribeArray(arrayName, listener)`, and `subscribeText(textName, listener)` to isolate UI re-renders by container.
- **Server Snapshot Hydration & Sync Control (`@yoin/client`)**:
  - Added `applySnapshot(snapshot: Uint8Array)`, `exportSnapshot(): Uint8Array`, and `syncWithPeers()`.
  - Added `BroadcastOptions { transient?: boolean }`, `getQueueLength()`, and `clearQueue()` on `NetworkManager`.
- **React Hooks (`@yoin/client/react`)**:
  - Added `useYoinText(textName?)` hook returning `{ text, delta, insert, deleteText, format, applyDelta, clear }`.
- **Real WASM Integration Test Suite**:
  - Added `packages/client/src/__tests__/real-wasm.test.ts` testing compiled `core_bg.wasm` binary directly (native type fidelity, CRUD, rich-text deltas, two-peer sync, and undo/redo).

### Changed
- **Native Type Fidelity in Rust WASM (`@yoin/core`)**:
  - Replaced stringified JSON coercion (`JSON.parse` / `serde_json::from_str`) with recursive `js_to_any(&JsValue) -> yrs::Any` conversion across `map_set`, `map_set_deep`, `batch_set`, `array_push`, and `array_insert`. Strings like `"123"` or `"true"` are no longer coerced into numbers or booleans.
  - Upgraded `map_set_deep` to accept any `JsValue` (strings, booleans, objects, arrays, numbers) rather than only `f64`.
- **Enhanced JavaScript Proxies (`@yoin/client`)**:
  - `createMapProxy` now returns `undefined` for missing keys, preserves native types, and supports `delete proxy.key`, `'key' in proxy`, `Object.keys(proxy)`, and deep nested object proxies.
  - `createArrayProxy` now reads live state on every trap and supports mutating methods `.push()`, `.splice()`, `.pop()`, `.shift()`, and `.unshift()`.
- **React Hook Subscriptions (`@yoin/client/react`)**:
  - `useYoinMap` and `useYoinArray` now subscribe via `subscribeMap` and `subscribeArray` and re-memoize their proxy reference whenever the underlying snapshot updates.
  - `useYoinStatus` now uses `client.subscribeNetwork(cb)` (which returns an unsubscribe function) instead of overwriting `network.onStatusChange`.

### Fixed
- **Broadcast Storm Suppression**: Added `hasNonEmptyUpdate()` check during `MSG_SYNC_STEP_1` and `MSG_SYNC_STEP_1_REPLY` handling to prevent broadcasting empty `[0, 0]` diff packets across N-peer rooms.
- **Transient Offline Queueing**: Awareness, heartbeat, and handshake packets now pass `{ transient: true }` so they do not bloat the offline message queue while disconnected.
- **IndexedDB Persistence & Sync**: Cached `IDBDatabase` connection in `StorageAdapter` (with `close()` cleanup), removed duplicate `onAfterUpdate` save scheduling in `YoinDbPlugin`, and triggered `syncWithPeers()` after `loadFromDisk()` if already connected.
- **Zod Validation in `batchSet`**: `batchSet` now validates all entries against configured Zod schemas before committing the transaction.
- **WASM Memory Cleanup**: `client.destroy()` now invokes `this.doc.free?.()` to release linear WASM memory.
- **Package Dependency Hygiene**: Moved `vite`, `vite-plugin-wasm`, and `vite-plugin-top-level-await` from `dependencies` to optional `peerDependencies` and `devDependencies` in `@yoin/client`.

---

## [0.1.0] - 2026-02-15

### Added
- Initial release of `@yoin/core` (Rust Yrs WASM wrapper) and `@yoin/client` (TypeScript micro-kernel SDK).
- Basic Text, Map, and Array CRDT operations, Awareness protocol, IndexedDB persistence (`YoinDbPlugin`), Undo/Redo (`YoinUndoPlugin`), Proxy wrappers, and React 18 Hooks.
