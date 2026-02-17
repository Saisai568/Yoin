// packages/client/tests/yoin-client.test.ts
// ============================================================
// Test: YoinClient core functionality with WASM mock
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @yoin/core before importing YoinClient
vi.mock('@yoin/core', () => import('./__mocks__/core'));

// Mock WASM loader so isYoinInitialized() returns true in tests
vi.mock('../src/wasm/loader', () => ({
  isYoinInitialized: () => true,
  initYoin: async () => {},
  YoinInitError: class YoinInitError extends Error { name = 'YoinInitError'; },
}));

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  sent: any[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
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

// Install mock
vi.stubGlobal('WebSocket', MockWebSocket);

import { YoinClient } from '../src/YoinClient';
import type { YoinConfig } from '../src/types';

function createConfig(overrides?: Partial<YoinConfig>): YoinConfig {
  return {
    url: 'wss://test.example.com',
    docId: 'test-room',
    ...overrides,
  };
}

describe('YoinClient', () => {
  let client: YoinClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new YoinClient(createConfig());
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create a client with valid config', () => {
      expect(client).toBeDefined();
      expect(client.getClientId()).toBeTruthy();
      expect(client.getClientId().length).toBeGreaterThan(0);
    });

    it('should generate unique client IDs', () => {
      const client2 = new YoinClient(createConfig());
      expect(client.getClientId()).not.toBe(client2.getClientId());
      client2.destroy();
    });

    it('should expose config via getConfig', () => {
      const config = client.getConfig();
      expect(config.url).toBe('wss://test.example.com');
      expect(config.docId).toBe('test-room');
    });
  });

  describe('Text API', () => {
    it('should insert text', async () => {
      await client.insertText(0, 'Hello');
      expect(client.getText()).toBe('Hello');
    });

    it('should insert text at position', async () => {
      await client.insertText(0, 'Hello');
      await client.insertText(5, ' World');
      expect(client.getText()).toBe('Hello World');
    });

    it('should delete text', async () => {
      await client.insertText(0, 'Hello World');
      await client.deleteText(5, 6);
      expect(client.getText()).toBe('Hello');
    });

    it('should clear all text', async () => {
      await client.insertText(0, 'Hello World');
      await client.clearText();
      expect(client.getText()).toBe('');
    });

    it('clearText on empty doc should be safe', async () => {
      await client.clearText();
      expect(client.getText()).toBe('');
    });
  });

  describe('Map API', () => {
    it('should set and get map values', async () => {
      await client.setMap('settings', 'theme', 'dark');
      const map = client.getMap('settings');
      expect(map.theme).toBe('dark');
    });

    it('should handle JSON-serialized values', async () => {
      await client.setMap('data', 'count', 42);
      const map = client.getMap('data');
      expect(map.count).toBe(42);
    });

    it('should handle object values', async () => {
      await client.setMap('data', 'user', { name: 'Alice', age: 30 });
      const map = client.getMap('data');
      expect(map.user).toEqual({ name: 'Alice', age: 30 });
    });

    it('should return empty object for missing map', () => {
      const map = client.getMap('non-existent');
      expect(map).toEqual({});
    });

    it('should support batch set', () => {
      client.batchSet([
        ['config', 'a', 'valueA'],
        ['config', 'b', 'valueB'],
      ]);
      // batch_set uses mock which sets values
      const map = client.getMap('config');
      expect(map.a).toBe('valueA');
      expect(map.b).toBe('valueB');
    });
  });

  describe('Array API', () => {
    it('should push and get array items', async () => {
      await client.pushArray('logs', 'item1');
      const arr = client.getArray('logs');
      expect(arr).toContain('item1');
    });

    it('should handle JSON-serialized array items', async () => {
      await client.pushArray('logs', { action: 'CLICK', time: '12:00' });
      const arr = client.getArray('logs');
      expect(arr[0]).toEqual({ action: 'CLICK', time: '12:00' });
    });

    it('should return empty array for missing array', () => {
      const arr = client.getArray('nonexistent');
      expect(arr).toEqual([]);
    });
  });

  describe('Subscribe / Listeners', () => {
    it('should notify subscribers on text change', async () => {
      const listener = vi.fn();
      client.subscribe(listener);
      await client.insertText(0, 'test');
      expect(listener).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', async () => {
      const listener = vi.fn();
      const unsub = client.subscribe(listener);
      unsub();
      await client.insertText(0, 'test');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      client.subscribe(listener1);
      client.subscribe(listener2);
      await client.insertText(0, 'test');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('Plugin System', () => {
    it('should install plugins via .use()', () => {
      const plugin = {
        name: 'test-plugin',
        onInstall: vi.fn(),
      };
      client.use(plugin);
      expect(plugin.onInstall).toHaveBeenCalledWith(client);
    });

    it('should chain .use() calls', () => {
      const p1 = { name: 'p1', onInstall: vi.fn() };
      const p2 = { name: 'p2', onInstall: vi.fn() };
      const result = client.use(p1).use(p2);
      expect(result).toBe(client);
      expect(p1.onInstall).toHaveBeenCalled();
      expect(p2.onInstall).toHaveBeenCalled();
    });

    it('should call onBeforeUpdate and onAfterUpdate hooks', async () => {
      const plugin = {
        name: 'hooks-test',
        onInstall: vi.fn(),
        onBeforeUpdate: vi.fn(),
        onAfterUpdate: vi.fn(),
      };
      client.use(plugin);
      await client.insertText(0, 'test');
      expect(plugin.onBeforeUpdate).toHaveBeenCalled();
      expect(plugin.onAfterUpdate).toHaveBeenCalled();
    });

    it('should call onDestroy on client.destroy()', () => {
      const plugin = {
        name: 'destroy-test',
        onInstall: vi.fn(),
        onDestroy: vi.fn(),
      };
      client.use(plugin);
      client.destroy();
      expect(plugin.onDestroy).toHaveBeenCalled();
    });
  });

  describe('Doc Update Hooks', () => {
    it('should fire onDocUpdate for local changes', async () => {
      const callback = vi.fn();
      client.onDocUpdate(callback);
      await client.insertText(0, 'test');
      expect(callback).toHaveBeenCalled();
    });

    it('should unsubscribe from onDocUpdate', async () => {
      const callback = vi.fn();
      const unsub = client.onDocUpdate(callback);
      unsub();
      await client.insertText(0, 'test');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should fire onLocalUpdate for local changes', async () => {
      const callback = vi.fn();
      client.onLocalUpdate(callback);
      await client.insertText(0, 'test');
      expect(callback).toHaveBeenCalled();
    });

    it('should unsubscribe from onLocalUpdate', async () => {
      const callback = vi.fn();
      const unsub = client.onLocalUpdate(callback);
      unsub();
      await client.insertText(0, 'test');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Awareness System', () => {
    it('should set awareness state', () => {
      client.setAwareness({ name: 'Alice', color: '#ff0000' });
      const states = client.getAwarenessStates();
      const myState = states.get(client.getClientId());
      expect(myState).toBeDefined();
      expect(myState!.name).toBe('Alice');
      expect(myState!.color).toBe('#ff0000');
    });

    it('should merge partial awareness updates', () => {
      client.setAwareness({ name: 'Alice', color: '#ff0000' });
      client.setAwareness({ cursorX: 100, cursorY: 200 });
      const myState = client.getAwarenessStates().get(client.getClientId());
      expect(myState!.name).toBe('Alice');
      expect(myState!.cursorX).toBe(100);
      expect(myState!.cursorY).toBe(200);
    });

    it('should notify awareness listeners', () => {
      const cb = vi.fn();
      client.onAwarenessChange(cb);
      // onAwarenessChange calls callback immediately with current state
      expect(cb).toHaveBeenCalledTimes(1);
      client.setAwareness({ name: 'Bob' });
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from awareness changes', () => {
      const cb = vi.fn();
      const unsub = client.onAwarenessChange(cb);
      unsub();
      client.setAwareness({ name: 'Charlie' });
      // Called once during subscribe, then not after unsub
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should remove awareness on leaveAwareness', () => {
      client.setAwareness({ name: 'Alice' });
      expect(client.getAwarenessStates().has(client.getClientId())).toBe(true);
      client.leaveAwareness();
      expect(client.getAwarenessStates().has(client.getClientId())).toBe(false);
    });
  });

  describe('Network Status', () => {
    it('should accept network status subscribers', () => {
      const cb = vi.fn();
      client.subscribeNetwork(cb);
      // Network status is managed internally
      expect(cb).toBeDefined();
    });
  });

  describe('getDoc / broadcastUpdate', () => {
    it('should expose the YoinDoc', () => {
      const doc = client.getDoc();
      expect(doc).toBeDefined();
      expect(typeof doc.get_text).toBe('function');
    });

    it('broadcastUpdate should notify listeners', () => {
      const listener = vi.fn();
      client.subscribe(listener);
      client.broadcastUpdate(new Uint8Array([1, 2, 3]));
      expect(listener).toHaveBeenCalled();
    });
  });
});
