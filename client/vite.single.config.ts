// Wersja jednoplikowa: cała gra (kod, three.js, czcionki) w jednym pliku HTML,
// który otwiera się dwuklikiem, bez serwera i bez internetu.
import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  resolve: { alias: [{ find: /^\.\/embedded$/, replacement: fileURLToPath(new URL('./src/world/embedded.single.ts', import.meta.url)) }] },
  build: { outDir: '../dist-single', emptyOutDir: true, assetsInlineLimit: 100_000_000 },
}));
