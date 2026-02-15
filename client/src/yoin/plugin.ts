// client/src/yoin/plugin.ts
// ============================================================
// Micro-kernel Plugin Interface
// ============================================================
//
// All Yoin extensions (Undo, IndexedDB, Schema Validation, etc.) 
// are mounted onto the lightweight YoinClient core through this interface.
// ============================================================

import type { YoinClient } from './YoinClient';

/**
 * YoinPlugin Lifecycle interface
 *
 * onInstall   — Triggered when the plugin is registered with `.use()`, used to initialize internal states and bind events.
 * onBeforeUpdate — Triggered before local data changes are "about to" be broadcasted (can be intercepted / logged)
 * onAfterUpdate — Triggered after any document update (local or remote) is applied
 * onDestroy      — Client Triggered upon destruction, used to clean up timers and resources
 */
export interface YoinPlugin {
    /** Plugin Name (for debugging and logging)） */
    readonly name: string;

    /**
     * Plugin installation hook
     * Called when `client.use(plugin)` is executed
     * @param client — YoinClient instance, providing access to the public API and internal hooks
     */
    onInstall(client: YoinClient): void;

    /**
     * Called before a terrain change is about to be broadcast
     * @param update — the delta update (Uint8Array) that is about to be broadcast
     */
    onBeforeUpdate?(update: Uint8Array): void;

    /**
     * Called after any file update (local or remote) is applied
     * @param update — the applied update (Uint8Array)
     */
    onAfterUpdate?(update: Uint8Array): void;

    /**
     * Called when the client is destroyed, used to clean up resources
     */
    onDestroy?(): void;
}
