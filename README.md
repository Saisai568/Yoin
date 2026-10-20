[繁體中文](README_zh_Hant.md) | [English](README.md)

# Yoin (餘韻)

**Local-First Real-Time Collaborative State Sync Framework — Powered by Rust WASM (Yrs) + TypeScript Micro-Kernel**

[![Tests](https://img.shields.io/badge/tests-123%20passed-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-74%25-green)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()
[![Rust](https://img.shields.io/badge/Rust-WASM-orange)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## What is Yoin?

Yoin is a lightweight **Local-First real-time collaboration engine** that wraps [Yrs](https://github.com/y-crdt/y-crdt) (the Rust implementation of Yjs) via WebAssembly into a ready-to-use TypeScript SDK for the frontend.

**Key Features**:

- **Conflict-Free CRDT Merging** — Built on Yrs, supporting Rich Text Deltas (formatting attributes & multiple named text containers), Map (full CRUD, native type fidelity, deep nesting & batch transactions), and Array (push / insert / delete / move)
- **Local-First Architecture** — Zero-latency local operations, automatic IndexedDB persistence (cached connection singleton) + non-transient offline queue + exponential backoff auto-reconnection
- **Container-Scoped Subscriptions** — Dedicated `subscribeMap`, `subscribeArray`, and `subscribeText` listeners isolate 60FPS canvas dragging from rich-text editing
- **Micro-Kernel + Plugin System** — Lean core extensible via the `YoinPlugin` interface (persistence, multi-container Undo/Redo, logging, etc.)
- **Transparent Proxy Read/Write** — Mutate CRDTs with native JS property assignments (`proxy.key = val`, `delete proxy.key`, `arr.splice(...)`), automatically synced to all peers
- **React 18 Hooks** — Built on `useSyncExternalStore`, providing `<YoinProvider>`, `useYoinMap`, `useYoinArray`, `useYoinText`, `useYoinAwareness`, `useYoinStatus`, and `useYoinUndo`
- **Real-Time Awareness** — Instant broadcast of cursor positions, selections, online status, and device types (with transient offline filtering & automatic garbage collection)
- **Snapshot Hydration & Broadcast Storm Suppression** — Supports `applySnapshot` / `exportSnapshot` for server snapshot preloading and suppresses empty diff packets during the 3-way handshake
- **Schema Validation** — Integrated with [Zod](https://zod.dev/) to validate data structures before writing (`setMap`, `batchSet`, `pushArray`, `insertArray`)

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 9
- **Rust** + **wasm-pack** (only needed when modifying Core)

### Installation & Build

```bash
# Clone the project
git clone <repo-url>
cd yoin

# Install dependencies
pnpm install

# Build everything (WASM Core → Client SDK)
pnpm build
```

> Runnable demo apps, API test sandboxes, the Node.js relay server, and the Cloudflare Worker live in the companion [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) repository.

### Get Started in 30 Seconds

**Vanilla TypeScript**:

```typescript
import { initYoin, YoinClient, createMapProxy, createDbPlugin, createUndoPlugin } from '@yoin/client';

// 1. Initialize the WASM engine (only needed once globally)
await initYoin();

// 2. Create a client and mount plugins
const { plugin: dbPlugin } = createDbPlugin({ dbName: 'my-app' });
const { plugin: undoPlugin, undo, redo } = createUndoPlugin();

const client = new YoinClient({
  url: 'wss://your-worker.workers.dev',
  docId: 'my-room',
})
  .use(dbPlugin)
  .use(undoPlugin);

// 3. Read/write directly via Proxy — automatic CRDT sync!
const state = createMapProxy<{ count: number; title: string }>(client, 'app-state');
state.count = 1;           // → Automatically synced to all connected peers (native number preserved)
state.title = 'Hello Yoin';

// 4. Subscribe to a specific container for isolated updates
client.subscribeMap('app-state', () => {
  console.log('State updated:', state.count, state.title);
});
```

**React**:

```tsx
import {
  YoinProvider,
  useYoinMap,
  useYoinText,
  useYoinAwareness,
  useYoinStatus,
  useYoinUndo,
} from '@yoin/client/react';

function App() {
  return (
    <YoinProvider config={{ url: 'wss://...', docId: 'my-room' }}>
      <Counter />
    </YoinProvider>
  );
}

function Counter() {
  const state = useYoinMap<{ count: number }>('app-state');
  const { text, insert, format } = useYoinText('content');
  const { states, setLocalState } = useYoinAwareness();
  const status = useYoinStatus();
  const { undo, redo } = useYoinUndo();

  return (
    <div>
      <p>Status: {status} | Online: {states.size}</p>
      <button onClick={() => { state.count = (state.count || 0) + 1; }}>
        Count: {state.count ?? 0}
      </button>
      <button onClick={undo}>Undo</button>
      <button onClick={redo}>Redo</button>
    </div>
  );
}
```

---

## Project Structure

```
yoin/
├── packages/
│   ├── core/               # @yoin/core — Rust CRDT core (Yrs → WASM)
│   └── client/             # @yoin/client — TypeScript micro-kernel SDK + React Hooks
├── docs/                   # Comprehensive technical documentation
└── tests/                  # Monorepo integration tests
```

| Package | Description | Size |
|---------|-------------|------|
| `@yoin/core` | Rust Yrs wrapper, compiled to WebAssembly with native `yrs::Any` & rich-text Delta support | ~236 KB (WASM) |
| `@yoin/client` | TypeScript micro-kernel SDK + Plugins + Proxy | ~26 KB (ESM) |
| `@yoin/client/react` | React 18 Hooks (`useYoinMap`, `useYoinArray`, `useYoinText`, etc.) | ~3.5 KB (ESM) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│            React Hooks  /  Proxy  /  Direct API          │
├─────────────────────────────────────────────────────────┤
│                  @yoin/client (TS SDK)                    │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌────────────┐  │
│  │YoinClient │ │ Network  │ │ Storage │ │  Plugins   │  │
│  │ (Micro-   │ │(WebSocket│ │(Indexed │ │ (DB/Undo/  │  │
│  │  Kernel)  │ │ +Queue)  │ │  DB)    │ │  Logger)   │  │
│  └─────┬─────┘ └────┬─────┘ └─────────┘ └────────────┘  │
├────────┼────────────┼───────────────────────────────────┤
│        ▼            ▼                                    │
│  ┌───────────┐ ┌──────────────────────────────────────┐  │
│  │@yoin/core │ │        Relay Server / Worker         │  │
│  │(Rust WASM)│ │ (Cloudflare DO / Node.js WS Relay)   │  │
│  └───────────┘ └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Common Commands

```bash
# Development & Build
pnpm build              # Full build (WASM → SDK)
pnpm build:wasm         # Build Rust → WASM only
pnpm build:client       # Build Client SDK only

# Testing & Type Checking
pnpm test               # Run all tests (Unit + Real WASM + Integration)
pnpm test:unit          # Unit & real WASM integration tests (Vitest, 123 tests)
pnpm test:integration   # Monorepo structure tests (54 checks)
pnpm test:coverage      # Test coverage report
pnpm typecheck          # TypeScript type checking
```

---

## Documentation Guide

| Document | Description |
|----------|-------------|
| **[Beginner Demo Guide](BEGINNER_DEMO_GUIDE.md)** | Step-by-step tutorial for building a dual-tab real-time sticky note app |
| **[API Tutorial (ZH)](docs/API_TUTORIAL._zh_Hant.md)** | Hands-on tutorial verified against `@yoin/client` v0.1.2 |
| **[API Reference](docs/API_en.md)** | Complete signatures and examples for all public classes, functions, types, Hooks, and plugins |
| **[Architecture Doc](docs/ARCHITECTURE_en.md)** | System layering, CRDT data flow, three-way handshake protocol, micro-kernel design |
| **[Contributing Guide](docs/CONTRIBUTING_en.md)** | Environment setup, dev workflow, writing tests, commit conventions |
| **[Changelog](CHANGELOG.md)** | Release history and upgrade notes |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **CRDT Core** | Rust, [Yrs](https://docs.rs/yrs) 0.18, wasm-bindgen |
| **Client SDK** | TypeScript (strict), tsup (ESM + CJS), Zod |
| **Frontend Integration** | React 18 (`useSyncExternalStore`), JavaScript Proxy |
| **Offline Storage** | IndexedDB (`StorageAdapter` cached connection) |
| **Testing Framework** | Vitest, happy-dom, Real WASM Integration Tests |
| **Monorepo** | pnpm workspace |

---

## License

MIT
