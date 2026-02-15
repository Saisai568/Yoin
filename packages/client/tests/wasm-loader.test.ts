// packages/client/tests/wasm-loader.test.ts
// ============================================================
// Test: WASM loader (initYoin / isYoinInitialized)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@yoin/core', () => import('./__mocks__/core'));

describe('WASM Loader', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules();
    vi.mock('@yoin/core', () => import('./__mocks__/core'));
  });

  it('should export initYoin as a function', async () => {
    const { initYoin } = await import('../src/wasm/loader');
    expect(typeof initYoin).toBe('function');
  });

  it('should export isYoinInitialized as a function', async () => {
    const { isYoinInitialized } = await import('../src/wasm/loader');
    expect(typeof isYoinInitialized).toBe('function');
  });

  it('initYoin should complete without error', async () => {
    const { initYoin } = await import('../src/wasm/loader');
    await expect(initYoin()).resolves.toBeUndefined();
  });

  it('isYoinInitialized should be true after init', async () => {
    const { initYoin, isYoinInitialized } = await import('../src/wasm/loader');
    await initYoin();
    expect(isYoinInitialized()).toBe(true);
  });

  it('initYoin should be idempotent', async () => {
    const { initYoin } = await import('../src/wasm/loader');
    await initYoin();
    await initYoin();
    await initYoin();
    // Should not throw
  });
});
