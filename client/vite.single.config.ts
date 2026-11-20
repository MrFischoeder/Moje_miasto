// Wersja jednoplikowa: cała gra (kod, three.js, czcionki) w jednym pliku HTML,
// który otwiera się dwuklikiem, bez serwera i bez internetu.
import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: '../dist-single', emptyOutDir: true, assetsInlineLimit: 100_000_000 },
}));
