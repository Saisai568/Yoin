import { YoinDoc } from '../../core/pkg/core'; // 引入 WASM 定義
import { StorageAdapter } from './storage';            // 引入我們剛改好的 Storage
import { NetworkProvider } from './network';           // 引入我們剛改好的 Network
import type { YoinConfig } from './types';                  // 引入設定檔介面TYPE

export class YoinClient {
    private doc: YoinDoc;
    private storage: StorageAdapter;
    private network: NetworkProvider;
    private config: YoinConfig;

    // 用來存放訂閱者 (UI 更新函數) 的陣列
    private listeners: ((text: string) => void)[] = [];

    constructor(config: YoinConfig) {
        this.config = config;
        
        // 1. 初始化 WASM 核心
        // 注意：這裡假設 init() 已經在外部呼叫過了，或者 YoinDoc 不需要非同步建立
        this.doc = new YoinDoc();

        // 2. 初始化持久化層
        this.storage = new StorageAdapter(config.dbName);

        // 3. 初始化網路層
        // 定義：當從網路收到別人傳來的 Update (二進制) 時要做什麼？
        this.network = new NetworkProvider(config.url, async (remoteUpdate) => {
            console.log(`📥 [Network] Received update: ${remoteUpdate.length} bytes`);
            
            // A. 更新 WASM 核心狀態
            this.doc.apply_update(remoteUpdate);
            
            // B. 通知 UI 更新
            this.notifyListeners();
            
            // C. 順便存檔 (保持本地資料最新)
            await this.persist();
        });

        // 4. 啟動時嘗試從本地資料庫載入舊資料
        this.loadFromDisk();
    }

    /**
     * 核心方法：插入文字
     * 這是使用者唯一需要呼叫的寫入方法
     */
    public async insertText(index: number, text: string) {
        // 1. 呼叫 Rust: 插入並取得「增量更新 (Delta)」
        // 這是我們為了效能優化特別寫的 Rust 方法
        const deltaUpdate = this.doc.insert_and_get_update("content", index, text);

        console.log(`📤 [Client] Generated delta: ${deltaUpdate.length} bytes`);

        // 2. 廣播這個小小的 Delta 給其他人
        this.network.broadcast(deltaUpdate);

        // 3. 更新 UI (讓自己看到)
        this.notifyListeners();

        // 4. 存檔 (存全量 Snapshot)
        await this.persist();
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
        // 1. 先從 WASM 取出資料 (這步在 Client 做)
        const snapshot = this.doc.export_update();
        
        // 2. 再把資料傳給 Storage (這步只負責存)
        await this.storage.save(this.config.docId, snapshot);
    }
    /**
     * 私有方法：通知所有訂閱者
     */
    private notifyListeners() {
        const text = this.getText();
        this.listeners.forEach(listener => listener(text));
    }
}