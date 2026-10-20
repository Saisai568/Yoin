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
  YoinInitError: class YoinInitError extends Error {
    name = 'YoinInitError';
  },
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
  send(data: any) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
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

  afterEach(async () => {
    await client.destroy();
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

  it('reading a property should return exact value and type from getMap', async () => {
    await client.setMap('settings', 'theme', 'dark');
    await client.setMap('settings', 'fontSize', 16);
    const proxy = createMapProxy<{ theme: string; fontSize: number; missing?: string }>(
      client,
      'settings',
    );
    expect(proxy.theme).toBe('dark');
    expect(proxy.fontSize).toBe(16);
    expect(typeof proxy.fontSize).toBe('number');
    expect(proxy.missing).toBeUndefined();
    expect(proxy.missing ?? '#ffffff').toBe('#ffffff');
  });

  it('should support delete operator, in operator, and Object.keys()', async () => {
    const proxy = createMapProxy<Record<string, any>>(client, 'whiteboard');
    proxy.shape1 = { x: 10, y: 20 };
    proxy.shape2 = { x: 30, y: 40 };

    expect('shape1' in proxy).toBe(true);
    expect(Object.keys(proxy)).toEqual(['shape1', 'shape2']);

    delete proxy.shape1;
    expect('shape1' in proxy).toBe(false);
    expect(Object.keys(proxy)).toEqual(['shape2']);
  });

  it('should support deep nested proxy reads and writes via setMapDeep', async () => {
    await client.setMap('settings', 'ui', { sidebar: { width: 240 } });
    const proxy = createMapProxy<any>(client, 'settings');
    expect(proxy.ui.sidebar.width).toBe(240);

    proxy.ui.sidebar.width = 360;
    expect(proxy.ui.sidebar.width).toBe(360);
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

  afterEach(async () => {
    await client.destroy();
    vi.useRealTimers();
  });

  it('should create an array proxy', () => {
    const proxy = createArrayProxy(client, 'logs');
    expect(proxy).toBeDefined();
    expect(Array.isArray(proxy)).toBe(true);
  });

  it('push should call pushArray on client and immediately reflect in live length and elements', async () => {
    const spy = vi.spyOn(client, 'pushArray');
    const proxy = createArrayProxy<{ action: string }>(client, 'logs');
    expect(proxy.length).toBe(0);

    proxy.push({ action: 'JOIN' });
    expect(spy).toHaveBeenCalledWith('logs', { action: 'JOIN' });
    expect(proxy.length).toBe(1);
    expect(proxy[0]).toEqual({ action: 'JOIN' });
  });

  it('push should accept multiple items', async () => {
    const spy = vi.spyOn(client, 'pushArray');
    const proxy = createArrayProxy<string>(client, 'logs');
    proxy.push('a', 'b', 'c');
    expect(spy).toHaveBeenCalledTimes(3);
    expect([...proxy]).toEqual(['a', 'b', 'c']);
  });

  it('should support splice, pop, shift, and unshift', () => {
    const proxy = createArrayProxy<string>(client, 'cards');
    proxy.push('card-1', 'card-2', 'card-3');

    const removed = proxy.splice(1, 1, 'card-2-updated');
    expect(removed).toEqual(['card-2']);
    expect([...proxy]).toEqual(['card-1', 'card-2-updated', 'card-3']);

    expect(proxy.pop()).toBe('card-3');
    expect(proxy.shift()).toBe('card-1');
    proxy.unshift('card-0');
    expect([...proxy]).toEqual(['card-0', 'card-2-updated']);
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
