import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// wersja gry w menu: skrót commita i czas budowania (łatwo sprawdzić, czy przeglądarka ma najnowszą wersję)
const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return '?'; } })();
const built = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default defineConfig({
  define: { __VERSION__: JSON.stringify(`${commit} · ${built}`) },
  server: { port: 5173, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
