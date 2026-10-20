[繁體中文](API.md) | [English](API_en.md)

# Yoin API Reference

> Version: `@yoin/client` v0.1.2

## Table of Contents

- [Initialization](#initialization)
  - [`initYoin(wasmInput?)`](#inityoinwasminput)
  - [`isYoinInitialized()`](#isyoininitialized)
- [YoinClient Core Class](#yoinclient-core-class)
  - [Constructor & Configuration](#constructor--configuration)
  - [Text API (Rich Text & Multi-Text Containers)](#text-api-rich-text--multi-text-containers)
  - [Map API (Full CRUD & Native Type Fidelity)](#map-api-full-crud--native-type-fidelity)
  - [Array API (Push / Insert / Delete / Move)](#array-api-push--insert--delete--move)
  - [Container-Scoped Subscriptions & Lifecycle](#container-scoped-subscriptions--lifecycle)
  - [Server Snapshot Hydration & Sync Control](#server-snapshot-hydration--sync-control)
  - [Hook API (For Plugin System)](#hook-api-for-plugin-system)
  - [Awareness API](#awareness-api)
  - [Accessors & Utility Methods](#accessors--utility-methods)
- [Transparent Proxy Read/Write](#transparent-proxy-readwrite)
  - [`createMapProxy<T>(client, mapName)`](#createmapproxytclient-mapname)
  - [`createArrayProxy<T>(client, arrayName)`](#createarrayproxytclient-arrayname)
- [Plugin System](#plugin-system)
  - [`YoinPlugin` Interface](#yoinplugin-interface)
  - [`createDbPlugin(options)` — IndexedDB Persistence](#createdbpluginoptions--indexeddb-persistence)
  - [`createUndoPlugin()` — Undo/Redo](#createundoplugin--undoredo)
  - [`createLoggerPlugin(prefix?)` — Debug Logging](#createloggerpluginprefix--debug-logging)
  - [Custom Plugin Example](#custom-plugin-example)
- [React Hooks (`@yoin/client/react`)](#react-hooks-yoinclientreact)
  - [`<YoinProvider>`](#yoinprovider)
  - [`useYoinClient()`](#useyoinclient)
  - [`useYoinMap<T>(mapName)`](#useyoinmaptmapname)
  - [`useYoinArray<T>(arrayName)`](#useyoinarraytarrayname)
  - [`useYoinText(textName?)`](#useyointexttextname)
  - [`useYoinAwareness()`](#useyoinawareness)
  - [`useYoinStatus()`](#useyoinstatus)
  - [`useYoinUndo()`](#useyoinundo)
- [Low-Level Modules](#low-level-modules)
  - [`NetworkManager`](#networkmanager)
  - [`StorageAdapter`](#storageadapter)
- [Schema Validation (Zod Integration)](#schema-validation-zod-integration)
- [Type Definitions](#type-definitions)
- [Communication Protocol](#communication-protocol)

---

## Initialization

Before using any Yoin features, the underlying Rust WebAssembly engine must be loaded and initialized.

### `initYoin(wasmInput?)`

```typescript
function initYoin(wasmInput?: unknown): Promise<void>
```

Loads and initializes Yoin's WASM CRDT engine. Only needs to be called once globally; subsequent or concurrent calls are idempotent and share the same initialization promise.

### `isYoinInitialized()`

```typescript
function isYoinInitialized(): boolean
```

Checks whether the WASM engine has finished initializing.

---

## YoinClient Core Class

`YoinClient` is Yoin's micro-kernel, responsible for managing CRDT document instances, WebSocket network communication, Awareness presence states, and plugin lifecycles.

### Constructor & Configuration

```typescript
const client = new YoinClient(config: YoinConfig)
```

> **Note**: `await initYoin()` must be completed before constructing `YoinClient`, otherwise an error will be thrown.

**`YoinConfig` Interface**:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | WebSocket server base URL (e.g., `'wss://yoin-worker.example.workers.dev'` or `'ws://localhost:8080'`) |
| `docId` | `string` | Yes | — | Unique document/room identifier. Final connection URL is `${url}/${docId}` |
| `dbName` | `string` | No | — | IndexedDB database name (used with `createDbPlugin`) |
| `awarenessThrottleMs` | `number` | No | `30` | Awareness broadcast throttle interval (ms), default ~33fps |
| `heartbeatIntervalMs` | `number` | No | `5000` | Awareness heartbeat broadcast interval (ms) |
| `heartbeatTimeoutMs` | `number` | No | `30000` | Timeout (ms) before an unresponsive remote client is considered offline |
| `schemas` | `Record<string, z.ZodTypeAny>` | No | — | Zod schema definitions for automatic pre-write validation |

---

### Text API (Rich Text & Multi-Text Containers)

Supports multiple named text containers within a single document (defaulting to `'content'`), as well as Quill / Tiptap-compatible rich-text formatting attributes and Delta operations.

#### `insertText(index, text, attributes?, textName?)`

```typescript
async insertText(
  index: number,
  text: string,
  attributes?: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

Inserts `text` at `index` in the specified `textName` container, optionally with formatting `attributes` (e.g. `{ bold: true, color: '#ff0000' }`).

#### `deleteText(index, length, textName?)`

```typescript
async deleteText(
  index: number,
  length: number,
  textName: string = 'content'
): Promise<void>
```

Deletes `length` characters starting at `index` in the specified `textName` container.

#### `formatText(index, length, attributes, textName?)`

```typescript
async formatText(
  index: number,
  length: number,
  attributes: Record<string, any>,
  textName: string = 'content'
): Promise<void>
```

Applies formatting `attributes` (e.g. `{ italic: true, bold: null }`) to the range `[index, index + length)` in `textName`.

#### `applyTextDelta(ops, textName?)`

```typescript
async applyTextDelta(
  ops: TextDeltaOp[],
  textName: string = 'content'
): Promise<void>
```

Applies a Quill-compatible Delta array (`insert`, `retain`, `delete`, with optional `attributes`) to `textName` in a single CRDT transaction.

```typescript
await client.applyTextDelta(
  [
    { insert: 'Hello ', attributes: { bold: true } },
    { insert: 'World\n' },
  ],
  'article'
);
```

#### `clearText(textName?)`

```typescript
async clearText(textName: string = 'content'): Promise<void>
```

Clears all text content in `textName`.

#### `getText(textName?)`

```typescript
getText(textName: string = 'content'): string
```

Returns the current plain-text string of `textName`.

#### `getTextDelta(textName?)`

```typescript
getTextDelta(textName: string = 'content'): TextDeltaOp[]
```

Returns the current rich-text Delta array (`Array<{ insert: string, attributes?: Record<string, any> }>`) of `textName`.

---

### Map API (Full CRUD & Native Type Fidelity)

Operates on named CRDT Maps (key-value structures). Backed by native `yrs::Any` conversion in Rust WASM, **preserving exact JavaScript types (`string`, `number`, `boolean`, `null`, nested `Array` and `Object`) without coercing `"123"` into `123` or `"true"` into `true`**.

#### `setMap(mapName, key, value)`

```typescript
async setMap(mapName: string, key: string, value: any): Promise<void>
```

Sets the value of `key` in the Map named `mapName`. Automatically validates if a corresponding Zod schema is configured.

#### `deleteMap(mapName, key)` / `deleteMapKey(mapName, key)`

```typescript
async deleteMap(mapName: string, key: string): Promise<void>
async deleteMapKey(mapName: string, key: string): Promise<void>
```

Removes `key` from the Map named `mapName` and broadcasts the deletion to all peers. `deleteMapKey` is an alias for `deleteMap`.

#### `hasMapKey(mapName, key)`

```typescript
hasMapKey(mapName: string, key: string): boolean
```

Returns `true` if `key` exists in `mapName`.

#### `getMap(mapName)`

```typescript
getMap(mapName: string): Record<string, any>
```

Gets all key-value pairs from the Map named `mapName` as a plain JavaScript object.

#### `setMapDeep(mapName, path, value)`

```typescript
setMapDeep(mapName: string, path: string[], value: any): void
```

Sets any JavaScript `value` (number, string, boolean, object, array, or `null`) deeply along `path` in a nested Map structure. Missing intermediate `MapPrelim` levels are automatically created.

```typescript
client.setMapDeep('canvas', ['node_1', 'position', 'x'], 150);
client.setMapDeep('canvas', ['node_1', 'label'], 'Hero Card');
```

#### `batchSet(entries)`

```typescript
batchSet(entries: Array<[string, string, any]>): void
```

Writes multiple Map entries in a **single CRDT transaction**, producing only one diff and one network broadcast. Validates all entries against configured Zod schemas prior to committing.

---

### Array API (Push / Insert / Delete / Move)

Operates on named CRDT Arrays (ordered list structures).

#### `pushArray(arrayName, item)`

```typescript
async pushArray(arrayName: string, item: any): Promise<void>
```

Pushes `item` to the end of the Array named `arrayName`. Validates against configured Zod schemas.

#### `insertArray(arrayName, index, item)`

```typescript
async insertArray(arrayName: string, index: number, item: any): Promise<void>
```

Inserts `item` at `index` in the Array named `arrayName`. Validates against configured Zod schemas.

#### `deleteArray(arrayName, index, length?)`

```typescript
async deleteArray(arrayName: string, index: number, length: number = 1): Promise<void>
```

Deletes `length` elements starting at `index` from the Array named `arrayName`.

#### `moveArray(arrayName, fromIndex, toIndex)`

```typescript
async moveArray(arrayName: string, fromIndex: number, toIndex: number): Promise<void>
```

Moves the element at `fromIndex` to `toIndex` within `arrayName` (ideal for z-index layer ordering or Kanban card reordering).

#### `getArray(arrayName)`

```typescript
getArray(arrayName: string): any[]
```

Gets all elements from the Array named `arrayName`.

---

### Container-Scoped Subscriptions & Lifecycle

#### `subscribeMap(mapName, listener)`

```typescript
subscribeMap(mapName: string, listener: () => void): () => void
```

Subscribes specifically to changes on the `mapName` container. Local mutations to other containers will **not** trigger this listener. Immediately invokes `listener` once upon subscription and returns an unsubscribe function.

#### `subscribeArray(arrayName, listener)`

```typescript
subscribeArray(arrayName: string, listener: () => void): () => void
```

Subscribes specifically to changes on the `arrayName` container. Immediately invokes `listener` once upon subscription and returns an unsubscribe function.

#### `subscribeText(textName, listener)`

```typescript
subscribeText(textName: string, listener: (text: string) => void): () => void
```

Subscribes specifically to changes on the `textName` container, passing the container's current plain text. Immediately invokes `listener` once upon subscription and returns an unsubscribe function.

#### `subscribe(listener)`

```typescript
subscribe(listener: (text: string) => void): () => void
```

Global subscription triggered on any local or remote document update.

#### `subscribeNetwork(cb)`

```typescript
subscribeNetwork(cb: (status: NetworkStatus) => void): () => void
```

Subscribes to network status changes (`'connecting' | 'online' | 'offline' | 'failed'`). Supports multiple concurrent listeners, fires immediately with the current status, and returns an unsubscribe function.

#### `use(plugin)`

```typescript
use(plugin: YoinPlugin): this
```

Mounts a plugin onto the client. Supports method chaining and prevents duplicate installation of the same plugin instance.

#### `destroy()`

```typescript
destroy(): void
```

Destroys the client instance and releases all resources:
1. Clears heartbeat and garbage collection timers
2. Calls `onDestroy()` on all installed plugins (including closing cached IndexedDB connections)
3. Broadcasts offline Awareness and disconnects the WebSocket
4. Clears all listeners and message queues
5. Calls `this.doc.free?.()` to release underlying Rust WASM linear memory

---

### Server Snapshot Hydration & Sync Control

#### `exportSnapshot()`

```typescript
exportSnapshot(): Uint8Array
```

Exports the full binary CRDT state snapshot of the document (ready to store in PostgreSQL, S3, or Durable Object storage).

#### `applySnapshot(snapshot)`

```typescript
applySnapshot(snapshot: Uint8Array): void
```

Applies a binary CRDT snapshot (e.g., preloaded from a server endpoint) to the document and notifies all container and global subscribers.

#### `syncWithPeers()`

```typescript
syncWithPeers(): void
```

Actively broadcasts `MSG_SYNC_STEP_1` (State Vector) to synchronize diffs with connected peers (automatically called after IndexedDB hydration completes while online).

---

### Hook API (For Plugin System)

#### `onDocUpdate(cb)`

```typescript
onDocUpdate(cb: (update: Uint8Array) => void): () => void
```

Registers a callback invoked after **any update** (local or remote). Returns an unregister function.

#### `onLocalUpdate(cb)`

```typescript
onLocalUpdate(cb: (update: Uint8Array) => void): () => void
```

Registers a callback invoked **only on local mutations**. Returns an unregister function.

---

### Awareness API

Awareness transmits **ephemeral user presence information** (cursor coordinates, selection, name, color, etc.) without writing to CRDT history. Awareness broadcasts use `{ transient: true }` so they are never queued while offline.

- `setAwareness(state: AwarenessPartial): void`
- `onAwarenessChange(cb: AwarenessCallback): () => void`
- `getAwarenessStates(): Map<string, AwarenessState>`
- `leaveAwareness(): void`
- `bindCursorTracking(container: HTMLElement, renderer: CursorRenderer): () => void`

---

### Accessors & Utility Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getDoc()` | `YoinDoc` | Gets the underlying WASM `YoinDoc` instance |
| `getConfig()` | `YoinConfig` | Gets the configuration object passed at construction |
| `getClientId()` | `string` | Gets this client's random 8-character identifier |

---

## Transparent Proxy Read/Write

### `createMapProxy<T>(client, mapName)`

```typescript
function createMapProxy<T extends Record<string, any>>(
  client: YoinClient,
  mapName: string
): T
```

Creates a transparent Proxy bound to a CRDT Map:
- **Property read (`proxy.key`)**: Reads live from `client.getMap(mapName)`; returns `undefined` for missing keys. Nested plain objects return a deep proxy.
- **Property write (`proxy.key = val` / `proxy.a.b = val`)**: Calls `client.setMap` at top level and `client.setMapDeep` for nested paths.
- **Property deletion (`delete proxy.key`)**: Calls `client.deleteMap(mapName, key)`.
- **Key inspection (`'key' in proxy` / `Object.keys(proxy)`)**: Reflects current keys in the CRDT Map.

### `createArrayProxy<T>(client, arrayName)`

```typescript
function createArrayProxy<T>(
  client: YoinClient,
  arrayName: string
): T[]
```

Creates a transparent Proxy bound to a CRDT Array. Every property access reads live from `client.getArray(arrayName)` and supports mutating methods `.push()`, `.splice()`, `.pop()`, `.shift()`, and `.unshift()`.

---

## Plugin System

### `YoinPlugin` Interface

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

### `createDbPlugin(options)` — IndexedDB Persistence

```typescript
function createDbPlugin(options: YoinDbPluginOptions): {
  plugin: YoinDbPlugin;
  forceSave: () => Promise<void>;
}
```

Automatically persists CRDT document snapshots to browser IndexedDB using a cached `IDBDatabase` connection, debounces writes on updates, and calls `client.syncWithPeers()` after loading from disk if already online.

### `createUndoPlugin()` — Undo/Redo

```typescript
function createUndoPlugin(): {
  plugin: YoinUndoPlugin;
  undo: () => void;
  redo: () => void;
}
```

Built on Yrs's `UndoManager`. Automatically expands its tracking scope whenever any Map (`setMap`, `deleteMap`, `setMapDeep`, `batchSet`), Array (`pushArray`, `insertArray`, `deleteArray`, `moveArray`), or named Text container is mutated locally.

### `createLoggerPlugin(prefix?)` — Debug Logging

```typescript
function createLoggerPlugin(prefix?: string): YoinPlugin
```

### Custom Plugin Example

```typescript
import type { YoinPlugin } from '@yoin/client';

const analyticsPlugin: YoinPlugin = {
  name: 'analytics-plugin',
  onInstall(client) {
    console.log(`Analytics mounted for doc: ${client.getConfig().docId}`);
  },
  onAfterUpdate(update) {
    navigator.sendBeacon('/api/metrics', JSON.stringify({ bytes: update.byteLength }));
  },
};
```

---

## React Hooks (`@yoin/client/react`)

Imported from `@yoin/client/react`. Built on React 18's `useSyncExternalStore` with container-scoped subscriptions.

### `<YoinProvider>`

```tsx
function YoinProvider(props: {
  config: YoinConfig;
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element
```

### `useYoinClient()`

```typescript
function useYoinClient(): YoinClient
```

### `useYoinMap<T>(mapName)`

```typescript
function useYoinMap<T extends Record<string, any>>(mapName: string): T
```

Returns a reactive Proxy object bound to `mapName` via `client.subscribeMap(mapName, ...)`, re-memoizing the proxy reference whenever the snapshot changes.

### `useYoinArray<T>(arrayName)`

```typescript
function useYoinArray<T = any>(arrayName: string): T[]
```

Returns a reactive Proxy array bound to `arrayName` via `client.subscribeArray(arrayName, ...)`.

### `useYoinText(textName?)`

```typescript
function useYoinText(textName: string = 'content'): {
  text: string;
  delta: TextDeltaOp[];
  insert: (index: number, content: string, attributes?: Record<string, any>) => Promise<void>;
  deleteText: (index: number, length: number) => Promise<void>;
  format: (index: number, length: number, attributes: Record<string, any>) => Promise<void>;
  applyDelta: (ops: TextDeltaOp[]) => Promise<void>;
  clear: () => Promise<void>;
}
```

Subscribes to and mutates a named CRDT text container (defaults to `'content'`).

### `useYoinAwareness()`

```typescript
function useYoinAwareness(): {
  states: Map<string, AwarenessState>;
  setLocalState: (state: AwarenessPartial) => void;
}
```

### `useYoinStatus()`

```typescript
function useYoinStatus(): NetworkStatus
```

Subscribes to the WebSocket connection status via `client.subscribeNetwork`.

### `useYoinUndo()`

```typescript
function useYoinUndo(): {
  undo: () => void;
  redo: () => void;
}
```

---

## Low-Level Modules

### `NetworkManager`

```typescript
class NetworkManager {
  constructor(url: string, docId: string, onMessageCallback: (data: Uint8Array) => void);
  onStatusChange?: (status: NetworkStatus) => void;
  connect(): void;
  broadcast(data: Uint8Array, options?: BroadcastOptions): void;
  getQueueLength(): number;
  clearQueue(): void;
  disconnect(): void;
}
```

### `StorageAdapter`

```typescript
class StorageAdapter {
  constructor(dbName: string);
  saveSnapshot(docId: string, snapshotBytes: Uint8Array): Promise<void>;
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  close(): void;
}
```

---

## Schema Validation (Zod Integration)

When `YoinConfig.schemas` is provided, `setMap`, `batchSet`, `pushArray`, and `insertArray` validate data against the configured Zod schemas before writing to the CRDT document.

---

## Type Definitions

```typescript
interface TextDeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
  attributes?: Record<string, any>;
}

interface BroadcastOptions {
  transient?: boolean;
}

type NetworkStatus = 'connecting' | 'online' | 'offline' | 'failed';
```

---

## Communication Protocol

Yoin uses a 1-byte header binary protocol for WebSocket communication:

| Type | Constant | Value | Direction | Description |
|------|----------|-------|-----------|-------------|
| Sync Step 1 | `MSG_SYNC_STEP_1` | `0` | Client → Server → Client | Send State Vector to request sync |
| Sync Step 2 | `MSG_SYNC_STEP_2` | `1` | Bidirectional | Transfer non-empty CRDT Update / Diff |
| Sync Step 1 Reply | `MSG_SYNC_STEP_1_REPLY` | `2` | Client → Server → Client | Reply with State Vector |
| Awareness | `MSG_AWARENESS` | `3` | Bidirectional | Presence broadcast (JSON over binary, marked `transient`) |
| Join Room | `MSG_JOIN_ROOM` | `4` | Client → Server | Room join notification (marked `transient`) |
