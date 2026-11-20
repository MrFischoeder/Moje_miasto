// Przycinanie geometrii do kafelków.
import type { XZ } from '../world/collision';
import { TILE_SIZE } from './types';

/** Sutherland–Hodgman: pierścień przycięty do prostokąta [x0,x1]×[z0,z1]. */
export function clipRing(ring: XZ[], x0: number, z0: number, x1: number, z1: number): XZ[] {
  let out = ring;
  const edges: [(p: XZ) => boolean, (a: XZ, b: XZ) => XZ][] = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= z0, (a, b) => [a[0] + (b[0] - a[0]) * (z0 - a[1]) / (b[1] - a[1]), z0]],
    [p => p[1] <= z1, (a, b) => [a[0] + (b[0] - a[0]) * (z1 - a[1]) / (b[1] - a[1]), z1]],
  ];
  for (const [inside, cut] of edges) {
    const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length], ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); } else if (pi) out.push(cut(prev, cur));
    }
  }
  return out;
}

export const ringArea = (r: XZ[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; };

/** Zakres kafelków obejmujących punkty. */
export function tileRange(pts: XZ[]): [number, number, number, number] {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
  return [Math.floor(a / TILE_SIZE), Math.floor(c / TILE_SIZE), Math.floor(b / TILE_SIZE), Math.floor(d / TILE_SIZE)];
}

/**
 * Dzieli łamaną na kawałki według kafelka środka każdego odcinka.
 * Sąsiednie kawałki dzielą wierzchołek graniczny. Zwraca [tx, ty, indeks pierwszego wierzchołka, indeks ostatniego].
 */
export function splitPolyline(pts: XZ[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const tx = Math.floor((pts[i][0] + pts[i + 1][0]) / 2 / TILE_SIZE), ty = Math.floor((pts[i][1] + pts[i + 1][1]) / 2 / TILE_SIZE);
    const last = out[out.length - 1];
    if (last && last[0] === tx && last[1] === ty) last[3] = i + 1; else out.push([tx, ty, i, i + 1]);
  }
  return out;
}
