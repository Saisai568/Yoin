// packages/client/tests/plugins.test.ts
// ============================================================
// Test: Built-in plugin factories
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
import { createUndoPlugin, YoinUndoPlugin } from '../src/plugins/undo';
import { createLoggerPlugin } from '../src/logger';

describe('createUndoPlugin', () => {
  let client: YoinClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new YoinClient({ url: 'wss://test.example.com', docId: 'test' });
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  it('should return plugin instance and undo/redo functions', () => {
    const result = createUndoPlugin();
    expect(result.plugin).toBeInstanceOf(YoinUndoPlugin);
    expect(typeof result.undo).toBe('function');
    expect(typeof result.redo).toBe('function');
  });

  it('should install correctly via client.use()', () => {
    const { plugin } = createUndoPlugin();
    expect(() => client.use(plugin)).not.toThrow();
  });

  it('plugin name should be yoin-undo', () => {
    const { plugin } = createUndoPlugin();
    expect(plugin.name).toBe('yoin-undo');
  });

  it('undo should not throw on empty state', () => {
    const undoPlugin = createUndoPlugin();
    client.use(undoPlugin.plugin);
    expect(() => undoPlugin.undo()).not.toThrow();
  });

  it('redo should not throw on empty state', () => {
    const undoPlugin = createUndoPlugin();
    client.use(undoPlugin.plugin);
    expect(() => undoPlugin.redo()).not.toThrow();
  });
});

describe('createLoggerPlugin', () => {
  it('should create a plugin with name "logger"', () => {
    const plugin = createLoggerPlugin();
    expect(plugin.name).toBe('logger');
  });

  it('should accept custom prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = createLoggerPlugin('[CustomPrefix]');
    const client = new YoinClient({ url: 'wss://test.example.com', docId: 'test' });
    plugin.onInstall(client);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[CustomPrefix]'));
    spy.mockRestore();
    client.destroy();
  });

  it('should log on onBeforeUpdate', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = createLoggerPlugin();
    plugin.onBeforeUpdate!(new Uint8Array([1, 2, 3]));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('3 bytes'));
    spy.mockRestore();
  });

  it('should log on onAfterUpdate', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = createLoggerPlugin();
    plugin.onAfterUpdate!(new Uint8Array([1, 2, 3, 4, 5]));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('5 bytes'));
    spy.mockRestore();
  });
});
