import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// A fingerprint of the model files, added to their URLs, so a browser that cached older model
// files (they are cached for a day) downloads the new ones after an update.
const modelsDir = resolve(import.meta.dirname, 'public/models');
const hash = createHash('sha1');
for (const f of readdirSync(modelsDir).sort()) hash.update(f).update(readFileSync(resolve(modelsDir, f)));
const MODELS_VERSION = hash.digest('hex').slice(0, 10);

// Two pages: the whole-body explorer and the shoulder walkthrough.
export default defineConfig({
  define: { __MODELS_VERSION__: JSON.stringify(MODELS_VERSION) },
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
