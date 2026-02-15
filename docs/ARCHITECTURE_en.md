[繁體中文](ARCHITECTURE.md) | [English](ARCHITECTURE_en.md)

# Yoin Architecture Document

## Table of Contents

- [System Overview](#system-overview)
- [Four-Layer Architecture](#four-layer-architecture)
- [Layer 1: CRDT Engine (Rust + WASM)](#layer-1-crdt-engine-rust--wasm)
- [Layer 2: WebSocket Relay (Cloudflare Worker)](#layer-2-websocket-relay-cloudflare-worker)
- [Layer 3: Client SDK (TypeScript)](#layer-3-client-sdk-typescript)
- [Layer 4: Application Layer](#layer-4-application-layer)
- [Communication Protocol](#communication-protocol)
- [Sync Mechanism](#sync-mechanism)
- [Offline & Persistence](#offline--persistence)
- [Awareness System](#awareness-system)
- [Monorepo Infrastructure](#monorepo-infrastructure)
- [Deployment Architecture](#deployment-architecture)
- [Future Roadmap](#future-roadmap)

---

## System Overview

Yoin is a **Local-First real-time collaborative state synchronization framework**. The core philosophy is to enable any web application to gain multi-user real-time collaboration capabilities with just a few lines of code, while remaining fully functional in offline environments.

```
┌─────────────────────────────────────────────────┐
│                   Browser A                     │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  App UI │→ │ YoinClient│→ │ YoinDoc(WASM) │  │
│  └─────────┘  └────┬─────┘  └───────────────┘  │
│                    │ WebSocket                    │
└────────────────────┼────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │  Cloudflare Edge    │
          │  ┌────────────────┐ │
          │  │  YoinRoom (DO) │ │  ← Durable Object (room-isolated)
          │  │  WebSocket     │ │
          │  │  Blind Relay   │ │
          │  └────────────────┘ │
          └──────────┬──────────┘
                     │
┌────────────────────┼────────────────────────────┐
│                    │ WebSocket                    │
│  ┌─────────┐  ┌───┴──────┐  ┌───────────────┐  │
│  │  App UI │→ │ YoinClient│→ │ YoinDoc(WASM) │  │
│  └─────────┘  └──────────┘  └───────────────┘  │
│                   Browser B                     │
└─────────────────────────────────────────────────┘
```

**Design Philosophy**: Each browser holds a complete CRDT document replica. The server is only responsible for relaying messages. All merge logic is executed client-side by Rust WASM, ensuring offline operation even when the server is unavailable.

---

## Four-Layer Architecture

```
┌─────────────────────────────────────────────┐
│  Layer 4: Application                       │
│  Event binding, DOM rendering, rAF          │
│  throttling, React Hooks                    │
├─────────────────────────────────────────────┤
│  Layer 3: @yoin/client (SDK)                │
│  YoinClient micro-kernel + Plugin + Proxy   │
│  ├── network.ts    WebSocket + offline queue│
│  ├── storage.ts    IndexedDB adapter        │
│  ├── proxy.ts      Map/Array Proxy writes   │
│  ├── plugin.ts     Plugin interface         │
│  ├── plugins/      db, undo built-in plugins│
│  ├── logger.ts     Debug logging plugin     │
│  ├── react/        React Hooks integration  │
│  └── wasm/         WASM initializer         │
├─────────────────────────────────────────────┤
│  Layer 2: yoin-worker                       │
│  Cloudflare Durable Objects WebSocket Relay │
├─────────────────────────────────────────────┤
│  Layer 1: @yoin/core (Rust → WASM)          │
│  Yrs CRDT engine + wasm-bindgen bindings    │
└─────────────────────────────────────────────┘
```

Each layer depends only on the layer below — no cross-layer calls. Layer 2 (Worker) and Layer 3 (Client) communicate via binary protocol, and their codebases are completely independent.

---

## Layer 1: CRDT Engine (Rust + WASM)

### Technology Choices

| Choice | Rationale |
|--------|-----------|
| **Yrs** (Yjs Rust implementation) | Mature CRDT library supporting Text / Map / Array / UndoManager |
| **wasm-bindgen** | Zero-cost Rust ↔ JS interop |
| **serde-wasm-bindgen** | Direct serialization to native JS objects, avoiding JSON.parse overhead |
| **wee_alloc** | Tiny memory allocator designed for WASM |

### YoinDoc Core Structure

```rust
#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,                               // Yrs CRDT Document
    undo_manager: RefCell<Option<UndoManager>>, // Lazy initialization
}
```

**Incremental Diff Mode**: All write APIs follow the same flow:

```
sv_before = doc.transact().state_vector()
  → Execute CRDT operation
  → diff = doc.transact().encode_diff_v1(&sv_before)
  → Return diff (Uint8Array)
```

Only the incremental diff is returned rather than the full state, significantly reducing network payload.

### Origin Tracking

```rust
fn origin_local()  -> Origin { Origin::from("yoin-local") }
fn origin_remote() -> Origin { Origin::from("yoin-remote") }
```

- Local operations use `origin_local()`
- Remote `apply_update` uses `origin_remote()`
- UndoManager listens for `origin_local()`, ensuring undo only reverts the user's own operations

### API Matrix

| Data Type | Write | Read |
|-----------|-------|------|
| **Text** | `insert_text`, `delete_text` | `get_text` |
| **Map** | `map_set`, `map_set_deep`, `batch_set` | `map_get`, `map_get_all`, `map_get_json` |
| **Array** | `array_push` | `array_get`, `array_get_all` |
| **Sync** | `apply_update` | `get_state_vector`, `export_update`, `export_diff`, `snapshot`, `get_missing_updates` |
| **Undo** | `undo`, `redo`, `enable_undo`, `expand_undo_scope` | — |

### Build Output

```
packages/core/
├── src/lib.rs          # Rust source (~300 lines)
├── Cargo.toml          # opt-level="z", lto=true, strip=true
└── pkg-web/            # wasm-pack --target web output
    ├── core_bg.wasm    # ~300 KB (gzip ~120 KB)
    ├── core.js         # JS glue code
    └── core.d.ts       # TypeScript types
```

---

## Layer 2: WebSocket Relay (Cloudflare Worker)

### Architecture: Durable Objects + Hibernation API

```
              ┌─────────────────────────────────┐
              │       Cloudflare Edge Node       │
              │                                  │
  Client A ──→│  Worker (Router)                 │
  Client B ──→│  ├─ /room/abc → YoinRoom("abc") │
  Client C ──→│  ├─ /room/xyz → YoinRoom("xyz") │
              │  └─ ?room=... → YoinRoom(...)    │
              │                                  │
              │  YoinRoom  (Durable Object)      │
              │  ├─ ctx.acceptWebSocket()        │
              │  ├─ webSocketMessage → broadcast  │
              │  └─ webSocketClose → cleanup      │
              └─────────────────────────────────┘
```

### Key Design Decisions

| Feature | Description |
|---------|-------------|
| **Room Isolation** | Each `docId` maps to a single Durable Object instance — natural isolation |
| **Hibernation API** | `ctx.acceptWebSocket()` mode allows DOs to hibernate when idle, reducing billable time |
| **Blind Relay** | Server doesn't maintain a CRDT document — binary messages are forwarded directly to other WebSockets in the same room |
| **Join Room Filtering** | `MSG_JOIN_ROOM (type=4)` is intercepted by the server and not relayed |

### URL Routing

Two formats are supported:
- **Path-style**: `wss://worker.dev/room/{roomId}`
- **Query-style**: `wss://worker.dev?room={roomId}`

The Worker extracts `roomId` from the URL → `env.YOIN_ROOM.idFromName(roomId)` → obtains DO stub → `fetch()` forwards the request.

### Wrangler Configuration

```jsonc
{
  "name": "yoin-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-02-12",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "YOIN_ROOM", "class_name": "YoinRoom" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["YoinRoom"] }
  ]
}
```

---

## Layer 3: Client SDK (TypeScript)

### Micro-Kernel Architecture

`YoinClient` serves as a micro-kernel containing only essential functionality:

```
YoinClient (micro-kernel)
├── CRDT Operations (Text / Map / Array)
├── Network Connection (NetworkProvider)
├── Awareness System (throttle + GC)
├── Schema Validation (Zod)
└── Plugin Lifecycle Management
```

All extended features (persistence, undo, logging) are mounted via the Plugin system.

### Module Responsibilities

| Module | Responsibility | Key Classes / Functions |
|--------|---------------|------------------------|
| `YoinClient.ts` | Micro-kernel: CRDT + network + plugins | `YoinClient` |
| `network.ts` | WebSocket management + offline queue + auto-reconnect | `NetworkProvider` |
| `storage.ts` | IndexedDB wrapper | `StorageAdapter` |
| `proxy.ts` | JS Proxy transparent writes | `createMapProxy`, `createArrayProxy` |
| `plugin.ts` | Plugin interface definition | `YoinPlugin` interface |
| `plugins/db.ts` | IndexedDB persistence | `YoinDbPlugin` |
| `plugins/undo.ts` | Undo / Redo | `YoinUndoPlugin` |
| `logger.ts` | Development debug logging | `createLoggerPlugin` |
| `react/index.tsx` | React Hooks integration | `YoinProvider`, `useYoinMap`, `useYoinArray` |
| `wasm/loader.ts` | WASM initialization (idempotent) | `initYoin`, `isYoinInitialized` |

### Plugin Lifecycle

```
client.use(plugin)
    │
    ├─ plugin.onInstall(client)      ← Initialize
    │
    ├─ [Local write]
    │   ├─ plugin.onBeforeUpdate()   ← Before broadcast
    │   └─ plugin.onAfterUpdate()    ← After broadcast
    │
    ├─ [Remote update]
    │   └─ plugin.onAfterUpdate()    ← After apply
    │
    └─ client.destroy()
        └─ plugin.onDestroy()        ← Cleanup
```

### Data Flow

```
User Action (UI Event)
    │
    ▼
YoinClient.setMap() / insertText() / pushArray()
    │
    ├─ Zod Schema Validation (if defined)
    │
    ▼
YoinDoc (WASM) ── Execute CRDT operation → Return incremental diff
    │
    ├─ plugins.onBeforeUpdate(diff)
    │
    ├─ NetworkProvider.broadcast(message)
    │   ├─ WebSocket connected → send directly
    │   └─ Offline → push to messageQueue
    │
    ├─ notifyListeners() → UI update
    │
    ├─ plugins.onAfterUpdate(diff)
    │
    └─ emitDocUpdate(diff) / emitLocalUpdate(diff)
```

### Build Output

```
packages/client/
├── tsup.config.ts      # Dual entry (index + react), ESM + CJS + DTS output
└── dist/
    ├── index.js        # ESM main entry
    ├── index.cjs       # CJS main entry
    ├── index.d.ts      # Type definitions
    ├── react.js        # React Hooks (ESM)
    ├── react.cjs       # React Hooks (CJS)
    └── react.d.ts      # React type definitions
```

---

## Layer 4: Application Layer

### Demo Architecture

The demo showcases two frontend integration approaches simultaneously:

| File | Mode | Description |
|------|------|-------------|
| `main.ts` | Vanilla JS | Direct DOM manipulation + rAF throttled rendering |
| `App.tsx` | React | Hook + Proxy zero-boilerplate integration |
| `renderers.ts` | Shared | Pure function cursor / avatar DOM factories |

---

## Communication Protocol

### 1-Byte Header Binary Protocol

```
┌──────────┬────────────────────────────┐
│ 1 byte   │ N bytes                    │
│ msg_type │ payload (Uint8Array)       │
└──────────┴────────────────────────────┘
```

| Type | Value | Payload | Description |
|------|-------|---------|-------------|
| `MSG_SYNC_STEP_1` | `0` | State Vector | Sync request |
| `MSG_SYNC_STEP_2` | `1` | CRDT Update / Diff | Data transfer |
| `MSG_SYNC_STEP_1_REPLY` | `2` | State Vector | Sync request reply |
| `MSG_AWARENESS` | `3` | JSON (UTF-8 encoded) | Presence state |
| `MSG_JOIN_ROOM` | `4` | Room name (UTF-8) | Join room |

---

## Sync Mechanism

### Three-Way Handshake

Sync flow between a newly joining Client A and an existing Client B:

```
Client A (new)            Server (Relay)           Client B (existing)
    │                         │                       │
    │── JOIN_ROOM ──────────→ │                       │
    │── SYNC_STEP_1 (sv_A) ─→│── SYNC_STEP_1 ──────→│
    │                         │                       │
    │                         │←── SYNC_STEP_2 ─────│  diff(sv_A)
    │←── SYNC_STEP_2 ────────│                       │
    │                         │←── SYNC_STEP_1_REPLY │  sv_B
    │←── SYNC_STEP_1_REPLY ──│                       │
    │                         │                       │
    │── SYNC_STEP_2 (diff) ─→│── SYNC_STEP_2 ──────→│  diff(sv_B)
    │                         │                       │
    ▼  Both sides synced      ▼                       ▼
```

1. A sends its State Vector
2. B computes a diff from A's SV and sends it back, along with B's own SV
3. A computes a diff from B's SV and sends it to B
4. Both sides converge

### Incremental Updates

For each local operation:
1. Record `sv_before` (State Vector before the operation)
2. Execute the CRDT operation
3. `encode_diff_v1(sv_before)` to obtain the incremental diff
4. Broadcast only the diff (typically tens to hundreds of bytes)

---

## Offline & Persistence

### Offline Queue (NetworkProvider)

```
Online:    operation → broadcast() → WebSocket.send()
Offline:   operation → broadcast() → messageQueue.push()
Reconnect: messageQueue.forEach(send) → flush queue
```

- Auto-reconnects 3 seconds after WebSocket disconnection
- On reconnect, the queue is flushed first, then the three-way handshake is performed
- Messages in the queue maintain their order

### IndexedDB Persistence (DbPlugin)

```
operation → onDocUpdate → scheduleSave() ─[debounce 1s]→ persist()
                                                            │
                              IndexedDB ← export_update() (full snapshot)
```

- Debounce mechanism prevents excessive writes
- On startup, `loadFromDisk()` → `apply_update()` restores state
- `forceSave()` can trigger an immediate save manually

---

## Awareness System

### Design

Awareness broadcasts ephemeral information that is NOT written to the CRDT document: cursor position, online status, user name, etc.

```
User moves mouse
    │
    ▼ (rAF throttle)
setAwareness({ cursorX, cursorY })
    │
    ├─ Update local awarenessStates Map
    ├─ Notify local Awareness listeners
    └─ Throttled broadcast (leading-edge + trailing)
        │
        ▼ (30ms throttle)
    broadcastAwareness() → MSG_AWARENESS → WebSocket
```

### Throttle Mechanism

```
t=0    setAwareness()  → Broadcast immediately (leading edge)
t=10   setAwareness()  → Mark as pending
t=20   setAwareness()  → Mark as pending (overwrite)
t=30   throttle expires → Broadcast latest pending (trailing edge)
```

### Ghost Busting

```
Every 3 seconds:
  for (clientId, state) in awarenessStates:
    if (now - state.timestamp > 30s) && (clientId ≠ myClientId):
      awarenessStates.delete(clientId)
      notifyAwarenessListeners()
```

The heartbeat mechanism (every 5 seconds) ensures active users are not removed.

---

## Monorepo Infrastructure

### pnpm Workspace

```yaml
packages:
  - packages/*    # @yoin/core, @yoin/client
  - apps/*        # @yoin/demo
  - yoin-worker   # Cloudflare Worker
```

### Package Dependency Graph

```
@yoin/core (Rust WASM, no JS dependencies)
    ↑
@yoin/client (workspace:*)
    ↑
@yoin/demo (workspace:*)

yoin-worker (standalone, no internal workspace dependencies)
```

### Build Order

```
1. wasm-pack build (packages/core)    → pkg-web/
2. tsup (packages/client)             → dist/
3. vite build (apps/demo)             → dist/
```

Strict topological sort: Core → Client → Demo.

---

## Deployment Architecture

### Cloudflare Deployment

```
                ┌──────────────────────┐
                │  Cloudflare Network  │
                │                      │
                │  Workers             │
  WebSocket ──→ │  ├─ yoin-worker      │
                │  └─ YoinRoom (DO)    │
                │                      │
                │  Pages               │
  HTTPS ──────→ │  └─ yoin-client      │ ← apps/demo/dist
                │     (Static Assets)  │
                └──────────────────────┘
```

| Service | Platform | Deploy Command |
|---------|----------|----------------|
| WebSocket Worker | Cloudflare Workers | `pnpm deploy:worker` |
| Demo Frontend | Cloudflare Pages | `pnpm deploy:pages` |
| Full Stack (one-click) | Both | `.\deploy.bat` or `pnpm deploy` |

### deploy.bat Flow

```
[1/5] wasm-pack build        → packages/core/pkg-web/
[2/5] tsup build             → packages/client/dist/
[3/5] wrangler deploy        → Cloudflare Workers
[4/5] vite build             → apps/demo/dist/
[5/5] wrangler pages deploy  → Cloudflare Pages
```

---

## Future Roadmap

### Short-Term (High Priority)

#### 1. Smart Server (Server-Side CRDT)

Currently the Worker operates as a Blind Relay without maintaining CRDT state. Upgrading to a Smart Server:

- **Durable Object holds a `YoinDoc` replica** (requires loading WASM in the Worker or using the Yjs JS version)
- When a new client joins, the server delivers a full snapshot directly — no need to wait for other clients
- **Server-side Compaction**: Periodically compress history to reduce State Vector size

```
Client A ──→ YoinRoom (DO) ←── Client B
                 │
                 ├─ Maintain CRDT Doc
                 ├─ New connection → Send snapshot directly
                 └─ Periodic compaction
```

#### 2. Persistent Offline Queue

Currently `messageQueue` lives in memory and is lost on page refresh. Move it to IndexedDB:

```
broadcast() → offline → IndexedDB queue → Restore on restart → Flush on reconnect
```

#### 3. Sub-documents

Large collaborative applications often need multiple independent sync regions (e.g., multiple pages, different data tables). Leveraging the Yrs Sub-doc mechanism:

- Load sub-documents on demand, reducing initial transfer size
- Each sub-doc can sync and persist independently

### Mid-Term

#### 4. Binary Awareness

Currently Awareness uses JSON over binary. Switching to pure binary encoding can reduce bandwidth by approximately 40%.

#### 5. Conflict Resolution Callbacks

Provide an `onConflict(local, remote)` hook for developers to define custom merge strategies:

```typescript
client.onConflict('settings', (local, remote) => {
  return remote.timestamp > local.timestamp ? remote : local;
});
```

#### 6. Selective Sync

Sync only the Maps / Arrays the current user is focused on, reducing bandwidth and CPU usage:

```typescript
client.subscribe('settings', (data) => { /* Only receive settings changes */ });
```

#### 7. Access Control

Add JWT authentication and read/write permissions at the Worker layer:

```
Client → JWT Token → Worker validation → Allow/Deny → DO
```

### Long-Term

#### 8. History Version Browsing

Leverage Yrs Snapshots for time-travel capabilities:

```typescript
const history = client.getHistory();
const version = client.restoreSnapshot(history[5]);
```

#### 9. Large File Support

- Incremental loading strategy: Only load the latest snapshot initially, fetch historical diffs on demand
- Compressed transfer (gzip / brotli at the Worker)

#### 10. Multi-Framework Support

Extend the React Hooks pattern to Vue / Svelte / Solid:

```
@yoin/client           # Core SDK (framework-agnostic)
@yoin/client/react     # React Hooks (implemented)
@yoin/client/vue       # Vue Composables
@yoin/client/svelte    # Svelte Stores
@yoin/client/solid     # Solid Signals
```

#### 11. Publish SDK to npm

Publish `@yoin/client` as a standalone npm package for external developers. Requires solving the WASM file loading strategy (CDN vs. bundler auto-resolution).

#### 12. Monitoring & Observability

- Add Cloudflare Analytics on the Worker side
- Add performance metrics on the Client side (sync latency, message size, reconnection count)
- Provide a Dashboard Plugin
