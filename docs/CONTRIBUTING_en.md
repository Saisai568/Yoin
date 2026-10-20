[繁體中文](CONTRIBUTING.md) | [English](CONTRIBUTING_en.md)

# Contributing Guide

Thanks for your interest in Yoin! This document explains how to get involved in development.

## Table of Contents

- [Environment Setup](#environment-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Build Commands](#build-commands)
- [Testing](#testing)
- [Code Style](#code-style)
- [Git Workflow](#git-workflow)
- [Adding New Features](#adding-new-features)
- [FAQ](#faq)

---

## Environment Setup

### Required Tools

| Tool | Version | Description |
|------|---------|-------------|
| **Node.js** | ≥ 18 | JavaScript runtime |
| **pnpm** | ≥ 9 | Package manager. Install: `npm install -g pnpm` |
| **Rust** | stable | CRDT Core compilation. Install: [rustup.rs](https://rustup.rs/) |
| **wasm-pack / wasm-bindgen** | latest | Rust → WASM builds. Install: `cargo install wasm-pack` or `cargo install wasm-bindgen-cli` |
| **wasm32 target** | — | `rustup target add wasm32-unknown-unknown` |

### Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd yoin

# 2. Install all dependencies (pnpm workspace auto-links packages)
pnpm install

# 3. Build the WASM Core (must be done first — Client package depends on it)
pnpm build:wasm

# 4. Build the Client SDK
pnpm build:client

# 5. Verify everything works
pnpm typecheck
pnpm test
```

---

## Project Structure

```
yoin/
├── packages/
│   ├── core/               # @yoin/core — Rust CRDT engine
│   │   ├── src/lib.rs      # Core logic (YoinDoc, js_to_any, Rich Text Delta, UndoManager)
│   │   ├── Cargo.toml      # Rust dependencies
│   │   └── pkg-web/        # wasm-pack output (auto-generated, do not edit)
│   └── client/             # @yoin/client — TypeScript SDK
│       ├── src/
│       │   ├── YoinClient.ts    # Micro-kernel (container subscriptions, snapshots, empty-diff suppression)
│       │   ├── network.ts       # WebSocket management & transient-filtered offline queue
│       │   ├── storage.ts       # IndexedDB wrapper (cached connection singleton)
│       │   ├── proxy.ts         # Transparent Proxy read/write (Map / Array)
│       │   ├── plugin.ts        # Plugin interface
│       │   ├── plugins/         # Built-in plugins (db, undo)
│       │   ├── logger.ts        # Logger plugin
│       │   ├── react/           # React 18 Hooks
│       │   ├── wasm/            # WASM loader
│       │   └── __tests__/       # Vitest unit & real WASM integration tests
│       ├── tsup.config.ts       # Build configuration
│       └── vitest.config.ts     # Test configuration
├── docs/                   # Technical docs
└── tests/                  # Monorepo structural integration tests
```

> Runnable demo applications (Vanilla / React Demo, API test sandbox), the Cloudflare Worker (`yoin-worker`), and the Node.js relay server (`server`) live in the companion [`Yoin-apps-example`](https://github.com/s9900930/Yoin-apps-example) repository.

### Package Dependency Graph

```
@yoin/core        ← No internal dependencies (Rust standalone build)
    ↑
@yoin/client      ← Depends on @yoin/core (workspace:*) bundled at build time
```

Build order must follow: **Core → Client**.

---

## Development Workflow

### Day-to-Day Development

```bash
# Start Client SDK watch mode
cd packages/client && pnpm dev

# If you modified the Rust Core
pnpm build:wasm
pnpm build:client
```

### Guidelines by Area of Change

| Area | What to Do |
|------|-----------|
| Rust Core (`lib.rs`) | `pnpm build:wasm` → `pnpm build:client` → `pnpm test` |
| Client SDK | `pnpm build:client` → `pnpm typecheck` → `pnpm test` |
| React Hooks | Same as above (included in Client SDK, exported via `@yoin/client/react`) |

---

## Build Commands

### Root-Level Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Full build (WASM → SDK) |
| `pnpm build:wasm` | Build Rust Core → WASM only |
| `pnpm build:client` | Build `@yoin/client` SDK only |
| `pnpm typecheck` | TypeScript type checking for all packages |
| `pnpm clean` | Remove all `dist` and cache files |

### Per-Package Commands

```bash
# packages/core
cd packages/core
wasm-pack build --target web --out-dir pkg-web

# packages/client
cd packages/client
pnpm build          # tsup build
pnpm dev            # tsup watch mode
pnpm test           # vitest tests (123 tests)
pnpm test:coverage  # vitest coverage report
pnpm typecheck      # tsc --noEmit
```

---

## Testing

### Test Architecture

| Type | Tool | Command | Scope |
|------|------|---------|-------|
| Unit + Real WASM Tests | Vitest + happy-dom | `pnpm test:unit` | `@yoin/client` SDK & `@yoin/core` WASM integration (123 tests) |
| Integration Tests | Node.js scripts | `pnpm test:integration` | Monorepo structure & build output validation (54 checks) |
| Coverage | Vitest + v8 | `pnpm test:coverage` | `@yoin/client` (~74% statements / ~76% lines) |

### Running Tests

```bash
# All tests
pnpm test

# Unit & real WASM tests only
pnpm test:unit

# Structural integration tests only
pnpm test:integration

# Coverage report
pnpm test:coverage
```

---

## Code Style

### TypeScript

- Use `strict` mode
- Prefer `interface` over `type` (unless union types are needed)
- Use explicit type annotations for function parameters
- Add JSDoc comments for public APIs
- Prefer `const` declarations; avoid `var`

### Rust

- Follow `cargo fmt` formatting
- Annotate all public APIs with `#[wasm_bindgen]`
- Every write operation follows the **sv_before → operation → encode_diff_v1** pattern and uses `js_to_any` to preserve native JS types
- Tests use `#[cfg(test)]` modules

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: documentation update
refactor: refactor (no behavior change)
test: add/modify tests
chore: build/tooling changes
perf: performance improvement
```

---

## Git Workflow

### Submitting a Pull Request

1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Develop and commit your changes
3. Ensure all checks pass:
   ```bash
   pnpm build
   pnpm typecheck
   pnpm test
   ```
4. Push and open a PR

---

## Adding New Features

### Adding a CRDT Operation

1. **Rust Core**: Add a `#[wasm_bindgen]` method in the `YoinDoc impl` block in `packages/core/src/lib.rs`
2. **Rebuild WASM**: `pnpm build:wasm`
3. **Client SDK**: Add a public method in `packages/client/src/YoinClient.ts` calling `this.doc.xxx()` + `applyLocalUpdate(diff, () => this.notifyXxxSubscribers(name))`
4. **Undo Tracking**: Ensure the operation automatically expands the undo scope in `packages/client/src/plugins/undo.ts`
5. **Export & Document**: Export from `packages/client/src/index.ts` and update `docs/API.md` and `docs/API_en.md`
6. **Test**: Add tests in `packages/client/src/__tests__/` (including `real-wasm.test.ts`)

---

## FAQ

### Q: `pnpm build:wasm` fails

Ensure the Rust toolchain and WASM target are installed:
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Q: TypeScript type errors after modifying Rust

`pkg-web/core.d.ts` is auto-generated. After changing Rust APIs, rebuild:
```bash
pnpm build:wasm
pnpm build:client
```
