import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        streaming: resolve(__dirname, 'streaming.html'),
        sip: resolve(__dirname, 'sip.html'),
      },
    },
  },
  server: {
    port: 3000,
  },
});
