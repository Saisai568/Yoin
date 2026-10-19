import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageAdapter } from '../src/storage';

type StoredValue = Uint8Array;

class FakeObjectStore {
  constructor(private readonly values: Map<string, StoredValue>) {}

  put(value: Uint8Array, key: string): void {
    this.values.set(key, new Uint8Array(value));
  }

  get(key: string): IDBRequest {
    const request = new FakeRequest();
    setTimeout(() => {
      request.result = this.values.get(key);
      request.onsuccess?.({ target: request });
    }, 0);
    return request as unknown as IDBRequest;
  }
}

class FakeRequest {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly values: Map<string, StoredValue>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.values);
  }
}

class FakeDatabase {
  objectStoreNames = {
    contains: (name: string) => name === 'documents',
  };

  createObjectStore(): void {}

  transaction(): FakeTransaction {
    const transaction = new FakeTransaction(fakeValues);
    setTimeout(() => transaction.oncomplete?.(), 0);
    return transaction;
  }
}

const fakeValues = new Map<string, StoredValue>();

function installIndexedDb(): void {
  const open = vi.fn(() => {
    const request = new FakeRequest();
    const database = new FakeDatabase();
    setTimeout(() => {
      request.onupgradeneeded?.({
        target: { result: database },
      } as unknown as IDBVersionChangeEvent);
      request.result = database;
      request.onsuccess?.({ target: request });
    }, 0);
    return request as unknown as IDBOpenDBRequest;
  });

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open },
  });
}

describe('StorageAdapter', () => {
  afterEach(() => {
    fakeValues.clear();
    vi.useRealTimers();
  });

  it('persists and restores a document snapshot', async () => {
    installIndexedDb();
    const storage = new StorageAdapter('test-db');
    const snapshot = new Uint8Array([1, 2, 3]);

    await storage.save('doc-1', snapshot);
    const restored = await storage.load('doc-1');

    expect(restored).toEqual(snapshot);
    expect(restored).not.toBe(snapshot);
  });

  it('returns null for an unknown document', async () => {
    installIndexedDb();
    const storage = new StorageAdapter('test-db');

    await expect(storage.load('missing')).resolves.toBeNull();
  });
});
