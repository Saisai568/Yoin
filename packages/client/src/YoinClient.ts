// packages/client/src/YoinClient.ts
// ============================================================
// Micro-kernel Core - CRDT Doc, Networking, Text/Map/Array API
// ============================================================
import { YoinDoc } from '@yoin/core';
import { NetworkProvider } from './network';
import { isYoinInitialized } from './wasm/loader';
import type { YoinPlugin } from './plugin';
import type {
  YoinConfig,
  TextDeltaOp,
  AwarenessState,
  AwarenessPartial,
  AwarenessCallback,
  NetworkStatus,
} from './types';
import { z } from 'zod';

// ============================================================
// Communication protocol constants
// ============================================================
const MSG_SYNC_STEP_1 = 0;
const MSG_SYNC_STEP_2 = 1;
const MSG_SYNC_STEP_1_REPLY = 2;
const MSG_AWARENESS = 3;
const MSG_JOIN_ROOM = 4;
const MSG_HELLO = 16;
const MSG_UPDATE_ACK = 17;
const MSG_ERROR = 18;

interface UpdateScope {
  kind: 'text' | 'map' | 'array';
  name: string;
}

// ============================================================
// Micro-kernel Core
// ============================================================
export class YoinClient {
  private doc: YoinDoc;
  public network: NetworkProvider;
  private config: YoinConfig;

  // Global / Text Subscribers (React/UI)
  private listeners: ((text: string) => void)[] = [];

  // Fine-grained Container Subscribers (for 60FPS Whiteboard / Kanban / Rich Text)
  private mapListeners: Map<string, Set<(data: any) => void>> = new Map();
  private arrayListeners: Map<string, Set<(data: any[]) => void>> = new Map();
  private textListeners: Map<
    string,
    Set<(text: string, delta: TextDeltaOp[]) => void>
  > = new Map();

  // Schema Validation Rules
  private schemas: Record<string, z.ZodTypeAny> | undefined;

  // Plugin system
  private plugins: YoinPlugin[] = [];

  // File update hooks (for plugin subscription)
  private docUpdateListeners: ((update: Uint8Array) => void)[] = [];
  private localUpdateListeners: ((update: Uint8Array) => void)[] = [];

  // Awareness System Properties
  private myClientId = Math.random().toString(36).substring(2, 10);
  private awarenessStates: Map<string, AwarenessState<any>> = new Map();
  private awarenessListeners: AwarenessCallback<any>[] = [];

  // Throttle Mechanism
  private awarenessTimeout: ReturnType<typeof setTimeout> | undefined;
  private pendingAwarenessUpdate: boolean = false;

  // Heartbeat Timer
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private gcTimer: ReturnType<typeof setInterval> | undefined;

  private networkListeners: ((status: NetworkStatus) => void)[] = [];

  // Server-authoritative sequence & pending tracking (Y-04)
  private updateSeq = 0;
  private pendingUpdates: Map<number, Uint8Array> = new Map();
  private isReadOnly = false;

  // ==========================================
  // Constructor (Lightweight Initialization)
  // ==========================================
  constructor(config: YoinConfig) {
    // Pre-flight: ensure WASM is ready before creating a client instance
    if (!isYoinInitialized()) {
      throw new Error(
        '[Yoin] WASM engine not initialized. Call `await initYoin()` before creating a YoinClient.',
      );
    }

    this.config = config;
    this.myClientId = Math.random().toString(36).substring(2, 10);
    this.doc = new YoinDoc();
    this.schemas = config.schemas;

    const roomUrl = new URL(config.url);
    if (roomUrl.pathname === '/' || roomUrl.pathname === '') {
      roomUrl.pathname = `/room/${encodeURIComponent(config.docId)}`;
    } else {
      roomUrl.searchParams.append('room', config.docId);
    }

    const networkOpts = {
      ...config.networkOptions,
      autoConnect: config.autoConnect !== false,
      getConnectParams: config.getConnectParams,
    };

    this.network = new NetworkProvider(
      roomUrl.toString(),

      // Event 1: Connection Successful
      () => {
        const roomNameBytes = new TextEncoder().encode(this.config.docId);
        this.network.broadcast(
          this.encodeMessage(MSG_JOIN_ROOM, roomNameBytes),
          { transient: true },
        );
        console.log(`[Network] Joining room: ${this.config.docId}`);
        this.syncWithPeers();
        const myState = this.awarenessStates.get(this.myClientId);
        if (myState) this.setAwareness({});
      },

      // Event 2: Received an online message
      async (rawMsg: Uint8Array) => {
        const type = rawMsg[0];
        const payload = rawMsg.slice(1);

        switch (type) {
          case MSG_SYNC_STEP_1: {
            const diff = this.doc.export_diff(payload);
            if (this.hasNonEmptyUpdate(diff)) {
              this.network.broadcast(
                this.encodeMessage(MSG_SYNC_STEP_2, diff),
              );
            }
            const mySV = this.doc.get_state_vector();
            this.network.broadcast(
              this.encodeMessage(MSG_SYNC_STEP_1_REPLY, mySV),
              { transient: true },
            );
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) this.setAwareness({});
            break;
          }

          case MSG_SYNC_STEP_1_REPLY: {
            const diff = this.doc.export_diff(payload);
            if (this.hasNonEmptyUpdate(diff)) {
              this.network.broadcast(
                this.encodeMessage(MSG_SYNC_STEP_2, diff),
              );
            }
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) this.setAwareness({});
            break;
          }

          case MSG_SYNC_STEP_2: {
            if (this.hasNonEmptyUpdate(payload)) {
              try {
                const scopes = this.doc.apply_update(payload) as
                  | UpdateScope[]
                  | undefined;
                if (scopes && scopes.length > 0) {
                  this.notifyScopedListeners(scopes);
                } else {
                  this.notifyListeners();
                }
                this.plugins.forEach((p) => p.onAfterUpdate?.(payload));
                this.emitDocUpdate(payload);
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                console.error('[Yoin] apply_update failed:', err);
                this.config.onError?.(err);
              }
            }
            break;
          }

          case MSG_AWARENESS: {
            const jsonStr = new TextDecoder().decode(payload);
            try {
              const state: AwarenessState = JSON.parse(jsonStr);
              if (state.offline) {
                this.awarenessStates.delete(state.clientId);
              } else {
                this.awarenessStates.set(state.clientId, state);
              }
              this.notifyAwarenessListeners();
            } catch (e) {
              console.error('[Awareness] Failed to parse packet', e);
            }
            break;
          }

          case MSG_HELLO: {
            try {
              const info = JSON.parse(new TextDecoder().decode(payload));
              if (info.userId) {
                this.myClientId = String(info.userId);
              }
              if (info.role === 'viewer') {
                this.isReadOnly = true;
              }
              console.log('[Yoin] Received HELLO from server:', info);
            } catch (e) {
              console.warn('[Yoin] Failed to parse HELLO payload', e);
            }
            break;
          }

          case MSG_UPDATE_ACK: {
            if (payload.length >= 4) {
              const ackSeq = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false);
              this.pendingUpdates.delete(ackSeq);
              if (this.pendingUpdates.size === 0) {
                this.notifyNetworkListeners('synced');
              }
            }
            break;
          }

          case MSG_ERROR: {
            try {
              const errorInfo = JSON.parse(new TextDecoder().decode(payload));
              console.error('[Yoin] Server returned error:', errorInfo);
              if (errorInfo.code === 'FORBIDDEN_READONLY') {
                this.isReadOnly = true;
              }
              const err = new Error(`[Server Error] ${errorInfo.code}: ${errorInfo.message}`);
              this.config.onError?.(err);
            } catch (e) {
              console.warn('[Yoin] Failed to parse ERROR payload', e);
            }
            break;
          }
        }
      },

      // Event 3: Network Status Change
      (status) => {
        this.notifyNetworkListeners(status);
      },

      networkOpts,
    );

    this.startHeartbeat();
  }

  /**
   * Checks whether a binary CRDT update/diff actually contains operations.
   * Suppresses empty 0-byte or 2-byte [0, 0] Yrs/Yjs V1 updates to prevent broadcast storms.
   */
  private hasNonEmptyUpdate(update: Uint8Array | null | undefined): boolean {
    if (!update || update.byteLength === 0) return false;
    if (update.byteLength === 2 && update[0] === 0 && update[1] === 0) {
      return false;
    }
    return true;
  }

  /**
   * Initiates state vector synchronization with connected peers.
   */
  public syncWithPeers(): void {
    const sv = this.doc.get_state_vector();
    this.network.broadcast(
      this.encodeMessage(MSG_SYNC_STEP_1, sv),
      { transient: true },
    );
    console.log('[Sync] Sent initial State Vector');
  }

  /**
   * Hydrate the document from a server-provided binary snapshot (e.g., PostgreSQL / Cloudflare DO).
   * Compatible with both Yrs and Yjs V1 binary updates.
   */
  public applySnapshot(snapshot: Uint8Array): void {
    if (!this.hasNonEmptyUpdate(snapshot)) return;
    this.doc.apply_update(snapshot);
    this.notifyListeners();
    this.plugins.forEach((p) => p.onAfterUpdate?.(snapshot));
    this.emitDocUpdate(snapshot);
  }

  /**
   * Export full binary snapshot of the current document state.
   */
  public exportSnapshot(): Uint8Array {
    return this.doc.snapshot() as Uint8Array;
  }

  // ==========================================
  // Plugin API: .use()
  // ==========================================

  public use(plugin: YoinPlugin): this {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      console.warn(`[Plugin] Plugin '${plugin.name}' is already installed.`);
      return this;
    }

    try {
      const res = plugin.onInstall(this);
      if (res && typeof (res as any).then === 'function') {
        (res as Promise<void>).catch((err) => {
          this.rollbackPlugin(plugin, err);
        });
      }
      this.plugins.push(plugin);
      console.log(`[Plugin] Installed: ${plugin.name}`);
    } catch (err) {
      this.rollbackPlugin(plugin, err);
      throw err;
    }

    return this;
  }

  private rollbackPlugin(plugin: YoinPlugin, err: unknown): void {
    const idx = this.plugins.indexOf(plugin);
    if (idx !== -1) {
      this.plugins.splice(idx, 1);
    }
    try {
      void plugin.onDestroy?.();
    } catch {
      // ignore secondary errors during rollback
    }
    console.error(`[Plugin] Installation failed for '${plugin.name}':`, err);
  }

  // ==========================================
  // Internal Hook API (for plugin subscription)
  // ==========================================

  public onDocUpdate(
    callback: (update: Uint8Array) => void,
  ): () => void {
    this.docUpdateListeners.push(callback);
    return () => {
      const idx = this.docUpdateListeners.indexOf(callback);
      if (idx !== -1) this.docUpdateListeners.splice(idx, 1);
    };
  }

  public onLocalUpdate(
    callback: (update: Uint8Array) => void,
  ): () => void {
    this.localUpdateListeners.push(callback);
    return () => {
      const idx = this.localUpdateListeners.indexOf(callback);
      if (idx !== -1) this.localUpdateListeners.splice(idx, 1);
    };
  }

  public getDoc(): YoinDoc {
    return this.doc;
  }

  public getConfig(): YoinConfig {
    return this.config;
  }

  public broadcastUpdate(
    update: Uint8Array,
    scopes?: UpdateScope | UpdateScope[],
  ): void {
    if (this.isReadOnly) {
      console.warn('[Yoin] Document is in read-only mode. Mutation rejected.');
      return;
    }

    this.plugins.forEach((p) => p.onBeforeUpdate?.(update));

    if (this.config.mode === 'server') {
      this.updateSeq++;
      const seq = this.updateSeq;
      this.pendingUpdates.set(seq, update);

      // Packet format: [MSG_SYNC_STEP_2, seq: u32_be, ...update]
      const packet = new Uint8Array(1 + 4 + update.length);
      packet[0] = MSG_SYNC_STEP_2;
      new DataView(packet.buffer).setUint32(1, seq, false);
      packet.set(update, 5);
      this.network.broadcast(packet);
    } else {
      const msg = this.encodeMessage(MSG_SYNC_STEP_2, update);
      this.network.broadcast(msg);
    }

    if (scopes) {
      this.notifyScopedListeners(scopes);
    } else {
      this.notifyListeners();
    }
    this.plugins.forEach((p) => p.onAfterUpdate?.(update));
    this.emitLocalUpdate(update);
    this.emitDocUpdate(update);
  }

  // ==========================================
  // Awareness Public API
  // ==========================================

  public setAwareness(partial: AwarenessPartial<any>) {
    const current = this.awarenessStates.get(this.myClientId);
    const fullState: AwarenessState<any> = {
      ...current,
      ...partial,
      clientId: this.myClientId,
      timestamp: Date.now(),
    } as AwarenessState<any>;

    this.awarenessStates.set(this.myClientId, fullState);
    this.notifyAwarenessListeners();

    const throttleMs = this.config.awarenessThrottleMs ?? 30;

    if (!this.awarenessTimeout) {
      this.broadcastAwareness(fullState);
      this.awarenessTimeout = setTimeout(() => {
        this.awarenessTimeout = undefined;
        if (this.pendingAwarenessUpdate) {
          this.pendingAwarenessUpdate = false;
          const latest = this.awarenessStates.get(this.myClientId);
          if (latest) this.broadcastAwareness(latest);
        }
      }, throttleMs);
    } else {
      this.pendingAwarenessUpdate = true;
    }
  }

  public onAwarenessChange(
    callback: AwarenessCallback<any>,
  ): () => void {
    this.awarenessListeners.push(callback);
    callback(this.awarenessStates);
    return () => {
      const idx = this.awarenessListeners.indexOf(callback);
      if (idx !== -1) this.awarenessListeners.splice(idx, 1);
    };
  }

  public leaveAwareness() {
    const offlineState: AwarenessState = {
      clientId: this.myClientId,
      offline: true,
      name: '',
      color: '',
      timestamp: Date.now(),
    };

    this.awarenessStates.delete(this.myClientId);
    this.notifyAwarenessListeners();
    this.broadcastAwareness(offlineState);
  }

  public notifyAwarenessListeners() {
    const snapshot = this.awarenessStates;
    this.awarenessListeners.forEach((fn) => fn(snapshot));
  }

  // ==========================================
  // Awareness Internal
  // ==========================================

  private broadcastAwareness(state: AwarenessState) {
    const jsonStr = JSON.stringify(state);
    const payload = new TextEncoder().encode(jsonStr);
    this.network.broadcast(this.encodeMessage(MSG_AWARENESS, payload), {
      transient: true,
    });
  }

  private startHeartbeat() {
    const heartbeatInterval =
      this.config.heartbeatIntervalMs ?? 5000;
    const timeoutThreshold =
      this.config.heartbeatTimeoutMs ?? 30000;

    this.heartbeatTimer = setInterval(() => {
      const myState = this.awarenessStates.get(this.myClientId);
      if (myState) {
        this.setAwareness({});
      }
    }, heartbeatInterval);

    this.gcTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const [clientId, state] of this.awarenessStates.entries()) {
        if (clientId === this.myClientId) continue;
        if (now - state.timestamp > timeoutThreshold) {
          this.awarenessStates.delete(clientId);
          changed = true;
          console.log(
            `[Awareness] Offline user cleared: ${state.name} (${clientId})`,
          );
        }
      }

      if (changed) this.notifyAwarenessListeners();
    }, 3000);
  }

  // ==========================================
  // Destroy
  // ==========================================
  public async destroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    if (this.awarenessTimeout) clearTimeout(this.awarenessTimeout);

    const activePlugins = [...this.plugins];
    this.plugins = [];

    for (const plugin of activePlugins) {
      try {
        await plugin.onDestroy?.();
      } catch (e) {
        console.error(`[Plugin] Error destroying '${plugin.name}':`, e);
      }
    }

    this.leaveAwareness();
    this.network.disconnect();
    this.doc.free?.();
  }

  // ==========================================
  // Public Accessors
  // ==========================================

  public getClientId(): string {
    return this.myClientId;
  }

  public subscribeNetwork(
    callback: (status: NetworkStatus) => void,
  ): () => void {
    this.networkListeners.push(callback);
    return () => {
      const idx = this.networkListeners.indexOf(callback);
      if (idx !== -1) this.networkListeners.splice(idx, 1);
    };
  }

  private notifyNetworkListeners(status: NetworkStatus) {
    this.networkListeners.forEach((listener) => listener(status));
  }

  // ==========================================
  // Core CRDT API: Text & Rich Text (Quill / Tiptap)
  // ==========================================

  public async insertText(
    index: number,
    text: string,
    attributes?: Record<string, any>,
    textName: string = 'content',
  ): Promise<void> {
    let deltaUpdate: Uint8Array;
    if (
      attributes &&
      Object.keys(attributes).length > 0 &&
      typeof (this.doc as any).insert_text_with_attrs === 'function'
    ) {
      deltaUpdate = (this.doc as any).insert_text_with_attrs(
        textName,
        index,
        text,
        attributes,
      ) as Uint8Array;
    } else {
      deltaUpdate = this.doc.insert_text(
        textName,
        index,
        text,
      ) as Uint8Array;
    }
    this.applyLocalUpdate(deltaUpdate, { kind: 'text', name: textName });
  }

  public async formatText(
    index: number,
    length: number,
    attributes: Record<string, any>,
    textName: string = 'content',
  ): Promise<void> {
    if (length <= 0) return;
    const deltaUpdate = (this.doc as any).format_text(
      textName,
      index,
      length,
      attributes,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'text', name: textName });
  }

  public async applyTextDelta(
    ops: TextDeltaOp[],
    textName: string = 'content',
  ): Promise<void> {
    if (!ops || ops.length === 0) return;
    const deltaUpdate = (this.doc as any).apply_text_delta(
      textName,
      ops,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'text', name: textName });
  }

  public async deleteText(
    index: number,
    length: number,
    textName: string = 'content',
  ): Promise<void> {
    const deltaUpdate = this.doc.delete_text(
      textName,
      index,
      length,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'text', name: textName });
  }

  public async clearText(textName: string = 'content'): Promise<void> {
    const currentText = this.getText(textName);
    const length = currentText.length;
    if (length > 0) {
      await this.deleteText(0, length, textName);
    }
  }

  public getText(textName: string = 'content'): string {
    return this.doc.get_text(textName);
  }

  public getTextDelta(textName: string = 'content'): TextDeltaOp[] {
    if (typeof (this.doc as any).get_text_delta === 'function') {
      const raw = (this.doc as any).get_text_delta(textName);
      return Array.isArray(raw) ? raw : [];
    }
    const text = this.getText(textName);
    return text ? [{ insert: text }] : [];
  }

  /**
   * Create a permanent relative position byte array for a text index (Y-07).
   * Supports both `createRelativePosition(index, assoc?, textName?)` and
   * `createRelativePosition(textName, index, assoc?)`.
   */
  public createRelativePosition(
    textNameOrIndex: string | number,
    indexOrAssoc: number = 0,
    assocOrName: number | string = 0,
  ): Uint8Array {
    let textName: string;
    let index: number;
    let assoc: number;

    if (typeof textNameOrIndex === 'number') {
      index = textNameOrIndex;
      assoc = typeof indexOrAssoc === 'number' ? indexOrAssoc : 0;
      textName = typeof assocOrName === 'string' ? assocOrName : 'content';
    } else {
      textName = textNameOrIndex;
      index = indexOrAssoc;
      assoc = typeof assocOrName === 'number' ? assocOrName : 0;
    }

    return (this.doc as any).create_relative_position(textName, index, assoc);
  }

  /**
   * Resolve a relative position byte array back to the current absolute index (Y-07).
   * Returns `{ index: number; assoc: number }` or `null` if the reference block was deleted/invalid.
   */
  public resolveRelativePosition(
    relPos: Uint8Array,
  ): { index: number; assoc: number } | null {
    const res = (this.doc as any).resolve_relative_position(relPos);
    return res && typeof res === 'object' && 'index' in res ? res : null;
  }

  public subscribe(
    listener: (text: string) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public subscribeText(
    textName: string,
    listener: (text: string, delta: TextDeltaOp[]) => void,
  ): () => void {
    try {
      this.doc.get_text(textName);
    } catch {
      // Ignored if mock doc doesn't have get_text
    }
    let set = this.textListeners.get(textName);
    if (!set) {
      set = new Set();
      this.textListeners.set(textName, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.textListeners.delete(textName);
      }
    };
  }

  // ==========================================
  // Core CRDT API: Map
  // ==========================================

  public async setMap(
    mapName: string,
    key: string,
    value: any,
  ): Promise<void> {
    this.validateMap(mapName, key, value);

    const deltaUpdate = (this.doc as any).map_set(
      mapName,
      key,
      value,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'map', name: mapName });
  }

  public async deleteMap(
    mapName: string,
    key: string,
  ): Promise<void> {
    const deltaUpdate = (this.doc as any).map_delete(
      mapName,
      key,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'map', name: mapName });
  }

  public async deleteMapKey(
    mapName: string,
    key: string,
  ): Promise<void> {
    return this.deleteMap(mapName, key);
  }

  public hasMapKey(mapName: string, key: string): boolean {
    const map = this.getMap(mapName);
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  public getMap<T extends Record<string, any> = Record<string, any>>(
    mapName: string,
  ): T {
    try {
      const rawMap = this.doc.map_get_all(mapName) as Record<
        string,
        any
      > | null;
      if (!rawMap || typeof rawMap !== 'object') return {} as T;
      return { ...rawMap } as T;
    } catch (error) {
      console.warn(
        `[Yoin] Failed to read Map (${mapName}), returning empty state.`,
        error,
      );
      return {} as T;
    }
  }

  public setMapDeep(
    mapName: string,
    path: string[],
    value: any,
  ): void {
    if (!path || path.length === 0) {
      throw new Error('[Yoin] setMapDeep path cannot be empty');
    }
    const deltaUpdate = this.doc.map_set_deep(
      mapName,
      path,
      value,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'map', name: mapName });
  }

  /**
   * Insert or overwrite a nested map under `mapName[key]`.
   * Essential for property-level CRDT merges on whiteboard shapes and cards!
   */
  public async setNested(
    mapName: string,
    key: string,
    entries: Record<string, any>,
  ): Promise<void> {
    const deltaUpdate = (this.doc as any).map_insert_nested(
      mapName,
      key,
      entries,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'map', name: mapName });
  }

  /**
   * Update one or more properties of an existing nested map under `mapName[key]`.
   */
  public async updateNested(
    mapName: string,
    key: string,
    updates: Record<string, any>,
  ): Promise<void> {
    const deltaUpdate = (this.doc as any).map_update_nested(
      mapName,
      key,
      updates,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'map', name: mapName });
  }

  public batchSet(entries: [string, string, any][]): void {
    if (!entries || entries.length === 0) return;

    const affectedMaps = new Set<string>();
    for (const [mapName, key, value] of entries) {
      this.validateMap(mapName, key, value);
      affectedMaps.add(mapName);
    }

    const deltaUpdate = this.doc.batch_set(entries) as Uint8Array;
    const scopes: UpdateScope[] = Array.from(affectedMaps).map((name) => ({
      kind: 'map',
      name,
    }));
    this.applyLocalUpdate(deltaUpdate, scopes);
  }

  public subscribeMap<T = Record<string, any>>(
    mapName: string,
    listener: (data: T) => void,
  ): () => void {
    try {
      this.doc.map_get_all(mapName);
    } catch {
      // Ignored if mock doc doesn't have map_get_all
    }
    let set = this.mapListeners.get(mapName);
    if (!set) {
      set = new Set();
      this.mapListeners.set(mapName, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.mapListeners.delete(mapName);
      }
    };
  }

  // ==========================================
  // Core CRDT API: Array
  // ==========================================

  public async pushArray(arrayName: string, item: any): Promise<void> {
    this.validateArray(arrayName, item);

    const deltaUpdate = (this.doc as any).array_push(
      arrayName,
      item,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'array', name: arrayName });
  }

  public async insertArray(
    arrayName: string,
    index: number,
    item: any,
  ): Promise<void> {
    this.validateArray(arrayName, item);

    const deltaUpdate = (this.doc as any).array_insert(
      arrayName,
      index,
      item,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'array', name: arrayName });
  }

  public async deleteArray(
    arrayName: string,
    index: number,
    length: number = 1,
  ): Promise<void> {
    if (length <= 0) return;
    const deltaUpdate = (this.doc as any).array_delete(
      arrayName,
      index,
      length,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate, { kind: 'array', name: arrayName });
  }

  public async moveArray(
    arrayName: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<void> {
    const current = this.getArray(arrayName);
    if (
      fromIndex < 0 ||
      fromIndex >= current.length ||
      toIndex < 0 ||
      toIndex >= current.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const item = current[fromIndex];
    await this.deleteArray(arrayName, fromIndex, 1);
    await this.insertArray(arrayName, toIndex, item);
  }

  public getArray<T = any>(arrayName: string): T[] {
    try {
      const rawArray = this.doc.array_get_all(
        arrayName,
      ) as T[] | null;
      if (!rawArray || !Array.isArray(rawArray)) return [];
      return [...rawArray];
    } catch (error) {
      console.warn(
        `[Yoin] Failed to read Array (${arrayName})`,
        error,
      );
      return [];
    }
  }

  public subscribeArray<T = any>(
    arrayName: string,
    listener: (data: T[]) => void,
  ): () => void {
    try {
      this.doc.array_get_all(arrayName);
    } catch {
      // Ignored if mock doc doesn't have array_get_all
    }
    let set = this.arrayListeners.get(arrayName);
    if (!set) {
      set = new Set();
      this.arrayListeners.set(arrayName, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.arrayListeners.delete(arrayName);
      }
    };
  }

  // ==========================================
  // Notification Dispatchers
  // ==========================================

  /**
   * Notifies all global and container-scoped listeners.
   */
  public notifyListeners(): void {
    if (this.listeners.length > 0) {
      const text = this.getText();
      this.listeners.forEach((listener) => listener(text));
    }

    for (const [textName, set] of this.textListeners.entries()) {
      if (set.size > 0) {
        const text = this.getText(textName);
        const delta = this.getTextDelta(textName);
        set.forEach((fn) => fn(text, delta));
      }
    }

    for (const [mapName, set] of this.mapListeners.entries()) {
      if (set.size > 0) {
        const data = this.getMap(mapName);
        set.forEach((fn) => fn(data));
      }
    }

    for (const [arrayName, set] of this.arrayListeners.entries()) {
      if (set.size > 0) {
        const data = this.getArray(arrayName);
        set.forEach((fn) => fn(data));
      }
    }
  }

  /**
   * Notifies only the listeners for the modified container(s) plus general `subscribe` listeners.
   */
  private notifyScopedListeners(scopes: UpdateScope | UpdateScope[]): void {
    const list = Array.isArray(scopes) ? scopes : [scopes];
    if (this.listeners.length > 0) {
      const touchesContent = list.some(
        (s) => s.kind === 'text' && (s.name === 'content' || !s.name),
      );
      if (touchesContent) {
        const text = this.getText();
        this.listeners.forEach((listener) => listener(text));
      }
    }
    for (const scope of list) {
      if (scope.kind === 'map') {
        const set = this.mapListeners.get(scope.name);
        if (set && set.size > 0) {
          const data = this.getMap(scope.name);
          set.forEach((fn) => fn(data));
        }
      } else if (scope.kind === 'array') {
        const set = this.arrayListeners.get(scope.name);
        if (set && set.size > 0) {
          const data = this.getArray(scope.name);
          set.forEach((fn) => fn(data));
        }
      } else if (scope.kind === 'text') {
        const set = this.textListeners.get(scope.name);
        if (set && set.size > 0) {
          const text = this.getText(scope.name);
          const delta = this.getTextDelta(scope.name);
          set.forEach((fn) => fn(text, delta));
        }
      }
    }
  }

  // ==========================================
  // Core Internal: Unified Local Update Process
  // ==========================================

  private applyLocalUpdate(
    deltaUpdate: Uint8Array,
    scopes?: UpdateScope | UpdateScope[],
  ): void {
    this.broadcastUpdate(deltaUpdate, scopes);
  }

  // ==========================================
  // Internal hook triggers for plugins
  // ==========================================

  private emitDocUpdate(update: Uint8Array) {
    this.docUpdateListeners.forEach((fn) => fn(update));
  }

  private emitLocalUpdate(update: Uint8Array) {
    this.localUpdateListeners.forEach((fn) => fn(update));
  }

  // ==========================================
  // Message Encoding
  // ==========================================

  private encodeMessage(
    type: number,
    payload: Uint8Array,
  ): Uint8Array {
    const msg = new Uint8Array(payload.length + 1);
    msg[0] = type;
    msg.set(payload, 1);
    return msg;
  }

  // ==========================================
  // Schema Validation
  // ==========================================

  private validateMap(mapName: string, key: string, value: any) {
    if (!this.schemas || !this.schemas[mapName]) return;

    const schema = this.schemas[mapName];

    try {
      if (schema instanceof z.ZodObject) {
        const objectSchema = schema as z.ZodObject<any>;
        const fieldSchema = objectSchema.shape[key];

        if (!fieldSchema) {
          console.warn(
            `[Yoin] Warning: Writing to undocumented field '${key}' in map '${mapName}'`,
          );
          return;
        }
        (fieldSchema as z.ZodTypeAny).parse(value);
      } else if (schema instanceof z.ZodRecord) {
        const recordSchema = schema as any;
        if (recordSchema.valueSchema) {
          recordSchema.valueSchema.parse(value);
        } else {
          (schema as z.ZodTypeAny).parse(value);
        }
      } else {
        (schema as z.ZodTypeAny).parse(value);
      }
    } catch (e) {
      console.error(
        `[Yoin] Schema Validation Failed for Map '${mapName}' key '${key}':`,
        e,
      );
      throw e;
    }
  }

  private validateArray(arrayName: string, item: any) {
    if (!this.schemas || !this.schemas[arrayName]) return;
    const schema = this.schemas[arrayName];
    try {
      if (schema instanceof z.ZodArray) {
        const arraySchema = schema as z.ZodArray<any>;
        arraySchema.element.parse(item);
      } else {
        console.warn(
          `[Yoin] Warning: Schema for array '${arrayName}' is not a z.array()`,
        );
      }
    } catch (e) {
      console.error(
        `[Yoin] Schema Validation Failed for Array '${arrayName}':`,
        e,
      );
      throw e;
    }
  }

  // ==========================================
  // React Integration Helpers
  // ==========================================

  public map_get_all(mapName: string): any {
    return this.getMap(mapName);
  }

  public array_get_all(arrayName: string): any {
    return this.getArray(arrayName);
  }

  public getAwarenessStates<T = Record<string, any>>(): Map<string, AwarenessState<T>> {
    return this.awarenessStates as Map<string, AwarenessState<T>>;
  }
}
