// packages/client/tests/exports.test.ts
// ============================================================
// Test: Barrel file exports completeness
// Ensures all public API symbols are correctly exported
// ============================================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('@yoin/core', () => import('./__mocks__/core'));

describe('@yoin/client exports', () => {
  it('should export initYoin function', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.initYoin).toBe('function');
  });

  it('should export isYoinInitialized function', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.isYoinInitialized).toBe('function');
  });

  it('should export YoinClient class', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.YoinClient).toBe('function');
  });

  it('should export YoinDoc class', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.YoinDoc).toBe('function');
  });

  it('should export createUndoPlugin factory', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createUndoPlugin).toBe('function');
  });

  it('should export YoinUndoPlugin class', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.YoinUndoPlugin).toBe('function');
  });

  it('should export createDbPlugin factory', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createDbPlugin).toBe('function');
  });

  it('should export YoinDbPlugin class', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.YoinDbPlugin).toBe('function');
  });

  it('should export createLoggerPlugin factory', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createLoggerPlugin).toBe('function');
  });

  it('should export createMapProxy function', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createMapProxy).toBe('function');
  });

  it('should export createArrayProxy function', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createArrayProxy).toBe('function');
  });

  it('should have exactly the expected exports', async () => {
    const mod = await import('../src/index');
    const exportedNames = Object.keys(mod).sort();
    const expected = [
      'YoinClient',
      'YoinDbPlugin',
      'YoinDoc',
      'YoinUndoPlugin',
      'createArrayProxy',
      'createDbPlugin',
      'createLoggerPlugin',
      'createMapProxy',
      'createUndoPlugin',
      'initYoin',
      'isYoinInitialized',
    ].sort();
    expect(exportedNames).toEqual(expected);
  });
});
