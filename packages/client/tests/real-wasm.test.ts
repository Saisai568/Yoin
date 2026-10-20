// packages/client/tests/real-wasm.test.ts
// ============================================================
// Real Rust/Yrs WASM Integration Tests
// Verifies actual compiled packages/core/pkg-web/core_bg.wasm
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import initWasm, { YoinDoc } from '../../core/pkg-web/core.js';

describe('Real Rust/Yrs WASM Engine (core_bg.wasm)', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../../core/pkg-web/core_bg.wasm');
    const wasmBytes = fs.readFileSync(wasmPath);
    await initWasm({ module_or_path: wasmBytes });
  });

  it('preserves native JS types in map_set and map_get_all without string coercion', () => {
    const doc = new YoinDoc();

    doc.map_set('data', 'num', 42);
    doc.map_set('data', 'numStr', '42');
    doc.map_set('data', 'bool', true);
    doc.map_set('data', 'boolStr', 'true');
    doc.map_set('data', 'obj', { x: 10, y: 20, tags: ['a', 'b'] });

    const all = doc.map_get_all('data');
    expect(all.num).toBe(42);
    expect(typeof all.num).toBe('number');
    expect(all.numStr).toBe('42');
    expect(typeof all.numStr).toBe('string');
    expect(all.bool).toBe(true);
    expect(typeof all.bool).toBe('boolean');
    expect(all.boolStr).toBe('true');
    expect(typeof all.boolStr).toBe('string');
    expect(all.obj).toEqual({ x: 10, y: 20, tags: ['a', 'b'] });

    doc.free();
  });

  it('supports map_delete and batch_set in real Yrs WASM', () => {
    const doc = new YoinDoc();

    doc.batch_set([
      ['whiteboard', 'shape-1', { x: 10, y: 20 }],
      ['whiteboard', 'shape-2', { x: 30, y: 40 }],
    ]);
    expect(Object.keys(doc.map_get_all('whiteboard')).sort()).toEqual([
      'shape-1',
      'shape-2',
    ]);

    doc.map_delete('whiteboard', 'shape-1');
    expect(doc.map_get_all('whiteboard')).toEqual({
      'shape-2': { x: 30, y: 40 },
    });

    doc.free();
  });

  it('supports array_push, array_insert, and array_delete in real Yrs WASM', () => {
    const doc = new YoinDoc();

    doc.array_push('kanban', { id: '1', status: 'todo' });
    doc.array_push('kanban', { id: '3', status: 'todo' });
    doc.array_insert('kanban', 1, { id: '2', status: 'in-progress' });

    expect(doc.array_get_all('kanban').map((x: any) => x.id)).toEqual([
      '1',
      '2',
      '3',
    ]);

    doc.array_delete('kanban', 1, 1);
    expect(doc.array_get_all('kanban').map((x: any) => x.id)).toEqual([
      '1',
      '3',
    ]);

    doc.free();
  });

  it('supports Rich Text formatting attributes and Quill Delta in real Yrs WASM', () => {
    const doc = new YoinDoc();

    doc.insert_text_with_attrs('content', 0, 'Hello ', { bold: true });
    doc.insert_text_with_attrs('content', 6, 'World', { italic: true });

    expect(doc.get_text('content')).toBe('Hello World');
    expect(doc.get_text_delta('content')).toEqual([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'World', attributes: { italic: true } },
    ]);

    // Format "World" to also be bold
    doc.format_text('content', 6, 5, { bold: true });
    expect(doc.get_text_delta('content')).toEqual([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'World', attributes: { bold: true, italic: true } },
    ]);

    // Apply delta on a second named text container
    doc.apply_text_delta('notes', [
      { insert: 'SyncSpace 2.0' },
      { retain: 0 },
    ]);
    expect(doc.get_text('notes')).toBe('SyncSpace 2.0');

    doc.free();
  });

  it('converges two independent YoinDoc WASM instances via binary diff and undo/redo', () => {
    const docA = new YoinDoc();
    const docB = new YoinDoc();

    docA.enable_undo();
    docA.expand_undo_scope_for('board', 'map');

    const diff1 = docA.map_set('board', 'sticky-1', { text: 'Idea A' });
    docB.apply_update(diff1);

    expect(docB.map_get_all('board')).toEqual({
      'sticky-1': { text: 'Idea A' },
    });

    // Undo on docA and broadcast diff to docB
    const undoDiff = docA.undo();
    expect(undoDiff.byteLength).toBeGreaterThan(0);
    docB.apply_update(undoDiff);

    expect(docA.map_get_all('board')).toEqual({});
    expect(docB.map_get_all('board')).toEqual({});

    docA.free();
    docB.free();
  });
});
