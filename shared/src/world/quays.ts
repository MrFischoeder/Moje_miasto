// Nabrzeża (mury i pas bruku) z obrysów wody w kaflu: krawędzie z koroną (TileArea.qt, tools/lib/waterBanks.ts),
// normalna w stronę lądu. Wspólne dla rysowania (client tileView) i fizyki (pas bruku jako pomost, world.ts).
import { TILE_SIZE, type TileData } from '../tiles/types';

type XZ = [number, number];
/** wall = mur nabrzeża z brukiem (miasto); inaczej skarpa (brzeg poza zabudową) */
export interface QuaySeg { a: XZ; b: XZ; ta: number; tb: number; n: XZ; wl: number; wall: boolean }
/** szerokość pasa bruku od muru w głąb lądu [m] */
export const QUAY_W = 5.5;

const pip = (r: XZ[], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

export function quaySegments(t: TileData): QuaySeg[] {
  const out: QuaySeg[] = [], x0 = t.x * TILE_SIZE, z0 = t.y * TILE_SIZE, x1 = x0 + TILE_SIZE, z1 = z0 + TILE_SIZE, e = .05;
  const box = (p: XZ, q: XZ) => (Math.abs(p[0] - q[0]) < e && (Math.abs(p[0] - x0) < e || Math.abs(p[0] - x1) < e)) || (Math.abs(p[1] - q[1]) < e && (Math.abs(p[1] - z0) < e || Math.abs(p[1] - z1) < e));
  for (const a of t.a) {
    if (a.k !== 'water' || !a.qt || !a.qk || a.wl == null) continue;
    const rings = [a.o, ...(a.i ?? [])].map(f => { const r: XZ[] = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; });
    const wet = (x: number, z: number) => pip(rings[0], x, z) && !rings.slice(1).some(h => pip(h, x, z));
    rings.forEach((R, ri) => { const q = a.qt![ri], kk = a.qk![ri]; if (!q || !kk) return; for (let i = 0; i < R.length; i++) {
      const j = (i + 1) % R.length, p = R[i], r = R[j]; if (!kk[i] || !kk[j] || box(p, r)) continue;
      const dx = r[0] - p[0], dz = r[1] - p[1], L = Math.hypot(dx, dz); if (L < .2) continue;
      let n: XZ = [-dz / L, dx / L]; const m: XZ = [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2]; if (wet(m[0] + n[0] * .5, m[1] + n[1] * .5)) n = [-n[0], -n[1]];
      out.push({ a: p, b: r, ta: q[i], tb: q[j], n, wl: a.wl!, wall: kk[i] === 1 || kk[j] === 1 });
    } });
  }
  return out;
}
