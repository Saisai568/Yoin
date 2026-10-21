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

  it('supports map_insert_nested and map_update_nested for property-level CRDT merges', () => {
    const docA = new YoinDoc();
    const docB = new YoinDoc();

    // 1. DocA inserts a nested shape (Whiteboard rect)
    const initDiff = docA.map_insert_nested('shapes', 'rect-1', {
      type: 'rect',
      x: 10,
      y: 20,
      fill: 'red',
    });
    docB.apply_update(initDiff);

    // 2. Client A moves the rectangle (x: 150)
    const moveDiff = docA.map_update_nested('shapes', 'rect-1', { x: 150 });

    // 3. Client B concurrently changes color (fill: 'blue')
    const colorDiff = docB.map_update_nested('shapes', 'rect-1', { fill: 'blue' });

    // 4. Cross-replicate updates
    docA.apply_update(colorDiff);
    docB.apply_update(moveDiff);

    // 5. Verify property-level merge: BOTH x: 150 AND fill: 'blue' are preserved!
    const stateA = docA.map_get_all('shapes');
    const stateB = docB.map_get_all('shapes');

    expect(stateA).toEqual(stateB);
    expect(stateA['rect-1']).toEqual({
      type: 'rect',
      x: 150,
      y: 20,
      fill: 'blue',
    });

    docA.free();
    docB.free();
  });

  it('throws error when apply_update receives corrupted bytes', () => {
    const doc = new YoinDoc();
    const corrupted = new Uint8Array([255, 255, 255, 255]);
    expect(() => doc.apply_update(corrupted)).toThrow();
    doc.free();
  });

  it('Y-03: returns affected container scopes on remote apply_update', () => {
    const docA = new YoinDoc();
    const docB = new YoinDoc();

    // Pre-register containers so Yrs recognizes their branch types
    docB.get_text('notes');
    docB.map_get_all('wb.shapes');
    docB.array_get_all('kanban.tasks');

    // 1. Text update
    const textDiff = docA.insert_text('notes', 0, 'remote hello');
    const textScopes = docB.apply_update(textDiff);
    expect(textScopes).toEqual([{ kind: 'text', name: 'notes' }]);

    // 2. Map update (nested shape)
    const mapDiff = docA.map_insert_nested('wb.shapes', 'node_1', {
      type: 'rect',
      x: 10,
    });
    const mapScopes = docB.apply_update(mapDiff);
    expect(mapScopes).toEqual([{ kind: 'map', name: 'wb.shapes' }]);

    // 3. Array update
    const arrayDiff = docA.array_push('kanban.tasks', 'task-101');
    const arrayScopes = docB.apply_update(arrayDiff);
    expect(arrayScopes).toEqual([{ kind: 'array', name: 'kanban.tasks' }]);

    docA.free();
    docB.free();
  });

  it('Y-07: relative position tracks index shifts correctly across remote updates', () => {
    const docA = new YoinDoc();
    const docB = new YoinDoc();

    // 1. DocA writes "hello world" (11 chars)
    const initDiff = docA.insert_text('content', 0, 'hello world');
    docB.apply_update(initDiff);

    // 2. DocB creates relative position at index 5 (after "hello", assoc: 0)
    const relPos = docB.create_relative_position('content', 5, 0);
    expect(relPos).toBeInstanceOf(Uint8Array);
    expect(relPos.length).toBeGreaterThan(0);

    const posBefore = docB.resolve_relative_position(relPos);
    expect(posBefore).toEqual({ index: 5, assoc: 0 });

    // 3. DocA prepends "[PREPENDED 15] " (15 chars)
    const prependText = '[PREPENDED 15] ';
    const prependDiff = docA.insert_text('content', 0, prependText);
    docB.apply_update(prependDiff);

    // 4. DocB resolves relative position -> index must have shifted by 15 to 20!
    const posAfter = docB.resolve_relative_position(relPos);
    expect(posAfter).toEqual({ index: 5 + prependText.length, assoc: 0 });

    // 5. Verify the character at index 20 is still ' ' (space between "hello" and "world")
    const fullText = docB.get_text('content');
    expect(fullText.charAt(20)).toBe(' ');
    expect(fullText.substring(21, 26)).toBe('world');

    docA.free();
    docB.free();
  });
});
