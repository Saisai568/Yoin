# Yoin - Local-First Synchronization Framework

> A high-performance, local-first synchronization engine built with Rust, WASM, and TypeScript.

**Yoin** is an experimental framework designed to bring seamless offline-first capabilities to web applications. It leverages **CRDTs (Conflict-free Replicated Data Types)** via `yrs` to ensure eventual consistency, while using **WebAssembly** for performant core logic and **Incremental Updates** for efficient network usage.

## 🌟 Key Features

* **Local-First Architecture**: Data is stored locally in IndexedDB first. Applications work offline by default.
* **Real-time Synchronization**: Seamless state syncing between multiple clients via WebSocket.
* **Efficient Binary Protocol**: Low-overhead communication using custom 1-byte headers and a 3-way handshake for reliable state synchronization.
* **Resilient Sync Engine**: Features an offline queue for disconnected editing and debounced persistence for optimal local storage performance.
* **High Performance**: Core logic written in **Rust** and compiled to **WebAssembly (WASM)**.
* **Complex Data Support**: Beyond text, natively handles Maps and Arrays for sophisticated application state.
* **Awareness & Presence**: Real-time monitoring of active users with automated cleanup and status broadcasting.
* **TypeScript SDK**: Fully typed client SDK for a developer-friendly experience.

## 🏗 Architecture & Protocol

**Yoin** implements a robust synchronization protocol designed for resilience and consistency:

1.  **3-Way Handshake**:
    *   **Step 1**: Client A connects and sends `MSG_SYNC_STEP_1` (State Vector).
    *   **Step 2**: Client B receives state, calculates differential updates (Deltas), and replies with `MSG_SYNC_STEP_2` (Delta) + `MSG_SYNC_STEP_1_REPLY` (B's State Vector).
    *   **Step 3**: Client A processes Delta and sends back missing updates for B.
    *   *Result*: Both clients converge within milliseconds of connection.

2.  **Resilience Layer**:
    *   **Offline Queue**: Updates generated while disconnected are buffered in memory and automatically flushed upon reconnection.
    *   **Debounced Persistence**: Local IndexedDB writes are throttled (e.g., 1000ms delay) to prevent UI blocking during high-frequency typing.

3.  **Awareness System**:
    *   **Ephemeral State**: Cursor positions and user presence are broadcast separately via `MSG_AWARENESS` (Type 3) messages.
    *   **Heartbeat & GC**: Clients broadcast "I'm alive" every 15s. Stale clients (>30s silence) are automatically garbage collected from the peer list.

## 🚀 Getting Started

### Prerequisites

* **Rust** (latest stable) & `wasm-pack`
* **Node.js** (v16+) & `npm`

### Installation & Setup

1.  **Build the WASM Core**
    ```bash
    cd core
    wasm-pack build --target web
    ```

2.  **Start the Relay Server**
    ```bash
    cd server
    npm install
    node server.js
    ```

3.  **Start the Client App**
    ```bash
    cd client
    npm install
    npm run dev
    ```

4.  **Open in Browser**
    Visit `http://localhost:5173`. Open multiple tabs to test real-time synchronization!

## 🧪 API Usage

The `YoinClient` provides a simple, strongly-typed API for collaborative features.

```typescript
// 1. Initialize Client
const client = new YoinClient({
    url: 'ws://localhost:8080',
    dbName: 'MyNotesDB',
    docId: 'room-1',
});

// 2. Collaborative Text Editing
// Insert "Hello" at position 0
await client.insertText(0, "Hello");

// Read current content
const text = client.getText();
console.log(text); // "Hello"

// Subscribe to text changes
client.subscribe((newText) => {
    updateTextArea(newText);
});

// 3. Shared State (Map)
// Store complex objects securely (handled via Rust + serde_json)
await client.setMap('config', 'theme', { mode: 'dark', color: '#333' });

// Retrieve state
const theme = client.getMap('config');

// 4. Awareness (Cursors & Presence)
// Broadcast my cursor position (not persisted to DB)
client.setAwareness({
    name: 'Alice',
    cursor: { x: 100, y: 200 },
    color: '#ff0000'
});

// Listen for other users
client.subscribeAwareness((states) => {
    states.forEach((state, clientId) => {
        renderCursor(clientId, state.cursor);
    });
});
```

## 🛠 Project Structure

```text
.
├── core/           # Rust source code (CRDT logic)
│   ├── src/lib.rs  # Main WASM bindings
│   └── pkg/        # Generated WASM package (WASM + TS bindings)
├── client/         # Demo App & UI Logic (Vite + TS)
│   ├── src/
│   │   ├── yoin/       # Core Yoin SDK (Modularized)
│   │   │   ├── YoinClient.ts  # Orchestrator
│   │   │   ├── network.ts     # WS Protocol & Offline Queue
│   │   │   ├── storage.ts     # IndexedDB Adapter
│   │   │   └── types.ts       # Typed Interfaces
│   │   ├── renderers.ts       # Remote Cursors & UI Renderers
│   │   └── main.ts            # App Entry Point & UI Logic
├── server/         # Simple Node.js WebSocket Relay
└── README.md
```

## 📝 Roadmap

* [x] **Phase 1: MVP** (Basic Sync, Persistence, Network)
* [x] **Phase 2: Industrialization** (Binary Protocol, Offline Queue, Map/Array Support, Awareness System)
* [ ] **Phase 3: DX & UX Polish** (Live Cursors, Network State UI, SDK Modularization)
* [ ] **Phase 4: Ecosystem & Security** (React/Vue Hooks, npm Release, Auth & Room Isolation)

## 🤝 Contributing

This project is currently in the **Prototype/Alpha** stage. Ideas and discussions are welcome!

## 📄 Copyright & License

Copyright (c) 2026 Saisai568. Licensed under the MIT License.
