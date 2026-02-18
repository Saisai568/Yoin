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

  it('onInstall should call doc.enable_undo()', () => {
    const { plugin } = createUndoPlugin();
    const doc = client.getDoc();
    const enableUndoSpy = vi.spyOn(doc, 'enable_undo');
    client.use(plugin);
    expect(enableUndoSpy).toHaveBeenCalledTimes(1);
  });

  it('setMap should auto-call expand_undo_scope on first write to a map', async () => {
    const { plugin } = createUndoPlugin();
    client.use(plugin);
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');

    await client.setMap('myMap', 'key', 'value');
    expect(expandSpy).toHaveBeenCalledWith('myMap');
    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it('setMap should only call expand_undo_scope once per map (idempotent)', async () => {
    const { plugin } = createUndoPlugin();
    client.use(plugin);
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');

    await client.setMap('myMap', 'key1', 'a');
    await client.setMap('myMap', 'key2', 'b');
    await client.setMap('myMap', 'key3', 'c');
    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it('setMap on different maps should each call expand_undo_scope once', async () => {
    const { plugin } = createUndoPlugin();
    client.use(plugin);
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');

    await client.setMap('mapA', 'key', 'val');
    await client.setMap('mapB', 'key', 'val');
    expect(expandSpy).toHaveBeenCalledWith('mapA');
    expect(expandSpy).toHaveBeenCalledWith('mapB');
    expect(expandSpy).toHaveBeenCalledTimes(2);
  });

  it('setMapDeep should auto-call expand_undo_scope on first write', () => {
    const { plugin } = createUndoPlugin();
    client.use(plugin);
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');

    client.setMapDeep('deepMap', ['a', 'b'], 'val');
    expect(expandSpy).toHaveBeenCalledWith('deepMap');
    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it('setMapDeep should only call expand_undo_scope once per map (idempotent)', () => {
    const { plugin } = createUndoPlugin();
    client.use(plugin);
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');

    client.setMapDeep('deepMap', ['x'], 1);
    client.setMapDeep('deepMap', ['y'], 2);
    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it('setMap followed by undo() should successfully revert the value', async () => {
    const undoPlugin = createUndoPlugin();
    client.use(undoPlugin.plugin);

    await client.setMap('counter', 'n', 42);
    const before = client.getMap('counter');
    expect(before['n']).toBe(42);

    undoPlugin.undo();

    const after = client.getMap('counter');
    expect(after['n']).toBeUndefined();
  });

  it('onDestroy should restore original setMap and setMapDeep', async () => {
    const { plugin } = createUndoPlugin();
    const origSetMap = client.setMap.bind(client);
    client.use(plugin);

    // setMap is now wrapped
    expect(client.setMap).not.toBe(origSetMap);

    plugin.onDestroy!();

    // After destroy the wrapper is removed; original behaviour restored
    const doc = client.getDoc();
    const expandSpy = vi.spyOn(doc, 'expand_undo_scope');
    await client.setMap('postDestroy', 'k', 'v');
    expect(expandSpy).not.toHaveBeenCalled();
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
