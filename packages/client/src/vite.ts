// packages/client/src/vite.ts
// ============================================================
// Yoin Vite Plugin
// ============================================================
//
// How to use:
//
//   import { defineConfig } from 'vite';
//   import { yoinViteConfig } from '@yoin/client/vite';
//
//   export default defineConfig({
//     ...yoinViteConfig(),
//   });
//
// ============================================================

import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import type { Plugin, ResolvedConfig } from 'vite';
import { existsSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================
// Internal: Custom plugin to serve WASM from node_modules
// ============================================================
//
// Problem: When Vite pre-bundles @yoin/core into .vite/deps/,
// the wasm-pack generated code does:
//   `new URL('core_bg.wasm', import.meta.url)`
// which resolves to /node_modules/.vite/deps/core_bg.wasm
// But that path doesn't exist, so Vite's SPA fallback returns
// index.html instead of the WASM file.
//
// Solution: Intercept requests for core_bg.wasm and serve the
// actual file from node_modules/@yoin/core/pkg-web/.
// ============================================================

function yoinWasmServePlugin(): Plugin {
  let wasmFilePath: string | undefined;

  return {
    name: 'yoin-wasm-serve',
    configResolved(config: ResolvedConfig) {
      // Search order matters! @yoin/client/dist always ships core_bg.wasm
      // (copied during build), so it's the most reliable source.
      // @yoin/core may or may not have it depending on how it was published.
      const candidates = [
        resolve(config.root, 'node_modules/@yoin/client/dist/core_bg.wasm'),
        resolve(config.root, 'node_modules/@yoin/core/pkg-web/core_bg.wasm'),
        resolve(config.root, 'node_modules/@yoin/core/core_bg.wasm'),
      ];
      wasmFilePath = candidates.find((p) => existsSync(p));
      if (wasmFilePath) {
        config.logger.info(`[yoin] WASM file found: ${wasmFilePath}`);
      } else {
        config.logger.warn(
          '[yoin] ⚠️ core_bg.wasm not found. Searched:\n' +
            candidates.map((c) => `  - ${c}`).join('\n') +
            '\nWASM loading will fail at runtime.',
        );
      }
    },
    configureServer(server) {
      // Middleware runs BEFORE Vite's default handling,
      // so we catch the .wasm request before the SPA fallback.
      server.middlewares.use((req, res, next) => {
        if (wasmFilePath && req.url && req.url.includes('core_bg.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(wasmFilePath).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

/**
 * Yoin Vite plug-in
 *
 * Automatically configure Vite plugins and server WASM middleware required for WASM loading.
 * 
 * @returns
 * 
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { yoinVitePlugin } from '@yoin/client/vite';
 * 
 * export default defineConfig({
 *   plugins: yoinVitePlugin(),
 * });
 * ```
 */
export function yoinVitePlugin(): Plugin[] {
  return [
    yoinWasmServePlugin(),
    wasm(),
    topLevelAwait(),
  ];
}

/**
 * Yoin Vite server configuration
 * 
 * @returns 
 * 
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { yoinVitePlugin, yoinViteServerConfig } from '@yoin/client/vite';
 * 
 * export default defineConfig({
 *   plugins: [yoinVitePlugin()],
 *   server: yoinViteServerConfig(),
 * });
 * ```
 */
export function yoinViteServerConfig() {
  return {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..'],
    },
  };
}

/**
 * Yoin Vite configuration
 * 
 * @returns 
 * 
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { yoinViteConfig } from '@yoin/client/vite';
 * 
 * export default defineConfig({
 *   ...yoinViteConfig(),
 * });
 * ```
 */
export function yoinViteConfig() {
  return {
    plugins: yoinVitePlugin(),
    server: yoinViteServerConfig(),
    optimizeDeps: {
      exclude: ['@yoin/core'],
    },
    assetsInclude: ['**/*.wasm'],
  };
}
