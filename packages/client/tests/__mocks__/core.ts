// packages/client/tests/__mocks__/core.ts
// ============================================================
// Mock for @yoin/core WASM module
// Provides a stub YoinDoc class with in-memory state
// ============================================================

// In-memory CRDT simulation for testing
class MockYoinDoc {
  private texts: Map<string, string> = new Map();
  private maps: Map<string, Record<string, string>> = new Map();
  private arrays: Map<string, string[]> = new Map();
  private undoStack: any[] = [];
  private redoStack: any[] = [];
  private stateVersion = 0;

  free() {}
  [Symbol.dispose]() {}

  insert_text(name: string, index: number, chunk: string): Uint8Array {
    const current = this.texts.get(name) || '';
    const updated = current.slice(0, index) + chunk + current.slice(index);
    this.texts.set(name, updated);
    this.stateVersion++;
    this.undoStack.push({ type: 'text', name, prev: current });
    return new Uint8Array([1, this.stateVersion]);
  }

  delete_text(name: string, index: number, length: number): Uint8Array {
    const current = this.texts.get(name) || '';
    const updated = current.slice(0, index) + current.slice(index + length);
    this.undoStack.push({ type: 'text', name, prev: current });
    this.texts.set(name, updated);
    this.stateVersion++;
    return new Uint8Array([2, this.stateVersion]);
  }

  get_text(name: string): string {
    return this.texts.get(name) || '';
  }

  map_set(mapName: string, key: string, value: string): Uint8Array {
    const map = this.maps.get(mapName) || {};
    const prev = { ...map };
    map[key] = value;
    this.maps.set(mapName, map);
    this.undoStack.push({ type: 'map', mapName, prev });
    this.stateVersion++;
    return new Uint8Array([3, this.stateVersion]);
  }

  map_set_deep(rootMapName: string, path: any[], value: any): Uint8Array {
    const map = this.maps.get(rootMapName) || {};
    // Simplified: just set at first key
    if (path.length === 1) {
      map[path[0]] = String(value);
    }
    this.maps.set(rootMapName, map);
    this.stateVersion++;
    return new Uint8Array([4, this.stateVersion]);
  }

  map_get(mapName: string, key: string): any {
    const map = this.maps.get(mapName);
    if (!map) return null;
    return map[key] ?? null;
  }

  map_get_all(mapName: string): any {
    return this.maps.get(mapName) || {};
  }

  map_get_json(mapName: string): any {
    return this.map_get_all(mapName);
  }

  array_push(arrayName: string, value: string): Uint8Array {
    const arr = this.arrays.get(arrayName) || [];
    arr.push(value);
    this.arrays.set(arrayName, arr);
    this.stateVersion++;
    return new Uint8Array([5, this.stateVersion]);
  }

  array_get(arrayName: string, index: number): any {
    const arr = this.arrays.get(arrayName) || [];
    return arr[index] ?? null;
  }

  array_get_all(arrayName: string): any {
    return this.arrays.get(arrayName) || [];
  }

  batch_set(entries: any[]): Uint8Array {
    for (const [mapName, key, value] of entries) {
      const map = this.maps.get(mapName) || {};
      map[key] = value;
      this.maps.set(mapName, map);
    }
    this.stateVersion++;
    return new Uint8Array([6, this.stateVersion]);
  }

  apply_update(_update: Uint8Array): void {
    // Stub: in real CRDT this would merge
  }

  export_update(): Uint8Array {
    return new Uint8Array([7, this.stateVersion]);
  }

  get_state_vector(): Uint8Array {
    return new Uint8Array([8, this.stateVersion]);
  }

  export_diff(_remoteSv: Uint8Array): Uint8Array {
    return new Uint8Array([9, this.stateVersion]);
  }

  get_missing_updates(_clientSv: Uint8Array): Uint8Array {
    return new Uint8Array([10, this.stateVersion]);
  }

  snapshot(): Uint8Array {
    return new Uint8Array([11, this.stateVersion]);
  }

  enable_undo(): void {}
  expand_undo_scope(_typeName: string): void {}

  undo(): Uint8Array {
    if (this.undoStack.length === 0) return new Uint8Array(0);
    const action = this.undoStack.pop();
    this.redoStack.push(action);
    if (action.type === 'text') {
      this.texts.set(action.name, action.prev);
    } else if (action.type === 'map') {
      this.maps.set(action.mapName, action.prev);
    }
    return new Uint8Array([12, this.stateVersion]);
  }

  redo(): Uint8Array {
    if (this.redoStack.length === 0) return new Uint8Array(0);
    this.redoStack.pop();
    return new Uint8Array([13, this.stateVersion]);
  }
}

export { MockYoinDoc as YoinDoc };

// Mock init_panic_hook
export function init_panic_hook(): void {}

// Mock InitInput type
export type InitInput = string | URL | Request | Response | BufferSource | WebAssembly.Module;

// Mock default init function (WASM loader)
export default async function initWasm(_input?: InitInput): Promise<void> {
  // No-op in tests
}
