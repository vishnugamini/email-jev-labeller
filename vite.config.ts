import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'extension',
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve('extension/popup.html'), background: resolve('extension/src/background.ts'), content: resolve('extension/src/content.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js' },
    },
  },
});
