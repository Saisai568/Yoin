import { YoinDoc } from '../../../core/pkg-web/core';
import { StorageAdapter } from './storage';
import { NetworkProvider } from './network';
import type { YoinConfig, AwarenessState, AwarenessPartial, AwarenessCallback, NetworkStatus } from "./types";

// ============================================================
// 通訊協議常數
// ============================================================
const MSG_SYNC_STEP_1 = 0;
const MSG_SYNC_STEP_2 = 1;
const MSG_SYNC_STEP_1_REPLY = 2;
const MSG_AWARENESS = 3;

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

        // 將 docId 轉化為房間 URL
        const roomUrl = new URL(config.url);
        roomUrl.searchParams.append('room', config.docId);

        this.network = new NetworkProvider(
            roomUrl.toString(),

            // 事件 1：連線成功
            () => {
                const sv = this.doc.get_state_vector();
                this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1, sv));
                console.log("🔄 [Sync] Sent initial State Vector");

                // 連線時廣播自己的最新狀態
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
     * 核心方法：插入文字
     * 這是使用者唯一需要呼叫的寫入方法
     */
    public async insertText(index: number, text: string) {
        const deltaUpdate = this.doc.insert_and_get_update("content", index, text);
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);

        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

    /**
     * 刪除指定範圍的文字
     */
    public async deleteText(index: number, length: number) {
        const deltaUpdate = this.doc.delete_text_and_get_update("content", index, length);
        
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate));
        
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
    // 高階 API：Map (狀態與設定同步)
    // ==========================================
    public async setMap(mapName: string, key: string, value: any) {
        const valueStr = JSON.stringify(value);
        const deltaUpdate = this.doc.map_set_and_get_update(mapName, key, valueStr);
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate));
        this.notifyListeners();
        this.scheduleSave();
    }

    public getMap(mapName: string): Record<string, any> {
        try {
            const jsonStr = this.doc.map_get_all(mapName);
            // 防禦：如果 Rust 傳回空值，直接回傳空物件
            if (!jsonStr) return {}; 
            
            const rawMap = JSON.parse(jsonStr);
            const result: Record<string, any> = {};
            for (const key in rawMap) {
                try { result[key] = JSON.parse(rawMap[key]); } 
                catch { result[key] = rawMap[key]; }
            }
            return result;
        } catch (error) {
            console.warn(`[Yoin] 讀取 Map (${mapName}) 失敗，回傳空狀態。原因:`, error);
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
    // 高階 API：Array (列表與歷史同步)
    // ==========================================
    public async pushArray(arrayName: string, item: any) {
        const valueStr = JSON.stringify(item);
        const deltaUpdate = this.doc.array_push_and_get_update(arrayName, valueStr);
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate));
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
     * 深度修改 Map 數值 (支援白板協作)
     * @param mapName 根 Map 名稱 (例如 "whiteboard")
     * @param path 路徑陣列 (例如 ["shape-id-123", "style", "color"])
     * @param value 值
     */
    public setMapDeep(mapName: string, path: string[], value: string | number | boolean) {
        try {
            this.doc.map_set_deep(mapName, path, value);
            
            // 觸發更新
            const update = this.doc.export_update(); // 這裡可以優化，但先求有
            // 注意：Rust 內部的 transaction 已經處理好 update 了
            // 我們只需要觸發儲存和通知
            
            // 由於 map_set_deep 會產生 update，我們需要抓出 diff 廣播嗎？
            // 其實 Yrs 的 observe 機制會處理，但我們目前的架構是手動廣播。
            // 為了簡化，我們先廣播一次「全量 diff」給別人 (或是像 deleteText 那樣做)
            // *最佳實踐*：Rust 端應該回傳 update binary，這裡先暫用通用廣播
            
            const diff = this.doc.snapshot(); // 暫時用 snapshot 確保同步，或是用 get_update
            // 實際上 deleteText 那邊我們是用 delete_text_and_get_update
            // 建議 Rust 端 map_set_deep 也回傳 Vec<u8> update，這裡先簡化流程：
            
            this.notifyListeners();
            this.scheduleSave();
            
            // 這裡依然需要廣播，建議回頭去 Rust 把 map_set_deep 改成回傳 Vec<u8>
            // 但為了不讓你改太多 Rust，我們先用這招：
            const sv = this.doc.get_state_vector();
            this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1_REPLY, sv)); 
            // ^ 偷懶解法：告訴別人「我更新了，你們來跟我同步吧」
            
        } catch (e) {
            console.error("[Yoin] Deep Set Error:", e);
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
}