import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // electron-vite's default externalizes every `dependencies` entry
    // in package.json — they get loaded from node_modules at runtime
    // instead of being inlined. Overriding the plugin here to keep
    // `extract-zip` bundled (and its transitive deps with it) sidesteps
    // electron-builder's flaky prune step that lost `wrappy` on v1.0.8.
    // See electron-builder.yml `files:` comment for the full backstory.
    plugins: [externalizeDepsPlugin({ exclude: ['extract-zip'] })],
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
