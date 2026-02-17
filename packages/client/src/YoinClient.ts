// packages/client/src/YoinClient.ts
// ============================================================
// Micro-kernel Core - CRDT Doc, Networking, Map/Array API
// ============================================================
import { YoinDoc } from '@yoin/core';
import { NetworkProvider } from './network';
import { isYoinInitialized } from './wasm/loader';
import type { YoinPlugin } from './plugin';
import type {
  YoinConfig,
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

// ============================================================
// Micro-kernel Core
// ============================================================
export class YoinClient {
  private doc: YoinDoc;
  public network: NetworkProvider;
  private config: YoinConfig;

  // CRDT Text Subscriber (React/UI)
  private listeners: ((text: string) => void)[] = [];

  // Schema Validation Rules
  private schemas: Record<string, z.ZodTypeAny> | undefined;

  // Plugin system
  private plugins: YoinPlugin[] = [];

  // File update hooks (for plugin subscription)
  private docUpdateListeners: ((update: Uint8Array) => void)[] = [];
  private localUpdateListeners: ((update: Uint8Array) => void)[] = [];

  // Awareness System Properties
  private myClientId = Math.random().toString(36).substring(2, 10);
  private awarenessStates: Map<string, AwarenessState> = new Map();
  private awarenessListeners: AwarenessCallback[] = [];

  // Throttle Mechanism
  private awarenessTimeout: number | undefined;
  private pendingAwarenessUpdate: boolean = false;

  // Heartbeat Timer
  private heartbeatTimer: number | undefined;
  private gcTimer: number | undefined;

  private networkListeners: ((status: NetworkStatus) => void)[] = [];

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

    this.network = new NetworkProvider(
      roomUrl.toString(),

      // Event 1: Connection Successful
      () => {
        const roomNameBytes = new TextEncoder().encode(this.config.docId);
        this.network.broadcast(
          this.encodeMessage(MSG_JOIN_ROOM, roomNameBytes),
        );
        console.log(`[Network] Joining room: ${this.config.docId}`);
        const sv = this.doc.get_state_vector();
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1, sv));
        console.log('[Sync] Sent initial State Vector');
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
            this.network.broadcast(
              this.encodeMessage(MSG_SYNC_STEP_2, diff),
            );
            const mySV = this.doc.get_state_vector();
            this.network.broadcast(
              this.encodeMessage(MSG_SYNC_STEP_1_REPLY, mySV),
            );
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) this.setAwareness({});
            break;
          }

          case MSG_SYNC_STEP_1_REPLY: {
            const diff = this.doc.export_diff(payload);
            this.network.broadcast(
              this.encodeMessage(MSG_SYNC_STEP_2, diff),
            );
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) this.setAwareness({});
            break;
          }

          case MSG_SYNC_STEP_2: {
            this.doc.apply_update(payload);
            this.notifyListeners();
            this.plugins.forEach((p) => p.onAfterUpdate?.(payload));
            this.emitDocUpdate(payload);
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
        }
      },

      // Event 3: Network Status Change
      (status) => {
        this.notifyNetworkListeners(status);
      },
    );

    this.startHeartbeat();
  }

  // ==========================================
  // Plugin API: .use()
  // ==========================================

  public use(plugin: YoinPlugin): this {
    this.plugins.push(plugin);
    plugin.onInstall(this);
    console.log(`[Plugin] Installed: ${plugin.name}`);
    return this;
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

  public broadcastUpdate(update: Uint8Array): void {
    const msg = this.encodeMessage(MSG_SYNC_STEP_2, update);
    this.network.broadcast(msg);
    this.notifyListeners();
  }

  // ==========================================
  // Awareness Public API
  // ==========================================

  public setAwareness(partial: AwarenessPartial) {
    const current = this.awarenessStates.get(this.myClientId);
    const fullState: AwarenessState = {
      ...current,
      ...partial,
      clientId: this.myClientId,
      timestamp: Date.now(),
    } as AwarenessState;

    this.awarenessStates.set(this.myClientId, fullState);
    this.notifyAwarenessListeners();

    const throttleMs = this.config.awarenessThrottleMs ?? 30;

    if (!this.awarenessTimeout) {
      this.broadcastAwareness(fullState);
      this.awarenessTimeout = window.setTimeout(() => {
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
    callback: AwarenessCallback,
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
    this.network.broadcast(this.encodeMessage(MSG_AWARENESS, payload));
  }

  private startHeartbeat() {
    const heartbeatInterval =
      this.config.heartbeatIntervalMs ?? 5000;
    const timeoutThreshold =
      this.config.heartbeatTimeoutMs ?? 30000;

    this.heartbeatTimer = window.setInterval(() => {
      const myState = this.awarenessStates.get(this.myClientId);
      if (myState) {
        this.setAwareness({});
      }
    }, heartbeatInterval);

    this.gcTimer = window.setInterval(() => {
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
  public destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    if (this.awarenessTimeout) clearTimeout(this.awarenessTimeout);

    this.plugins.forEach((p) => p.onDestroy?.());

    this.leaveAwareness();
    this.network.disconnect();
  }

  // ==========================================
  // Public Accessors
  // ==========================================

  public getClientId(): string {
    return this.myClientId;
  }

  public subscribeNetwork(
    callback: (status: NetworkStatus) => void,
  ) {
    this.networkListeners.push(callback);
  }

  private notifyNetworkListeners(status: NetworkStatus) {
    this.networkListeners.forEach((listener) => listener(status));
  }

  // ==========================================
  // Core CRDT API: Text
  // ==========================================

  public async insertText(index: number, text: string) {
    const deltaUpdate = this.doc.insert_text(
      'content',
      index,
      text,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate);
  }

  public async deleteText(index: number, length: number) {
    const deltaUpdate = this.doc.delete_text(
      'content',
      index,
      length,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate);
  }

  public async clearText() {
    const currentText = this.getText();
    const length = currentText.length;
    if (length > 0) {
      await this.deleteText(0, length);
    }
  }

  public getText(): string {
    return this.doc.get_text('content');
  }

  public subscribe(
    listener: (text: string) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ==========================================
  // Core CRDT API: Map
  // ==========================================

  public async setMap(mapName: string, key: string, value: any) {
    this.validateMap(mapName, key, value);

    const valueStr =
      typeof value === 'string' ? value : JSON.stringify(value);

    const deltaUpdate = this.doc.map_set(
      mapName,
      key,
      valueStr,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate);
  }

  public getMap(mapName: string): Record<string, any> {
    try {
      const rawMap = this.doc.map_get_all(mapName) as Record<
        string,
        any
      > | null;
      if (!rawMap || typeof rawMap !== 'object') return {};

      const result: Record<string, any> = {};
      for (const key in rawMap) {
        const val = rawMap[key];
        if (typeof val === 'string') {
          try {
            result[key] = JSON.parse(val);
          } catch {
            result[key] = val;
          }
        } else {
          result[key] = val;
        }
      }
      return result;
    } catch (error) {
      console.warn(
        `[Yoin] Failed to read Map (${mapName}), returning empty state.`,
        error,
      );
      return {};
    }
  }

  public setMapDeep(
    mapName: string,
    path: string[],
    value: string | number | boolean,
  ) {
    try {
      const deltaUpdate = this.doc.map_set_deep(
        mapName,
        path,
        value,
      ) as Uint8Array;
      this.applyLocalUpdate(deltaUpdate);
    } catch (e) {
      console.error('[Yoin] Deep Set Error:', e);
    }
  }

  public batchSet(entries: [string, string, any][]) {
    try {
      const jsEntries = entries.map(([mapName, key, value]) => {
        const v =
          typeof value === 'string' ? value : JSON.stringify(value);
        return [mapName, key, v];
      });
      const deltaUpdate = this.doc.batch_set(
        jsEntries,
      ) as Uint8Array;
      this.applyLocalUpdate(deltaUpdate);
    } catch (e) {
      console.error('[Yoin] Batch Set Error:', e);
    }
  }

  // ==========================================
  // Core CRDT API: Array
  // ==========================================

  public async pushArray(arrayName: string, item: any) {
    this.validateArray(arrayName, item);

    const valueStr =
      typeof item === 'string' ? item : JSON.stringify(item);

    const deltaUpdate = this.doc.array_push(
      arrayName,
      valueStr,
    ) as Uint8Array;
    this.applyLocalUpdate(deltaUpdate);
  }

  public getArray(arrayName: string): any[] {
    try {
      const rawArray = this.doc.array_get_all(
        arrayName,
      ) as any[] | null;
      if (!rawArray || !Array.isArray(rawArray)) return [];

      return rawArray.map((item) => {
        if (typeof item === 'string') {
          try {
            return JSON.parse(item);
          } catch {
            return item;
          }
        }
        return item;
      });
    } catch (error) {
      console.warn(
        `[Yoin] Failed to read Array (${arrayName})`,
        error,
      );
      return [];
    }
  }

  // ==========================================
  // public notifyListeners
  // ==========================================

  public notifyListeners() {
    const text = this.getText();
    this.listeners.forEach((listener) => listener(text));
  }

  // ==========================================
  // Core Internal: Unified Local Update Process
  // ==========================================

  private applyLocalUpdate(deltaUpdate: Uint8Array) {
    this.plugins.forEach((p) => p.onBeforeUpdate?.(deltaUpdate));

    const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
    this.network.broadcast(msg);

    this.notifyListeners();

    this.plugins.forEach((p) => p.onAfterUpdate?.(deltaUpdate));

    this.emitLocalUpdate(deltaUpdate);
    this.emitDocUpdate(deltaUpdate);
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
    return this.doc.map_get_all(mapName);
  }

  public array_get_all(arrayName: string): any {
    return this.doc.array_get_all(arrayName);
  }

  public getAwarenessStates() {
    return this.awarenessStates;
  }
}
