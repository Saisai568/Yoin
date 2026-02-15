// packages/client/tests/types.test.ts
// ============================================================
// Test: TypeScript type system validation
// Ensures all exported types are correctly defined
// ============================================================

import { describe, it, expect } from 'vitest';
import type {
  YoinConfig,
  AwarenessState,
  AwarenessPartial,
  CursorRenderer,
  AwarenessCallback,
  NetworkStatus,
  YoinPlugin,
  YoinDbPluginOptions,
} from '../src/index';

describe('Type Definitions', () => {
  it('YoinConfig should accept valid configurations', () => {
    const config: YoinConfig = {
      url: 'wss://example.com',
      docId: 'test-doc',
    };
    expect(config.url).toBe('wss://example.com');
    expect(config.docId).toBe('test-doc');
  });

  it('YoinConfig should accept all optional fields', () => {
    const config: YoinConfig = {
      url: 'wss://example.com',
      docId: 'test-doc',
      dbName: 'testDB',
      awarenessThrottleMs: 50,
      heartbeatIntervalMs: 3000,
      heartbeatTimeoutMs: 15000,
    };
    expect(config.dbName).toBe('testDB');
    expect(config.awarenessThrottleMs).toBe(50);
    expect(config.heartbeatIntervalMs).toBe(3000);
    expect(config.heartbeatTimeoutMs).toBe(15000);
  });

  it('AwarenessState should have required fields', () => {
    const state: AwarenessState = {
      clientId: 'abc123',
      name: 'TestUser',
      color: '#ff0000',
      timestamp: Date.now(),
    };
    expect(state.clientId).toBe('abc123');
    expect(state.name).toBe('TestUser');
    expect(state.offline).toBeUndefined();
  });

  it('AwarenessState should accept optional fields', () => {
    const state: AwarenessState = {
      clientId: 'abc123',
      name: 'TestUser',
      color: '#ff0000',
      timestamp: Date.now(),
      cursorX: 100,
      cursorY: 200,
      selection: 'shape-1',
      offline: false,
      device: 'desktop',
      lastActive: Date.now(),
    };
    expect(state.cursorX).toBe(100);
    expect(state.device).toBe('desktop');
  });

  it('AwarenessPartial should exclude clientId and timestamp', () => {
    const partial: AwarenessPartial = {
      name: 'NewName',
      color: '#00ff00',
      cursorX: 50,
    };
    // @ts-expect-error - clientId should not be in AwarenessPartial
    const _invalid: AwarenessPartial = { clientId: 'x' };
    expect(partial.name).toBe('NewName');
  });

  it('NetworkStatus should be a union type', () => {
    const s1: NetworkStatus = 'connecting';
    const s2: NetworkStatus = 'online';
    const s3: NetworkStatus = 'offline';
    expect([s1, s2, s3]).toEqual(['connecting', 'online', 'offline']);
  });

  it('YoinDbPluginOptions should have required dbName', () => {
    const opts: YoinDbPluginOptions = {
      dbName: 'test-db',
    };
    expect(opts.dbName).toBe('test-db');
    expect(opts.debounceMs).toBeUndefined();
  });

  it('YoinDbPluginOptions should accept optional debounceMs', () => {
    const opts: YoinDbPluginOptions = {
      dbName: 'test-db',
      debounceMs: 2000,
    };
    expect(opts.debounceMs).toBe(2000);
  });
});
