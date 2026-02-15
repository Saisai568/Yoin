// packages/client/tests/network.test.ts
// ============================================================
// Test: NetworkProvider class
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
let lastCreatedWs: MockWebSocket;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  onopen: any = null;
  onmessage: any = null;
  onclose: any = null;
  onerror: any = null;
  sent: any[] = [];
  constructor(url: string) {
    this.url = url;
    lastCreatedWs = this;
  }
  send(data: any) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; }
}
vi.stubGlobal('WebSocket', MockWebSocket);

import { NetworkProvider } from '../src/network';

describe('NetworkProvider', () => {
  let onConnect: ReturnType<typeof vi.fn>;
  let onMessage: ReturnType<typeof vi.fn>;
  let onStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onConnect = vi.fn();
    onMessage = vi.fn();
    onStatus = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should connect to the given URL', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    expect(lastCreatedWs.url).toBe('wss://test.com');
  });

  it('should report connecting status initially', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    expect(onStatus).toHaveBeenCalledWith('connecting');
  });

  it('should report online status on open', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    lastCreatedWs.readyState = MockWebSocket.OPEN;
    lastCreatedWs.onopen?.({});
    expect(onStatus).toHaveBeenCalledWith('online');
    expect(onConnect).toHaveBeenCalled();
  });

  it('should report offline status on close', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    lastCreatedWs.onclose?.({});
    expect(onStatus).toHaveBeenCalledWith('offline');
  });

  it('should report offline status on error', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    lastCreatedWs.onerror?.({});
    expect(onStatus).toHaveBeenCalledWith('offline');
  });

  it('should handle binary messages', () => {
    new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    const buffer = new ArrayBuffer(4);
    lastCreatedWs.onmessage?.({ data: buffer });
    expect(onMessage).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it('should queue messages when offline', () => {
    const provider = new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    // Socket is still CONNECTING
    provider.broadcast(new Uint8Array([1, 2, 3]));
    expect(lastCreatedWs.sent.length).toBe(0);
  });

  it('should send messages when online', () => {
    const provider = new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    lastCreatedWs.readyState = MockWebSocket.OPEN;
    lastCreatedWs.onopen?.({});
    provider.broadcast(new Uint8Array([1, 2, 3]));
    expect(lastCreatedWs.sent.length).toBeGreaterThan(0);
  });

  it('should flush queue on reconnect', () => {
    const provider = new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    // Queue while offline
    provider.broadcast(new Uint8Array([1]));
    provider.broadcast(new Uint8Array([2]));
    // Connect
    lastCreatedWs.readyState = MockWebSocket.OPEN;
    lastCreatedWs.onopen?.({});
    // Queued messages should be flushed
    expect(lastCreatedWs.sent.length).toBe(2);
  });

  it('isConnected should be false initially', () => {
    const provider = new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    expect(provider.isConnected).toBe(false);
  });

  it('isConnected should be true when open', () => {
    const provider = new NetworkProvider('wss://test.com', onConnect, onMessage, onStatus);
    lastCreatedWs.readyState = MockWebSocket.OPEN;
    expect(provider.isConnected).toBe(true);
  });
});
