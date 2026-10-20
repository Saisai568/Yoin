// packages/client/tests/yoin-client.test.ts
// ============================================================
// Test: YoinClient core functionality with WASM mock
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock @yoin/core before importing YoinClient
vi.mock('@yoin/core', () => import('./__mocks__/core'));

// Mock WASM loader so isYoinInitialized() returns true in tests
vi.mock('../src/wasm/loader', () => ({
  isYoinInitialized: () => true,
  initYoin: async () => {},
  YoinInitError: class YoinInitError extends Error {
    name = 'YoinInitError';
  },
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

  afterEach(async () => {
    await client.destroy();
    vi.useRealTimers();
  });

  describe('Constructor & Lifecycle', () => {
    it('should create a client with valid config', () => {
      expect(client).toBeDefined();
      expect(client.getClientId()).toBeTruthy();
      expect(client.getClientId().length).toBeGreaterThan(0);
    });

    it('should generate unique client IDs', async () => {
      const client2 = new YoinClient(createConfig());
      expect(client.getClientId()).not.toBe(client2.getClientId());
      await client2.destroy();
    });

    it('should expose config via getConfig', () => {
      const config = client.getConfig();
      expect(config.url).toBe('wss://test.example.com');
      expect(config.docId).toBe('test-room');
    });

    it('should free WASM doc on destroy()', async () => {
      const c = new YoinClient(createConfig());
      const doc = c.getDoc() as any;
      const freeSpy = vi.spyOn(doc, 'free');
      await c.destroy();
      expect(freeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Text & Rich Text Delta API', () => {
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

    it('should insert rich text with attributes and return Quill-compatible delta', async () => {
      await client.insertText(0, 'Hello ', { bold: true });
      await client.insertText(6, 'World', { italic: true, color: '#ff0000' });

      expect(client.getText()).toBe('Hello World');
      expect(client.getTextDelta()).toEqual([
        { insert: 'Hello ', attributes: { bold: true } },
        { insert: 'World', attributes: { color: '#ff0000', italic: true } },
      ]);
    });

    it('should format existing text range and unformat with null/false', async () => {
      await client.insertText(0, 'Hello World');
      await client.formatText(0, 5, { bold: true });
      expect(client.getTextDelta()).toEqual([
        { insert: 'Hello', attributes: { bold: true } },
        { insert: ' World' },
      ]);

      await client.formatText(0, 5, { bold: false });
      expect(client.getTextDelta()).toEqual([{ insert: 'Hello World' }]);
    });

    it('should apply Quill Delta operations atomically via applyTextDelta', async () => {
      await client.applyTextDelta([
        { insert: 'SyncSpace ' },
        { insert: '2.0', attributes: { bold: true } },
      ]);
      expect(client.getText()).toBe('SyncSpace 2.0');
      expect(client.getTextDelta()).toEqual([
        { insert: 'SyncSpace ' },
        { insert: '2.0', attributes: { bold: true } },
      ]);

      // Retain "Sync", delete "Space", format " 2.0" as italic
      await client.applyTextDelta([
        { retain: 4 },
        { delete: 5 },
        { retain: 4, attributes: { italic: true } },
      ]);
      expect(client.getText()).toBe('Sync 2.0');
      expect(client.getTextDelta()).toEqual([
        { insert: 'Sync' },
        { insert: ' ', attributes: { italic: true } },
        { insert: '2.0', attributes: { bold: true, italic: true } },
      ]);
    });

    it('should support multiple independent named text documents', async () => {
      await client.insertText(0, 'Main Doc', undefined, 'content');
      await client.insertText(0, 'Chat Message', { bold: true }, 'chat-input');

      expect(client.getText('content')).toBe('Main Doc');
      expect(client.getText('chat-input')).toBe('Chat Message');
      expect(client.getTextDelta('chat-input')).toEqual([
        { insert: 'Chat Message', attributes: { bold: true } },
      ]);
    });
  });

  describe('Map API (CRUD & Native Type Fidelity)', () => {
    it('should set and get map values', async () => {
      await client.setMap('settings', 'theme', 'dark');
      const map = client.getMap('settings');
      expect(map.theme).toBe('dark');
    });

    it('should preserve native numbers, booleans, and objects without coercing numeric/boolean strings', async () => {
      await client.setMap('data', 'count', 42);
      await client.setMap('data', 'numericString', '42');
      await client.setMap('data', 'flag', true);
      await client.setMap('data', 'booleanString', 'true');
      await client.setMap('data', 'user', { name: 'Alice', age: 30 });

      const map = client.getMap('data');
      expect(map.count).toBe(42);
      expect(typeof map.count).toBe('number');
      expect(map.numericString).toBe('42');
      expect(typeof map.numericString).toBe('string');
      expect(map.flag).toBe(true);
      expect(typeof map.flag).toBe('boolean');
      expect(map.booleanString).toBe('true');
      expect(typeof map.booleanString).toBe('string');
      expect(map.user).toEqual({ name: 'Alice', age: 30 });
    });

    it('should delete map keys via deleteMap / deleteMapKey and check existence via hasMapKey', async () => {
      await client.setMap('whiteboard', 'shape-1', { x: 10, y: 20 });
      await client.setMap('whiteboard', 'shape-2', { x: 50, y: 60 });
      expect(client.hasMapKey('whiteboard', 'shape-1')).toBe(true);

      await client.deleteMap('whiteboard', 'shape-1');
      expect(client.hasMapKey('whiteboard', 'shape-1')).toBe(false);
      expect(client.getMap('whiteboard')).toEqual({
        'shape-2': { x: 50, y: 60 },
      });

      await client.deleteMapKey('whiteboard', 'shape-2');
      expect(client.getMap('whiteboard')).toEqual({});
    });

    it('should support multi-level nested setMapDeep', () => {
      client.setMapDeep('config', ['ui', 'sidebar', 'width'], 320);
      client.setMapDeep('config', ['ui', 'sidebar', 'collapsed'], false);
      expect(client.getMap('config')).toEqual({
        ui: {
          sidebar: {
            width: 320,
            collapsed: false,
          },
        },
      });
    });

    it('should return empty object for missing map', () => {
      const map = client.getMap('non-existent');
      expect(map).toEqual({});
    });

    it('should support batch set and validate schemas', async () => {
      client.batchSet([
        ['config', 'a', 'valueA'],
        ['config', 'b', 100],
      ]);
      const map = client.getMap('config');
      expect(map.a).toBe('valueA');
      expect(map.b).toBe(100);

      const strictClient = new YoinClient(
        createConfig({
          schemas: {
            'strict-map': z.object({ count: z.number() }),
          },
        }),
      );
      expect(() =>
        strictClient.batchSet([['strict-map', 'count', 'not-a-number']]),
      ).toThrow();
      await strictClient.destroy();
    });
  });

  describe('Array API (Push, Insert, Delete, Move)', () => {
    it('should push and get array items', async () => {
      await client.pushArray('logs', 'item1');
      const arr = client.getArray('logs');
      expect(arr).toContain('item1');
    });

    it('should handle object array items', async () => {
      await client.pushArray('logs', { action: 'CLICK', time: '12:00' });
      const arr = client.getArray('logs');
      expect(arr[0]).toEqual({ action: 'CLICK', time: '12:00' });
    });

    it('should insert, delete, and move array items (Kanban workflow)', async () => {
      await client.pushArray('kanban-todo', { id: 'issue-1', title: 'Setup' });
      await client.pushArray('kanban-todo', { id: 'issue-3', title: 'Deploy' });

      // Insert at index 1
      await client.insertArray('kanban-todo', 1, {
        id: 'issue-2',
        title: 'Build',
      });
      expect(client.getArray('kanban-todo').map((i) => i.id)).toEqual([
        'issue-1',
        'issue-2',
        'issue-3',
      ]);

      // Move issue-3 to index 0
      await client.moveArray('kanban-todo', 2, 0);
      expect(client.getArray('kanban-todo').map((i) => i.id)).toEqual([
        'issue-3',
        'issue-1',
        'issue-2',
      ]);

      // Delete index 1 (issue-1)
      await client.deleteArray('kanban-todo', 1, 1);
      expect(client.getArray('kanban-todo').map((i) => i.id)).toEqual([
        'issue-3',
        'issue-2',
      ]);
    });

    it('should return empty array for missing array', () => {
      const arr = client.getArray('nonexistent');
      expect(arr).toEqual([]);
    });
  });

  describe('Subscribe & Container-Scoped Listeners', () => {
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

    it('should only notify targeted container listeners on local writes (60FPS Whiteboard isolation)', async () => {
      const whiteboardListener = vi.fn();
      const settingsListener = vi.fn();
      const kanbanListener = vi.fn();
      const notesListener = vi.fn();

      const unsubWb = client.subscribeMap('whiteboard', whiteboardListener);
      const unsubSettings = client.subscribeMap('settings', settingsListener);
      const unsubKanban = client.subscribeArray('kanban', kanbanListener);
      const unsubNotes = client.subscribeText('notes', notesListener);

      await client.setMap('whiteboard', 'shape-1', { x: 100, y: 200 });

      expect(whiteboardListener).toHaveBeenCalledTimes(1);
      expect(whiteboardListener).toHaveBeenCalledWith({
        'shape-1': { x: 100, y: 200 },
      });
      expect(settingsListener).not.toHaveBeenCalled();
      expect(kanbanListener).not.toHaveBeenCalled();
      expect(notesListener).not.toHaveBeenCalled();

      await client.pushArray('kanban', 'card-1');
      expect(kanbanListener).toHaveBeenCalledTimes(1);
      expect(kanbanListener).toHaveBeenCalledWith(['card-1']);
      expect(whiteboardListener).toHaveBeenCalledTimes(1);

      await client.insertText(0, 'Rich note', { bold: true }, 'notes');
      expect(notesListener).toHaveBeenCalledTimes(1);
      expect(notesListener).toHaveBeenCalledWith('Rich note', [
        { insert: 'Rich note', attributes: { bold: true } },
      ]);

      unsubWb();
      unsubSettings();
      unsubKanban();
      unsubNotes();
    });
  });

  describe('Server Snapshot Hydration & Transient Offline Queue', () => {
    it('should export and apply snapshot across clients', async () => {
      await client.setMap('whiteboard', 'node-1', { label: 'Architecture' });
      await client.pushArray('events', { type: 'CREATED' });
      await client.insertText(0, 'Title', { bold: true });

      const snapshot = client.exportSnapshot();
      expect(snapshot.byteLength).toBeGreaterThan(0);

      const client2 = new YoinClient(createConfig({ docId: 'room-2' }));
      const mapListener = vi.fn();
      client2.subscribeMap('whiteboard', mapListener);

      client2.applySnapshot(snapshot);

      expect(client2.getMap('whiteboard')).toEqual({
        'node-1': { label: 'Architecture' },
      });
      expect(client2.getArray('events')).toEqual([{ type: 'CREATED' }]);
      expect(client2.getText()).toBe('Title');
      expect(mapListener).toHaveBeenCalledTimes(1);

      await client2.destroy();
    });

    it('should not queue transient awareness packets when offline', () => {
      // While socket is still CONNECTING (offline)
      expect(client.network.isConnected).toBe(false);
      expect(client.network.getQueueLength()).toBe(0);

      client.setAwareness({ name: 'OfflineUser', cursorX: 10, cursorY: 20 });
      client.leaveAwareness();

      // Transient awareness updates must never bloat the offline CRDT messageQueue
      expect(client.network.getQueueLength()).toBe(0);
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

    it('should call onDestroy on client.destroy()', async () => {
      const plugin = {
        name: 'destroy-test',
        onInstall: vi.fn(),
        onDestroy: vi.fn(),
      };
      client.use(plugin);
      await client.destroy();
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
      expect(cb).toHaveBeenCalledTimes(1);
      client.setAwareness({ name: 'Bob' });
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from awareness changes', () => {
      const cb = vi.fn();
      const unsub = client.onAwarenessChange(cb);
      unsub();
      client.setAwareness({ name: 'Charlie' });
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
    it('should accept network status subscribers and return unsubscribe function', () => {
      const cb = vi.fn();
      const unsub = client.subscribeNetwork(cb);
      expect(typeof unsub).toBe('function');
      unsub();
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
