// Kolizje z obrysami budynków: siatka 40 m i test punkt-w-wielokącie.
import { CELL, cellKey } from './grid';

export type XZ = [number, number];
export interface BuildingPoly { poly: XZ[]; a: number; b: number; c: number; d: number; h: number }

export function pip(poly: XZ[], x: number, z: number): boolean {
  let s = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s;
  }
  return s;
}

export class BuildingIndex {
  polys: BuildingPoly[] = [];
  grid = new Map<string, BuildingPoly[]>();

  /** Dodaje bryłę stojącą na gruncie (mh < 2) jako przeszkodę. */
  add(pts: XZ[], h: number): BuildingPoly {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    const q: BuildingPoly = { poly: pts, a, b, c, d, h }; this.polys.push(q);
    for (let i = Math.floor(a / CELL); i <= Math.floor(b / CELL); i++) for (let j = Math.floor(c / CELL); j <= Math.floor(d / CELL); j++) {
      const k = i + ',' + j; let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(q);
    }
    return q;
  }

  /** Czy punkt jest wewnątrz budynku. */
  hit(x: number, z: number): boolean {
    const l = this.grid.get(cellKey(x, z)); if (!l) return false;
    for (const p of l) if (x >= p.a && x <= p.b && z >= p.c && z <= p.d && pip(p.poly, x, z)) return true;
    return false;
  }

  /** Wysokość najwyższego dachu w punkcie (0 = grunt). */
  top(x: number, z: number): number {
    const l = this.grid.get(cellKey(x, z)); let t = 0;
    if (l) for (const p of l) if (p.h > t && x >= p.a && x <= p.b && z >= p.c && z <= p.d && pip(p.poly, x, z)) t = p.h;
    return t;
  }

  /** Kolizja auta: 6 punktów prostokąta. */
  carHit(x: number, z: number, yaw: number): boolean {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (const [a, b] of CAR_PTS) if (this.hit(x + rx * a + fx * b, z + rz * a + fz * b)) return true;
    return false;
  }

  /** Najbliższe wolne miejsce na auto (albo na pieszego, gdy point = true). */
  freeSpot(x: number, z: number, yaw: number, point = false): XZ {
    const ok = (a: number, b: number) => point ? !this.hit(a, b) : !this.carHit(a, b, yaw);
    if (ok(x, z)) return [x, z];
    for (let r = 2; r < 300; r += 2) for (let a = 0; a < 6.28; a += .4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return [px, pz]; }
    return [x, z];
  }
}

const CAR_PTS: XZ[] = [[1, 2.3], [-1, 2.3], [1, -2.3], [-1, -2.3], [1, 0], [-1, 0]];
