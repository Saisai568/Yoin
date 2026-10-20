// packages/client/src/wasm/loader.ts
// ============================================================
// WASM Loader - Handles WASM initialization across environments
// ============================================================

import initWasm, { init_panic_hook } from '@yoin/core';
import type { InitInput } from '@yoin/core';

let initialized = false;
let initPromise: Promise<void> | null = null;

// ============================================================
// Custom Error class for init failures
// ============================================================

/**
 * Thrown when the WASM engine fails to initialize after all retry attempts.
 */
export class YoinInitError extends Error {
  /** The underlying error from the last failed attempt. */
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'YoinInitError';
    this.cause = cause;
  }
}

/**
 * Initialize the Yoin WASM engine with automatic retry.
 *
 * @param wasmInput - Optional WASM module source. In Vite environments with
 *   `vite-plugin-wasm`, this can be omitted. For other bundlers, pass the
 *   WASM URL obtained via `import wasmUrl from '@yoin/core/core_bg.wasm?url'`.
 * @param retries - Number of retry attempts on failure (default: 3).
 *
 * @throws {YoinInitError} If all attempts fail.
 * @returns Promise that resolves when WASM is ready.
 */
export async function initYoin(
  wasmInput?: InitInput,
  retries = 3,
): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  // Pre-flight: check WebAssembly support
  if (typeof WebAssembly === 'undefined') {
    throw new YoinInitError(
      'This browser does not support WebAssembly. Yoin requires a modern browser with WASM support.',
    );
  }

  initPromise = (async () => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await initWasm(wasmInput);
        init_panic_hook();
        initialized = true;
        console.log('[Yoin] WASM engine initialized successfully');
        return;
      } catch (error) {
        lastError = error;
        console.warn(
          `[Yoin] WASM init attempt ${attempt}/${retries} failed:`,
          error,
        );

        if (attempt < retries) {
          // Incremental backoff: 500 → 1000 → 1500 ms …
          const delay = attempt * 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    initPromise = null;
    throw new YoinInitError(
      `Failed to initialize Yoin WASM engine after ${retries} attempts. ` +
        'Ensure the .wasm file is accessible and the browser supports WebAssembly.',
      lastError,
    );
  })();

  return initPromise;
}

/**
 * Check whether the WASM engine has been initialized.
 */
export function isYoinInitialized(): boolean {
  return initialized;
}
