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

## 🏗 Architecture

The system consists of three main layers:

1.  **Core (Rust + WASM)**: Handles CRDT operations, state vectors, and delta calculation.
2.  **Client SDK (TypeScript)**:
    * **StorageAdapter**: Manages persistence to IndexedDB.
    * **NetworkProvider**: Handles WebSocket communication and binary protocol.
    * **YoinClient**: The main entry point orchestrating the sync loop.
3.  **Server (Node.js)**: A lightweight WebSocket relay that broadcasts binary updates to connected peers.

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

## 🛠 Project Structure

```text
.
├── core/           # Rust source code (CRDT logic)
│   ├── src/lib.rs  # Main WASM bindings
│   └── pkg/        # Generated WASM package
├── client/         # Frontend SDK & Demo App (Vite + TS)
│   ├── src/
│   │   ├── YoinClient.ts  # Main Framework Class
│   │   ├── storage.ts     # IndexedDB Adapter
│   │   └── network.ts     # WebSocket Provider
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
