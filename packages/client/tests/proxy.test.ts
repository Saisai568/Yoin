// packages/client/tests/proxy.test.ts
// ============================================================
// Test: createMapProxy and createArrayProxy
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@yoin/core', () => import('./__mocks__/core'));

// Mock WASM loader so isYoinInitialized() returns true in tests
vi.mock('../src/wasm/loader', () => ({
  isYoinInitialized: () => true,
  initYoin: async () => {},
  YoinInitError: class YoinInitError extends Error { name = 'YoinInitError'; },
}));

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
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 10);
  }
  send(data: any) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; }
}
vi.stubGlobal('WebSocket', MockWebSocket);

import { YoinClient } from '../src/YoinClient';
import { createMapProxy, createArrayProxy } from '../src/proxy';

describe('createMapProxy', () => {
  let client: YoinClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new YoinClient({ url: 'wss://test.example.com', docId: 'test' });
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  it('should create a proxy object', () => {
    const proxy = createMapProxy(client, 'settings');
    expect(proxy).toBeDefined();
  });

  it('setting a property should call setMap', async () => {
    const spy = vi.spyOn(client, 'setMap');
    const proxy = createMapProxy<{ theme: string }>(client, 'settings');
    proxy.theme = 'dark';
    expect(spy).toHaveBeenCalledWith('settings', 'theme', 'dark');
  });

  it('reading a property should return value from getMap', async () => {
    await client.setMap('settings', 'theme', 'dark');
    const proxy = createMapProxy<{ theme: string }>(client, 'settings');
    // The proxy's get triggers a deep proxy read
    const value = proxy.theme;
    // Value comes through DeepProxy which reads from map_get_all
    expect(value).toBeDefined();
  });

  it('toJSON should return metadata', () => {
    const proxy = createMapProxy(client, 'settings');
    expect((proxy as any).toJSON()).toEqual({
      __type: 'MapProxy',
      mapName: 'settings',
    });
  });
});

describe('createArrayProxy', () => {
  let client: YoinClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new YoinClient({ url: 'wss://test.example.com', docId: 'test' });
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  it('should create an array proxy', () => {
    const proxy = createArrayProxy(client, 'logs');
    expect(proxy).toBeDefined();
    expect(Array.isArray(proxy)).toBe(true);
  });

  it('push should call pushArray on client', async () => {
    const spy = vi.spyOn(client, 'pushArray');
    const proxy = createArrayProxy<string>(client, 'logs');
    proxy.push('item1');
    expect(spy).toHaveBeenCalledWith('logs', 'item1');
  });

  it('push should accept multiple items', async () => {
    const spy = vi.spyOn(client, 'pushArray');
    const proxy = createArrayProxy<string>(client, 'logs');
    proxy.push('a', 'b', 'c');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should warn on index assignment', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const proxy = createArrayProxy<string>(client, 'logs');
    proxy[0] = 'value';
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Index assignment'),
    );
    spy.mockRestore();
  });

  it('length should reflect snapshot', () => {
    const proxy = createArrayProxy(client, 'empty-array');
    expect(proxy.length).toBe(0);
  });
});
