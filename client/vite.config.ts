// client/vite.config.ts
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: './',
  plugins: [
    wasm(),
    topLevelAwait(),
    react()
  ],
  build: {
    rollupOptions: {
      input: {
        // 使用 resolve 確保絕對路徑正確
        index: resolve(__dirname, 'index.html'),
        react: resolve(__dirname, 'react.html'),
      },
    },
  },
  server: {
   headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // 允許 Vite 存取上一層的 core/pkg (因為你的 WASM 在外面)
      allow: ['..']
    }
  }
});
// 這個配置允許我們同時開發 Vanilla 和 React 頁面，並且正確處理 WASM 模組的載入與跨域政策。