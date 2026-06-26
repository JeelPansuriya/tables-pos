import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Native / dynamic-require modules used by the main process. These MUST stay
// external: bundling better-sqlite3 makes Rollup try to inline its .node binary
// (which it can't resolve at runtime), and electron-pos-printer/electron-updater
// rely on require() + native bits too. They're loaded from node_modules at
// runtime — electron-builder packages production deps automatically.
const mainExternals = [
  'better-sqlite3',
  'bindings',
  'electron-pos-printer',
  'electron-updater',
  'bcryptjs',
  '@supabase/supabase-js',
];

// Electron + React app. Vite handles renderer (src/), the electron plugin
// builds main + preload from electron/ into dist-electron/.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: mainExternals,
            },
          },
        },
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
