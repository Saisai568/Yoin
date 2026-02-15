// client/src/yoin/plugins/db.ts
// ============================================================
// @yoin/db — IndexedDB Persistence Plugin
// ============================================================
//
// Completely separate the StorageAdapter + scheduleSave logic from YoinClient.
// Mount it to the core via onInstall, and listen to client.onDocUpdate to automatically
// perform a debounced save.
//
// Also automatically run loadFromDisk() upon installation to restore data from IndexedDB.
// ============================================================

import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import { StorageAdapter } from '../storage';

export interface YoinDbPluginOptions {
    /** IndexedDB Name */
    dbName: string;
    /** Debounce save delay (ms), default 1000*/
    debounceMs?: number;
}

export class YoinDbPlugin implements YoinPlugin {
    readonly name = 'yoin-db';

    private client!: YoinClient;
    private storage: StorageAdapter;
    private debounceMs: number;

    private saveTimeout: number | undefined;
    private unsubDocUpdate?: () => void;

    constructor(options: YoinDbPluginOptions) {
        this.storage = new StorageAdapter(options.dbName);
        this.debounceMs = options.debounceMs ?? 1000;
    }

    // ==========================================
    // Lifecycle: onInstall
    // ==========================================
    onInstall(client: YoinClient): void {
        this.client = client;

        // 1. Load disk snapshot
        this.loadFromDisk();

        // 2. Monitor all file updates → Auto-debounce save
        this.unsubDocUpdate = client.onDocUpdate(() => {
            this.scheduleSave();
        });

        console.log(`[YoinDbPlugin] 💾 Database plugin installed (debounce: ${this.debounceMs}ms)`);
    }

    // ==========================================
    // Plugin Lifecycle Hooks
    // ==========================================

    /**
     * onAfterUpdate — Triggers the save schedule after any update is applied
     * This ensures that updates coming through the plugin lifecycle are also persisted
     */
    onAfterUpdate(_update: Uint8Array): void {
        this.scheduleSave();
    }

    onDestroy(): void {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        if (this.unsubDocUpdate) this.unsubDocUpdate();
        console.log('[YoinDbPlugin] Destroyed');
    }

    // ==========================================
    // Public API
    // ==========================================

    /**
     *Manually trigger save immediately (bypass debounce)
     */
    public async forceSave(): Promise<void> {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        await this.persist();
        console.log('[YoinDbPlugin] 💾 Force saved to IndexedDB');
    }

    // ==========================================
    // Internal: Load / Save
    // ==========================================

    private async loadFromDisk(): Promise<void> {
        const docId = this.client.getConfig().docId;
        const data = await this.storage.load(docId);

        if (data) {
            console.log('[YoinDbPlugin] 📂 Found local data, applying...');
            this.client.getDoc().apply_update(data);
            this.client.notifyListeners();
        } else {
            console.log('[YoinDbPlugin] 🆕 No local data found, starting fresh.');
        }
    }

    private async persist(): Promise<void> {
        const docId = this.client.getConfig().docId;
        const snapshot = this.client.getDoc().export_update();
        await this.storage.save(docId, snapshot);
    }

    /**
     * Debounce save: reset the timer each time it is called
     * The save will only actually execute debounceMs milliseconds after the last call.
     */
    private scheduleSave(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = window.setTimeout(async () => {
            await this.persist();
            console.log('[YoinDbPlugin] 💾 Auto-saved to IndexedDB (Debounced)');
        }, this.debounceMs);
    }
}

/**
 * Create an IndexedDB persistence plugin
 *
 * @example
 * const { plugin, forceSave } = createDbPlugin({ dbName: 'myDB' });
 * client.use(plugin);
 * await forceSave();
 */
export function createDbPlugin(options: YoinDbPluginOptions) {
    const instance = new YoinDbPlugin(options);
    return {
        plugin: instance,
        forceSave: () => instance.forceSave(),
    };
}
