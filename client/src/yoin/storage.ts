// client/src/storage.ts

export class StorageAdapter {
    private dbName: string;
    private storeName: string = "documents";

    constructor(dbName: string) {
        this.dbName = dbName;
    }

    /**
     * 私有 helper: 開啟 IndexedDB
     * 回傳 Promise<IDBDatabase>
     */
    private openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                // TypeScript 需要轉型才能存取 result
                const db = (event.target as IDBOpenDBRequest).result;
                
                // 建立 ObjectStore (類似 Table)
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    /**
     * 儲存文件快照 (Snapshot)
     * @param docId 文件 ID
     * @param data 二進制資料 (Uint8Array) - 注意：這裡不再傳 SyncDoc，而是傳資料
     */
    public async save(docId: string, data: Uint8Array): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        
        store.put(data, docId);
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * 讀取文件快照
     * @param docId 文件 ID
     * @returns Promise<Uint8Array | null> 如果找不到回傳 null
     */
    public async load(docId: string): Promise<Uint8Array | null> {
        const db = await this.openDB();
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        
        const request = store.get(docId);

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // 確保回傳的是 Uint8Array (IndexedDB 有時會存成 ArrayBuffer)
                    if (result instanceof Uint8Array) {
                        resolve(result);
                    } else {
                        resolve(new Uint8Array(result));
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}