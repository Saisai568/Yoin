[繁體中文](ARCHITECTURE.md) | [English](ARCHITECTURE_en.md)

# Yoin System Architecture Design Document

> Version: `@yoin/client` v0.1.2

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [System Layered Architecture](#system-layered-architecture)
- [Monorepo Structure](#monorepo-structure)
- [Layer 1: Rust CRDT Core (`@yoin/core`)](#layer-1-rust-crdt-core-yoincore)
  - [Why Yrs + WASM](#why-yrs--wasm)
  - [YoinDoc Internal Structure & Native Type Fidelity](#yoindoc-internal-structure--native-type-fidelity)
  - [Differential Update Mechanism (State Vector Diff)](#differential-update-mechanism-state-vector-diff)
- [Layer 2: TypeScript Micro-Kernel SDK (`@yoin/client`)](#layer-2-typescript-micro-kernel-sdk-yoinclient)
  - [Micro-Kernel + Plugin Architecture](#micro-kernel--plugin-architecture)
  - [Data Flow: Local Write & Container-Scoped Isolation](#data-flow-local-write--container-scoped-isolation)
  - [Data Flow: Remote Sync & Snapshot Hydration](#data-flow-remote-sync--snapshot-hydration)
  - [Three-Way Handshake Sync Protocol (with Empty-Diff Suppression)](#three-way-handshake-sync-protocol-with-empty-diff-suppression)
  - [Awareness Subsystem](#awareness-subsystem)
  - [Network Layer & Transient Offline Queue](#network-layer--transient-offline-queue)
  - [Transparent Proxy Read/Write Mechanism](#transparent-proxy-readwrite-mechanism)
  - [React 18 Integration Mechanism](#react-18-integration-mechanism)
- [Layer 3: Relay Server & Persistence Architecture](#layer-3-relay-server--persistence-architecture)
- [Testing Architecture](#testing-architecture)
- [Build Pipeline](#build-pipeline)

---

## Design Philosophy

Yoin's design revolves around four core principles:

1. **Local-First**
   All read and write operations execute directly on the in-memory WASM CRDT document with zero latency. The network layer asynchronously transmits binary diffs in the background, enabling seamless editing and persistence even when completely offline.

2. **Micro-Kernel**
   The `YoinClient` core retains only four responsibilities: CRDT operations, network synchronization, container-scoped subscriptions, and Awareness presence. IndexedDB persistence, multi-container Undo/Redo, and debug logging are mounted as plugins via the `YoinPlugin` interface.

3. **Zero-Config Sync**
   Developers read and write plain JavaScript objects via `createMapProxy`, `createArrayProxy`, or React Hooks (`useYoinMap`, `useYoinArray`, `useYoinText`), while the underlying layer automatically handles CRDT transaction encoding, binary packet assembly, and WebSocket broadcasting.

4. **Dumb Pipe Relay + Snapshot Hydration**
   The WebSocket relay layer does not need to parse CRDT payloads; all merge computations happen inside client-side WASM. Meanwhile, `exportSnapshot()` and `applySnapshot()` allow seamless server-side snapshot preloading for instant room initialization.

---

## System Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                            │
│   React Components (useYoinMap / useYoinArray / useYoinText)        │
│   Vanilla JS (createMapProxy / createArrayProxy / Direct API)       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     @yoin/client (TypeScript)                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    YoinClient (Micro-Kernel)                   │  │
│  │  • Text / Rich-Text Delta / Map CRUD / Array CRUD             │  │
│  │  • Container-Scoped Subscriptions (Map / Array / Text)        │  │
│  │  • Snapshot Hydration (applySnapshot / exportSnapshot)        │  │
│  │  • Zod Schema Validation (setMap / batchSet / Array)          │  │
│  │  • Awareness Engine (Throttle 30ms + Heartbeat + GC)          │  │
│  └──────┬────────────────────┬────────────────────┬──────────────┘  │
│         │                    │                    │                  │
│  ┌──────▼──────┐     ┌──────▼───────┐     ┌──────▼──────────────┐  │
│  │   Plugins   │     │NetworkManager│     │   WASM Loader       │  │
│  │ • DbPlugin  │     │ • WebSocket  │     │ • Singleton Lock    │  │
│  │ • UndoPlugin│     │ • Non-Trans  │     │ • Memory Cleanup    │  │
│  │ • Logger    │     │   Offline Q  │     │   (doc.free)        │  │
│  └─────────────┘     └──────┬───────┘     └──────┬──────────────┘  │
└─────────────────────────────┼────────────────────┼──────────────────┘
                              │                    │
               WebSocket      │                    │ FFI (wasm-bindgen)
            (Binary Protocol) │                    │
┌─────────────────────────────┼────────────────────▼──────────────────┐
│                             │         @yoin/core (Rust WASM)        │
│                             │  ┌─────────────────────────────────┐  │
│                             │  │ YoinDoc                         │  │
│                             │  │  • yrs::Doc                     │  │
│                             │  │  • yrs::UndoManager (All Types) │  │
│                             │  │  • js_to_any / any_to_js        │  │
│                             │  │  • Rich Text Delta + Formatting │  │
│                             │  └─────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                Relay Server (Yoin-apps-example)                     │
│  • Cloudflare Worker + Durable Objects / Node.js WS Relay           │
│  • Room Routing + Binary Broadcast (excluding sender)               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
yoin/
├── pnpm-workspace.yaml          # Workspace definition (packages/*)
├── package.json                 # Root scripts & devDependencies
├── packages/
│   ├── core/                    # @yoin/core — Rust WASM CRDT engine
│   │   ├── Cargo.toml           # Rust dependencies (yrs 0.18, wasm-bindgen, serde, js-sys)
│   │   ├── src/
│   │   │   └── lib.rs           # Complete YoinDoc implementation
│   │   └── pkg-web/             # wasm-pack build output (core.js, core_bg.wasm, core.d.ts)
│   └── client/                  # @yoin/client — TypeScript SDK
│       ├── package.json         # Dual Exports: "." and "./react"
│       ├── tsup.config.ts       # ESM + CJS dual-format bundling config
│       ├── vitest.config.ts     # Unit test & coverage config
│       └── src/
│           ├── index.ts         # Main entry exports
│           ├── YoinClient.ts    # Micro-kernel main class
│           ├── types.ts         # Global types & protocol constants (incl. TextDeltaOp)
│           ├── plugin.ts        # YoinPlugin interface definition
│           ├── network.ts       # WebSocket connection, reconnection, transient-filtered queue
│           ├── storage.ts       # IndexedDB wrapper (cached connection singleton + close)
│           ├── proxy.ts         # createMapProxy / createArrayProxy
│           ├── logger.ts        # Built-in Logger plugin
│           ├── wasm/
│           │   └── loader.ts    # WASM singleton initializer
│           ├── plugins/
│           │   ├── index.ts
│           │   ├── db.ts        # IndexedDB auto-debounced save & post-load sync plugin
│           │   └── undo.ts      # Auto-expanding Undo/Redo plugin across all containers
│           ├── react/
│           │   └── index.tsx    # React 18 Hooks (Provider, Map, Array, Text, Status, Undo)
│           └── __tests__/       # Vitest unit & real WASM integration tests (123 tests)
├── tests/
│   └── monorepo-integrity.test.mjs  # Monorepo structural integrity tests (54 checks)
└── docs/                        # Technical documentation
```

> Runnable demo applications, the API test sandbox, the Node.js relay server, and the Cloudflare Worker live in the companion [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) repository.

---

## Layer 1: Rust CRDT Core (`@yoin/core`)

### Why Yrs + WASM

- **Performance & Compact Binary**: Yrs is the official Rust port of Yjs, compiling down to a ~236 KB `core_bg.wasm` binary with predictable memory usage.
- **Cross-Language Binary Compatibility**: Uses Yjs v1 Encoding (`encode_state_as_update_v1` / `Update::decode_v1`), ensuring 100% compatibility with the broader Yjs ecosystem.

### YoinDoc Internal Structure & Native Type Fidelity

`packages/core/src/lib.rs` defines the `YoinDoc` struct exported to JavaScript:

```rust
#[wasm_bindgen]
pub struct YoinDoc {
    doc: Doc,
    undo_manager: Option<UndoManager>,
}
```

**Native Type Fidelity (`js_to_any` / `any_to_js`)**:
Instead of coercing strings via `JSON.parse` / `serde_json::from_str`, Yoin v0.1.2 converts `JsValue` directly into `yrs::Any` recursively:
- JavaScript `"123"` maps to `Any::String("123")`, `123` maps to `Any::Number(123.0)`, `"true"` maps to `Any::String("true")`, and `true` maps to `Any::Bool(true)`.
- Nested JavaScript Arrays and Objects recursively map to `Any::Array` and `Any::Map`.

**Supported CRDT Operations**:

| Category | Rust Methods | Yrs Type | Description |
|----------|-------------|----------|-------------|
| **Text / Rich Text** | `insert_text`, `insert_text_with_attrs`, `delete_text`, `format_text`, `apply_text_delta`, `clear_text`, `get_text`, `get_text_delta` | `TextRef` | Multiple named text containers, formatting attributes, and Quill Deltas |
| **Map** | `map_set`, `map_delete`, `map_get`, `map_get_all`, `map_set_deep`, `batch_set` | `MapRef` + `MapPrelim` | Full key-value CRUD, deep arbitrary-type updates, and batch transactions |
| **Array** | `array_push`, `array_insert`, `array_delete`, `array_get_all` | `ArrayRef` | Ordered list push, indexed insert, range delete, and read |
| **Sync** | `encode_state_vector`, `encode_diff`, `apply_update` | `StateVector` + `Update` | Binary state vector and differential sync |
| **Undo** | `init_undo_manager`, `expand_undo_scope`, `expand_undo_scope_for`, `undo`, `redo` | `UndoManager` | Dynamic undo scope expansion across Map, Array, and Text containers |

### Differential Update Mechanism (State Vector Diff)

Every write operation records the state vector before the transaction and encodes only the minimal binary diff produced by that transaction:

```rust
let sv_before = self.doc.transact().state_vector();
{
    let mut txn = self.doc.transact_mut();
    // Perform CRDT mutation...
}
let txn = self.doc.transact();
txn.encode_diff_v1(&sv_before)
```

---

## Layer 2: TypeScript Micro-Kernel SDK (`@yoin/client`)

### Micro-Kernel + Plugin Architecture

`YoinClient` dispatches every local mutation through `applyLocalUpdate(diff, notifyFn)`:
1. Triggers `plugin.onBeforeUpdate(diff)`
2. Broadcasts `[MSG_SYNC_STEP_2, ...diff]` over `NetworkManager`
3. Triggers `plugin.onAfterUpdate(diff)`, `onLocalUpdate`, and `onDocUpdate` hooks
4. Invokes the container-specific `notifyFn()` (e.g., `notifyMapSubscribers(mapName)`) plus any legacy global subscribers

### Data Flow: Local Write & Container-Scoped Isolation

When `client.setMap('shapes', 'rect1', data)` is called locally, `notifyMapSubscribers('shapes')` notifies **only** listeners subscribed to `'shapes'`. Components subscribed to other Maps, Arrays, or Text containers do not re-render, keeping 60FPS canvas interactions smooth.

### Data Flow: Remote Sync & Snapshot Hydration

When receiving `MSG_SYNC_STEP_2` or calling `applySnapshot(snapshot)`, `this.doc.apply_update(payload)` merges the binary update into WASM and calls `notifyAllSubscribers()` to refresh all active containers.

### Three-Way Handshake Sync Protocol (with Empty-Diff Suppression)

To prevent $O(N^2)$ broadcast storms in multi-peer rooms, `YoinClient` checks `hasNonEmptyUpdate(diff)` (filtering out 0-byte or `[0, 0]` empty Yrs diffs) before replying with `MSG_SYNC_STEP_2` during `MSG_SYNC_STEP_1` and `MSG_SYNC_STEP_1_REPLY`.

### Awareness Subsystem

Awareness uses `MSG_AWARENESS = 3` with 30ms throttling, 5s heartbeats, 30s garbage collection, and `{ transient: true }` broadcasting so presence packets never accumulate in the offline queue.

### Network Layer & Transient Offline Queue

`NetworkManager` features exponential backoff reconnection (`1000ms * 2^attempt`, capped at 30s, max 50 retries before `'failed'`) and filters out `{ transient: true }` packets when offline so only genuine CRDT diffs are queued and flushed upon reconnect.

### Transparent Proxy Read/Write Mechanism

- **`createMapProxy`**: Intercepts `get`, `set`, `deleteProperty`, `has`, and `ownKeys`, returning `undefined` for missing keys and wrapping nested objects in deep proxies.
- **`createArrayProxy`**: Reads live from `client.getArray` on every property access and maps `.push()`, `.splice()`, `.pop()`, `.shift()`, and `.unshift()` to CRDT Array operations.

### React 18 Integration Mechanism

`@yoin/client/react` uses `useSyncExternalStore` backed by `subscribeMap`, `subscribeArray`, `subscribeText`, and `subscribeNetwork` for tear-free, container-isolated rendering.

---

## Layer 3: Relay Server & Persistence Architecture

Yoin works with any WebSocket relay implementing the 1-byte header protocol (reference implementations in `Yoin-apps-example`), and supports server-side snapshot persistence and preloading via `exportSnapshot()` and `applySnapshot()`.

---

## Testing Architecture

| Test File | Tests | Covered Modules |
|-----------|-------|-----------------|
| `real-wasm.test.ts` | 8 | Real `core_bg.wasm` integration tests (type fidelity, Map/Array CRUD, rich-text Delta, 2-peer sync, Undo/Redo) |
| `YoinClient.test.ts` | 36 | `YoinClient` methods, container subscriptions, snapshots, empty-diff suppression, Zod schemas, Awareness |
| `plugins.test.ts` | 21 | `YoinDbPlugin`, `YoinUndoPlugin` (multi-container scope), `LoggerPlugin` |
| `network.test.ts` | 15 | `NetworkManager` connection, backoff, transient offline queue filtering |
| `proxy.test.ts` | 15 | `createMapProxy` (`delete`/`in`/`keys`), `createArrayProxy` (`splice`/`pop`/`unshift`) |
| `storage.test.ts` | 12 | `StorageAdapter` IndexedDB snapshot read/write and connection caching |
| `loader.test.ts` | 9 | `initYoin` singleton lock, concurrent calls, error recovery |
| `types.test.ts` | 7 | Protocol constant validation |
| `monorepo-integrity.test.mjs` | 54 | Workspace structure, package exports, build artifact verification |

---

## Build Pipeline

```
Step 1: pnpm build:wasm
  packages/core/src/lib.rs ──► packages/core/pkg-web/{core.js, core_bg.wasm, core.d.ts}

Step 2: pnpm build:client
  packages/client/src/{index.ts, react/index.tsx} ──► packages/client/dist/{index.*, react.*, core_bg.wasm}
```
