import { YoinDoc } from '../../core/pkg/core';         // 引入 WASM 定義
import { StorageAdapter } from './storage';            // 引入我們剛改好的 Storage
import { NetworkProvider } from './network';           // 引入我們剛改好的 Network
import type { YoinConfig } from './types';             // 引入設定檔介面TYPE

// 🟢 定義通訊協議的 Message Type 常數
const MSG_SYNC_STEP_1 = 0; // 傳送 State Vector
const MSG_SYNC_STEP_2 = 1; // 傳送 Diff 或 Update
const MSG_SYNC_STEP_1_REPLY = 2; // 🟢 新增：「收到，順便附上我的進度，你也把你多出來的資料給我」

export class YoinClient {
    private doc: YoinDoc;
    private storage: StorageAdapter;
    private network: NetworkProvider;
    private config: YoinConfig;

    // 用來存放訂閱者 (UI 更新函數) 的陣列
    private listeners: ((text: string) => void)[] = [];

    // 🟢 新增：用來記錄計時器的 ID
    private saveTimeout: number | undefined;

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
            },
            // 事件 2：收到網路訊息時 (大升級)
            async (rawMsg: Uint8Array) => {
                const type = rawMsg[0];
                const payload = rawMsg.slice(1);

                if (type === MSG_SYNC_STEP_1) {
                    // 【收到新朋友的連線請求】
                    // 1. 給他缺少的資料
                    const diff = this.doc.export_diff(payload);
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));
                    
                    // 2. 🟢 關鍵修復：告訴他「我目前的進度」，請他把我也缺少的資料傳過來
                    const mySV = this.doc.get_state_vector();
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_1_REPLY, mySV));

                } else if (type === MSG_SYNC_STEP_1_REPLY) {
                    // 【🟢 收到舊朋友回傳的進度要求】
                    // 計算並發送他缺少的資料
                    const diff = this.doc.export_diff(payload);
                    this.network.broadcast(this.encodeMessage(MSG_SYNC_STEP_2, diff));

                } else if (type === MSG_SYNC_STEP_2) {
                    // 【收到實質的更新資料】
                    this.doc.apply_update(payload);
                    this.notifyListeners();
                    this.scheduleSave();
                }
            }
        );

        this.loadFromDisk();
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

}