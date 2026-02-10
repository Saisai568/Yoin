// client/vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  server: {
    fs: {
      // 允許 Vite 存取上一層的 core/pkg (因為你的 WASM 在外面)
      allow: ['..']
    }
  }
});