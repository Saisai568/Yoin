// client/src/network.ts
import type { NetworkStatus } from './types';

// 接收一個 Uint8Array (二進制資料)，回傳 void (或是 Promise<void>)
type MessageCallback = (data: Uint8Array) => void | Promise<void>;
type ConnectCallback = () => void; //  新增連線成功的回呼型別
type StatusCallback = (status: NetworkStatus) => void;

export class NetworkProvider {
    private url: string;
    private socket: WebSocket | null = null;
    private onMessageReceived: MessageCallback;
    private onConnect: ConnectCallback;             //  新增連線成功的回呼函數
    private onStatusChange: StatusCallback;         //  新增網路狀態變更的回呼函數
    private messageQueue: Uint8Array[] = [];
    
    constructor(
        url: string, 
        onConnect: ConnectCallback, 
        onMessageReceived: MessageCallback,
        onStatusChange: StatusCallback          // 接收狀態回呼
    ) {
        this.url = url;
        this.onConnect = onConnect;
        this.onMessageReceived = onMessageReceived;
        this.onStatusChange = onStatusChange;
        this.connect();
    }

    // [新增] Getter 讓外部知道連線狀態
    public get isConnected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    private connect(): void {
        this.onStatusChange('connecting');
        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer'; 

        this.socket.onopen = () => {
            console.log("[Network] Connected to Sync Server");
            this.onStatusChange('online'); 
            
            this.onConnect();
            if (this.messageQueue.length > 0) {
                this.messageQueue.forEach(update => this.socket?.send(update));
                this.messageQueue = [];
            }
        };

        this.socket.onmessage = (event: MessageEvent) => {
            if (event.data instanceof ArrayBuffer) {
                this.onMessageReceived(new Uint8Array(event.data));
            }
        };

        this.socket.onclose = () => {
            console.warn("[Network] Disconnected");
            this.onStatusChange('offline'); 
            
            // 簡單的斷線重連機制 (3秒後重試)
            setTimeout(() => this.connect(), 3000);
        };

        this.socket.onerror = () => {
            this.onStatusChange('offline'); 
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