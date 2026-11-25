// Import NMT (numeryczny model terenu, np. GUGiK 1 m z LiDAR) do kafli terenu gry (MMT2).
// Rastry w układzie PL-1992 (EPSG:2180): ESRI ASCII Grid (.asc), XYZ (.xyz/.txt), GeoTIFF (osobno, w CLI).
// Kolejność osi bywa różna (X = wschodnia albo X = północna, jak w polskiej geodezji): rozpoznawana automatycznie
// po odległości od środka miasta.
import { fromPL1992, toPL1992 } from '../../shared/src/data/pl1992';
import { DemTile } from '../../shared/src/world/terrain';

/** Raster: siatka wartości od lewego górnego rogu; osie (a, b) = (E, N) albo (N, E) gdy swap. */
export interface Raster {
  /** pierwsza oś: początek (środek lewej kolumny), druga oś: środek górnego wiersza */
  a0: number; b1: number; step: number; na: number; nb: number; d: Float32Array; swap: boolean;
  /** zasięg w PL-1992: E0, N0, E1, N1 */
  bbox: [number, number, number, number];
}

const near = (a: number, b: number) => Math.abs(a - b) < 80000;
/** Czy pierwsza oś pliku to współrzędna północna (gdy dane leżą w mieście tylko po zamianie osi). */
export function axesSwapped(x: number, y: number, center: [number, number]): boolean {
  const [E, N] = center;
  if (near(x, E) && near(y, N)) return false;
  if (near(x, N) && near(y, E)) return true;
  throw new Error(`Raster (${x.toFixed(0)}, ${y.toFixed(0)}) nie leży w pobliżu miasta (E ${E.toFixed(0)}, N ${N.toFixed(0)}) w żadnej kolejności osi. Czy to PL-1992 (EPSG:2180)?`);
}

function finish(r: Omit<Raster, 'bbox'>): Raster {
  const a1 = r.a0 + (r.na - 1) * r.step, b0 = r.b1 - (r.nb - 1) * r.step;
  const bbox: [number, number, number, number] = r.swap ? [b0, r.a0, r.b1, a1] : [r.a0, b0, a1, r.b1];
  return { ...r, bbox };
}

/** ESRI ASCII Grid. */
export function parseAsc(text: string, center: [number, number]): Raster {
  const lines = text.split(/\r?\n/), H: Record<string, number> = {}; let i = 0;
  for (; i < lines.length; i++) { const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/); if (!m) break; H[m[1].toLowerCase()] = +m[2]; }
  const na = H.ncols, nb = H.nrows, step = H.cellsize, nod = H.nodata_value ?? -9999;
  if (!na || !nb || !step) throw new Error('Nieprawidłowy nagłówek ASC');
  const a0 = H.xllcenter ?? H.xllcorner + step / 2, b0 = H.yllcenter ?? H.yllcorner + step / 2, b1 = b0 + (nb - 1) * step;
  const d = new Float32Array(na * nb); let k = 0;
  for (; i < lines.length && k < d.length; i++) for (const v of lines[i].trim().split(/\s+/)) { if (v === '') continue; const f = +v; d[k++] = f === nod || !Number.isFinite(f) ? NaN : f; }
  return finish({ a0, b1, step, na, nb, d, swap: axesSwapped(a0, b0, center) });
}

/** Tekst XYZ (regularna siatka punktów „X Y Z”). */
export function parseXyz(text: string, center: [number, number]): Raster {
  const pts: number[] = [];
  for (const line of text.split(/\r?\n/)) { const p = line.trim().split(/[\s,;]+/); if (p.length < 3) continue; const x = +p[0], y = +p[1], z = +p[2]; if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) pts.push(x, y, z); }
  if (!pts.length) throw new Error('Pusty plik XYZ');
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, step = Infinity;
  for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); if (i) { const dx = Math.abs(pts[i] - pts[i - 3]); if (dx > 1e-6) step = Math.min(step, dx); } }
  const na = Math.round((x1 - x0) / step) + 1, nb = Math.round((y1 - y0) / step) + 1, d = new Float32Array(na * nb).fill(NaN);
  for (let i = 0; i < pts.length; i += 3) d[Math.round((y1 - pts[i + 1]) / step) * na + Math.round((pts[i] - x0) / step)] = pts[i + 2];
  return finish({ a0: x0, b1: y1, step, na, nb, d, swap: axesSwapped(x0, y0, center) });
}

/** Wartość rastra w punkcie PL-1992 (dwuliniowo); NaN poza zasięgiem / bez danych. */
export function sampleRaster(r: Raster, E: number, N: number): number {
  const [a, b] = r.swap ? [N, E] : [E, N];
  let fa = (a - r.a0) / r.step, fb = (r.b1 - b) / r.step;
  // do 1,5 komórki poza skrajnymi środkami: wartość z krawędzi (styki arkuszy bez szczelin)
  if (fa < -1.5 || fb < -1.5 || fa > r.na - 1 + 1.5 || fb > r.nb - 1 + 1.5) return NaN;
  fa = Math.max(0, Math.min(r.na - 1, fa)); fb = Math.max(0, Math.min(r.nb - 1, fb));
  const i = Math.max(0, Math.min(r.na - 2, Math.floor(fa))), j = Math.max(0, Math.min(r.nb - 2, Math.floor(fb))), u = fa - i, w = fb - j, k = j * r.na + i, d = r.d;
  if (r.na < 2 || r.nb < 2) return d[0];
  const v = (d[k] * (1 - u) + d[k + 1] * u) * (1 - w) + (d[k + r.na] * (1 - u) + d[k + r.na + 1] * u) * w;
  if (!Number.isNaN(v)) return v;
  // brak danych w części sąsiedztwa: średnia z dostępnych narożników
  let s = 0, c = 0; for (const q of [d[k], d[k + 1], d[k + r.na], d[k + r.na + 1]]) if (!Number.isNaN(q)) { s += q; c++; }
  return c ? s / c : NaN;
}

/** Odwrotność projekcji gry (lokalna, równoodległościowa wokół początku miasta). */
export function gameToLatLon(o: [number, number], x: number, z: number): [number, number] {
  const kx = Math.cos(o[0] * Math.PI / 180) * 111320, ky = 110540; return [o[0] - z / ky, o[1] + x / kx];
}

export interface RasterRef { bbox: [number, number, number, number]; load(): Promise<Raster> }

/**
 * Kafel terenu gry (500 m, krok step) z rastrów NMT. Wysokości względem ref [m n.p.m.].
 * Punkty bez danych uzupełnia fill (np. dotychczasowy model zgrubny, też względem ref); zwraca null, gdy pokrycie < minCover.
 */
export async function buildDemTile(o: [number, number], tx: number, ty: number, step: number, ref: number, rasters: RasterRef[],
  cache: Map<RasterRef, Promise<Raster>>, fill: ((x: number, z: number) => number) | null, minCover = .5): Promise<{ tile: DemTile; cover: number } | null> {
  const n = Math.round(500 / step) + 1, x0 = tx * 500, z0 = ty * 500;
  // rastry nachodzące na kafel (zasięg kafla w PL-1992 z czterech narożników)
  let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
  for (const [x, z] of [[x0, z0], [x0 + 500, z0], [x0, z0 + 500], [x0 + 500, z0 + 500]]) { const [la, lo] = gameToLatLon(o, x, z), [E, N] = toPL1992(la, lo); E0 = Math.min(E0, E); E1 = Math.max(E1, E); N0 = Math.min(N0, N); N1 = Math.max(N1, N); }
  const hits = rasters.filter(r => r.bbox[0] <= E1 + 2 && r.bbox[2] >= E0 - 2 && r.bbox[1] <= N1 + 2 && r.bbox[3] >= N0 - 2);
  if (!hits.length) return null;
  const loaded: Raster[] = [];
  for (const r of hits) { let p = cache.get(r); if (!p) cache.set(r, p = r.load()); loaded.push(await p); }
  const h = new Float32Array(n * n); let have = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * step, z = z0 + j * step, [la, lo] = gameToLatLon(o, x, z), [E, N] = toPL1992(la, lo);
    let v = NaN; for (const r of loaded) { v = sampleRaster(r, E, N); if (!Number.isNaN(v)) break; }
    if (Number.isNaN(v)) h[j * n + i] = fill ? fill(x, z) : NaN; else { h[j * n + i] = v - ref; have++; }
  }
  const cover = have / (n * n);
  if (cover < minCover) return null;
  return { tile: new DemTile(tx, ty, step, n, ref, h), cover };
}

export { fromPL1992, toPL1992 };
