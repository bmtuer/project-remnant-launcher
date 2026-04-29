import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // electron-vite's default externalizes every `dependencies` entry
    // in package.json — they get loaded from node_modules at runtime
    // instead of being inlined. We exclude two:
    //   - `yauzl`: directly used by gameUpdater.js's unzipBufferedWrites
    //     (replaces extract-zip; we bypass createWriteStream because
    //     Electron 33's asar-integrity hook blocks any open() of a path
    //     ending in `resources/app.asar` — the GAME's app.asar inside
    //     the staging dir trips the launcher's own integrity validator
    //     during unzip).
    //   - `extract-zip`: kept excluded so its transitive subgraph (incl
    //     `wrappy`, lost by electron-builder's prune walker on v1.0.8)
    //     gets inlined. Module is no longer imported but the bundle
    //     reference cost is negligible; remove on next dep cleanup.
    plugins: [externalizeDepsPlugin({ exclude: ['extract-zip', 'yauzl'] })],
    build: {
      rollupOptions: {
        input: 'src/main/index.js',
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: 'src/preload/index.js',
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
    plugins: [react()],
  },
});
