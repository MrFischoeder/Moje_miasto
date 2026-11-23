// Import NMT z GUGiK (LiDAR, siatka 1 m, PL-1992) do terenu gry: kafle 500 m (MMT2) w client/public/terrain/<miasto>/
// i odświeżony model zgrubny (terrain/<miasto>.bin.gz), żeby na granicy dokładnych danych nie było uskoków.
//   npx tsx tools/nmt-import.ts --city warszawa --src /ścieżka/do/arkuszy [--step 2] [--min-cover 0.5] [--out katalog] [--no-coarse]
// Pliki: .asc (ESRI ASCII Grid), .xyz / .txt (punkty X Y Z), .tif / .tiff (GeoTIFF), także w podkatalogach.
// Dane: Główny Urząd Geodezji i Kartografii, numeryczny model terenu (udostępniany bezpłatnie, ustawa Pgik art. 40a).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CITIES } from '../shared/src/data/cities';
import { Terrain } from '../shared/src/world/terrain';
import type { TileIndex } from '../shared/src/tiles/types';
import { axesSwapped, buildDemTile, parseAsc, parseXyz, toPL1992, type Raster, type RasterRef } from './lib/nmt';

const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const key = (arg('city', 'warszawa') ?? 'warszawa') as keyof typeof CITIES, city = CITIES[key], src = arg('src');
const step = +(arg('step', '2') ?? 2), minCover = +(arg('min-cover', '0.5') ?? .5);
if (!city || !src || !existsSync(src)) { console.error('Użycie: npx tsx tools/nmt-import.ts --city warszawa --src <katalog z arkuszami NMT> [--step 2]'); process.exit(1); }
if (Math.abs(500 / step - Math.round(500 / step)) > 1e-9) { console.error('Krok musi dzielić 500 m (np. 1, 2, 2.5, 4, 5).'); process.exit(1); }
const center = toPL1992(city.o[0], city.o[1]);

// --- pliki źródłowe i ich zasięg ---
const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(asc|xyz|txt|tiff?)$/i.test(f)) files.push(p); } }; walk(src);
console.log(`${city.name}: ${files.length} plików NMT, środek miasta w PL-1992 E ${center[0].toFixed(0)}, N ${center[1].toFixed(0)}`);

async function readRaster(f: string): Promise<Raster> {
  if (/\.tiff?$/i.test(f)) {
    const { fromFile } = await import('geotiff'); const tif = await fromFile(f), img = await tif.getImage();
    const [x0, y0, x1, y1] = img.getBoundingBox(), w = img.getWidth(), h = img.getHeight(), step2 = (x1 - x0) / w, nod = img.getGDALNoData();
    const ras = await img.readRasters({ interleave: true }) as unknown as ArrayLike<number>, d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) { const v = ras[i]; d[i] = (nod != null && v === nod) || !Number.isFinite(v) || v < -1000 ? NaN : v; }
    const a0 = x0 + step2 / 2, b1 = y1 - step2 / 2, swap = axesSwapped(a0, y0, center);
    const a1 = a0 + (w - 1) * step2, b0 = b1 - (h - 1) * step2;
    return { a0, b1, step: step2, na: w, nb: h, d, swap, bbox: swap ? [b0, a0, b1, a1] : [a0, b0, a1, b1] };
  }
  const text = readFileSync(f, 'utf8');
  return /\.asc$/i.test(f) ? parseAsc(text, center) : parseXyz(text, center);
}
/** Zasięg pliku bez wczytywania całości (ASC: nagłówek; pozostałe: pełny odczyt raz). */
async function bboxOf(f: string): Promise<[number, number, number, number]> {
  if (/\.asc$/i.test(f)) {
    const head = readFileSync(f, { encoding: 'utf8' }).slice(0, 400), H: Record<string, number> = {};
    for (const l of head.split(/\r?\n/)) { const m = l.trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/); if (m) H[m[1].toLowerCase()] = +m[2]; }
    const s = H.cellsize, a0 = H.xllcenter ?? H.xllcorner + s / 2, b0 = H.yllcenter ?? H.yllcorner + s / 2, a1 = a0 + (H.ncols - 1) * s, b1 = b0 + (H.nrows - 1) * s;
    return axesSwapped(a0, b0, center) ? [b0, a0, b1, a1] : [a0, b0, a1, b1];
  }
  return (await readRaster(f)).bbox;
}
const refs: RasterRef[] = [];
for (const f of files) { try { refs.push({ bbox: await bboxOf(f), load: () => readRaster(f) }); } catch (e) { console.warn(`pomijam ${f}: ${(e as Error).message}`); } }
if (!refs.length) { console.error('Brak użytecznych plików.'); process.exit(1); }

// --- kafle mapy miasta i model zgrubny ---
const tiles = (JSON.parse(readFileSync(join(ROOT, 'client/public/tiles', key, 'index.json'), 'utf8')) as TileIndex).tiles.map(([x, y]) => [x, y] as [number, number]);
const tf = join(ROOT, 'client/public/terrain', `${key}.bin.gz`);
const coarse = existsSync(tf) ? (() => { const b = gunzipSync(readFileSync(tf)); return Terrain.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })() : null;
const ref = coarse?.ref ?? 100;
const out = arg('out') ?? join(ROOT, 'client/public/terrain', key), noCoarse = argv.includes('--no-coarse') || !!arg('out');
if (existsSync(out)) rmSync(out, { recursive: true }); mkdirSync(out, { recursive: true });

tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const cache = new Map<RasterRef, Promise<Raster>>(), made: [number, number][] = [], fine = new Map<string, import('../shared/src/world/terrain').DemTile>();
let n = 0; const t0 = Date.now();
for (const [x, y] of tiles) {
  const r = await buildDemTile(city.o, x, y, step, ref, refs, cache, coarse ? (px, pz) => coarse.coarse(px, pz) : null, minCover);
  while (cache.size > 24) cache.delete(cache.keys().next().value!); // pamięć: najwyżej 24 arkusze naraz
  if (++n % 25 === 0) console.log(`${n}/${tiles.length} kafli, ${made.length} z NMT, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (!r) continue;
  writeFileSync(join(out, `${x}_${y}.bin.gz`), gzipSync(Buffer.from(r.tile.encode()))); made.push([x, y]); fine.set(x + '_' + y, r.tile);
}
writeFileSync(join(out, 'index.json'), JSON.stringify({ v: 1, city: key, step, source: 'GUGiK, numeryczny model terenu (LiDAR, siatka 1 m), PL-1992 → układ gry',
  licence: 'Dane GUGiK udostępniane bezpłatnie (Pgik art. 40a); źródło: Główny Urząd Geodezji i Kartografii', generated: new Date().toISOString(), tiles: made }));
console.log(`zapisano ${made.length} kafli terenu (krok ${step} m) w ${out}`);

// --- model zgrubny: punkty pokryte NMT przyjmują wysokość z NMT (spójność na granicy) ---
if (coarse && fine.size && !noCoarse) {
  let upd = 0;
  for (let j = 0; j < coarse.nz; j++) for (let i = 0; i < coarse.nx; i++) {
    const x = coarse.x0 + i * coarse.step, z = coarse.z0 + j * coarse.step, t = fine.get(Math.floor(x / 500) + '_' + Math.floor(z / 500)); if (!t) continue;
    const v = t.sample(x, z); if (!Number.isNaN(v)) { coarse.h[j * coarse.nx + i] = v + t.ref - coarse.ref; upd++; }
  }
  writeFileSync(tf, gzipSync(Buffer.from(coarse.encode()))); console.log(`model zgrubny: ${upd} punktów z NMT`);
}
