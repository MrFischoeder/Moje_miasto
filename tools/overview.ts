// Mapa przeglądowa miasta dla telefonu (cała mapa naraz): woda, zieleń, drogi wg klas, tory, większe budynki.
// Współrzędne w metrach układu gry, zaokrąglone, uproszczone. Wynik: client/public/overview/<miasto>.json(.gz)
//   npx tsx tools/overview.ts --city wroclaw
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { gunzipSync, gzipSync } from 'node:zlib';
import type { TileData } from '../shared/src/tiles/types';
const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2), city = argv[argv.indexOf('--city') + 1] || 'wroclaw';
const dir = join(ROOT, 'client/public/tiles', city);
type P = [number, number];
function dp(p: P[], eps: number): P[] {
  if (p.length < 3) return p; const keep = new Array(p.length).fill(false); keep[0] = keep[p.length - 1] = true; const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) { const [i, j] = st.pop()!; const [ax, az] = p[i], [bx, bz] = p[j], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9; let b = 0, bi = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((p[k][0] - ax) * dz - (p[k][1] - az) * dx) / L; if (d > b) { b = d; bi = k; } }
    if (b > eps) { keep[bi] = true; st.push([i, bi], [bi, j]); } }
  return p.filter((_, i) => keep[i]);
}
const pts = (f: number[]): P[] => { const o: P[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const flat = (p: P[]) => p.flatMap(([x, z]) => [Math.round(x), Math.round(z)]);
const area = (p: P[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a / 2); };
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary'], MID = ['tertiary', 'residential', 'living', 'pedestrian'];
const out = { v: 1, city, bbox: [Infinity, Infinity, -Infinity, -Infinity], water: [] as number[][], green: [] as number[][], major: [] as number[][], mid: [] as number[][], path: [] as number[][], rail: [] as number[][], tram: [] as number[][], bld: [] as number[][], names: [] as [string, number, number][] };
const named = new Map<string, P>();
for (const f of readdirSync(dir).filter(f => f.endsWith('.json.gz'))) {
  const t = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString()) as TileData, x0 = t.x * t.size, z0 = t.y * t.size;
  out.bbox = [Math.min(out.bbox[0], x0), Math.min(out.bbox[1], z0), Math.max(out.bbox[2], x0 + t.size), Math.max(out.bbox[3], z0 + t.size)];
  for (const a of t.a) { const p = dp(pts(a.o), 6); if (p.length < 3 || area(p) < 1500) continue; (a.k === 'water' ? out.water : ['park', 'forest', 'cemetery', 'pitch'].includes(a.k) ? out.green : null)?.push(flat(p)); }
  for (const r of t.r) {
    if (!MAJOR.includes(r.k) && !MID.includes(r.k)) continue; // bez ścieżek i dojazdów (lżejszy plik)
    const p = dp(pts(r.p), MAJOR.includes(r.k) ? 4 : 6); if (p.length < 2) continue;
    (MAJOR.includes(r.k) ? out.major : out.mid).push(flat(p));
    if (r.n && MAJOR.concat(['tertiary']).includes(r.k) && !named.has(r.n)) named.set(r.n, p[p.length >> 1]);
  }
  for (const l of t.l) { const p = dp(pts(l.p), 3); if (p.length >= 2) (l.k === 'tram' ? out.tram : out.rail).push(flat(p)); }
  for (const b of t.b) { if (b.part) continue; const p = pts(b.o); if (area(p) < 900) continue; out.bld.push(flat(dp(p, 3))); }
}
out.names = [...named].map(([n, [x, z]]) => [n, Math.round(x), Math.round(z)]);
const s = JSON.stringify(out); mkdirSync(join(ROOT, 'client/public/overview'), { recursive: true });
writeFileSync(join(ROOT, 'client/public/overview', city + '.json.gz'), gzipSync(Buffer.from(s), { level: 9 }));
console.log(`${city}: ${(s.length / 1e6).toFixed(1)} MB JSON, budynki ${out.bld.length}, drogi ${out.major.length + out.mid.length + out.path.length}, nazwy ${out.names.length}`);
