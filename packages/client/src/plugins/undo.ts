// packages/client/src/plugins/undo.ts
import type { YoinPlugin } from '../plugin';
import type { YoinClient } from '../YoinClient';
import type { YoinDoc } from '@yoin/core';
import type { TextDeltaOp } from '../types';

export class YoinUndoPlugin implements YoinPlugin {
  readonly name = 'yoin-undo';

  private client!: YoinClient;
  private doc!: YoinDoc;

  /** Tracks which shared container names have already had expand_undo_scope called (idempotent). */
  private expandedScopes = new Set<string>();

  /** Original methods saved so onDestroy can restore them. */
  private _origSetMap?: (mapName: string, key: string, value: any) => Promise<void>;
  private _origDeleteMap?: (mapName: string, key: string) => Promise<void>;
  private _origSetMapDeep?: (mapName: string, path: string[], value: any) => void;
  private _origBatchSet?: (entries: [string, string, any][]) => void;
  private _origPushArray?: (arrayName: string, item: any) => Promise<void>;
  private _origInsertArray?: (arrayName: string, index: number, item: any) => Promise<void>;
  private _origDeleteArray?: (arrayName: string, index: number, length?: number) => Promise<void>;
  private _origMoveArray?: (arrayName: string, fromIndex: number, toIndex: number) => Promise<void>;
  private _origInsertText?: (index: number, text: string, attributes?: Record<string, any>, textName?: string) => Promise<void>;
  private _origDeleteText?: (index: number, length: number, textName?: string) => Promise<void>;
  private _origFormatText?: (index: number, length: number, attributes: Record<string, any>, textName?: string) => Promise<void>;
  private _origApplyTextDelta?: (ops: TextDeltaOp[], textName?: string) => Promise<void>;

  private ensureScope(name: string, kind: 'map' | 'array' | 'text'): void {
    const scopeKey = `${kind}:${name}`;
    if (this.expandedScopes.has(scopeKey) || (kind === 'text' && name === 'content')) {
      return;
    }
    this.doc.expand_undo_scope(name);
    if (typeof (this.doc as any).expand_undo_scope_for === 'function' && kind !== 'map') {
      (this.doc as any).expand_undo_scope_for(name, kind);
    }
    this.expandedScopes.add(scopeKey);
  }

  onInstall(client: YoinClient): void {
    this.client = client;
    this.doc = client.getDoc();

    // Automatically enable undo tracking in the underlying CRDT doc.
    this.doc.enable_undo();

    const plugin = this;

    // Wrap Map operations
    this._origSetMap = client.setMap.bind(client);
    client.setMap = async function (mapName: string, key: string, value: any): Promise<void> {
      plugin.ensureScope(mapName, 'map');
      return plugin._origSetMap!(mapName, key, value);
    };

    this._origDeleteMap = client.deleteMap.bind(client);
    client.deleteMap = async function (mapName: string, key: string): Promise<void> {
      plugin.ensureScope(mapName, 'map');
      return plugin._origDeleteMap!(mapName, key);
    };

    this._origSetMapDeep = client.setMapDeep.bind(client);
    client.setMapDeep = function (mapName: string, path: string[], value: any): void {
      plugin.ensureScope(mapName, 'map');
      return plugin._origSetMapDeep!(mapName, path, value);
    };

    this._origBatchSet = client.batchSet.bind(client);
    client.batchSet = function (entries: [string, string, any][]): void {
      for (const [mapName] of entries) {
        if (typeof mapName === 'string') {
          plugin.ensureScope(mapName, 'map');
        }
      }
      return plugin._origBatchSet!(entries);
    };

    // Wrap Array operations
    this._origPushArray = client.pushArray.bind(client);
    client.pushArray = function (arrayName: string, item: any): Promise<void> {
      plugin.ensureScope(arrayName, 'array');
      return plugin._origPushArray!(arrayName, item);
    };

    this._origInsertArray = client.insertArray.bind(client);
    client.insertArray = function (arrayName: string, index: number, item: any): Promise<void> {
      plugin.ensureScope(arrayName, 'array');
      return plugin._origInsertArray!(arrayName, index, item);
    };

    this._origDeleteArray = client.deleteArray.bind(client);
    client.deleteArray = function (arrayName: string, index: number, length?: number): Promise<void> {
      plugin.ensureScope(arrayName, 'array');
      return plugin._origDeleteArray!(arrayName, index, length);
    };

    this._origMoveArray = client.moveArray.bind(client);
    client.moveArray = function (arrayName: string, fromIndex: number, toIndex: number): Promise<void> {
      plugin.ensureScope(arrayName, 'array');
      return plugin._origMoveArray!(arrayName, fromIndex, toIndex);
    };

    // Wrap Text operations for custom named text blocks
    this._origInsertText = client.insertText.bind(client);
    client.insertText = function (
      index: number,
      text: string,
      attributes?: Record<string, any>,
      textName = 'content',
    ): Promise<void> {
      plugin.ensureScope(textName, 'text');
      return plugin._origInsertText!(index, text, attributes, textName);
    };

    this._origDeleteText = client.deleteText.bind(client);
    client.deleteText = function (
      index: number,
      length: number,
      textName = 'content',
    ): Promise<void> {
      plugin.ensureScope(textName, 'text');
      return plugin._origDeleteText!(index, length, textName);
    };

    this._origFormatText = client.formatText.bind(client);
    client.formatText = function (
      index: number,
      length: number,
      attributes: Record<string, any>,
      textName = 'content',
    ): Promise<void> {
      plugin.ensureScope(textName, 'text');
      return plugin._origFormatText!(index, length, attributes, textName);
    };

    this._origApplyTextDelta = client.applyTextDelta.bind(client);
    client.applyTextDelta = function (
      ops: TextDeltaOp[],
      textName = 'content',
    ): Promise<void> {
      plugin.ensureScope(textName, 'text');
      return plugin._origApplyTextDelta!(ops, textName);
    };

    console.log('[YoinUndoPlugin] Undo/Redo plugin installed');
  }

  public undo(): void {
    try {
      const diff = this.doc.undo();

      if (diff && diff.length > 0) {
        this.client.broadcastUpdate(diff);

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

        console.log('[YoinUndoPlugin] Redo applied');
      }
    } catch (e) {
      console.error('[YoinUndoPlugin] Redo failed:', e);
    }
  }

  onDestroy(): void {
    if (this._origSetMap) this.client.setMap = this._origSetMap;
    if (this._origDeleteMap) this.client.deleteMap = this._origDeleteMap;
    if (this._origSetMapDeep) this.client.setMapDeep = this._origSetMapDeep;
    if (this._origBatchSet) this.client.batchSet = this._origBatchSet;
    if (this._origPushArray) this.client.pushArray = this._origPushArray;
    if (this._origInsertArray) this.client.insertArray = this._origInsertArray;
    if (this._origDeleteArray) this.client.deleteArray = this._origDeleteArray;
    if (this._origMoveArray) this.client.moveArray = this._origMoveArray;
    if (this._origInsertText) this.client.insertText = this._origInsertText;
    if (this._origDeleteText) this.client.deleteText = this._origDeleteText;
    if (this._origFormatText) this.client.formatText = this._origFormatText;
    if (this._origApplyTextDelta) this.client.applyTextDelta = this._origApplyTextDelta;
    this.expandedScopes.clear();
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
