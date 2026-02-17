// packages/client/src/network.ts
import type { NetworkStatus } from './types';

type MessageCallback = (data: Uint8Array) => void | Promise<void>;
type ConnectCallback = () => void;
type StatusCallback = (status: NetworkStatus) => void;

// ============================================================
// Reconnection configuration defaults
// ============================================================
const DEFAULT_MAX_RECONNECTS = 10;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

export interface NetworkProviderOptions {
  /** Maximum reconnection attempts before giving up (default: 10) */
  maxReconnects?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
}

export class NetworkProvider {
  private url: string;
  private socket: WebSocket | null = null;
  private onMessageReceived: MessageCallback;
  private onConnect: ConnectCallback;
  private onStatusChange: StatusCallback;
  private messageQueue: Uint8Array[] = [];

  // Reconnection state
  private reconnectAttempts = 0;
  private readonly maxReconnects: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    url: string,
    onConnect: ConnectCallback,
    onMessageReceived: MessageCallback,
    onStatusChange: StatusCallback,
    options?: NetworkProviderOptions,
  ) {
    this.url = url;
    this.onConnect = onConnect;
    this.onMessageReceived = onMessageReceived;
    this.onStatusChange = onStatusChange;
    this.maxReconnects = options?.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.connect();
  }

  public get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.destroyed) return;

    this.onStatusChange('connecting');
    this.socket = new WebSocket(this.url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      console.log('[Network] Connected to Sync Server');
      this.reconnectAttempts = 0; // Reset on successful connection
      this.onStatusChange('online');

      this.onConnect();
      if (this.messageQueue.length > 0) {
        this.messageQueue.forEach((update) => this.socket?.send(update));
        this.messageQueue = [];
      }
    };

    this.socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.onMessageReceived(new Uint8Array(event.data));
      }
    };

    this.socket.onclose = () => {
      if (this.destroyed) return;

      console.warn('[Network] Disconnected');
      this.onStatusChange('offline');
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      if (this.destroyed) return;
      this.onStatusChange('offline');
    };
  }

  /**
   * Schedule a reconnection with exponential backoff.
   * Gives up after maxReconnects attempts and transitions to 'failed' status.
   */
  private scheduleReconnect(): void {
    if (this.destroyed) return;

    if (this.reconnectAttempts >= this.maxReconnects) {
      console.error(
        `[Network] Max reconnect attempts (${this.maxReconnects}) reached. Giving up.`,
      );
      this.onStatusChange('failed');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter, capped at maxDelayMs
    const exponentialDelay = this.baseDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * this.baseDelayMs * 0.5;
    const delay = Math.min(exponentialDelay + jitter, this.maxDelayMs);

    console.warn(
      `[Network] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnects})`,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Manually trigger a reconnection, resetting the attempt counter.
   * Useful after the status transitions to 'failed'.
   */
  public reconnect(): void {
    this.reconnectAttempts = 0;
    this.destroyed = false;
    this.connect();
  }

  public broadcast(update: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(update);
    } else {
      console.warn(
        `[Network] Offline. Queuing update (${update.length} bytes)`,
      );
      this.messageQueue.push(update);
    }
  }

  /**
   * Permanently close the connection and stop all reconnection attempts.
   */
  public disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onclose = null; // Prevent triggering reconnect
      this.socket.close();
      this.socket = null;
    }
  }
}
