import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@yoin/core', () => import('./__mocks__/core'));
vi.mock('../src/wasm/loader', () => ({
  isYoinInitialized: () => true,
  initYoin: async () => {},
}));
vi.mock('../src/storage', () => ({
  StorageAdapter: class {
    load = storageMocks.load;
    save = storageMocks.save;
  },
}));

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: Uint8Array[] = [];

  constructor(public readonly url: string) {}

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

import { YoinClient } from '../src/YoinClient';
import { createDbPlugin } from '../src/plugins/db';

describe('YoinDbPlugin lifecycle', () => {
  let client: YoinClient;
  let destroyed = false;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    storageMocks.load.mockResolvedValue(null);
    storageMocks.save.mockResolvedValue(undefined);
    client = new YoinClient({ url: 'wss://test.example.com', docId: 'db-test' });
  });

  afterEach(async () => {
    if (!destroyed) await client.destroy();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('waits for restore before persisting a local write', async () => {
    let resolveLoad!: (value: Uint8Array | null) => void;
    storageMocks.load.mockReturnValue(
      new Promise<Uint8Array | null>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const { plugin, forceSave } = createDbPlugin({
      dbName: 'test-db',
      debounceMs: 10,
    });

    client.use(plugin);
    await client.setMap('settings', 'theme', 'dark');
    await Promise.resolve();

    expect(storageMocks.save).not.toHaveBeenCalled();

    resolveLoad(null);
    await forceSave();

    expect(storageMocks.save).toHaveBeenCalledTimes(1);
  });

  it('awaits the final persistence operation during destroy', async () => {
    let resolveSave!: () => void;
    storageMocks.save.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { plugin } = createDbPlugin({
      dbName: 'test-db',
      debounceMs: 1000,
    });
    client.use(plugin);
    await client.setMap('settings', 'theme', 'dark');

    const destroyPromise = client.destroy();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    expect(storageMocks.save).toHaveBeenCalledTimes(1);
    let completed = false;
    void destroyPromise.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    resolveSave();
    await destroyPromise;
    expect(completed).toBe(true);
    destroyed = true;
  });
});
