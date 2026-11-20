import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { port: 5173, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
