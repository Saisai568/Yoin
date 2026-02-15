import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry - core SDK
  {
    entry: {
      index: 'src/index.ts',
      react: 'src/react/index.tsx',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: [
      'react',
      'react-dom',
      // WASM modules are external - loaded at runtime
      '@yoin/core',
    ],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
]);
