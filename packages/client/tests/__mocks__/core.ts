// packages/client/tests/__mocks__/core.ts
// ============================================================
// Mock for @yoin/core WASM module
// Provides a realistic in-memory YoinDoc class for testing
// ============================================================

interface CharItem {
  ch: string;
  attrs: Record<string, any>;
}

function cloneDeep<T>(val: T): T {
  if (val === undefined || val === null || typeof val !== 'object') {
    return val;
  }
  return JSON.parse(JSON.stringify(val));
}

class MockYoinDoc {
  private texts: Map<string, CharItem[]> = new Map();
  private maps: Map<string, Record<string, any>> = new Map();
  private arrays: Map<string, any[]> = new Map();
  private undoStack: Array<{
    texts: Map<string, CharItem[]>;
    maps: Map<string, Record<string, any>>;
    arrays: Map<string, any[]>;
  }> = [];
  private redoStack: Array<{
    texts: Map<string, CharItem[]>;
    maps: Map<string, Record<string, any>>;
    arrays: Map<string, any[]>;
  }> = [];
  private stateVersion = 0;
  public freed = false;

  free() {
    this.freed = true;
  }
  [Symbol.dispose]() {
    this.freed = true;
  }

  private captureUndoState() {
    const textsCopy = new Map<string, CharItem[]>();
    for (const [k, v] of this.texts.entries()) {
      textsCopy.set(
        k,
        v.map((item) => ({ ch: item.ch, attrs: { ...item.attrs } })),
      );
    }
    const mapsCopy = new Map<string, Record<string, any>>();
    for (const [k, v] of this.maps.entries()) {
      mapsCopy.set(k, cloneDeep(v));
    }
    const arraysCopy = new Map<string, any[]>();
    for (const [k, v] of this.arrays.entries()) {
      arraysCopy.set(k, cloneDeep(v));
    }
    this.undoStack.push({
      texts: textsCopy,
      maps: mapsCopy,
      arrays: arraysCopy,
    });
    this.redoStack = [];
  }

  private encodeCurrentAsUpdate(tag: number): Uint8Array {
    this.stateVersion++;
    const payload = {
      __yoin_mock_v2: true,
      tag,
      v: this.stateVersion,
      texts: Object.fromEntries(this.texts.entries()),
      maps: Object.fromEntries(this.maps.entries()),
      arrays: Object.fromEntries(this.arrays.entries()),
    };
    return new TextEncoder().encode(JSON.stringify(payload));
  }

  insert_text(name: string, index: number, chunk: string): Uint8Array {
    return this.insert_text_with_attrs(name, index, chunk, {});
  }

  insert_text_with_attrs(
    name: string,
    index: number,
    chunk: string,
    attrs: Record<string, any> = {},
  ): Uint8Array {
    this.captureUndoState();
    const current = this.texts.get(name) || [];
    const cleanAttrs: Record<string, any> = {};
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== null && v !== undefined && v !== false) {
          cleanAttrs[k] = v;
        }
      }
    }
    const items: CharItem[] = Array.from(chunk).map((ch) => ({
      ch,
      attrs: { ...cleanAttrs },
    }));
    const updated = [
      ...current.slice(0, index),
      ...items,
      ...current.slice(index),
    ];
    this.texts.set(name, updated);
    return this.encodeCurrentAsUpdate(1);
  }

  format_text(
    name: string,
    index: number,
    length: number,
    attrs: Record<string, any>,
  ): Uint8Array {
    this.captureUndoState();
    const current = this.texts.get(name) || [];
    const end = Math.min(current.length, index + length);
    for (let i = Math.max(0, index); i < end; i++) {
      const nextAttrs = { ...current[i].attrs };
      if (attrs && typeof attrs === 'object') {
        for (const [k, v] of Object.entries(attrs)) {
          if (v === null || v === false || v === undefined) {
            delete nextAttrs[k];
          } else {
            nextAttrs[k] = v;
          }
        }
      }
      current[i] = { ch: current[i].ch, attrs: nextAttrs };
    }
    this.texts.set(name, current);
    return this.encodeCurrentAsUpdate(14);
  }

  apply_text_delta(name: string, ops: any[]): Uint8Array {
    this.captureUndoState();
    const current = [...(this.texts.get(name) || [])];
    let cursor = 0;

    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      if (typeof op.insert === 'string') {
        const cleanAttrs: Record<string, any> = {};
        if (op.attributes && typeof op.attributes === 'object') {
          for (const [k, v] of Object.entries(op.attributes)) {
            if (v !== null && v !== undefined && v !== false) {
              cleanAttrs[k] = v;
            }
          }
        }
        const items: CharItem[] = Array.from(op.insert).map((ch) => ({
          ch,
          attrs: { ...cleanAttrs },
        }));
        current.splice(cursor, 0, ...items);
        cursor += items.length;
      } else if (typeof op.delete === 'number' && op.delete > 0) {
        current.splice(cursor, op.delete);
      } else if (typeof op.retain === 'number' && op.retain > 0) {
        if (op.attributes && typeof op.attributes === 'object') {
          const end = Math.min(current.length, cursor + op.retain);
          for (let i = cursor; i < end; i++) {
            const nextAttrs = { ...current[i].attrs };
            for (const [k, v] of Object.entries(op.attributes)) {
              if (v === null || v === false || v === undefined) {
                delete nextAttrs[k];
              } else {
                nextAttrs[k] = v;
              }
            }
            current[i] = { ch: current[i].ch, attrs: nextAttrs };
          }
        }
        cursor += op.retain;
      }
    }

    this.texts.set(name, current);
    return this.encodeCurrentAsUpdate(15);
  }

  delete_text(name: string, index: number, length: number): Uint8Array {
    this.captureUndoState();
    const current = this.texts.get(name) || [];
    const updated = [
      ...current.slice(0, index),
      ...current.slice(index + length),
    ];
    this.texts.set(name, updated);
    return this.encodeCurrentAsUpdate(2);
  }

  get_text(name: string): string {
    const current = this.texts.get(name) || [];
    return current.map((item) => item.ch).join('');
  }

  get_text_delta(
    name: string,
  ): Array<{ insert: string; attributes?: Record<string, any> }> {
    const current = this.texts.get(name) || [];
    if (current.length === 0) return [];

    const ops: Array<{ insert: string; attributes?: Record<string, any> }> = [];
    let currentStr = '';
    let currentAttrsStr = '';
    let currentAttrsObj: Record<string, any> = {};

    for (const item of current) {
      const keys = Object.keys(item.attrs).sort();
      const sortedAttrs: Record<string, any> = {};
      for (const k of keys) sortedAttrs[k] = item.attrs[k];
      const attrsStr = JSON.stringify(sortedAttrs);

      if (currentStr.length === 0) {
        currentStr = item.ch;
        currentAttrsStr = attrsStr;
        currentAttrsObj = sortedAttrs;
      } else if (attrsStr === currentAttrsStr) {
        currentStr += item.ch;
      } else {
        const op: { insert: string; attributes?: Record<string, any> } = {
          insert: currentStr,
        };
        if (Object.keys(currentAttrsObj).length > 0) {
          op.attributes = currentAttrsObj;
        }
        ops.push(op);
        currentStr = item.ch;
        currentAttrsStr = attrsStr;
        currentAttrsObj = sortedAttrs;
      }
    }

    if (currentStr.length > 0) {
      const op: { insert: string; attributes?: Record<string, any> } = {
        insert: currentStr,
      };
      if (Object.keys(currentAttrsObj).length > 0) {
        op.attributes = currentAttrsObj;
      }
      ops.push(op);
    }

    return ops;
  }

  map_set(mapName: string, key: string, value: any): Uint8Array {
    this.captureUndoState();
    const map = { ...(this.maps.get(mapName) || {}) };
    map[key] = cloneDeep(value);
    this.maps.set(mapName, map);
    return this.encodeCurrentAsUpdate(3);
  }

  map_delete(mapName: string, key: string): Uint8Array {
    this.captureUndoState();
    const map = { ...(this.maps.get(mapName) || {}) };
    delete map[key];
    this.maps.set(mapName, map);
    return this.encodeCurrentAsUpdate(16);
  }

  map_insert_nested(
    rootMapName: string,
    key: string,
    entries: Record<string, any>,
  ): Uint8Array {
    this.captureUndoState();
    const root = { ...(this.maps.get(rootMapName) || {}) };
    root[key] = cloneDeep(entries);
    this.maps.set(rootMapName, root);
    return this.encodeCurrentAsUpdate(21);
  }

  map_update_nested(
    rootMapName: string,
    key: string,
    updates: Record<string, any>,
  ): Uint8Array {
    this.captureUndoState();
    const root = { ...(this.maps.get(rootMapName) || {}) };
    const current =
      root[key] && typeof root[key] === 'object' && !Array.isArray(root[key])
        ? root[key]
        : {};
    root[key] = { ...current, ...cloneDeep(updates) };
    this.maps.set(rootMapName, root);
    return this.encodeCurrentAsUpdate(22);
  }

  map_set_deep(rootMapName: string, path: any[], value: any): Uint8Array {
    if (!path || path.length === 0) {
      throw new Error('Path cannot be empty');
    }
    this.captureUndoState();
    const root = { ...(this.maps.get(rootMapName) || {}) };
    let cursor: Record<string, any> = root;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = String(path[i]);
      if (
        cursor[segment] === null ||
        typeof cursor[segment] !== 'object' ||
        Array.isArray(cursor[segment])
      ) {
        cursor[segment] = {};
      } else {
        cursor[segment] = { ...cursor[segment] };
      }
      cursor = cursor[segment];
    }
    const lastKey = String(path[path.length - 1]);
    cursor[lastKey] = cloneDeep(value);
    this.maps.set(rootMapName, root);
    return this.encodeCurrentAsUpdate(4);
  }

  map_get(mapName: string, key: string): any {
    const map = this.maps.get(mapName);
    if (!map || !(key in map)) return null;
    return cloneDeep(map[key]);
  }

  map_get_all(mapName: string): any {
    return cloneDeep(this.maps.get(mapName) || {});
  }

  map_get_json(mapName: string): any {
    return this.map_get_all(mapName);
  }

  array_push(arrayName: string, value: any): Uint8Array {
    this.captureUndoState();
    const arr = [...(this.arrays.get(arrayName) || [])];
    arr.push(cloneDeep(value));
    this.arrays.set(arrayName, arr);
    return this.encodeCurrentAsUpdate(5);
  }

  array_insert(arrayName: string, index: number, value: any): Uint8Array {
    this.captureUndoState();
    const arr = [...(this.arrays.get(arrayName) || [])];
    arr.splice(index, 0, cloneDeep(value));
    this.arrays.set(arrayName, arr);
    return this.encodeCurrentAsUpdate(17);
  }

  array_delete(arrayName: string, index: number, length: number): Uint8Array {
    this.captureUndoState();
    const arr = [...(this.arrays.get(arrayName) || [])];
    arr.splice(index, length);
    this.arrays.set(arrayName, arr);
    return this.encodeCurrentAsUpdate(18);
  }

  array_get(arrayName: string, index: number): any {
    const arr = this.arrays.get(arrayName) || [];
    return index in arr ? cloneDeep(arr[index]) : null;
  }

  array_get_all(arrayName: string): any {
    return cloneDeep(this.arrays.get(arrayName) || []);
  }

  batch_set(entries: any[]): Uint8Array {
    this.captureUndoState();
    for (const [mapName, key, value] of entries) {
      const map = { ...(this.maps.get(mapName) || {}) };
      map[key] = cloneDeep(value);
      this.maps.set(mapName, map);
    }
    return this.encodeCurrentAsUpdate(6);
  }

  apply_update(update: Uint8Array): Array<{ kind: 'text' | 'map' | 'array'; name: string }> {
    const scopes: Array<{ kind: 'text' | 'map' | 'array'; name: string }> = [];
    if (!update || update.byteLength === 0) return scopes;
    try {
      const text = new TextDecoder().decode(update);
      const parsed = JSON.parse(text);
      if (parsed && parsed.__yoin_mock_v2) {
        if (parsed.texts && typeof parsed.texts === 'object') {
          for (const [k, v] of Object.entries(parsed.texts)) {
            this.texts.set(k, v as CharItem[]);
            scopes.push({ kind: 'text', name: k });
          }
        }
        if (parsed.maps && typeof parsed.maps === 'object') {
          for (const [k, v] of Object.entries(parsed.maps)) {
            const existing = this.maps.get(k) || {};
            this.maps.set(k, { ...existing, ...(v as Record<string, any>) });
            scopes.push({ kind: 'map', name: k });
          }
        }
        if (parsed.arrays && typeof parsed.arrays === 'object') {
          for (const [k, v] of Object.entries(parsed.arrays)) {
            this.arrays.set(k, v as any[]);
            scopes.push({ kind: 'array', name: k });
          }
        }
        this.stateVersion = Math.max(this.stateVersion, parsed.v || 0);
      }
    } catch {
      // Non-JSON raw bytes passed in unit tests — ignore safely
    }
    return scopes;
  }

  export_update(): Uint8Array {
    return this.encodeCurrentAsUpdate(7);
  }

  get_state_vector(): Uint8Array {
    return new Uint8Array([8, this.stateVersion]);
  }

  export_diff(remoteSv: Uint8Array): Uint8Array {
    const remoteVer = remoteSv && remoteSv.length > 1 ? remoteSv[1] : -1;
    if (this.stateVersion === 0 || remoteVer === this.stateVersion) {
      return new Uint8Array(0);
    }
    return this.encodeCurrentAsUpdate(9);
  }

  get_missing_updates(clientSv: Uint8Array): Uint8Array {
    return this.export_diff(clientSv);
  }

  create_relative_position(name: string, index: number, assoc: number = 0): Uint8Array {
    const payload = JSON.stringify({ __rel_pos: true, name, index, assoc });
    return new TextEncoder().encode(payload);
  }

  resolve_relative_position(bytes: Uint8Array): { index: number; assoc: number } | null {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed && parsed.__rel_pos) {
        return { index: parsed.index, assoc: parsed.assoc };
      }
    } catch {
      // ignore
    }
    return null;
  }

  snapshot(): Uint8Array {
    return this.encodeCurrentAsUpdate(11);
  }

  enable_undo(): void {}
  expand_undo_scope(_typeName: string): void {}
  expand_undo_scope_for(_typeName: string, _kind: string): void {}

  undo(): Uint8Array {
    if (this.undoStack.length === 0) return new Uint8Array(0);
    const currentSnapshot = {
      texts: new Map(this.texts),
      maps: new Map(this.maps),
      arrays: new Map(this.arrays),
    };
    const prev = this.undoStack.pop()!;
    this.redoStack.push(currentSnapshot);
    this.texts = prev.texts;
    this.maps = prev.maps;
    this.arrays = prev.arrays;
    return this.encodeCurrentAsUpdate(12);
  }

  redo(): Uint8Array {
    if (this.redoStack.length === 0) return new Uint8Array(0);
    const currentSnapshot = {
      texts: new Map(this.texts),
      maps: new Map(this.maps),
      arrays: new Map(this.arrays),
    };
    const next = this.redoStack.pop()!;
    this.undoStack.push(currentSnapshot);
    this.texts = next.texts;
    this.maps = next.maps;
    this.arrays = next.arrays;
    return this.encodeCurrentAsUpdate(13);
  }
}

export { MockYoinDoc as YoinDoc };

// Mock init_panic_hook
export function init_panic_hook(): void {}

// Mock InitInput type
export type InitInput =
  | string
  | URL
  | Request
  | Response
  | BufferSource
  | WebAssembly.Module;

// Mock default init function (WASM loader)
export default async function initWasm(_input?: InitInput): Promise<void> {
  // No-op in tests
}
