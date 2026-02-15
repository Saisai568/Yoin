// client/src/network.ts
import type { NetworkStatus } from './types';

// Receives a Uint8Array (binary data) and returns void (or Promise<void>)
type MessageCallback = (data: Uint8Array) => void | Promise<void>;
type ConnectCallback = () => void; 
type StatusCallback = (status: NetworkStatus) => void;

export class NetworkProvider {
    private url: string;
    private socket: WebSocket | null = null;
    private onMessageReceived: MessageCallback;
    private onConnect: ConnectCallback;         
    private onStatusChange: StatusCallback;
    private messageQueue: Uint8Array[] = [];
    
    constructor(
        url: string, 
        onConnect: ConnectCallback, 
        onMessageReceived: MessageCallback,
        onStatusChange: StatusCallback
    ) {
        this.url = url;
        this.onConnect = onConnect;
        this.onMessageReceived = onMessageReceived;
        this.onStatusChange = onStatusChange;
        this.connect();
    }

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
            
            setTimeout(() => this.connect(), 3000);
        };

        this.socket.onerror = () => {
            this.onStatusChange('offline'); 
        };
    }

    /**
     * Send binary update to Server
     */
    public broadcast(update: Uint8Array): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Smooth internet, send directly
            this.socket.send(update);
        } else {
            // When the network is disconnected, store it in the queue instead of discarding it
            console.warn(`⚠️ [Network] Offline. Queuing update (${update.length} bytes)`);
            this.messageQueue.push(update);
        }
    }
}