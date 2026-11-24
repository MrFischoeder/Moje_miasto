// Lepszy teren z Copernicus DEM (model POWIERZCHNI, z budynkami i drzewami) bez nadmiernego wygładzania:
//  1. siatka 10 m z rastrów Copernicus (.cache/dem, pobrane przez fetch-dem),
//  2. maska z OSM (kafle pełne): budynki, lasy i zadrzewienia, woda — teren pod nimi uzupełniany z otwartych miejsc
//     (wypełnianie piramidą średnich), lekkie otwarcie (okno 50 m) usuwa pozostałe drzewa i małe obiekty,
//     wzgórza w parkach (np. Wzgórze Partyzantów) zostają,
//  3. lustro wody rzek i kanałów z pomiaru nad wodą (wygładzone wzdłuż wody), co najmniej 2,5 m poniżej brzegu,
//  4. zapis: model zgrubny (terrain/<miasto>.bin.gz, 30 m) i dokładne kafle 5 m (terrain/<miasto>/x_y.bin.gz)
//     dla kafli z wodą i Starego Miasta: bulwary z uskokiem przy linii wody.
// Gdy będą dane NMT z GUGiK (LiDAR 1 m), lepszy jest tools/nmt-import.ts.
//   npx tsx tools/dem-refine.ts --city wroclaw [--fine-step 5]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fromFile } from 'geotiff';
import { CITIES, type CityKey } from '../shared/src/data/cities';
import { makeProj } from '../shared/src/data/projection';
import { unprojPoint } from '../shared/src/data/grid';
import { DemTile, Terrain } from '../shared/src/world/terrain';
import type { TileData } from '../shared/src/tiles/types';

const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2), arg = (k: string, d: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const key = arg('city', 'wroclaw') as CityKey, city = CITIES[key], FSTEP = +arg('fine-step', '5'), S = 10;
const t0 = Date.now(), log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);

// ---------- obszar: kafle pełne ----------
const tdir = join(ROOT, 'client/public/tiles-pelne', key), files = readdirSync(tdir).filter(f => /^-?\d+_-?\d+\.json\.gz$/.test(f));
let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
for (const f of files) { const [x, y] = f.split('.')[0].split('_').map(Number); X0 = Math.min(X0, x * 500); Z0 = Math.min(Z0, y * 500); X1 = Math.max(X1, x * 500 + 500); Z1 = Math.max(Z1, y * 500 + 500); }
X0 -= 1000; Z0 -= 1000; X1 += 1000; Z1 += 1000;
const NX = Math.round((X1 - X0) / S) + 1, NZ = Math.round((Z1 - Z0) / S) + 1, N = NX * NZ;
log(`${city.name}: siatka ${NX} × ${NZ} co ${S} m (${files.length} kafli)`);

// ---------- Copernicus ----------
const dem = join(ROOT, '.cache/dem'), rasters: { lat: number; lon: number; w: number; h: number; d: ArrayLike<number> }[] = [];
for (const f of readdirSync(dem).filter(f => f.endsWith('.tif'))) {
  const m = f.match(/_N(\d+)_00_E(\d+)_00_DEM/); if (!m) continue;
  const im = await (await fromFile(join(dem, f))).getImage(), [d] = await im.readRasters() as unknown as [ArrayLike<number>];
  rasters.push({ lat: +m[1], lon: +m[2], w: im.getWidth(), h: im.getHeight(), d });
}
const sample = (lat: number, lon: number) => {
  const r = rasters.find(r => lat >= r.lat && lat < r.lat + 1 && lon >= r.lon && lon < r.lon + 1); if (!r) return NaN;
  const fx = (lon - r.lon) * r.w - .5, fy = (r.lat + 1 - lat) * r.h - .5, i = Math.max(0, Math.min(r.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(r.h - 2, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j)), k = j * r.w + i;
  return (r.d[k] * (1 - u) + r.d[k + 1] * u) * (1 - v) + (r.d[k + r.w] * (1 - u) + r.d[k + r.w + 1] * u) * v;
};
const dsm = new Float32Array(N);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const [la, lo] = unprojPoint(city.o, X0 + i * S, Z0 + j * S); dsm[j * NX + i] = sample(la, lo); }
{ let nan = 0, lo = Infinity, lk = 0; for (let k = 0; k < N; k++) { const v = dsm[k]; if (!Number.isFinite(v)) nan++; else if (v < lo) { lo = v; lk = k; } }
  log(`Copernicus: ${rasters.length} rastrów, brak danych ${nan}, minimum ${lo.toFixed(1)} m w x ${X0 + (lk % NX) * S}, z ${Z0 + Math.floor(lk / NX) * S}`); }

// ---------- maski z OSM ----------
const BLD = 1, TREE = 2, WATER = 4, mask = new Uint8Array(N);
const water: number[][][] = []; // wielokąty wody (z dziurami) do dokładnych kafli
function fill(rings: number[][], bit: number): void {
  let zmin = Infinity, zmax = -Infinity; for (const r of rings) for (let k = 1; k < r.length; k += 2) { zmin = Math.min(zmin, r[k]); zmax = Math.max(zmax, r[k]); }
  const j0 = Math.max(0, Math.ceil((zmin - Z0) / S)), j1 = Math.min(NZ - 1, Math.floor((zmax - Z0) / S));
  for (let j = j0; j <= j1; j++) {
    const z = Z0 + j * S, xs: number[] = [];
    for (const r of rings) for (let a = 0, n = r.length / 2; a < n; a++) { const b = (a + 1) % n, za = r[a * 2 + 1], zb = r[b * 2 + 1]; if ((za > z) !== (zb > z)) xs.push(r[a * 2] + (z - za) / (zb - za) * (r[b * 2] - r[a * 2])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil((xs[k] - X0) / S)), i1 = Math.min(NX - 1, Math.floor((xs[k + 1] - X0) / S)); for (let i = i0; i <= i1; i++) mask[j * NX + i] |= bit; }
  }
}
for (const f of files) {
  const t = JSON.parse(gunzipSync(readFileSync(join(tdir, f))).toString()) as TileData;
  for (const b of t.b) if (!b.part) fill([b.o], BLD); // obrys budynku
  for (const a of t.a) {
    if (a.k === 'forest') fill([a.o, ...(a.i ?? [])], TREE);
    else if (a.k === 'water') {
      fill([a.o, ...(a.i ?? [])], WATER);
      let A = 0; for (let k = 0, n = a.o.length / 2; k < n; k++) { const q = (k + 1) % n; A += a.o[k * 2] * a.o[q * 2 + 1] - a.o[q * 2] * a.o[k * 2 + 1]; }
      if (Math.abs(A / 2) > 4000) water.push([a.o, ...(a.i ?? [])]); // rzeki, kanały, duże zbiorniki: dokładna linia brzegu
    }
  }
}
// budynki poszerzone o jedną komórkę (DSM ma rozmyte krawędzie)
const grow = (bit: number) => { const m2 = mask.slice(); for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (mask[k] & bit) { m2[k - 1] |= bit; m2[k + 1] |= bit; m2[k - NX] |= bit; m2[k + NX] |= bit; } } mask.set(m2); };
grow(BLD); grow(TREE);
let nb = 0, nw = 0; for (const v of mask) { if (v & (BLD | TREE)) nb++; if (v & WATER) nw++; }
log(`maski: zabudowa/las ${(nb / N * 100).toFixed(0)}%, woda ${(nw / N * 100).toFixed(1)}% (wielokątów wody ${water.length})`);

// ---------- wypełnianie piramidą średnich (push-pull) ----------
function pushPull(val: Float32Array, ok: (k: number) => boolean): Float32Array {
  const levels: { w: number; h: number; v: Float32Array; c: Float32Array }[] = [];
  let w = NX, h = NZ, v = new Float32Array(N), c = new Float32Array(N);
  for (let k = 0; k < N; k++) if (ok(k) && Number.isFinite(val[k])) { v[k] = val[k]; c[k] = 1; }
  levels.push({ w, h, v, c });
  while (w > 1 || h > 1) {
    const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), v2 = new Float32Array(w2 * h2), c2 = new Float32Array(w2 * h2);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i, k2 = (j >> 1) * w2 + (i >> 1); v2[k2] += v[k] * c[k]; c2[k2] += c[k]; }
    for (let k = 0; k < v2.length; k++) { if (c2[k] > 0) v2[k] /= c2[k]; c2[k] = Math.min(1, c2[k]); }
    levels.push({ w: w2, h: h2, v: v2, c: c2 }); w = w2; h = h2; v = v2; c = c2;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) {
      const k = j * L.w + i; if (L.c[k] >= 1) continue;
      // dwuliniowo z poziomu wyżej
      const fx = Math.min(U.w - 1, Math.max(0, (i - .5) / 2)), fz = Math.min(U.h - 1, Math.max(0, (j - .5) / 2)), a = Math.floor(fx), b = Math.floor(fz), a1 = Math.min(U.w - 1, a + 1), b1 = Math.min(U.h - 1, b + 1), u = fx - a, t = fz - b;
      const up = (U.v[b * U.w + a] * (1 - u) + U.v[b * U.w + a1] * u) * (1 - t) + (U.v[b1 * U.w + a] * (1 - u) + U.v[b1 * U.w + a1] * u) * t;
      L.v[k] = L.v[k] * L.c[k] + up * (1 - L.c[k]); L.c[k] = 1;
    }
  }
  return levels[0].v;
}
const pass = (src: Float32Array, r: number, f: (a: number, b: number) => number, init: number) => {
  const tmp = new Float32Array(N), out = new Float32Array(N);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { let m = init; for (let k = Math.max(0, i - r); k <= Math.min(NX - 1, i + r); k++) m = f(m, src[j * NX + k]); tmp[j * NX + i] = m; }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { let m = init; for (let k = Math.max(0, j - r); k <= Math.min(NZ - 1, j + r); k++) m = f(m, tmp[k * NX + i]); out[j * NX + i] = m; }
  return out;
};
const blur = (src: Float32Array, r: number) => { const a = pass(src, r, (s, v) => s + v, 0), c = pass(new Float32Array(N).fill(1), r, (s, v) => s + v, 0); for (let k = 0; k < N; k++) a[k] /= c[k]; return a; }; // średnia z komórek w siatce (bez zaniżania brzegów)

// ląd: tylko otwarte miejsca, potem lekkie otwarcie (drzewa przy ulicach, małe obiekty) i rozmycie
let dry = pushPull(dsm, k => !(mask[k] & (BLD | TREE | WATER)));
// gęsta zabudowa: komórki 30 m Copernicus przy ulicach „łapią” dachy -> silniejsze otwarcie (okno 130 m);
// tereny otwarte i parki: słabe otwarcie (okno 50 m), więc wzgórza zostają
const bf = blur(Float32Array.from(mask, v => v & BLD ? 1 : 0), 5);
const dA = pass(pass(dry, 2, Math.min, Infinity), 2, Math.max, -Infinity), dB = pass(pass(dry, 6, Math.min, Infinity), 6, Math.max, -Infinity);
for (let k = 0; k < N; k++) { const t = Math.min(1, Math.max(0, (bf[k] - .15) / .25)); dry[k] = dA[k] * (1 - t) + dB[k] * t; }
dry = blur(blur(dry, 2), 2);
// punkty kontrolne: szczyty z OSM (natural=peak z wysokością, np. Wzgórze Partyzantów 132 m) — teren wokół
// szczytu łagodnie podniesiony / obniżony do podanej wysokości (promień ok. 70 m)
{
  const odir = join(ROOT, '.cache/osm', key), peaks: [number, number, number, string][] = [];
  if (existsSync(odir)) for (const f of readdirSync(odir).filter(f => /^-?\d+_-?\d+\.json$/.test(f))) {
    for (const e of (JSON.parse(readFileSync(join(odir, f), 'utf8')).elements ?? []) as { type: string; lat?: number; lon?: number; tags?: Record<string, string> }[]) {
      const ele = parseFloat((e.tags?.ele ?? '').replace(',', '.'));
      if (e.type === 'node' && e.tags?.natural === 'peak' && Number.isFinite(ele) && e.lat != null) { const [x, z] = makeProj(city.o)(e.lat, e.lon!); if (x > X0 && x < X1 && z > Z0 && z < Z1 && !peaks.some(p => p[0] === x && p[1] === z)) peaks.push([x, z, ele, e.tags.name ?? '']); }
    }
  }
  for (const [x, z, ele, name] of peaks) {
    const i0 = Math.round((x - X0) / S), j0 = Math.round((z - Z0) / S), cur = dry[j0 * NX + i0], d = ele - cur;
    if (Math.abs(d) < .5 || Math.abs(d) > 40) continue;
    const R = 70, r = Math.ceil(2 * R / S);
    for (let j = Math.max(0, j0 - r); j <= Math.min(NZ - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(NX - 1, i0 + r); i++) {
      const q = Math.hypot((i - i0) * S, (j - j0) * S) / R; if (q < 2) dry[j * NX + i] += d * Math.exp(-q * q * 1.4);
    }
    console.log(`  szczyt ${name || '(bez nazwy)'}: ${cur.toFixed(1)} -> ${ele} m`);
  }
}
{ let lo = Infinity, lk = 0; for (let k = 0; k < N; k++) if (dry[k] < lo) { lo = dry[k]; lk = k; } log(`ląd gotowy, minimum ${lo.toFixed(1)} w x ${X0 + (lk % NX) * S}, z ${Z0 + Math.floor(lk / NX) * S}`); }
// woda: pomiar nad wodą (minimum w oknie 30 m wśród komórek wody), wygładzenie, co najmniej 2,5 m poniżej brzegu
const wmin = pass(dsm.map((v, k) => mask[k] & WATER ? v : Infinity) as Float32Array, 8, Math.min, Infinity); // dolna obwiednia wzdłuż wody (okno ok. 170 m)
let wet = pushPull(wmin, k => !!(mask[k] & WATER) && Number.isFinite(wmin[k]) && wmin[k] < 1e9);
wet = blur(blur(blur(wet, 3), 3), 3);
for (let k = 0; k < N; k++) wet[k] = Math.min(wet[k], dry[k] - 2.5);
log('lustro wody gotowe');

// ---------- zapis: model zgrubny 30 m ----------
const pr = makeProj(city.o), [cx0, cz0] = pr(city.o[0], city.o[1]);
const at = (F: Float32Array, x: number, z: number) => {
  const fx = Math.max(0, Math.min(NX - 1.001, (x - X0) / S)), fz = Math.max(0, Math.min(NZ - 1.001, (z - Z0) / S)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * NX + i;
  return (F[k] * (1 - u) + F[k + 1] * u) * (1 - v) + (F[k + NX] * (1 - u) + F[k + NX + 1] * u) * v;
};
const isWater = (x: number, z: number) => { const i = Math.round((x - X0) / S), j = Math.round((z - Z0) / S); return i >= 0 && j >= 0 && i < NX && j < NZ && !!(mask[j * NX + i] & WATER); };
const CS = 30, cnx = Math.floor((X1 - X0) / CS) + 1, cnz = Math.floor((Z1 - Z0) / CS) + 1, ref = Math.round(at(dry, cx0, cz0) * 10) / 10;
const ch = new Float32Array(cnx * cnz);
for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) { const x = X0 + i * CS, z = Z0 + j * CS; ch[j * cnx + i] = (isWater(x, z) ? at(wet, x, z) : at(dry, x, z)) - ref; }
const T = new Terrain(X0, Z0, CS, cnx, cnz, ref, ch), outDir = join(ROOT, 'client/public/terrain');
writeFileSync(join(outDir, `${key}.bin.gz`), gzipSync(Buffer.from(T.encode()), { level: 9 }));
let lo = Infinity, hi = -Infinity; for (const v of ch) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
log(`model zgrubny: odniesienie ${ref} m n.p.m., zakres ${lo.toFixed(1)}…${hi.toFixed(1)} m`);

// ---------- dokładne kafle (woda: dokładna linia brzegu; Stare Miasto) ----------
const inside = (rings: number[][], x: number, z: number) => { let s = false; for (const r of rings) for (let a = 0, n = r.length / 2, b = n - 1; a < n; b = a++) { const xa = r[a * 2], za = r[a * 2 + 1], xb = r[b * 2], zb = r[b * 2 + 1]; if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) s = !s; } return s; };
const wbox = water.map(rs => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let k = 0; k < rs[0].length; k += 2) { a = Math.min(a, rs[0][k]); c = Math.max(c, rs[0][k]); b = Math.min(b, rs[0][k + 1]); d = Math.max(d, rs[0][k + 1]); } return [a, b, c, d]; });
const ST = city.stare ? pr(city.stare[0], city.stare[1]) : null;
const fdir = join(outDir, key); if (existsSync(fdir)) rmSync(fdir, { recursive: true }); mkdirSync(fdir, { recursive: true });
const made: [number, number][] = [], n = Math.round(500 / FSTEP) + 1;
for (const f of files) {
  const [tx, ty] = f.split('.')[0].split('_').map(Number), x0 = tx * 500, z0 = ty * 500;
  const ws = water.filter((_, i) => wbox[i][0] < x0 + 500 && wbox[i][2] > x0 && wbox[i][1] < z0 + 500 && wbox[i][3] > z0);
  const old = ST && Math.hypot(x0 + 250 - ST[0], z0 + 250 - ST[1]) < 700;
  if (!ws.length && !old) continue;
  const h = new Float32Array(n * n);
  // brzeg: udział wody w otoczeniu punktu (próbki 3 × 3), więc linia brzegu to równa skarpa, a nie schodki siatki
  const o = FSTEP * .45;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * FSTEP, z = z0 + j * FSTEP; let wf = 0;
    if (ws.length) for (const dx of [-o, 0, o]) for (const dz of [-o, 0, o]) if (ws.some(rs => inside(rs, x + dx, z + dz))) wf++;
    wf /= 9; h[j * n + i] = at(dry, x, z) * (1 - wf) + at(wet, x, z) * wf - ref;
  }
  writeFileSync(join(fdir, `${tx}_${ty}.bin.gz`), gzipSync(Buffer.from(new DemTile(tx, ty, FSTEP, n, ref, h).encode()), { level: 9 })); made.push([tx, ty]);
}
writeFileSync(join(fdir, 'index.json'), JSON.stringify({ v: 1, city: key, step: FSTEP, source: 'Copernicus DEM GLO-30 z maską OSM (budynki, lasy) i lustrem wody (tools/dem-refine.ts)', generated: new Date().toISOString(), tiles: made }));
log(`dokładne kafle (${FSTEP} m): ${made.length}`);
