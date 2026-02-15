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
| **wasm-pack** | latest | Rust → WASM builds. Install: `cargo install wasm-pack` |
| **wasm32 target** | — | `rustup target add wasm32-unknown-unknown` |

### Optional Tools

| Tool | Purpose |
|------|---------|
| **Wrangler** | Cloudflare Worker local dev / deployment (already installed as a devDependency in each package) |
| **Playwright** | E2E testing. First-time setup: `pnpm exec playwright install` |

### Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd yoin

# 2. Install all dependencies (pnpm workspace auto-links packages)
pnpm install

# 3. Build the WASM Core (must be done first — other packages depend on it)
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
│   │   ├── src/lib.rs      # Core logic (~300 lines)
│   │   ├── Cargo.toml      # Rust dependencies
│   │   └── pkg-web/        # wasm-pack output (auto-generated, do not edit)
│   └── client/             # @yoin/client — TypeScript SDK
│       ├── src/
│       │   ├── YoinClient.ts    # Micro-kernel
│       │   ├── network.ts       # WebSocket management
│       │   ├── storage.ts       # IndexedDB
│       │   ├── proxy.ts         # Proxy transparent writes
│       │   ├── plugin.ts        # Plugin interface
│       │   ├── plugins/         # Built-in plugins (db, undo)
│       │   ├── logger.ts        # Logger plugin
│       │   ├── react/           # React Hooks
│       │   └── wasm/            # WASM loader
│       ├── tsup.config.ts       # Build configuration
│       └── vitest.config.ts     # Test configuration
├── yoin-worker/            # Cloudflare Worker
│   ├── src/index.ts        # Durable Objects + routing
│   └── wrangler.jsonc      # Worker configuration
├── apps/
│   └── demo/               # Demo application
│       ├── src/
│       │   ├── main.ts     # Vanilla JS Demo
│       │   ├── App.tsx     # React Demo
│       │   └── renderers.ts# Cursor / avatar rendering
│       └── tests/          # Playwright E2E tests
├── server/                 # Node.js development server
├── docs/                   # Technical docs
├── tests/                  # Monorepo integration tests
└── deploy.bat              # One-click deploy script
```

### Package Dependency Graph

```
@yoin/core        ← No internal dependencies (Rust standalone build)
    ↑
@yoin/client      ← Depends on @yoin/core (workspace:*)
    ↑
@yoin/demo        ← Depends on @yoin/client, @yoin/core

yoin-worker       ← Fully independent (no workspace internal dependencies)
```

Build order must follow: **Core → Client → Demo**.

---

## Development Workflow

### Day-to-Day Development

```bash
# Start Demo dev server (with HMR)
pnpm dev:demo

# In another terminal, start SDK watch mode
cd packages/client && pnpm dev

# If you modified the Rust Core
pnpm build:wasm
```

### Guidelines by Area of Change

| Area | What to Do |
|------|-----------|
| Rust Core (`lib.rs`) | `pnpm build:wasm` → `pnpm build:client` → restart Demo |
| Client SDK | SDK `pnpm dev` auto-watches. Demo Vite HMR auto-reloads |
| React Hooks | Same as above (included in Client SDK) |
| Worker | `cd yoin-worker && pnpm run deploy` (or local `wrangler dev`) |
| Demo | `pnpm dev:demo` (Vite HMR auto-reloads) |

---

## Build Commands

### Root-Level Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Full build (WASM → SDK → Demo) |
| `pnpm build:wasm` | Build Rust Core → WASM only |
| `pnpm build:client` | Build @yoin/client SDK only |
| `pnpm build:demo` | Build Demo only |
| `pnpm deploy` | Full build + deploy (Worker + Pages) |
| `pnpm deploy:worker` | Deploy Worker only |
| `pnpm deploy:pages` | Build + deploy Pages |
| `pnpm dev:demo` | Start Demo dev server |
| `pnpm typecheck` | TypeScript type checking for all packages |
| `pnpm clean` | Remove all dist and cache files |

### Per-Package Commands

```bash
# packages/core
cd packages/core
wasm-pack build --target web --out-dir pkg-web

# packages/client
cd packages/client
pnpm build      # tsup build
pnpm dev        # tsup watch mode
pnpm test       # vitest tests
pnpm typecheck  # tsc --noEmit

# apps/demo
cd apps/demo
pnpm dev        # Vite dev server
pnpm build      # Vite production build
pnpm test       # Playwright E2E

# yoin-worker
cd yoin-worker
wrangler dev    # Local dev server
pnpm run deploy # Deploy to Cloudflare
```

---

## Testing

### Test Architecture

| Type | Tool | Command | Scope |
|------|------|---------|-------|
| Unit Tests | Vitest + happy-dom | `pnpm test:unit` | @yoin/client SDK |
| Integration Tests | Node.js scripts | `pnpm test:integration` | Monorepo structure validation |
| E2E Tests | Playwright | `pnpm test:e2e` | Multi-user collaboration flow |
| Coverage | Vitest + v8 | `pnpm test:coverage` | @yoin/client |

### Running Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# E2E only (browsers must be installed first)
pnpm exec playwright install
pnpm test:e2e

# Coverage report
pnpm test:coverage
```

### Writing Tests

**Unit tests** are located in `packages/client/` using Vitest:

```typescript
// packages/client/src/__tests__/example.test.ts
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should work correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**E2E tests** are located in `apps/demo/tests/` using Playwright:

```typescript
// apps/demo/tests/example.spec.ts
import { test, expect } from '@playwright/test';

test('collaboration', async ({ page, context }) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await page1.goto('/');
  await page2.goto('/');
  // ... test multi-user collaboration
});
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
- Every write operation follows the **sv_before → operation → encode_diff** pattern
- Tests use `#[cfg(test)]` modules

### File Naming

- TypeScript: **camelCase** (`YoinClient.ts`, `network.ts`)
- Rust: **snake_case** (`lib.rs`)
- Tests: `*.test.ts` (Vitest), `*.spec.ts` (Playwright)

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

Examples:

```
feat(client): add setMapDeep for nested Map writes
fix(worker): handle WebSocket close events gracefully
docs: update API.md with new React hooks
refactor(core): simplify undo manager initialization
test(e2e): add multi-browser collaboration test
```

---

## Git Workflow

### Branching Strategy

```
main           ← Stable release, always deployable
  └── feat/*   ← Feature development branches
  └── fix/*    ← Bug fix branches
  └── docs/*   ← Documentation update branches
```

### Submitting a Pull Request

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Develop and commit:
   ```bash
   git add .
   git commit -m "feat(client): add new feature"
   ```

3. Ensure all checks pass:
   ```bash
   pnpm build
   pnpm typecheck
   pnpm test
   ```

4. Push and open a PR:
   ```bash
   git push origin feat/my-feature
   ```

### PR Checklist

- [ ] `pnpm build` succeeds
- [ ] `pnpm typecheck` reports no errors
- [ ] `pnpm test` all tests pass
- [ ] Public API changes are documented in `API.md`
- [ ] Architecture changes are documented in `ARCHITECTURE.md`
- [ ] New features have corresponding tests

---

## Adding New Features

### Adding a CRDT Operation

1. **Rust Core**: Add a `#[wasm_bindgen]` method in the `YoinDoc impl` block in `packages/core/src/lib.rs`
2. **Rebuild WASM**: `pnpm build:wasm`
3. **Client SDK**: Add a public method in `packages/client/src/YoinClient.ts` calling `this.doc.xxx()` + `applyLocalUpdate()`
4. **Export**: Export new types / methods from `packages/client/src/index.ts`
5. **Document**: Update `API.md`
6. **Test**: Add Vitest unit tests

### Adding a Plugin

1. Create a new file in `packages/client/src/plugins/`
2. Implement the `YoinPlugin` interface
3. Provide a `createXxxPlugin()` factory function
4. Export from `packages/client/src/plugins/index.ts`
5. Export from `packages/client/src/index.ts`
6. Update `API.md`

```typescript
// packages/client/src/plugins/my-plugin.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';

export class MyPlugin implements YoinPlugin {
  readonly name = 'my-plugin';

  onInstall(client: YoinClient): void {
    // Initialization logic
  }

  onAfterUpdate(update: Uint8Array): void {
    // Logic after each update
  }

  onDestroy(): void {
    // Cleanup resources
  }
}

export function createMyPlugin() {
  const instance = new MyPlugin();
  return { plugin: instance };
}
```

### Adding a React Hook

1. Add the hook in `packages/client/src/react/index.tsx`
2. Use `useYoinClient()` to get the client instance
3. Use `useSyncExternalStore` to create a reactive subscription
4. Export from `packages/client/src/react/index.tsx`
5. Update `API.md`

### Modifying the Worker

1. Edit `yoin-worker/src/index.ts`
2. Test locally: `cd yoin-worker && wrangler dev`
3. Deploy: `pnpm deploy:worker`

> Note: The communication protocol constants (`MSG_SYNC_STEP_1`, etc.) between Worker and Client must stay in sync. When modifying the protocol, update both sides.

---

## FAQ

### Q: `pnpm build:wasm` fails

Ensure the Rust toolchain and WASM target are installed:
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Q: Client SDK can't find `@yoin/core`

Make sure the Core is built first:
```bash
pnpm build:wasm
```
pnpm workspace will auto-link `packages/core` as `@yoin/core`.

### Q: Playwright tests fail

Ensure browsers are installed:
```bash
npx playwright install
```

### Q: Worker deployment fails

Ensure you're logged in to Cloudflare:
```bash
npx wrangler login
```

### Q: TypeScript type errors after modifying Rust

`pkg-web/core.d.ts` is auto-generated by `wasm-pack`. After changing Rust APIs, rebuild:
```bash
pnpm build:wasm
pnpm build:client
```

### Q: How to test the full collaboration flow locally

```bash
# Terminal 1: Start Worker in local mode
cd yoin-worker && wrangler dev

# Terminal 2: Start Demo (update URL to point to localhost)
pnpm dev:demo

# Open two browser tabs to test real-time sync
```
