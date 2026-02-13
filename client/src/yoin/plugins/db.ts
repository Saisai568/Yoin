// client/src/yoin/plugins/db.ts
// ============================================================
// @yoin/db — IndexedDB 持久化插件
// ============================================================
//
// 將 StorageAdapter + scheduleSave 邏輯從 YoinClient 完全抽離。
// 透過 onInstall 掛載到核心，並監聽 client.onDocUpdate 來自動
// 執行防抖存檔 (debounced save)。
//
// 同時在安裝時自動執行 loadFromDisk()，從 IndexedDB 還原資料。
// ============================================================

import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import { StorageAdapter } from '../storage';

export interface YoinDbPluginOptions {
    /** IndexedDB 資料庫名稱 */
    dbName: string;
    /** 防抖存檔延遲 (ms)，預設 1000 */
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

        // 1. 載入磁碟快照
        this.loadFromDisk();

        // 2. 監聽所有文件更新 → 自動防抖存檔
        this.unsubDocUpdate = client.onDocUpdate(() => {
            this.scheduleSave();
        });

        console.log(`[YoinDbPlugin] 💾 Database plugin installed (debounce: ${this.debounceMs}ms)`);
    }

    // ==========================================
    // Plugin Lifecycle Hooks
    // ==========================================

    /**
     * onAfterUpdate — 任何更新套用後也觸發存檔排程
     * 這確保即使透過 plugin 生命週期進來的更新也會被持久化
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
     * 手動觸發立即存檔 (跳過防抖)
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
     * 防抖存檔：每次呼叫時重置計時器，
     * 只有在最後一次呼叫後 debounceMs 毫秒才真正執行存檔
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

// ============================================================
// 組合式函式風格
// ============================================================

/**
 * 建立 IndexedDB 持久化插件
 *
 * @example
 * const { plugin, forceSave } = createDbPlugin({ dbName: 'myDB' });
 * client.use(plugin);
 * // 需要時可手動觸發存檔
 * await forceSave();
 */
export function createDbPlugin(options: YoinDbPluginOptions) {
    const instance = new YoinDbPlugin(options);
    return {
        /** 插件實例，傳入 client.use() */
        plugin: instance,
        /** 手動觸發立即存檔 */
        forceSave: () => instance.forceSave(),
    };
}
