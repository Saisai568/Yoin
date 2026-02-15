// packages/client/src/index.ts
// ============================================================
// @yoin/client - Unified Public API (Barrel File)
// ============================================================

// WASM Initialization
export { initYoin, isYoinInitialized } from './wasm/loader';

// Core WASM types re-exported for convenience
export { YoinDoc } from '@yoin/core';

// Core Client
export { YoinClient } from './YoinClient';

// Plugin Interface
export type { YoinPlugin } from './plugin';

// Built-in Plugins
export { YoinUndoPlugin, createUndoPlugin } from './plugins/undo';
export { YoinDbPlugin, createDbPlugin } from './plugins/db';
export type { YoinDbPluginOptions } from './plugins/db';
export { createLoggerPlugin } from './logger';

// Proxy Utilities
export { createMapProxy, createArrayProxy } from './proxy';

// Types
export type {
  YoinConfig,
  AwarenessState,
  AwarenessPartial,
  CursorRenderer,
  AwarenessCallback,
  NetworkStatus,
} from './types';
