[繁體中文](API.md) | [English](API_en.md)

# Yoin API Reference

> `@yoin/client` v0.1.0 — TypeScript SDK for Real-time Collaborative Applications

## Table of Contents

- [Initialization](#initialization)
- [YoinClient](#yoinclient)
  - [Constructor](#constructor)
  - [Text API](#text-api)
  - [Map API](#map-api)
  - [Array API](#array-api)
  - [Awareness API](#awareness-api)
  - [Network Status](#network-status)
  - [Plugin API](#plugin-api)
  - [Low-Level Access](#low-level-access)
  - [Lifecycle](#lifecycle)
- [Proxy Transparent Writes](#proxy-transparent-writes)
- [Plugin System](#plugin-system)
  - [Plugin Interface](#plugin-interface)
  - [IndexedDB Persistence Plugin](#indexeddb-persistence-plugin)
  - [Undo / Redo Plugin](#undo--redo-plugin)
  - [Logger Plugin](#logger-plugin)
  - [Custom Plugins](#custom-plugins)
- [React Hooks](#react-hooks)
- [Schema Validation](#schema-validation)
- [Type Definitions](#type-definitions)
- [Communication Protocol](#communication-protocol)

---

## Initialization

Before using any Yoin API, you must load the WASM engine:

```typescript
import { initYoin, isYoinInitialized } from '@yoin/client';

await initYoin();          // Load the WASM module (idempotent, initializes only once)
isYoinInitialized();       // => true
```

### `initYoin(wasmInput?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `wasmInput` | `string \| URL \| BufferSource` | Optional. Path to the WASM file or binary content. Automatically resolved by the bundler when omitted |

**Returns**: `Promise<void>`

> In Vite projects with `vite-plugin-wasm`, the WASM file is resolved automatically — no manual path needed.

### `isYoinInitialized()`

**Returns**: `boolean` — Whether the WASM engine is ready.

---

## YoinClient

The core class of the SDK. Manages the CRDT document, WebSocket connection, Awareness, and plugin system.

### Constructor

```typescript
import { YoinClient } from '@yoin/client';

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'my-document',
  dbName: 'my-app',
  awarenessThrottleMs: 30,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 30000,
  schemas: { /* Zod schemas */ },
});
```

#### `YoinConfig`

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `url` | `string` | ✅ | — | WebSocket server URL |
| `docId` | `string` | ✅ | — | Document / room ID |
| `dbName` | `string` | — | — | IndexedDB database name (used with DbPlugin) |
| `awarenessThrottleMs` | `number` | — | `30` | Awareness broadcast throttle interval (ms) |
| `heartbeatIntervalMs` | `number` | — | `5000` | Heartbeat send interval (ms) |
| `heartbeatTimeoutMs` | `number` | — | `30000` | Remote user timeout threshold (ms) |
| `schemas` | `Record<string, z.ZodTypeAny>` | — | — | Zod schema validation rules |

On construction, it automatically:
1. Creates a `YoinDoc` (CRDT document)
2. Establishes a WebSocket connection to `url/room/{docId}`
3. Performs a three-way handshake sync (State Vector exchange)
4. Starts heartbeat timer + Ghost Busting GC

---

### Text API

#### `insertText(index, text)`

Insert text into the `content` text block.

```typescript
client.insertText(0, 'Hello');
client.insertText(5, ' World');
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `index` | `number` | Insert position (0-based) |
| `text` | `string` | Text to insert |

**Returns**: `Promise<void>`

#### `deleteText(index, length)`

Delete text.

```typescript
client.deleteText(5, 6); // Deletes " World"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `index` | `number` | Start position (0-based) |
| `length` | `number` | Number of characters to delete |

**Returns**: `Promise<void>`

#### `clearText()`

Clear all text.

```typescript
client.clearText();
```

**Returns**: `Promise<void>`

#### `getText()`

Read current text content.

```typescript
const text = client.getText(); // "Hello"
```

**Returns**: `string`

#### `subscribe(listener)`

Subscribe to text changes (triggered by both local and remote updates).

```typescript
const unsubscribe = client.subscribe((text) => {
  console.log('Text changed:', text);
});

// Unsubscribe
unsubscribe();
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `listener` | `(text: string) => void` | Change callback |

**Returns**: `() => void` — Unsubscribe function

---

### Map API

#### `setMap(mapName, key, value)`

Write a key-value pair to a Map. Non-string values are automatically `JSON.stringify`'d.

```typescript
client.setMap('settings', 'theme', 'dark');
client.setMap('settings', 'fontSize', 16);
client.setMap('settings', 'options', { sidebar: true });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mapName` | `string` | Map name |
| `key` | `string` | Key name |
| `value` | `any` | Value (auto-serialized) |

**Returns**: `Promise<void>`

> If a Zod schema is configured, values are validated before writing. Throws on validation failure.

#### `getMap(mapName)`

Read an entire Map. String values are automatically parsed via `JSON.parse`.

```typescript
const settings = client.getMap('settings');
// { theme: "dark", fontSize: 16, options: { sidebar: true } }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mapName` | `string` | Map name |

**Returns**: `Record<string, any>`

#### `setMapDeep(mapName, path, value)`

Deep nested Map write. Performs property-level merging at the CRDT layer (does not overwrite sibling keys at the same level).

```typescript
client.setMapDeep('config', ['ui', 'sidebar', 'width'], 300);
client.setMapDeep('config', ['ui', 'sidebar', 'visible'], true);
// config = { ui: { sidebar: { width: 300, visible: true } } }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mapName` | `string` | Root Map name |
| `path` | `string[]` | Nested path array |
| `value` | `string \| number \| boolean` | Leaf node value |

#### `batchSet(entries)`

Batch Map writes. All operations are merged into a single CRDT transaction (single diff).

```typescript
client.batchSet([
  ['settings', 'theme', 'dark'],
  ['settings', 'lang', 'zh-TW'],
  ['profile', 'name', 'Alice'],
]);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `entries` | `[string, string, any][]` | `[mapName, key, value]` array |

---

### Array API

#### `pushArray(arrayName, item)`

Push an element to the end of an array. Non-string values are automatically `JSON.stringify`'d.

```typescript
client.pushArray('logs', { action: 'click', time: Date.now() });
client.pushArray('tags', 'important');
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `arrayName` | `string` | Array name |
| `item` | `any` | Element to push |

**Returns**: `Promise<void>`

> If a Zod schema (of type `z.array(...)`) is configured, each element is validated before writing.

#### `getArray(arrayName)`

Read an entire Array. String elements are automatically parsed via `JSON.parse`.

```typescript
const logs = client.getArray('logs');
// [{ action: "click", time: 1707955200000 }]
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `arrayName` | `string` | Array name |

**Returns**: `any[]`

---

### Awareness API

The Awareness system broadcasts ephemeral user state (cursor position, presence, selection, etc.) without writing to the CRDT document.

#### `setAwareness(partial)`

Set / update local Awareness state. Merges with existing state automatically, and broadcasts with throttling.

```typescript
client.setAwareness({
  name: 'Alice',
  color: '#ff6b6b',
  cursorX: 120,
  cursorY: 450,
  device: 'desktop',
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `partial` | `AwarenessPartial` | Fields to update (partial update) |

> Throttle mechanism: 30ms leading-edge throttle + trailing pending update by default.

#### `onAwarenessChange(callback)`

Subscribe to Awareness state changes. The callback is invoked immediately upon subscription.

```typescript
const unsubscribe = client.onAwarenessChange((states) => {
  for (const [clientId, state] of states) {
    console.log(`${state.name} is at (${state.cursorX}, ${state.cursorY})`);
  }
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `AwarenessCallback` | `(states: Map<string, AwarenessState>) => void` |

**Returns**: `() => void` — Unsubscribe function

#### `leaveAwareness()`

Broadcast offline state and clear local Awareness. Automatically called during `destroy()`.

```typescript
client.leaveAwareness();
```

#### `getClientId()`

Get this client's randomly generated ID.

```typescript
const myId = client.getClientId(); // "a3f8k2m1"
```

**Returns**: `string`

---

### Network Status

#### `subscribeNetwork(callback)`

Subscribe to network status changes.

```typescript
client.subscribeNetwork((status) => {
  // status: 'connecting' | 'online' | 'offline'
  updateStatusIndicator(status);
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `(status: NetworkStatus) => void` | Status callback |

The `NetworkProvider` instance can also be accessed directly:

```typescript
client.network.isConnected  // boolean — Whether the WebSocket is connected
```

---

### Plugin API

#### `use(plugin)`

Install a plugin. Supports method chaining.

```typescript
client
  .use(dbPlugin)
  .use(undoPlugin)
  .use(createLoggerPlugin('[Debug]'));
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `plugin` | `YoinPlugin` | Plugin instance |

**Returns**: `this` (chainable)

---

### Low-Level Access

The following APIs are primarily intended for plugin authors or advanced users.

#### `getDoc()`

Get the underlying `YoinDoc` (Rust CRDT document WASM object).

```typescript
const doc = client.getDoc();
const sv = doc.get_state_vector();
```

**Returns**: `YoinDoc`

#### `getConfig()`

Get the configuration passed during construction.

**Returns**: `YoinConfig`

#### `broadcastUpdate(update)`

Manually broadcast a CRDT update to all remote peers. Primarily used by the Undo plugin.

| Parameter | Type | Description |
|-----------|------|-------------|
| `update` | `Uint8Array` | CRDT incremental diff |

#### `onDocUpdate(callback)`

Subscribe to all document updates (both local and remote).

**Returns**: `() => void` — Unsubscribe function

#### `onLocalUpdate(callback)`

Subscribe to updates triggered only by local operations.

**Returns**: `() => void` — Unsubscribe function

#### `notifyListeners()`

Manually trigger all `subscribe()` listeners.

#### `notifyAwarenessListeners()`

Manually trigger all Awareness listeners.

#### `map_get_all(mapName)`

Low-level Map read (no JSON.parse). Used internally by React Hooks.

#### `array_get_all(arrayName)`

Low-level Array read (no JSON.parse). Used internally by React Hooks.

#### `getAwarenessStates()`

Get the Awareness state Map.

**Returns**: `Map<string, AwarenessState>`

---

### Lifecycle

#### `destroy()`

Destroy the client: clear all timers, destroy plugins, broadcast offline status.

```typescript
client.destroy();
```

Destruction sequence:
1. Clear heartbeat / GC / Awareness timers
2. Call `onDestroy()` on each plugin
3. Broadcast `leaveAwareness()`

---

## Proxy Transparent Writes

Use native JS syntax to operate on CRDT data.

### `createMapProxy<T>(client, mapName)`

Create a Proxy object for a Map. Assignment automatically calls `setMap()`, nested assignment automatically calls `setMapDeep()`.

```typescript
import { createMapProxy } from '@yoin/client';

interface Settings {
  theme: string;
  fontSize: number;
  sidebar: { width: number; visible: boolean };
}

const settings = createMapProxy<Settings>(client, 'settings');

// Shallow write → setMap('settings', 'theme', 'dark')
settings.theme = 'dark';

// Deep write → setMapDeep('settings', ['sidebar', 'width'], 280)
settings.sidebar.width = 280;

// Read (via CRDT layer)
console.log(settings.theme);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `client` | `YoinClient` | Client instance |
| `mapName` | `string` | Map name |

**Returns**: `T` (Proxy object)

### `createArrayProxy<T>(client, arrayName)`

Create a Proxy object for an Array. `.push()` automatically calls `pushArray()`.

```typescript
import { createArrayProxy } from '@yoin/client';

const logs = createArrayProxy<{ action: string }>(client, 'logs');
logs.push({ action: 'login' }); // → pushArray('logs', { action: 'login' })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `client` | `YoinClient` | Client instance |
| `arrayName` | `string` | Array name |

**Returns**: `T[]` (Proxy array)

> ⚠️ Currently only `.push()` is supported. Direct index assignment will produce a warning.

---

## Plugin System

### Plugin Interface

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

| Hook | Timing | Description |
|------|--------|-------------|
| `onInstall` | When `client.use(plugin)` is called | Initialization; receives client reference |
| `onBeforeUpdate` | After local write, before broadcast | Can be used for interception / logging |
| `onAfterUpdate` | After local or remote update is applied | Can be used for persistence / logging |
| `onDestroy` | When `client.destroy()` is called | Cleanup resources (timers, subscriptions) |

---

### IndexedDB Persistence Plugin

Automatically persists CRDT document snapshots to IndexedDB for offline persistence.

```typescript
import { createDbPlugin } from '@yoin/client';

const { plugin, forceSave } = createDbPlugin({
  dbName: 'my-app',
  debounceMs: 1000,      // Default: 1000ms
});

client.use(plugin);

// Force an immediate save
await forceSave();
```

#### `YoinDbPluginOptions`

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dbName` | `string` | ✅ | — | IndexedDB database name |
| `debounceMs` | `number` | — | `1000` | Auto-save debounce interval (ms) |

**Behavior**:
- On install, loads existing data from IndexedDB (`loadFromDisk`)
- Schedules debounced save after each doc update
- `forceSave()` persists immediately

---

### Undo / Redo Plugin

Based on the Rust-side `UndoManager`. Only undoes / redoes **local** operations.

```typescript
import { createUndoPlugin } from '@yoin/client';

const { plugin, undo, redo } = createUndoPlugin();
client.use(plugin);

// Undo the last local operation
undo();

// Redo
redo();
```

**Characteristics**:
- Uses origin tagging to distinguish local / remote operations
- Lazy initialization: UndoManager is created on first `undo()` / `redo()` call
- Automatically broadcasts the diff to remote peers after undo

---

### Logger Plugin

Development debugging tool that outputs update logs to the Console.

```typescript
import { createLoggerPlugin } from '@yoin/client';

client.use(createLoggerPlugin('[Debug]'));
// [Debug] Plugin installed!
// [Debug] Update detected, size: 42 bytes
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | `'[YoinLogger]'` | Log prefix |

---

### Custom Plugins

```typescript
import type { YoinPlugin } from '@yoin/client';

const myPlugin: YoinPlugin = {
  name: 'my-analytics',

  onInstall(client) {
    console.log(`Connected to doc: ${client.getConfig().docId}`);
  },

  onAfterUpdate(update) {
    analytics.track('crdt_update', { bytes: update.length });
  },

  onDestroy() {
    analytics.flush();
  },
};

client.use(myPlugin);
```

---

## React Hooks

Import path: `@yoin/client/react`

### `YoinProvider`

Context Provider that wraps child components needing access to Yoin data.

```tsx
import { YoinProvider } from '@yoin/client/react';

<YoinProvider client={client}>
  <App />
</YoinProvider>
```

| Prop | Type | Description |
|------|------|-------------|
| `client` | `YoinClient` | Yoin client instance |
| `children` | `React.ReactNode` | Child components |

### `useYoinClient()`

Get the `YoinClient` from Context.

```tsx
const client = useYoinClient();
```

**Returns**: `YoinClient`

> Throws an error if used outside of a `YoinProvider`.

### `useYoinMap<T>(mapName)`

Reactive Map Hook. Returns a Proxy object where assignments trigger CRDT writes + React re-renders.

```tsx
interface AppSettings {
  theme: string;
  fontSize: number;
}

function SettingsPanel() {
  const settings = useYoinMap<AppSettings>('app-settings');

  return (
    <div>
      <p>Theme: {settings.theme}</p>
      <button onClick={() => settings.theme = 'dark'}>
        Dark Mode
      </button>
    </div>
  );
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mapName` | `string` | CRDT Map name |

**Returns**: `T` (reactive Proxy)

Internally uses `useSyncExternalStore` + `JSON.stringify` snapshot for change detection.

### `useYoinArray<T>(arrayName)`

Reactive Array Hook.

```tsx
function LogList() {
  const logs = useYoinArray<{ action: string; time: number }>('logs');

  return (
    <ul>
      {logs.map((log, i) => <li key={i}>{log.action}</li>)}
      <button onClick={() => logs.push({ action: 'click', time: Date.now() })}>
        Add Log
      </button>
    </ul>
  );
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `arrayName` | `string` | CRDT Array name |

**Returns**: `T[]` (reactive Proxy array)

### `useYoinAwareness()`

Reactive Awareness Hook.

```tsx
function UserList() {
  const awareness = useYoinAwareness();

  return (
    <ul>
      {[...awareness.values()].map(user => (
        <li key={user.clientId} style={{ color: user.color }}>
          {user.name} ({user.device})
        </li>
      ))}
    </ul>
  );
}
```

**Returns**: `Map<string, AwarenessState>`

### `useYoinStatus()`

Reactive connection status Hook.

```tsx
function StatusBar() {
  const isConnected = useYoinStatus();

  return <span>{isConnected ? '🟢 Online' : '🔴 Offline'}</span>;
}
```

**Returns**: `boolean` — `true` means connected

---

## Schema Validation

Yoin integrates [Zod](https://zod.dev/) for write-time validation. Define rules in `YoinConfig.schemas`, and `setMap()` / `pushArray()` will automatically validate before writing.

```typescript
import { z } from 'zod';

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'example',
  schemas: {
    // Map Schema — use z.object()
    'app-settings': z.object({
      theme: z.enum(['light', 'dark']),
      fontSize: z.number().min(8).max(72),
      language: z.string(),
    }),

    // Array Schema — use z.array()
    'action-logs': z.array(z.object({
      action: z.string(),
      timestamp: z.number(),
    })),
  },
});

// ✅ Validation passes
client.setMap('app-settings', 'theme', 'dark');

// ❌ Validation fails, throws ZodError
client.setMap('app-settings', 'theme', 'rainbow');

// ✅ Validation passes
client.pushArray('action-logs', { action: 'click', timestamp: Date.now() });

// ❌ Validation fails
client.pushArray('action-logs', { action: 123 });
```

**Validation logic**:
- `z.object()` schema: Validates the corresponding `key`'s field schema
- `z.record()` schema: Validates the value schema
- `z.array()` schema: Validates each element
- Maps / Arrays without a defined schema are not validated

---

## Type Definitions

### `YoinConfig`

```typescript
interface YoinConfig {
  url: string;
  docId: string;
  dbName?: string;
  awarenessThrottleMs?: number;   // Default: 30
  heartbeatIntervalMs?: number;   // Default: 5000
  heartbeatTimeoutMs?: number;    // Default: 30000
  schemas?: Record<string, z.ZodTypeAny>;
}
```

### `AwarenessState`

```typescript
interface AwarenessState {
  clientId: string;
  name: string;
  color: string;
  cursorX?: number | null;
  cursorY?: number | null;
  selection?: string | null;
  offline?: boolean;
  device?: 'mobile' | 'desktop';
  lastActive?: number;
  timestamp: number;
}
```

### `AwarenessPartial`

```typescript
type AwarenessPartial = Partial<Omit<AwarenessState, 'clientId' | 'timestamp'>>;
```

### `CursorRenderer`

```typescript
type CursorRenderer = (color: string, name: string) => HTMLElement;
```

### `AwarenessCallback`

```typescript
type AwarenessCallback = (states: Map<string, AwarenessState>) => void;
```

### `NetworkStatus`

```typescript
type NetworkStatus = 'connecting' | 'online' | 'offline';
```

### `YoinPlugin`

```typescript
interface YoinPlugin {
  readonly name: string;
  onInstall(client: YoinClient): void;
  onBeforeUpdate?(update: Uint8Array): void;
  onAfterUpdate?(update: Uint8Array): void;
  onDestroy?(): void;
}
```

### `YoinDbPluginOptions`

```typescript
interface YoinDbPluginOptions {
  dbName: string;
  debounceMs?: number;   // Default: 1000
}
```

---

## Communication Protocol

Yoin uses a 1-byte header binary protocol for WebSocket communication:

| Type | Constant | Value | Direction | Description |
|------|----------|-------|-----------|-------------|
| Sync Step 1 | `MSG_SYNC_STEP_1` | `0` | Client → Server → Client | Send State Vector to request sync |
| Sync Step 2 | `MSG_SYNC_STEP_2` | `1` | Bidirectional | Transfer CRDT Update / Diff |
| Sync Step 1 Reply | `MSG_SYNC_STEP_1_REPLY` | `2` | Client → Server → Client | Reply with State Vector |
| Awareness | `MSG_AWARENESS` | `3` | Bidirectional | Presence state broadcast (JSON over binary) |
| Join Room | `MSG_JOIN_ROOM` | `4` | Client → Server | Room join notification |

### Message Format

```
┌──────────┬────────────────────────────┐
│ 1 byte   │ N bytes                    │
│ msg_type │ payload (Uint8Array)       │
└──────────┴────────────────────────────┘
```

### Sync Flow (Three-Way Handshake)

```
Client A (new)           Server / Relay           Client B (existing)
    │                         │                         │
    │── MSG_JOIN_ROOM ──────→ │                         │
    │── MSG_SYNC_STEP_1 ────→ │── MSG_SYNC_STEP_1 ───→ │
    │                         │                         │
    │                         │←── MSG_SYNC_STEP_2 ─── │  (diff based on A's SV)
    │←── MSG_SYNC_STEP_2 ─── │                         │
    │                         │←── MSG_SYNC_STEP_1_REPLY│  (B's own SV)
    │←── MSG_SYNC_STEP_1_REPLY│                         │
    │                         │                         │
    │── MSG_SYNC_STEP_2 ────→ │── MSG_SYNC_STEP_2 ───→ │  (diff based on B's SV)
    │                         │                         │
    ▼ Both sides synchronized ▼                         ▼
```
