// client/src/network.ts

/**
 * 定義回呼函數的型別：
 * 接收一個 Uint8Array (二進制資料)，回傳 void (或是 Promise<void>)
 */
type MessageCallback = (data: Uint8Array) => void | Promise<void>;
type ConnectCallback = () => void; // 🟢 新增連線成功的回呼型別

export class NetworkProvider {
    private url: string;
    private socket: WebSocket | null = null;
    private onMessageReceived: MessageCallback;
    private onConnect: ConnectCallback; // 🟢 新增連線成功的回呼函數
    // 🟢 新增：離線佇列，用來存放斷線時產生的 updates
    private messageQueue: Uint8Array[] = [];

    // 🔴 這裡的參數多了一個 onConnect
    constructor(url: string, onConnect: ConnectCallback, onMessageReceived: MessageCallback) {
        this.url = url;
        this.onConnect = onConnect;
        this.onMessageReceived = onMessageReceived;
        this.connect();
    }

    private connect(): void {
        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer'; 

        this.socket.onopen = () => {
            console.log("🟢 [Network] Connected to Sync Server");
            
            // 🟢 1. 觸發初始同步 (告訴 YoinClient 可以發送 State Vector 了)
            this.onConnect();

            // 🟢 新增：連線成功時，把積壓在佇列裡的更新全部發送出去
            if (this.messageQueue.length > 0) {
                console.log(`🚀 [Network] Flushing ${this.messageQueue.length} queued updates...`);
                this.messageQueue.forEach(update => {
                    this.socket?.send(update);
                });
                // 清空佇列
                this.messageQueue = [];
            }
        };

        this.socket.onmessage = (event: MessageEvent) => {
            if (event.data instanceof ArrayBuffer) {
                this.onMessageReceived(new Uint8Array(event.data));
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
            // 網路暢通，直接發送
            this.socket.send(update);
        } else {
            // 🔴 修改：網路斷開時，存入佇列而不是丟棄
            console.warn(`⚠️ [Network] Offline. Queuing update (${update.length} bytes)`);
            this.messageQueue.push(update);
        }
    }
}