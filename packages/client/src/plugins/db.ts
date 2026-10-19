// packages/client/src/plugins/db.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import { StorageAdapter } from '../storage';

export interface YoinDbPluginOptions {
  dbName: string;
  debounceMs?: number;
}

export class YoinDbPlugin implements YoinPlugin {
  readonly name = 'yoin-db';

  private client!: YoinClient;
  private storage: StorageAdapter;
  private debounceMs: number;

  private saveTimeout: number | undefined;
  private unsubDocUpdate?: () => void;
  private readyPromise!: Promise<void>;
  private destroyed = false;

  constructor(options: YoinDbPluginOptions) {
    this.storage = new StorageAdapter(options.dbName);
    this.debounceMs = options.debounceMs ?? 1000;
  }

  onInstall(client: YoinClient): void {
    this.client = client;

    this.readyPromise = this.loadFromDisk().catch((error) => {
      console.error('[YoinDbPlugin] Failed to restore from IndexedDB:', error);
      throw error;
    });

    this.unsubDocUpdate = client.onDocUpdate(() => {
      this.scheduleSave();
    });

    console.log(
      `[YoinDbPlugin] Database plugin installed (debounce: ${this.debounceMs}ms)`,
    );
  }

  onAfterUpdate(_update: Uint8Array): void {
    this.scheduleSave();
  }

  async onDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    if (this.unsubDocUpdate) this.unsubDocUpdate();
    await this.persistWhenReady();
    console.log('[YoinDbPlugin] Destroyed');
  }

  public async forceSave(): Promise<void> {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    await this.persistWhenReady();
    console.log('[YoinDbPlugin] Force saved to IndexedDB');
  }

  private async loadFromDisk(): Promise<void> {
    const docId = this.client.getConfig().docId;
    const data = await this.storage.load(docId);

    if (data) {
      console.log('[YoinDbPlugin] Found local data, applying...');
      this.client.getDoc().apply_update(data);
      this.client.notifyListeners();
    } else {
      console.log(
        '[YoinDbPlugin] No local data found, starting fresh.',
      );
    }
  }

  private async persist(): Promise<void> {
    const docId = this.client.getConfig().docId;
    const snapshot = this.client.getDoc().export_update();
    await this.storage.save(docId, snapshot);
  }

  private scheduleSave(): void {
    if (this.destroyed) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(() => {
      void this.persistWhenReady().then(() => {
        console.log('[YoinDbPlugin] Auto-saved to IndexedDB (Debounced)');
      }).catch((error) => {
        console.error('[YoinDbPlugin] Auto-save failed:', error);
      });
    }, this.debounceMs);
  }

  private async persistWhenReady(): Promise<void> {
    await this.readyPromise;
    await this.persist();
  }
}

export function createDbPlugin(options: YoinDbPluginOptions) {
  const instance = new YoinDbPlugin(options);
  return {
    plugin: instance,
    forceSave: () => instance.forceSave(),
  };
}
