import { defineConfig } from 'tsup';

export default defineConfig([
  // Main entry - core SDK
  {
    entry: {
      index: 'src/index.ts',
      react: 'src/react/index.tsx',
    },
    format: ['cjs', 'esm'],
    dts: {
      resolve: ['@yoin/core'],
    },
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: [
      'react',
      'react-dom',
    ],
    // @yoin/core JS glue code is bundled; the .wasm binary is shipped
    // separately in dist/ and loaded at runtime via initYoin().
    noExternal: ['@yoin/core'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
]);
