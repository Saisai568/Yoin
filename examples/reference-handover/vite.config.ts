import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { yoinVitePlugin } from '@yoin/client/vite';

// This app deliberately imports its tooling from the packed @yoin/client
// dependency, not from the monorepo source tree.
export default defineConfig({
  plugins: [react(), ...yoinVitePlugin()],
  // vite-plugin-top-level-await emits modern syntax; Vite's default target
  // attempts an unsupported downlevel transform during production builds.
  build: { target: 'esnext' },
});
