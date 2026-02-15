// client/src/yoin/plugins/undo.ts
// ============================================================
// @yoin/undo — Undo/Redo Plugin
// ============================================================
//
// Completely separate the UndoManager logic from the core of YoinClient.
// Mount it to the core via onInstall, and use doc.undo() / doc.redo()
// (Rust WASM) to perform operations, then broadcast changes through broadcastUpdate.
// ============================================================

import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import type { YoinDoc } from '../../../../core/pkg-web/core';

export class YoinUndoPlugin implements YoinPlugin {
    readonly name = 'yoin-undo';

    private client!: YoinClient;
    private doc!: YoinDoc;

    // ==========================================
    // Lifecycle: onInstall
    // ==========================================
    onInstall(client: YoinClient): void {
        this.client = client;
        this.doc = client.getDoc();

        console.log('[YoinUndoPlugin] ↩️ Undo/Redo plugin installed');
    }

    // ==========================================
    // Public API
    // ==========================================

    /**
     * Execute Undo
     * Call undo() from Rust WASM to get the reverse diff,
     * Broadcast it to other peers and update the local UI.
     */
    public undo(): void {
        try {
            const diff = this.doc.undo();

            if (diff && diff.length > 0) {
                this.client.broadcastUpdate(diff);
                this.client.notifyListeners();

                console.log('[YoinUndoPlugin] ↩️ Undo applied');
            }
        } catch (e) {
            console.error('[YoinUndoPlugin] Undo failed:', e);
        }
    }

    /**
     * Execute Redo
     * Call redo() from Rust WASM to get the forward diff,
     * Broadcast it to other peers and update the local UI.
     */
    public redo(): void {
        try {
            const diff = this.doc.redo();

            if (diff && diff.length > 0) {
                this.client.broadcastUpdate(diff);
                this.client.notifyListeners();

                console.log('[YoinUndoPlugin] ↪️ Redo applied');
            }
        } catch (e) {
            console.error('[YoinUndoPlugin] Redo failed:', e);
        }
    }

    // ==========================================
    // Plugin Lifecycle (optional hooks)
    // ==========================================

    onDestroy(): void {
        console.log('[YoinUndoPlugin] Destroyed');
    }
}

// ============================================================
// Alternative to Composable Function Style
// ============================================================

/**
 * Composable functions to build Undo/Redo capabilities
* Can return { undo, redo, plugin } directly without needing a class
 *
 * @example
 * const { undo, redo, plugin } = createUndoPlugin();
 * client.use(plugin);
 * btnUndo.onclick = undo;
 */
export function createUndoPlugin() {
    const instance = new YoinUndoPlugin();
    return {
        /** Plugin instance, passed into client.use() */
        plugin: instance,

        undo: () => instance.undo(),

        redo: () => instance.redo(),
    };
}
