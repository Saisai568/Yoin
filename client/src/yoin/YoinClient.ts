import { YoinDoc } from '../../../core/pkg-web/core';
import { StorageAdapter } from './storage';
import { NetworkProvider } from './network';
import type { YoinConfig, AwarenessState, AwarenessPartial, AwarenessCallback, NetworkStatus } from "./types";
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
// Layer 3: Logic Core — Awareness 狀態管理 + CRDT 同步引擎
// ============================================================
export class YoinClient {
    private doc: YoinDoc;
    private storage: StorageAdapter;
    private network: NetworkProvider;
    private config: YoinConfig;

    // CRDT 文字訂閱者
    private listeners: ((text: string) => void)[] = [];
    private saveTimeout: number | undefined;

    // [新增] 儲存驗證規則
    private schemas: Record<string, z.ZodTypeAny> | undefined;

    // ==========================================
    // Awareness 系統屬性
    // ==========================================
    private myClientId = Math.random().toString(36).substring(2, 10);
    private awarenessStates: Map<string, AwarenessState> = new Map();
    private awarenessListeners: AwarenessCallback[] = [];

    // Throttle 機制 (網路廣播防抖)
    private awarenessTimeout: number | undefined;
    private pendingAwarenessUpdate: boolean = false;

    // Heartbeat 計時器
    private heartbeatTimer: number | undefined;
    private gcTimer: number | undefined;

    private networkListeners: ((status: NetworkStatus) => void)[] = [];

    // ==========================================
    // Awareness Public API
    // ==========================================

    /**
     * 設定本地 Awareness 狀態 (支援部分更新)
     * 系統自動填入 clientId / timestamp，外部只需傳入變動的欄位
     *
     * @example
     * client.setAwareness({ cursorX: e.clientX, cursorY: e.clientY });
     * client.setAwareness({ selection: 'shape-123' });
     */
    public setAwareness(partial: AwarenessPartial) {
        const current = this.awarenessStates.get(this.myClientId);
        const fullState: AwarenessState = {
            // 保留上次的欄位 (name, color 等)
            ...current,
            // 覆寫本次變更
            ...partial,
            // 系統欄位永遠由引擎控制
            clientId: this.myClientId,
            timestamp: Date.now(),
        } as AwarenessState;

        // 1. 立即更新本地 UI 狀態
        this.awarenessStates.set(this.myClientId, fullState);
        this.notifyAwarenessListeners();

        // 2. Throttle 網路廣播
        const throttleMs = this.config.awarenessThrottleMs ?? 30;

        if (!this.awarenessTimeout) {
            // 冷卻期外 → 立即發送
            this.broadcastAwareness(fullState);
            this.awarenessTimeout = window.setTimeout(() => {
                this.awarenessTimeout = undefined;
                // 冷卻結束 → 補發最後一筆
                if (this.pendingAwarenessUpdate) {
                    this.pendingAwarenessUpdate = false;
                    const latest = this.awarenessStates.get(this.myClientId);
                    if (latest) this.broadcastAwareness(latest);
                }
            }, throttleMs);
        } else {
            // 冷卻中 → 標記有待發更新
            this.pendingAwarenessUpdate = true;
        }
    }

    /**
     * 訂閱 Awareness 狀態變化
     * @returns 取消訂閱的函式
     */
    public onAwarenessChange(callback: AwarenessCallback): () => void {
        this.awarenessListeners.push(callback);
        // 訂閱當下立刻觸發一次
        callback(this.awarenessStates);
        // 回傳取消訂閱函式
        return () => {
            const idx = this.awarenessListeners.indexOf(callback);
            if (idx !== -1) this.awarenessListeners.splice(idx, 1);
        };
    }

    /**
     * 主動廣播離線通知並清除本地狀態
     * 應在 window.beforeunload 中呼叫
     */
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

        // 發送離線封包 (跳過 throttle，立即送出)
        this.broadcastAwareness(offlineState);
    }

    /**
     * 強制觸發 Awareness 重繪 (例如切換渲染器後)
     */
    public notifyAwarenessListeners() {
        const snapshot = this.awarenessStates;
        this.awarenessListeners.forEach(fn => fn(snapshot));
    }

    // ==========================================
    // 向下相容別名 (Deprecated → 下個版本移除)
    // ==========================================
    /** @deprecated 請改用 setAwareness() */
    public setAwarenessState(state: Record<string, any>) {
        this.setAwareness(state as AwarenessPartial);
    }
    /** @deprecated 請改用 onAwarenessChange() */
    public subscribeAwareness(callback: AwarenessCallback) {
        this.onAwarenessChange(callback);
    }

    // ==========================================
    // Awareness 內部實作
    // ==========================================

    private broadcastAwareness(state: AwarenessState) {
        const jsonStr = JSON.stringify(state);
        const payload = new TextEncoder().encode(jsonStr);
        this.network.broadcast(this.encodeMessage(MSG_AWARENESS, payload));
    }

    /**
     * 啟動 Heartbeat 機制
     * - 定期廣播自己的狀態 (keep-alive)
     * - 定期垃圾回收超時的幽靈使用者
     */
    private startHeartbeat() {
        const heartbeatInterval = this.config.heartbeatIntervalMs ?? 5000;
        const timeoutThreshold = this.config.heartbeatTimeoutMs ?? 30000;

        // Heartbeat 廣播：定期重發自己的狀態
        this.heartbeatTimer = window.setInterval(() => {
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) {
                this.setAwareness({}); // 空更新 → 只刷新 timestamp
            }
        }, heartbeatInterval);

        // GC：每 3 秒掃描，清除超過閾值未更新的使用者
        this.gcTimer = window.setInterval(() => {
            const now = Date.now();
            let changed = false;

            for (const [clientId, state] of this.awarenessStates.entries()) {
                if (clientId === this.myClientId) continue; // 不清自己
                if (now - state.timestamp > timeoutThreshold) {
                    this.awarenessStates.delete(clientId);
                    changed = true;
                    console.log(`[Awareness] 👻 已清除離線用戶: ${state.name} (${clientId})`);
                }
            }

            if (changed) this.notifyAwarenessListeners();
        }, 3000);
    }

    /**
     * 銷毀 Client：停止所有計時器並廣播離線
     */
    public destroy() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.gcTimer) clearInterval(this.gcTimer);
        if (this.awarenessTimeout) clearTimeout(this.awarenessTimeout);
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.leaveAwareness();
    }

    // ==========================================
    // Constructor
    // ==========================================
    constructor(config: YoinConfig) {
        this.config = config;
        this.myClientId = Math.random().toString(36).substring(2, 10);
        this.doc = new YoinDoc();
        this.storage = new StorageAdapter(config.dbName);

        this.config = config;
        this.schemas = config.schemas; // [新增] 注入 Schema 設定

        // 將 docId 轉化為房間 URL
        const roomUrl = new URL(config.url);
        roomUrl.searchParams.append('room', config.docId);

        this.network = new NetworkProvider(
            roomUrl.toString(),

            // 事件 1：連線成功
            () => {
                // [Step 1] 加入房間 (Handshake)
                // 將 docId (Room ID) 編碼並發送給 Server
                const roomNameBytes = new TextEncoder().encode(this.config.docId);
                this.network.broadcast(this.encodeMessage(MSG_JOIN_ROOM, roomNameBytes));
                console.log(`🚪 [Network] Joining room: ${this.config.docId}`);

                // [Step 2] 開始同步流程
                const sv = this.doc.get_state_vector();
                this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1, sv));
                console.log("🔄 [Sync] Sent initial State Vector");

                // [Step 3] 廣播 Awareness
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
                        // 向新朋友自我介紹
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
                        this.notifyListeners();
                        this.scheduleSave();
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

        this.loadFromDisk();
        this.startHeartbeat();
    }

    /** 取得本地 clientId */
    public getClientId(): string {
        return this.myClientId;
    }

    // ==========================================
    // Network 訂閱
    // ==========================================
    public subscribeNetwork(callback: (status: NetworkStatus) => void) {
        this.networkListeners.push(callback);
    }

    private notifyNetworkListeners(status: NetworkStatus) {
        this.networkListeners.forEach(listener => listener(status));
    }

    /**
     * Core method: Insert text.
     * This calls the Rust API which returns the delta update immediately.
     */
    public async insertText(index: number, text: string) {
        // Call Rust API to get the update delta directly
        const deltaUpdate = this.doc.insert_text("content", index, text);
        
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

    /**
     * Delete text in a specific range.
     */
    public async deleteText(index: number, length: number) {
        const deltaUpdate = this.doc.delete_text("content", index, length);
        
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

    /**
     * 捷徑方法：一鍵清空所有文字
     */
    public async clearText() {
        const currentText = this.getText();
        const length = currentText.length;
        
        if (length > 0) {
            // 從第 0 個字元開始，刪除「總長度」這麼多字
            await this.deleteText(0, length);
        }
    }

    /**
     * 讀取目前文字內容
     */
    public getText(): string {
        return this.doc.get_text("content");
    }

    /**
     * 訂閱機制：讓 UI 可以監聽資料變動
     * 類似 React 的 useEffect 或 addEventListener
     */
    public subscribe(callback: (text: string) => void) {
        this.listeners.push(callback);
        // 訂閱當下立刻回傳一次目前的狀態
        callback(this.getText());
    }

    /**
     * 私有方法：從 IndexedDB 還原資料
     */
    private async loadFromDisk() {
        const data = await this.storage.load(this.config.docId);
        if (data) {
            console.log("📂 [Storage] Found local data, applying...");
            this.doc.apply_update(data);
            this.notifyListeners(); // 載入完成後通知 UI
        } else {
            console.log("🆕 [Storage] No local data found, starting fresh.");
        }
    }

    /**
     * 私有方法：儲存全量快照到 IndexedDB
     */
    private async persist() {
        const snapshot = this.doc.export_update();
        await this.storage.save(this.config.docId, snapshot);
    }
    /**
     * 私有方法：通知所有訂閱者
     */
    private notifyListeners() {
        const text = this.getText();
        this.listeners.forEach(listener => listener(text));
    }

    // 新增：防抖存檔機制
    private scheduleSave() {
        // 如果已經有一個計時器在倒數，就取消它（重新計時）
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        
        // 設定新的計時器，1000 毫秒 (1秒) 後執行真正的存檔
        this.saveTimeout = window.setTimeout(async () => {
            await this.persist();
            console.log("💾 [Storage] Auto-saved to IndexedDB (Debounced)");
        }, 1000);
    }

    // 新增私有小工具：負責幫資料戴上 1 byte 的「小帽子」
    private encodeMessage(type: number, payload: Uint8Array): Uint8Array {
        const msg = new Uint8Array(payload.length + 1);
        msg[0] = type;           // 寫入 Header
        msg.set(payload, 1);     // 寫入 Payload (從 index 1 開始放)
        return msg;
    }

    // ==========================================
    // High-level API: Map (State & Config Sync)
    // ==========================================
    public async setMap(mapName: string, key: string, value: any) {
        // [新增] 驗證攔截：如果不合法，會直接 throw Error，後面的 Rust 操作不會執行
        this.validateMap(mapName, key, value);

        const valueStr = JSON.stringify(value);
        const deltaUpdate = this.doc.map_set(mapName, key, valueStr);
        
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

public getMap(mapName: string): Record<string, any> {
        try {
            const jsonStr = this.doc.map_get_all(mapName);
            // Guard: Return empty object if Rust returns empty
            if (!jsonStr || jsonStr === "{}") return {}; 
            
            const rawMap = JSON.parse(jsonStr);
            const result: Record<string, any> = {};
            
            // Recursively parse inner JSON strings if necessary
            for (const key in rawMap) {
                try { 
                    // Values stored via map_set are stringified JSON, so we try to parse them.
                    // Native values from map_set_deep might not need parsing, but this handles mixed cases.
                    if (typeof rawMap[key] === 'string') {
                         result[key] = JSON.parse(rawMap[key]);
                    } else {
                         result[key] = rawMap[key];
                    }
                } 
                catch { result[key] = rawMap[key]; }
            }
            return result;
        } catch (error) {
            console.warn(`[Yoin] Failed to read Map (${mapName}), returning empty state. Error:`, error);
            return {};
        }
    }

    /**
     *  取得 Map 中的單一設定值 (不需全量轉換，效能極高)
     */
    public getMapItem(mapName: string, key: string): any {
        try {
            // 呼叫我們剛剛新增的 Rust API
            const jsonStr = this.doc.map_get(mapName, key);
            if (jsonStr === "null" || !jsonStr) return undefined;
            return JSON.parse(jsonStr);
        } catch (error) {
            console.warn(`[Yoin] 讀取 Map 項目 (${mapName}[${key}]) 失敗:`, error);
            return undefined;
        }
    }

    // ==========================================
    // High-level API: Array (List & History Sync)
    // ==========================================
    public async pushArray(arrayName: string, item: any) {
        // [新增] 驗證攔截
        this.validateArray(arrayName, item);

        const valueStr = JSON.stringify(item);
        const deltaUpdate = this.doc.array_push(arrayName, valueStr);
        
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

    public getArray(arrayName: string): any[] {
        try {
            const jsonStr = this.doc.array_get_all(arrayName);
            if (!jsonStr) return [];

            const rawArray: string[] = JSON.parse(jsonStr);
            return rawArray.map(item => {
                try { return JSON.parse(item); } 
                catch { return item; }
            });
        } catch (error) {
            console.warn(`[Yoin] 讀取 Array (${arrayName}) 失敗，回傳空陣列。原因:`, error);
            return [];
        }
    }

    /**
     *  取得 Array 中的特定索引值
     */
    public getArrayItem(arrayName: string, index: number): any {
        try {
            const jsonStr = this.doc.array_get(arrayName, index);
            if (jsonStr === "null" || !jsonStr) return undefined;
            return JSON.parse(jsonStr);
        } catch (error) {
            console.warn(`[Yoin] 讀取 Array 項目 (${arrayName}[${index}]) 失敗:`, error);
            return undefined;
        }
    }

    // ==========================================
    // 🌳 提案 C：巢狀 Map API
    // ==========================================
    
    /**
     * Modify nested Map values (supports whiteboard collaboration).
     * @param mapName Root Map name (e.g., "whiteboard")
     * @param path Path array (e.g., ["shape-id-123", "style", "color"])
     * @param value Value to set
     */
    public setMapDeep(mapName: string, path: string[], value: string | number | boolean) {
        try {
            // [新增] 驗證攔截
            // Deep Map 比較複雜，我們驗證路徑的第一層 Key (如果存在)
            // 或是你可以定義更複雜的 Deep Schema 邏輯
            if (path.length > 0) {
                 // 這裡做一個簡單的假設：Deep Set 通常也是修改某個物件的屬性
                 // 我們嘗試驗證根屬性。如果 path=['style', 'color']，我們目前僅驗證 mapName 下的 'style' 是否存在
                 // 若要完整驗證 Deep Set，需要 Zod 的 deep partial parsing，這裡先做基礎防護
                 // 暫時僅對第一層 Key 做存在性檢查 (若 schema 是 z.object)
                 /* if (this.schemas && this.schemas[mapName] instanceof z.ZodObject) {
                     const rootKey = path[0];
                     if (!this.schemas[mapName].shape[rootKey]) {
                         console.warn(`[Yoin] Warning: Deep set on undocumented root key '${rootKey}'`);
                     }
                 }
                 */
            }

            const deltaUpdate = this.doc.map_set_deep(mapName, path, value) as Uint8Array;
            
            const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
            this.network.broadcast(msg);
            
            this.notifyListeners();
            this.scheduleSave();
        } catch (e) {
            console.error("[Yoin] Deep Set Error:", e);
            // 這裡捕捉了錯誤，所以不會崩潰，但會印出錯誤
        }
    }

    /**
     * 取得完整的 Map 資料 (包含巢狀結構)
     * @param mapName Map 名稱 (例如 "shapes")
     */
    public getMapJSON(mapName: string): any {
        try {
            // 呼叫新的 Rust API
            return this.doc.map_get_json(mapName);
        } catch (e) {
            console.error("[Yoin] Get JSON Error:", e);
            return null;
        }
    }

    // ==========================================
    // ↩️ Undo / Redo API
    // ==========================================

    public async undo() {
        try {
            // Call Rust to perform undo and get the inverse operation (diff)
            const diff = this.doc.undo();
            
            // If diff is not empty, it means a change happened
            if (diff && diff.length > 0) {
                // 1. Broadcast the undo effect to peers
                const msg = this.encodeMessage(MSG_SYNC_STEP_2, diff);
                this.network.broadcast(msg);
                
                // 2. Update local UI
                this.notifyListeners();
                
                // 3. Persist to IndexedDB
                this.scheduleSave();
                
            }
        } catch (e) {
            console.error("[Yoin] Undo failed:", e);
        }
    }

    public async redo() {
        try {
            const diff = this.doc.redo();
            
            if (diff && diff.length > 0) {
                const msg = this.encodeMessage(MSG_SYNC_STEP_2, diff);
                this.network.broadcast(msg);
                
                this.notifyListeners();
                this.scheduleSave();

            } else {
            }
        } catch (e) {
            console.error("[Yoin] Redo failed:", e);
        }
    }

    // ==========================================
    // 🛡️ Schema Validation Helpers (Fixed)
    // ==========================================

    /**
     * 驗證 Map 的單一欄位寫入
     */
    private validateMap(mapName: string, key: string, value: any) {
        if (!this.schemas || !this.schemas[mapName]) return;

        const schema = this.schemas[mapName];

        try {
            if (schema instanceof z.ZodObject) {
                // 強制轉型為 ZodObject<any> 以存取 shape
                const objectSchema = schema as z.ZodObject<any>;
                const fieldSchema = objectSchema.shape[key];
                
                if (!fieldSchema) {
                    console.warn(`[Yoin] Warning: Writing to undocumented field '${key}' in map '${mapName}'`);
                    return;
                }
                // 強制轉型為 ZodTypeAny 以確保 parse 方法存在
                (fieldSchema as z.ZodTypeAny).parse(value);

            } else if (schema instanceof z.ZodRecord) {
                // 存取 valueSchema 而無需強制轉型為特定的 ZodRecord 泛型
                const recordSchema = schema as any;
                if (recordSchema.valueSchema) {
                    recordSchema.valueSchema.parse(value);
                } else {
                    (schema as z.ZodTypeAny).parse(value);
                }

            } else {
                // 其他情況 (如 z.any)，嘗試直接驗證
                // 通常用於 setMap 整個 value 是一單值的狀況
                (schema as z.ZodTypeAny).parse(value);
            }
        } catch (e) {
            console.error(`[Yoin] ❌ Schema Validation Failed for Map '${mapName}' key '${key}':`, e);
            throw e; // 阻斷寫入
        }
    }

    /**
     * 驗證 Array 的元素寫入
     */
    private validateArray(arrayName: string, item: any) {
        if (!this.schemas || !this.schemas[arrayName]) return;

        const schema = this.schemas[arrayName];

        try {
            if (schema instanceof z.ZodArray) {
                // 強制轉型為 ZodArray<any> 以存取 element
                const arraySchema = schema as z.ZodArray<any>;
                arraySchema.element.parse(item);
            } else {
                 console.warn(`[Yoin] Warning: Schema for array '${arrayName}' is not a z.array()`);
            }
        } catch (e) {
            console.error(`[Yoin] ❌ Schema Validation Failed for Array '${arrayName}':`, e);
            throw e; // 阻斷寫入
        }
    }

    
}