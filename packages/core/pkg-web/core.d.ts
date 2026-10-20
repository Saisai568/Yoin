/* tslint:disable */
/* eslint-disable */

export class YoinDoc {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Apply a sequence of Quill-compatible Delta operations ({ insert?, delete?, retain?, attributes? })
     * in a single atomic transaction.
     */
    apply_text_delta(name: string, ops: Array<any>): Uint8Array;
    apply_update(update: Uint8Array): void;
    array_delete(array_name: string, index: number, length: number): Uint8Array;
    /**
     * Returns native JS value for a single array index
     */
    array_get(array_name: string, index: number): any;
    /**
     * Returns native JS array directly via serde-wasm-bindgen (no JSON stringify/parse)
     */
    array_get_all(array_name: string): any;
    array_insert(array_name: string, index: number, value: any): Uint8Array;
    array_push(array_name: string, value: any): Uint8Array;
    /**
     * Batch write: execute multiple map_set operations in a single transaction.
     * entries is a JS Array of [mapName, key, value] triples.
     */
    batch_set(entries: Array<any>): Uint8Array;
    delete_text(name: string, index: number, length: number): Uint8Array;
    /**
     * Explicitly enable undo support. Called automatically on first undo()/redo().
     * JS can also call this to eagerly initialize.
     */
    enable_undo(): void;
    /**
     * Expand undo scope to track a named shared type (map/text/array).
     * Must be called after enable_undo or before first undo/redo.
     */
    expand_undo_scope(type_name: string): void;
    /**
     * Expand undo scope for a specific shared type kind ("map" | "text" | "array")
     * without colliding root branch types on the same key.
     */
    expand_undo_scope_for(type_name: string, kind: string): void;
    export_diff(remote_sv_bin: Uint8Array): Uint8Array;
    export_update(): Uint8Array;
    /**
     * Format an existing range of text with attributes (Quill/Tiptap compatible)
     */
    format_text(name: string, index: number, length: number, attrs: any): Uint8Array;
    get_missing_updates(client_sv_u8: Uint8Array): Uint8Array;
    get_state_vector(): Uint8Array;
    get_text(name: string): string;
    /**
     * Returns Quill-compatible Delta array: [{ insert: string, attributes?: Record<string, any> }]
     */
    get_text_delta(name: string): any;
    insert_text(name: string, index: number, chunk: string): Uint8Array;
    /**
     * Insert rich text with formatting attributes (e.g., { bold: true, color: "#ff0000" })
     */
    insert_text_with_attrs(name: string, index: number, chunk: string, attrs: any): Uint8Array;
    map_delete(map_name: string, key: string): Uint8Array;
    /**
     * Returns native JS value for a single key via serde-wasm-bindgen
     */
    map_get(map_name: string, key: string): any;
    /**
     * Returns native JS object directly via serde-wasm-bindgen (no JSON stringify/parse)
     */
    map_get_all(map_name: string): any;
    /**
     * Kept for backward compatibility - alias of map_get_all
     */
    map_get_json(map_name: string): any;
    map_set(map_name: string, key: string, value: any): Uint8Array;
    map_set_deep(root_map_name: string, path: Array<any>, value: any): Uint8Array;
    constructor();
    redo(): Uint8Array;
    snapshot(): Uint8Array;
    undo(): Uint8Array;
}

export function init_panic_hook(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly init_panic_hook: () => void;
    readonly __wbg_yoindoc_free: (a: number, b: number) => void;
    readonly yoindoc_new: () => number;
    readonly yoindoc_enable_undo: (a: number) => void;
    readonly yoindoc_expand_undo_scope: (a: number, b: number, c: number) => void;
    readonly yoindoc_expand_undo_scope_for: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly yoindoc_undo: (a: number, b: number) => void;
    readonly yoindoc_redo: (a: number, b: number) => void;
    readonly yoindoc_insert_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly yoindoc_insert_text_with_attrs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly yoindoc_format_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly yoindoc_apply_text_delta: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly yoindoc_delete_text: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly yoindoc_map_set: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly yoindoc_map_delete: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly yoindoc_map_set_deep: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly yoindoc_batch_set: (a: number, b: number, c: number) => void;
    readonly yoindoc_array_push: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly yoindoc_array_insert: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly yoindoc_array_delete: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly yoindoc_get_text: (a: number, b: number, c: number, d: number) => void;
    readonly yoindoc_get_text_delta: (a: number, b: number, c: number) => number;
    readonly yoindoc_map_get_all: (a: number, b: number, c: number) => number;
    readonly yoindoc_map_get: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly yoindoc_array_get_all: (a: number, b: number, c: number) => number;
    readonly yoindoc_array_get: (a: number, b: number, c: number, d: number) => number;
    readonly yoindoc_apply_update: (a: number, b: number, c: number) => void;
    readonly yoindoc_export_update: (a: number, b: number) => void;
    readonly yoindoc_get_state_vector: (a: number, b: number) => void;
    readonly yoindoc_export_diff: (a: number, b: number, c: number, d: number) => void;
    readonly yoindoc_snapshot: (a: number, b: number) => void;
    readonly yoindoc_get_missing_updates: (a: number, b: number, c: number, d: number) => void;
    readonly yoindoc_map_get_json: (a: number, b: number, c: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
