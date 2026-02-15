// packages/client/src/wasm/loader.ts
// ============================================================
// WASM Loader - Handles WASM initialization across environments
// ============================================================
//
// Usage in Vite projects:
//
//   import { initYoin } from '@yoin/client';
//   await initYoin();
//
// If automatic URL resolution fails, pass the WASM URL explicitly:
//
//   import wasmUrl from '@yoin/core/core_bg.wasm?url';
//   import { initYoin } from '@yoin/client';
//   await initYoin(wasmUrl);
//
// ============================================================

import initWasm, { init_panic_hook } from '@yoin/core';
import type { InitInput } from '@yoin/core';

let initialized = false;

/**
 * Initialize the Yoin WASM engine.
 *
 * @param wasmInput - Optional WASM module source. In Vite environments with
 *   `vite-plugin-wasm`, this can be omitted. For other bundlers, pass the
 *   WASM URL obtained via `import wasmUrl from '@yoin/core/core_bg.wasm?url'`.
 *
 * @returns Promise that resolves when WASM is ready.
 */
export async function initYoin(wasmInput?: InitInput): Promise<void> {
  if (initialized) return;

  await initWasm(wasmInput);
  init_panic_hook();
  initialized = true;
}

/**
 * Check whether the WASM engine has been initialized.
 */
export function isYoinInitialized(): boolean {
  return initialized;
}
