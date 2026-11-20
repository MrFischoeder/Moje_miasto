// Model terenu z Copernicus DEM GLO-30 (AWS Open Data) dla obszaru metra miasta.
// Copernicus to model powierzchni (z budynkami i drzewami), więc wygładzamy go otwarciem
// morfologicznym (min, potem max w oknie ~100 m) i rozmyciem: zostaje ukształtowanie terenu.
//   npm run fetch-dem -- --city warszawa [--step 30]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fromFile } from 'geotiff';
import { CITIES } from '@miasto/shared/data/cities';
import { makeProj } from '@miasto/shared/data/projection';
import { Terrain } from '@miasto/shared/world/terrain';
import { args, cityArg, ensureProxyEnv, ROOT, unproj } from './lib/common';

ensureProxyEnv();
const a = args(), key = cityArg(a), city = CITIES[key], proj = makeProj(city.o), step = +(a.step || 30);
const pts = city.st.map(s => proj(s[1], s[2])), M = 2500;
const x0 = Math.floor((Math.min(...pts.map(p => p[0])) - M) / step) * step, z0 = Math.floor((Math.min(...pts.map(p => p[1])) - M) / step) * step;
const nx = Math.ceil((Math.max(...pts.map(p => p[0])) + M - x0) / step) + 1, nz = Math.ceil((Math.max(...pts.map(p => p[1])) + M - z0) / step) + 1;
const [la1, lo0] = unproj(city.o, x0, z0), [la0, lo1] = unproj(city.o, x0 + nx * step, z0 + nz * step);
console.log(`${city.name}: siatka ${nx} × ${nz} co ${step} m, ${la0.toFixed(3)}–${la1.toFixed(3)} N, ${lo0.toFixed(3)}–${lo1.toFixed(3)} E`);

// kafelki 1° Copernicus
const dir = join(ROOT, '.cache/dem'); mkdirSync(dir, { recursive: true });
const name = (lat: number, lon: number) => `Copernicus_DSM_COG_10_${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_00_${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
type R = { lat: number; lon: number; w: number; h: number; d: Float32Array | Int16Array | Float64Array };
const rasters: R[] = [];
for (let lat = Math.floor(la0); lat <= Math.floor(la1); lat++) for (let lon = Math.floor(lo0); lon <= Math.floor(lo1); lon++) {
  const n = name(lat, lon), f = join(dir, n + '.tif');
  if (!existsSync(f)) {
    console.log(`pobieram ${n}…`);
    const res = await fetch(`https://copernicus-dem-30m.s3.amazonaws.com/${n}/${n}.tif`);
    if (!res.ok) { console.log(`  brak (${res.status}) – pewnie morze`); continue; }
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const im = await (await fromFile(f)).getImage(), [d] = await im.readRasters() as unknown as [R['d']];
  rasters.push({ lat, lon, w: im.getWidth(), h: im.getHeight(), d });
}
const sample = (lat: number, lon: number) => {
  const r = rasters.find(r => lat >= r.lat && lat < r.lat + 1 && lon >= r.lon && lon < r.lon + 1); if (!r) return 0;
  const fx = (lon - r.lon) * r.w - .5, fy = (r.lat + 1 - lat) * r.h - .5, i = Math.max(0, Math.min(r.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(r.h - 2, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j)), k = j * r.w + i;
  return (r.d[k] * (1 - u) + r.d[k + 1] * u) * (1 - v) + (r.d[k + r.w] * (1 - u) + r.d[k + r.w + 1] * u) * v;
};
let h = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const [la, lo] = unproj(city.o, x0 + i * step, z0 + j * step); h[j * nx + i] = sample(la, lo); }

// filtry: min / max (rozdzielne) i rozmycie pudełkowe
const pass = (src: Float32Array, r: number, f: (a: number, b: number) => number, init: number) => {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let m = init; for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) m = f(m, src[j * nx + k]); tmp[j * nx + i] = m; }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let m = init; for (let k = Math.max(0, j - r); k <= Math.min(nz - 1, j + r); k++) m = f(m, tmp[k * nx + i]); out[j * nx + i] = m; }
  return out;
};
const blur = (src: Float32Array, r: number) => {
  const out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0, c = 0; for (let b = Math.max(0, j - r); b <= Math.min(nz - 1, j + r); b++) for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) { s += src[b * nx + k]; c++; }
    out[j * nx + i] = s / c;
  }
  return out;
};
const R = Math.max(1, Math.round(+(a.window || 150) / step)); // promień okna: usuwa bryły węższe niż ~2R+1 komórek
h = pass(pass(h, R, Math.min, Infinity), R, Math.max, -Infinity);
h = blur(blur(blur(h, 2), 2), 2);
const T0 = new Terrain(x0, z0, step, nx, nz, 0, h), ref = Math.round(T0.height(0, 0) * 10) / 10;
for (let i = 0; i < h.length; i++) h[i] -= ref;
const T = new Terrain(x0, z0, step, nx, nz, ref, h);
const outDir = join(ROOT, 'client/public/terrain'); mkdirSync(outDir, { recursive: true });
const gz = gzipSync(Buffer.from(T.encode()), { level: 9 }); writeFileSync(join(outDir, `${key}.bin.gz`), gz);
let lo = Infinity, hi = -Infinity; for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(`odniesienie ${ref} m n.p.m., zakres ${lo.toFixed(1)}…${hi.toFixed(1)} m, plik ${(gz.length / 1e6).toFixed(2)} MB`);
if (a.png) {
  // podgląd: wysokości w odcieniach szarości (PGM)
  const px = Buffer.alloc(nx * nz); for (let i = 0; i < h.length; i++) px[i] = Math.round((h[i] - lo) / (hi - lo) * 255);
  writeFileSync(a.png, Buffer.concat([Buffer.from(`P5 ${nx} ${nz} 255\n`), px])); console.log('podgląd:', a.png);
}
