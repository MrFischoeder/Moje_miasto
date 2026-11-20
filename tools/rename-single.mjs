// Nadaje plikowi jednoplikowej wersji czytelną nazwę.
import { renameSync, statSync } from 'node:fs';
const src = new URL('../dist-single/index.html', import.meta.url), dst = new URL('../dist-single/moje-miasto.html', import.meta.url);
renameSync(src, dst);
console.log(`dist-single/moje-miasto.html (${(statSync(dst).size / 1024 / 1024).toFixed(1)} MB)`);
