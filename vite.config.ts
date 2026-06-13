import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Electron + React app. Vite handles renderer (src/), the electron plugin
// builds main + preload from electron/ into dist-electron/.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      // Native modules (better-sqlite3) must NOT be bundled by Vite — they
      // get loaded from node_modules at runtime. The renderer doesn't import
      // them; main does, via require.
      renderer: undefined,
    }),
  ],
  server: {
    port: 5174, // separate from the v1 app's 5173 so both can run side-by-side
  },
});
