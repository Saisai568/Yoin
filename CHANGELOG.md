# Changelog

All notable changes to the Yoin project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-02-16

### 🎉 First Public Release

Initial release of Yoin - a local-first real-time collaborative state synchronization framework.

#### Added
- 🦀 **Rust/WASM CRDT Engine** powered by [Yrs](https://github.com/y-crdt/y-crdt)
- 📦 **TypeScript Client SDK** with Micro-kernel + Plugin architecture
- ☁️ **Cloudflare Durable Objects** WebSocket relay server with Hibernation API
- 💾 **IndexedDB Persistence** via `createDbPlugin`
- ↩️ **Undo/Redo Support** via `createUndoPlugin`
- 👥 **Awareness System** for real-time cursors and presence
- ✨ **Proxy-based Transparent Writes** (`createMapProxy`, `createArrayProxy`)
- ⚛️ **React Hooks** (`useYoinMap`, `useYoinArray`, `useYoinAwareness`)
- 🔒 **Schema Validation** with Zod integration
- 📡 **Offline-First Architecture** with automatic sync on reconnect

---

## [0.1.0-rc.1] - 2026-02-16

### 🔒 Security & Stability Hardening (Pre-release Code Review Fixes)

This release addresses all **CRITICAL** issues identified in the pre-release code review.

#### 🚨 CRITICAL Fixes

##### 1. Version Number Consistency
- **Fixed:** Unified version numbers across all packages to `0.1.0`
  - Root `package.json`: `0.0.0` → `0.1.0`
  - `@yoin/core`: `0.2.0` → `0.1.0`
  - `@yoin/client`: `0.1.0` (unchanged)
- **Impact:** Prevents npm publish failures and workspace dependency conflicts

##### 2. Network Reconnection Logic
- **Fixed:** Implemented exponential backoff with max retry limit in `NetworkProvider`
- **Before:** Infinite reconnection every 3 seconds → resource exhaustion risk
- **After:** 
  - Exponential backoff: 1s → 2s → 4s → 8s → ... (capped at 30s)
  - Random jitter to prevent thundering herd
  - Maximum 10 reconnection attempts (configurable via `NetworkProviderOptions`)
  - New `'failed'` network status after max attempts
  - Manual `reconnect()` method for user-triggered retry
  - Proper cleanup via `disconnect()` method
- **Added Types:**
  - `NetworkStatus` now includes `'failed'` state
  - New `NetworkProviderOptions` interface with `maxReconnects`, `baseDelayMs`, `maxDelayMs`
- **Impact:** Prevents battery drain on mobile devices and resource exhaustion

##### 3. Cloudflare Worker Rate Limiting
- **Fixed:** Added comprehensive protection against abuse in `yoin-worker`
- **Added:**
  - Per-IP sliding window rate limiter (60 requests per minute)
  - Returns `429 Too Many Requests` with `Retry-After: 60` header
  - Message size guard: 1 MB limit per WebSocket message
  - Room ID length validation: 128 character maximum
  - CORS preflight support (`OPTIONS` method)
  - Automatic cleanup of expired rate limit records (every 2 minutes)
- **Impact:** Prevents DDoS attacks and cost overruns

##### 4. WASM Initialization Error Handling
- **Fixed:** Robust WASM loading with automatic retry and clear error messages
- **Added:**
  - WebAssembly support pre-flight check
  - Automatic retry with incremental backoff (3 attempts by default: 500ms → 1000ms → 1500ms)
  - New `YoinInitError` class with `cause` property for debugging
  - Pre-flight check in `YoinClient` constructor prevents usage before init
- **Breaking Change:** `YoinClient` now throws if WASM not initialized
  ```typescript
  // ✅ Correct usage
  await initYoin();
  const client = new YoinClient({ ... });
  
  // ❌ Will throw YoinInitError
  const client = new YoinClient({ ... }); // without await initYoin()
  ```
- **Impact:** Prevents application crashes from WASM load failures

#### Changed
- `NetworkProvider` constructor now accepts optional `NetworkProviderOptions`
- `initYoin()` now accepts optional `retries` parameter (default: 3)
- `YoinClient.destroy()` now properly calls `network.disconnect()`

#### Added Exports
- `YoinInitError` - Custom error class for WASM initialization failures
- `NetworkProviderOptions` - Configuration interface for reconnection behavior

#### Internal Improvements
- Enhanced code comments and JSDoc documentation
- Better error messages for developer experience

---

## Known Issues & Limitations

### 0.1.0
- **Browser Support:** Not fully tested on Safari < 14 and mobile browsers
- **Test Coverage:** 57% overall, `storage.ts` and `db.ts` plugin at 0%
- **Monitoring:** No production telemetry or error tracking integration yet
- **Documentation:** Missing upgrade guide and troubleshooting section

---

## Migration Guide

### From 0.1.0-alpha to 0.1.0

No breaking changes for existing code. The CRITICAL fixes are backward compatible except:

1. **WASM Initialization Check (Breaking):**
   ```typescript
   // Before: might crash silently
   const client = new YoinClient({ url: '...', docId: '...' });
   
   // After: must await initYoin() first
   await initYoin();
   const client = new YoinClient({ url: '...', docId: '...' });
   ```

2. **Network Status (Non-breaking Addition):**
   ```typescript
   // New 'failed' status available
   client.subscribeNetwork((status) => {
     if (status === 'failed') {
       // Show retry UI or fallback
       client.network.reconnect(); // Manual retry
     }
   });
   ```

3. **Worker Deployment:**
   - No code changes required
   - Rate limiting is automatic
   - Monitor 429 responses in Cloudflare Analytics

---

## Upgrade Instructions

### npm/pnpm
```bash
# Update dependencies
pnpm update @yoin/client @yoin/core

# Or install specific version
pnpm add @yoin/client@0.1.0 @yoin/core@0.1.0
```

### Cloudflare Worker
```bash
cd yoin-worker
pnpm run deploy
```

---

## Contributors

- [Saisai568](https://github.com/Saisai568) - Project Lead
- GitHub Copilot - Code Review & Architecture Consultation

---

## Links

- [GitHub Repository](https://github.com/Saisai568/yoin)
- [API Documentation](./docs/API.md)
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [Contributing Guidelines](./docs/CONTRIBUTING.md)

---

[0.1.0]: https://github.com/Saisai568/yoin/releases/tag/v0.1.0
[0.1.0-rc.1]: https://github.com/Saisai568/yoin/compare/v0.1.0-alpha...v0.1.0-rc.1
