// client/src/yoin/YoinClient.ts
// ============================================================
// Micro-kernel Core — 僅保留 CRDT Doc、Networking、Map/Array API
// ============================================================
import { YoinDoc } from '../../../core/pkg-web/core';
import { NetworkProvider } from './network';
import type { YoinPlugin } from './plugin';
import type { YoinConfig, AwarenessState, AwarenessPartial, AwarenessCallback, NetworkStatus } from './types';
import { z } from 'zod';

// ============================================================
// 通訊協議常數
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
    public network: NetworkProvider; // Public for debugging/hooks
    private config: YoinConfig;

    // CRDT 文字訂閱者 (React/UI)
    private listeners: ((text: string) => void)[] = [];

    // Schema 驗證規則
    private schemas: Record<string, z.ZodTypeAny> | undefined;

    // ==========================================
    // Plugin 系統
    // ==========================================
    private plugins: YoinPlugin[] = [];

    // ==========================================
    // 文件更新勾子 (供插件訂閱)
    // ==========================================
    private docUpdateListeners: ((update: Uint8Array) => void)[] = [];
    private localUpdateListeners: ((update: Uint8Array) => void)[] = [];

    // ==========================================
    // Awareness 系統屬性
    // ==========================================
    private myClientId = Math.random().toString(36).substring(2, 10);
    private awarenessStates: Map<string, AwarenessState> = new Map();
    private awarenessListeners: AwarenessCallback[] = [];

    // Throttle 機制
    private awarenessTimeout: number | undefined;
    private pendingAwarenessUpdate: boolean = false;

    // Heartbeat 計時器
    private heartbeatTimer: number | undefined;
    private gcTimer: number | undefined;

    private networkListeners: ((status: NetworkStatus) => void)[] = [];

    // ==========================================
    // Constructor (輕量化 — 不再包含 Storage / Undo)
    // ==========================================
    constructor(config: YoinConfig) {
        this.config = config;
        this.myClientId = Math.random().toString(36).substring(2, 10);
        this.doc = new YoinDoc();
        this.schemas = config.schemas;

        // 將 docId 轉化為房間 URL
        // 支援兩種格式：
        //   路徑式 (Cloudflare Workers): wss://worker.dev → wss://worker.dev/room/{docId}
        //   查詢式 (Legacy server.js):   如果 URL 已包含路徑則使用 ?room= 參數
        const roomUrl = new URL(config.url);
        if (roomUrl.pathname === '/' || roomUrl.pathname === '') {
            roomUrl.pathname = `/room/${encodeURIComponent(config.docId)}`;
        } else {
            roomUrl.searchParams.append('room', config.docId);
        }

        this.network = new NetworkProvider(
            roomUrl.toString(),

            // 事件 1：連線成功
            () => {
                // 1. Join Room
                const roomNameBytes = new TextEncoder().encode(this.config.docId);
                this.network.broadcast(this.encodeMessage(MSG_JOIN_ROOM, roomNameBytes));
                console.log(`🚪 [Network] Joining room: ${this.config.docId}`);

                // 2. Start Sync
                const sv = this.doc.get_state_vector();
                this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1, sv));
                console.log("🔄 [Sync] Sent initial State Vector");

                // 3. Sync Awareness
                const myState = this.awarenessStates.get(this.myClientId);
                if (myState) this.setAwareness({});
            },

            // 事件 2：收到網路訊息
            async (rawMsg: Uint8Array) => {
                const type = rawMsg[0];
                const payload = rawMsg.slice(1);

                switch (type) {
                    case MSG_SYNC_STEP_1: {
                        const diff = this.doc.export_diff(payload);
                        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));
                        const mySV = this.doc.get_state_vector();
                        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1_REPLY, mySV));
                        const myState = this.awarenessStates.get(this.myClientId);
                        if (myState) this.setAwareness({});
                        break;
                    }

                    case MSG_SYNC_STEP_1_REPLY: {
                        const diff = this.doc.export_diff(payload);
                        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));
                        const myState = this.awarenessStates.get(this.myClientId);
                        if (myState) this.setAwareness({});
                        break;
                    }

                    case MSG_SYNC_STEP_2: {
                        this.doc.apply_update(payload);
                        
                        // 1. 通知 UI (React)
                        this.notifyListeners();
                        
                        // 2. 觸發插件 onAfterUpdate (遠端更新)
                        this.plugins.forEach(p => p.onAfterUpdate?.(payload));
                        
                        // 3. 觸發內部 Hook (DB Plugin 使用)
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
                            console.error("[Awareness] 解析封包失敗", e);
                        }
                        break;
                    }
                }
            },

            // 事件 3：網路狀態變更
            (status) => {
                this.notifyNetworkListeners(status);
            }
        );

        this.startHeartbeat();
    }

    // ==========================================
    // Plugin API: .use()
    // ==========================================

    /**
     * 註冊插件到核心
     * 支援鏈式呼叫：client.use(undoPlugin).use(dbPlugin)
     */
    public use(plugin: YoinPlugin): this {
        this.plugins.push(plugin);
        plugin.onInstall(this);
        console.log(`🔌 [Plugin] Installed: ${plugin.name}`);
        return this;
    }

    // ==========================================
    // 內部勾子 API (供插件訂閱)
    // ==========================================

    /**
     * 訂閱所有文件更新 (本地 + 遠端)
     * 適用場景：IndexedDB 持久化
     */
    public onDocUpdate(callback: (update: Uint8Array) => void): () => void {
        this.docUpdateListeners.push(callback);
        return () => {
            const idx = this.docUpdateListeners.indexOf(callback);
            if (idx !== -1) this.docUpdateListeners.splice(idx, 1);
        };
    }

    /**
     * 訂閱本地更新 (僅本端產生的 delta)
     * 適用場景：Undo 堆疊追蹤
     */
    public onLocalUpdate(callback: (update: Uint8Array) => void): () => void {
        this.localUpdateListeners.push(callback);
        return () => {
            const idx = this.localUpdateListeners.indexOf(callback);
            if (idx !== -1) this.localUpdateListeners.splice(idx, 1);
        };
    }

    /** 取得內部 WASM Doc 參照 (供進階插件使用) */
    public getDoc(): YoinDoc {
        return this.doc;
    }

    /** 取得設定 */
    public getConfig(): YoinConfig {
        return this.config;
    }

    /**
     * 編碼並廣播一個 SYNC_STEP_2 更新
     * 供插件（如 UndoPlugin）在執行 undo/redo 後廣播變更
     */
    public broadcastUpdate(update: Uint8Array): void {
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, update);
        this.network.broadcast(msg);
        // Important: Broadcast from undo also implies a UI update locally
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

    public onAwarenessChange(callback: AwarenessCallback): () => void {
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
        this.awarenessListeners.forEach(fn => fn(snapshot));
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
        const heartbeatInterval = this.config.heartbeatIntervalMs ?? 5000;
        const timeoutThreshold = this.config.heartbeatTimeoutMs ?? 30000;

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
                    console.log(`[Awareness] 👻 已清除離線用戶: ${state.name} (${clientId})`);
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

        // 銷毀所有插件
        this.plugins.forEach(p => p.onDestroy?.());

        this.leaveAwareness();
    }

    // ==========================================
    // Public Accessors
    // ==========================================

    public getClientId(): string {
        return this.myClientId;
    }

    public subscribeNetwork(callback: (status: NetworkStatus) => void) {
        this.networkListeners.push(callback);
    }

    private notifyNetworkListeners(status: NetworkStatus) {
        this.networkListeners.forEach(listener => listener(status));
    }

    // ==========================================
    // Core CRDT API: Text
    // ==========================================

    public async insertText(index: number, text: string) {
        const deltaUpdate = this.doc.insert_text("content", index, text);
        this.applyLocalUpdate(deltaUpdate);
    }

    public async deleteText(index: number, length: number) {
        const deltaUpdate = this.doc.delete_text("content", index, length);
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
        return this.doc.get_text("content");
    }

    public subscribe(listener: (text: string) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // ==========================================
    // Core CRDT API: Map (With Double-Serialization Fix)
    // ==========================================

    public async setMap(mapName: string, key: string, value: any) {
        this.validateMap(mapName, key, value);
        
        // [FIX] Double Serialization Prevention
        // If it's already a string, pass it directly. Otherwise stringify.
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        
        const deltaUpdate = this.doc.map_set(mapName, key, valueStr);
        this.applyLocalUpdate(deltaUpdate);
    }

    public getMap(mapName: string): Record<string, any> {
        try {
            const jsonStr = this.doc.map_get_all(mapName);
            if (!jsonStr || jsonStr === "{}") return {};

            const rawMap = JSON.parse(jsonStr);
            const result: Record<string, any> = {};

            for (const key in rawMap) {
                try {
                    // Try to parse, but if it fails (it's a raw string), use as is
                    if (typeof rawMap[key] === 'string') {
                         // Attempt parse to handle legacy JSON strings
                        try {
                            result[key] = JSON.parse(rawMap[key]);
                        } catch {
                            // If parse fails, it's a raw string (Correct behavior for strings now)
                            result[key] = rawMap[key];
                        }
                    } else {
                        result[key] = rawMap[key];
                    }
                } catch {
                    result[key] = rawMap[key];
                }
            }
            return result;
        } catch (error) {
            console.warn(`[Yoin] Failed to read Map (${mapName}), returning empty state.`, error);
            return {};
        }
    }

    public setMapDeep(mapName: string, path: string[], value: string | number | boolean) {
        try {
            // [FIX] Double Serialization Prevention
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            
            const deltaUpdate = this.doc.map_set_deep(mapName, path, valueStr) as Uint8Array;
            this.applyLocalUpdate(deltaUpdate);
        } catch (e) {
            console.error("[Yoin] Deep Set Error:", e);
        }
    }

    // ==========================================
    // Core CRDT API: Array (With Double-Serialization Fix)
    // ==========================================

    public async pushArray(arrayName: string, item: any) {
        this.validateArray(arrayName, item);
        
        // [FIX] Double Serialization Prevention
        const valueStr = typeof item === 'string' ? item : JSON.stringify(item);
        
        const deltaUpdate = this.doc.array_push(arrayName, valueStr);
        this.applyLocalUpdate(deltaUpdate);
    }

    public getArray(arrayName: string): any[] {
        try {
            const jsonStr = this.doc.array_get_all(arrayName);
            if (!jsonStr) return [];

            const rawArray: string[] = JSON.parse(jsonStr);
            return rawArray.map(item => {
                try { return JSON.parse(item); }
                catch { return item; } // Return raw string if parse fails
            });
        } catch (error) {
            console.warn(`[Yoin] 讀取 Array (${arrayName}) 失敗`, error);
            return [];
        }
    }

    // ==========================================
    // 公開 notifyListeners (供插件觸發 UI 更新)
    // ==========================================

    public notifyListeners() {
        const text = this.getText(); // Legacy support
        this.listeners.forEach(listener => listener(text));
    }

    // ==========================================
    // 核心內部：統一的本地更新流程
    // ==========================================

    /**
     * 所有本地修改（insertText、setMap、pushArray…）的統一出口
     */
    private applyLocalUpdate(deltaUpdate: Uint8Array) {
        // 1. Plugin lifecycle: onBeforeUpdate (Local)
        this.plugins.forEach(p => p.onBeforeUpdate?.(deltaUpdate));

        // 2. 廣播
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);

        // 3. 通知 UI
        this.notifyListeners();

        // 4. Plugin lifecycle: onAfterUpdate (Local)
        this.plugins.forEach(p => p.onAfterUpdate?.(deltaUpdate));

        // 5. 勾子事件
        this.emitLocalUpdate(deltaUpdate);
        this.emitDocUpdate(deltaUpdate);
    }

    // ==========================================
    // 內部勾子觸發器
    // ==========================================

    private emitDocUpdate(update: Uint8Array) {
        this.docUpdateListeners.forEach(fn => fn(update));
    }

    private emitLocalUpdate(update: Uint8Array) {
        this.localUpdateListeners.forEach(fn => fn(update));
    }

    // ==========================================
    // 訊息編碼
    // ==========================================

    private encodeMessage(type: number, payload: Uint8Array): Uint8Array {
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
                    console.warn(`[Yoin] Warning: Writing to undocumented field '${key}' in map '${mapName}'`);
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
            console.error(`[Yoin] ❌ Schema Validation Failed for Map '${mapName}' key '${key}':`, e);
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
                console.warn(`[Yoin] Warning: Schema for array '${arrayName}' is not a z.array()`);
            }
        } catch (e) {
            console.error(`[Yoin] ❌ Schema Validation Failed for Array '${arrayName}':`, e);
            throw e;
        }
    }

    // ==========================================
    // ⚛️ React Integration Helpers
    // ==========================================

    /**
     * 取得 Map 的所有資料 (JSON String)
     * 供 useYoinMap 的 getSnapshot 使用
     */
    public map_get_all(mapName: string): string {
        return this.doc.map_get_all(mapName);
    }

    /**
     * 取得 Array 的所有資料 (JSON String)
     * 供 useYoinArray 的 getSnapshot 使用
     */
    public array_get_all(arrayName: string): string {
        return this.doc.array_get_all(arrayName);
    }

    /**
     * 取得感知狀態 Map
     * 供 useYoinAwareness 使用
     */
    public getAwarenessStates() {
        return this.awarenessStates;
    }
}