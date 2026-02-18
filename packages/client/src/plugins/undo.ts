// packages/client/src/plugins/undo.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import type { YoinDoc } from '@yoin/core';

export class YoinUndoPlugin implements YoinPlugin {
  readonly name = 'yoin-undo';

  private client!: YoinClient;
  private doc!: YoinDoc;

  /** Tracks which map names have already had expand_undo_scope called (idempotent). */
  private expandedMaps = new Set<string>();

  /** Original setMap / setMapDeep, saved so onDestroy can restore them. */
  private _origSetMap?: (mapName: string, key: string, value: any) => Promise<void>;
  private _origSetMapDeep?: (mapName: string, path: string[], value: string | number | boolean) => void;

  onInstall(client: YoinClient): void {
    this.client = client;
    this.doc = client.getDoc();

    // Automatically enable undo tracking in the underlying CRDT doc.
    this.doc.enable_undo();

    // Wrap setMap: expand undo scope for a map the first time it is written.
    this._origSetMap = (client as any).setMap.bind(client);
    const plugin = this;
    (client as any).setMap = async function (mapName: string, key: string, value: any): Promise<void> {
      if (!plugin.expandedMaps.has(mapName)) {
        plugin.doc.expand_undo_scope(mapName);
        plugin.expandedMaps.add(mapName);
      }
      return plugin._origSetMap!(mapName, key, value);
    };

    // Wrap setMapDeep: same auto-expand logic.
    this._origSetMapDeep = (client as any).setMapDeep.bind(client);
    (client as any).setMapDeep = function (mapName: string, path: string[], value: string | number | boolean): void {
      if (!plugin.expandedMaps.has(mapName)) {
        plugin.doc.expand_undo_scope(mapName);
        plugin.expandedMaps.add(mapName);
      }
      return plugin._origSetMapDeep!(mapName, path, value);
    };

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
    // Restore the original setMap / setMapDeep so other code is unaffected.
    if (this._origSetMap) {
      (this.client as any).setMap = this._origSetMap;
    }
    if (this._origSetMapDeep) {
      (this.client as any).setMapDeep = this._origSetMapDeep;
    }
    this.expandedMaps.clear();
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
