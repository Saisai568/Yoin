import { YoinDoc } from '../../core/pkg/core';         // 引入 WASM 定義
import { StorageAdapter } from './storage';            // 引入我們剛改好的 Storage
import { NetworkProvider } from './network';           // 引入我們剛改好的 Network
import type { YoinConfig } from './types';             // 引入設定檔介面TYPE

// 🟢 定義通訊協議的 Message Type 常數
const MSG_SYNC_STEP_1 = 0; // Type 0 傳送 State Vector
const MSG_SYNC_STEP_2 = 1; // Type 1 傳送 Diff 或 Update
const MSG_SYNC_STEP_1_REPLY = 2; // Type 2 新增：「收到，順便附上我的進度，你也把你多出來的資料給我」
const MSG_AWARENESS = 3; // Type 3 新增：感知系統廣播

export class YoinClient {
    private doc: YoinDoc;
    private storage: StorageAdapter;
    private network: NetworkProvider;
    private config: YoinConfig;

    // 用來存放訂閱者 (UI 更新函數) 的陣列
    private listeners: ((text: string) => void)[] = [];

    // 🟢 新增：用來記錄計時器的 ID
    private saveTimeout: number | undefined;

    // 🟢 感知系統的專屬屬性
    private myClientId = Math.random().toString(36).substring(2, 10); // 隨機產生一個唯一 ID
    private awarenessStates: Map<string, any> = new Map(); // 存放所有在線使用者的狀態
    private awarenessListeners: ((states: Map<string, any>) => void)[] = []; // 感知系統的 UI 訂閱者

    // 🟢 感知系統的公開 API
    public setAwarenessState(state: Record<string, any>) {
        // 加上自己的 ID 和更新時間
        const fullState = { ...state, clientId: this.myClientId, timestamp: Date.now() };
        
        // 1. 更新本地狀態
        this.awarenessStates.set(this.myClientId, fullState);
        this.notifyAwarenessListeners();

        // 2. 廣播給所有人 (將 JSON 轉為 Uint8Array)
        const jsonStr = JSON.stringify(fullState);
        const payload = new TextEncoder().encode(jsonStr); // JS 內建的字串轉二進制工具
        this.network.broadcast(this.encodeMessage(MSG_AWARENESS, payload));
    }

    public subscribeAwareness(callback: (states: Map<string, any>) => void) {
        this.awarenessListeners.push(callback);
        callback(this.awarenessStates); // 訂閱時立刻回傳一次現有狀態
    }

    private notifyAwarenessListeners() {
        this.awarenessListeners.forEach(listener => listener(this.awarenessStates));
    }
    // 🟢 主動廣播下線通知
    public leaveAwareness() {
        // 建立一個只有 clientId 和 offline 標記的狀態包
        const offlineState = { clientId: this.myClientId, offline: true };
        
        // 先把自己從本地移除
        this.awarenessStates.delete(this.myClientId);
        this.notifyAwarenessListeners();

        // 廣播給所有人「我走了」
        const jsonStr = JSON.stringify(offlineState);
        const payload = new TextEncoder().encode(jsonStr);
        this.network.broadcast(this.encodeMessage(MSG_AWARENESS, payload));
    }
    constructor(config: YoinConfig) {
        this.config = config;
        this.doc = new YoinDoc();
        this.storage = new StorageAdapter(config.dbName);

        // 🔴 升級網路層的事件處理邏輯
        this.network = new NetworkProvider(
            config.url,
            // 事件 1：剛連上線時 (不變)
            () => {
                const sv = this.doc.get_state_vector();
                this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1, sv));
                console.log("🔄 [Sync] Sent initial State Vector");

                // 🟢 連線時，順便廣播一次自己的最新狀態給所有人
                const myState = this.awarenessStates.get(this.myClientId);
                if (myState) this.setAwarenessState(myState);
            },
            // 事件 2：收到網路訊息時 (大升級)
            async (rawMsg: Uint8Array) => {
                const type = rawMsg[0];
                const payload = rawMsg.slice(1);

                if (type === MSG_SYNC_STEP_1) {
                    // 【收到新朋友的連線請求】
                    const diff = this.doc.export_diff(payload);
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));
                    
                    const mySV = this.doc.get_state_vector();
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1_REPLY, mySV));

                    // 🟢 關鍵修復：主動向新朋友自我介紹 (發送自己的 Awareness 狀態)
                    const myState = this.awarenessStates.get(this.myClientId);
                    if (myState) {
                        this.setAwarenessState(myState);
                    }

                } else if (type === MSG_SYNC_STEP_1_REPLY) {
                    // 【收到舊朋友回傳的進度要求】
                    const diff = this.doc.export_diff(payload);
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));

                    // 🟢 雙重保險：新朋友收到舊朋友的回應時，也再次確保自己有廣播狀態
                    const myState = this.awarenessStates.get(this.myClientId);
                    if (myState) {
                        this.setAwarenessState(myState);
                    };

                } else if (type === MSG_SYNC_STEP_2) {
                    // 【收到實質的更新資料】
                    this.doc.apply_update(payload);
                    this.notifyListeners();
                    this.scheduleSave();
                // 🟢 攔截感知系統的封包
                } else if (type === MSG_AWARENESS) {
                    // 將二進制 Payload 轉回 JSON 字串
                    const jsonStr = new TextDecoder().decode(payload);
                    try {
                        const state = JSON.parse(jsonStr);
                        
                        // 🟢 判斷是否為「下線通知」
                        if (state.offline) {
                            this.awarenessStates.delete(state.clientId);
                        } else {
                            // 存入對方的狀態並更新 UI
                            this.awarenessStates.set(state.clientId, state);
                        }
                        
                        this.notifyAwarenessListeners();
                    } catch (e) {
                        console.error("解析 Awareness 失敗", e);
                    }
                }
            }
        );

        this.loadFromDisk();
        // 🟢 心跳機制：每 15 秒重新廣播一次自己的狀態 (告訴大家我還活著)
        setInterval(() => {
            const myState = this.awarenessStates.get(this.myClientId);
            if (myState) {
                this.setAwarenessState(myState); // 這會更新 timestamp 並發送廣播
            }
        }, 15000);

        // 🟢 垃圾回收 (Garbage Collection)：每 5 秒檢查一次有沒有幽靈
        setInterval(() => {
            const now = Date.now();
            let hasGhost = false;
            
            for (const [clientId, state] of this.awarenessStates.entries()) {
                // 如果超過 30 秒沒有收到這個人的更新，就認定他網路斷線或當機了
                if (now - state.timestamp > 30000) {
                    this.awarenessStates.delete(clientId);
                    hasGhost = true;
                }
            }
            
            // 如果有清掉幽靈，就通知 UI 更新畫面
            if (hasGhost) {
                this.notifyAwarenessListeners();
            }
        }, 5000);
    }
    /**
     * 核心方法：插入文字
     * 這是使用者唯一需要呼叫的寫入方法
     */
    public async insertText(index: number, text: string) {
        const deltaUpdate = this.doc.insert_and_get_update("content", index, text);
        
        // 🔴 修改：平常打字送出的 Update，也是屬於 TYPE 1 的資料
        const msg = this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate);
        this.network.broadcast(msg);
        
        this.notifyListeners();
        this.scheduleSave();
    }

    /**
     * 刪除指定範圍的文字
     */
    public async deleteText(index: number, length: number) {
        // 呼叫我們剛剛在 Rust 寫好的方法
        const deltaUpdate = this.doc.delete_text_and_get_update("content", index, length);
        
        // 廣播給其他人 (1 代表 MSG_SYNC_STEP_2)
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate));
        
        this.notifyListeners();
        this.scheduleSave();
    }

    /**
     * 🟢 捷徑方法：一鍵清空所有文字
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

    // 🟢 新增：防抖存檔機制
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

    // 🟢 新增私有小工具：負責幫資料戴上 1 byte 的「帽子」
    private encodeMessage(type: number, payload: Uint8Array): Uint8Array {
        const msg = new Uint8Array(payload.length + 1);
        msg[0] = type;           // 寫入 Header
        msg.set(payload, 1);     // 寫入 Payload (從 index 1 開始放)
        return msg;
    }

    // ==========================================
    // 📦 高階 API：Map (狀態與設定同步)
    // ==========================================
    public async setMap(mapName: string, key: string, value: any) {
        const valueStr = JSON.stringify(value);
        const deltaUpdate = this.doc.map_set_and_get_update(mapName, key, valueStr);
        this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, deltaUpdate)); // 1 代表 MSG_SYNC_STEP_2
        this.notifyListeners();
        this.scheduleSave();
    }

    // ==========================================
    // 📦 高階 API：Map (安全強化版)
    // ==========================================
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
            return {}; // 發生錯誤時優雅降級，不要讓程式崩潰
        }
    }

    // ==========================================
    // 📚 高階 API：Array (列表與歷史同步)
    // ==========================================
    public async pushArray(arrayName: string, item: any) {
        const valueStr = JSON.stringify(item);
        const deltaUpdate = this.doc.array_push_and_get_update(arrayName, valueStr);
        this.network.broadcast(this.encodeMessage(1, deltaUpdate)); // 1 代表 MSG_SYNC_STEP_2
        this.notifyListeners();
        this.scheduleSave();
    }

    // ==========================================
    // 📚 高階 API：Array (安全強化版)
    // ==========================================
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
}