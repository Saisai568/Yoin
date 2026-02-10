// client/src/network.ts

/**
 * 定義回呼函數的型別：
 * 接收一個 Uint8Array (二進制資料)，回傳 void (或是 Promise<void>)
 */
type MessageCallback = (data: Uint8Array) => void | Promise<void>;

export class NetworkProvider {
    private url: string;
    private socket: WebSocket | null = null;
    private onMessageReceived: MessageCallback;

    constructor(url: string, onMessageReceived: MessageCallback) {
        this.url = url;
        this.onMessageReceived = onMessageReceived;
        this.connect();
    }

    private connect(): void {
        this.socket = new WebSocket(this.url);
        
        // 關鍵：明確告訴 TS 和瀏覽器，我們傳輸的是二進制陣列緩衝區
        this.socket.binaryType = 'arraybuffer'; 

        this.socket.onopen = () => {
            console.log("🟢 [Network] Connected to Sync Server");
            // TODO: 未來這裡可以加入傳送 "Awareness" 或 "Auth Token" 的邏輯
        };

        this.socket.onmessage = (event: MessageEvent) => {
            // event.data 在 binaryType = 'arraybuffer' 時會是 ArrayBuffer
            // 我們需要將其轉為 Uint8Array 才能讓 WASM 讀取
            if (event.data instanceof ArrayBuffer) {
                const update = new Uint8Array(event.data);
                // console.log(`📥 [Network] Received update: ${update.length} bytes`);
                
                // 呼叫外部傳入的回呼函數 (交給 YoinClient 處理)
                this.onMessageReceived(update);
            } else {
                console.warn("Received non-binary data, ignoring.");
            }
        };

        this.socket.onclose = () => {
            console.log("🔴 [Network] Disconnected. Retrying in 3s...");
            this.socket = null; // 清空參照
            setTimeout(() => this.connect(), 3000);
        };

        this.socket.onerror = (error) => {
            console.error("❌ [Network] WebSocket Error:", error);
        };
    }

    /**
     * 發送二進制更新給 Server
     */
    public broadcast(update: Uint8Array): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // console.log(`📤 [Network] Broadcasting: ${update.length} bytes`);
            this.socket.send(update);
        } else {
            console.warn("⚠️ [Network] Socket not open, update dropped (Need Queue mechanism in future)");
        }
    }
}