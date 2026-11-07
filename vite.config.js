import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the whole-body explorer and the shoulder walkthrough.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        shoulder: resolve(import.meta.dirname, 'shoulder/index.html'),
      },
    },
  },
});
