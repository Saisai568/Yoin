// client/src/yoin/index.ts
// ============================================================
// Yoin Micro-kernel 公開 API
// ============================================================
import initWasm, { YoinDoc, init_panic_hook } from '../../../core/pkg-web/core'; 

export const initYoin = initWasm;
export const initPanicHook = init_panic_hook; 

// Core
export { YoinClient } from './YoinClient';
export { YoinDoc };

// Plugin Interface
export type { YoinPlugin } from './plugin';

// Plugins
export { YoinUndoPlugin, createUndoPlugin } from './plugins/undo';
export { YoinDbPlugin, createDbPlugin } from './plugins/db';
export type { YoinDbPluginOptions } from './plugins/db';

// Types
export type { YoinConfig, AwarenessState, AwarenessPartial, CursorRenderer, AwarenessCallback, NetworkStatus } from './types';