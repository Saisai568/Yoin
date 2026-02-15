// client/src/storage.ts

export class StorageAdapter {
    private dbName: string;
    private storeName: string = "documents";

    constructor(dbName: string) {
        this.dbName = dbName;
    }

    /**
     * Private helper: Opens IndexedDB
     * Returns Promise<IDBDatabase>
     */
    private openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    /**
     * Save document snapshot (Snapshot)
     * @param docId Document ID
     * @param data Binary data (Uint8Array)
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
     * Read file snapshot
     * @param docId File ID
     * @returns Promise<Uint8Array | null> Returns null if not found
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