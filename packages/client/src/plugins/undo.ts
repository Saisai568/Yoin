// packages/client/src/plugins/undo.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import type { YoinDoc } from '@yoin/core';

export class YoinUndoPlugin implements YoinPlugin {
  readonly name = 'yoin-undo';

  private client!: YoinClient;
  private doc!: YoinDoc;

  onInstall(client: YoinClient): void {
    this.client = client;
    this.doc = client.getDoc();

    console.log('[YoinUndoPlugin] Undo/Redo plugin installed');
  }

  public undo(): void {
    try {
      const diff = this.doc.undo();

      if (diff && diff.length > 0) {
        this.client.broadcastUpdate(diff);
        this.client.notifyListeners();

        console.log('[YoinUndoPlugin] Undo applied');
      }
    } catch (e) {
      console.error('[YoinUndoPlugin] Undo failed:', e);
    }
  }

  public redo(): void {
    try {
      const diff = this.doc.redo();

      if (diff && diff.length > 0) {
        this.client.broadcastUpdate(diff);
        this.client.notifyListeners();

        console.log('[YoinUndoPlugin] Redo applied');
      }
    } catch (e) {
      console.error('[YoinUndoPlugin] Redo failed:', e);
    }
  }

  onDestroy(): void {
    console.log('[YoinUndoPlugin] Destroyed');
  }
}

export function createUndoPlugin() {
  const instance = new YoinUndoPlugin();
  return {
    plugin: instance,
    undo: () => instance.undo(),
    redo: () => instance.redo(),
  };
}
