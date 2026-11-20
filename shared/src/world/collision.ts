// Indeksy przestrzenne wielokątów (budynki, woda, pomosty) na siatce 40 m z testem punkt-w-wielokącie.
// Wielokąty mogą mieć dziury (dziedzińce) i należeć do kafelka, żeby dało się je zwolnić.
import { CELL, cellKey } from './grid';

export type XZ = [number, number];
export interface IndexedPoly {
  poly: XZ[]; holes?: XZ[][];
  a: number; b: number; c: number; d: number;
  /** wysokość dachu (budynki) */
  h: number;
  tile?: string;
}
/** zgodność wsteczna */
export type BuildingPoly = IndexedPoly;

export function pip(poly: XZ[], x: number, z: number): boolean {
  let s = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s;
  }
  return s;
}

const inside = (p: IndexedPoly, x: number, z: number) => x >= p.a && x <= p.b && z >= p.c && z <= p.d && pip(p.poly, x, z) && !(p.holes && p.holes.some(h => pip(h, x, z)));

export class PolyIndex {
  polys: IndexedPoly[] = [];
  grid = new Map<string, IndexedPoly[]>();
  private byTile = new Map<string, IndexedPoly[]>();

  add(pts: XZ[], h = 0, holes?: XZ[][], tile?: string): IndexedPoly {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    const q: IndexedPoly = { poly: pts, a, b, c, d, h }; if (holes && holes.length) q.holes = holes; if (tile) q.tile = tile;
    this.polys.push(q);
    if (tile) { let l = this.byTile.get(tile); if (!l) this.byTile.set(tile, l = []); l.push(q); }
    for (let i = Math.floor(a / CELL); i <= Math.floor(b / CELL); i++) for (let j = Math.floor(c / CELL); j <= Math.floor(d / CELL); j++) {
      const k = i + ',' + j; let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(q);
    }
    return q;
  }

  /** Usuwa wszystkie wielokąty kafelka. */
  removeTile(tile: string): void {
    const l = this.byTile.get(tile); if (!l) return; this.byTile.delete(tile);
    const gone = new Set(l);
    this.polys = this.polys.filter(p => !gone.has(p));
    for (const q of l) for (let i = Math.floor(q.a / CELL); i <= Math.floor(q.b / CELL); i++) for (let j = Math.floor(q.c / CELL); j <= Math.floor(q.d / CELL); j++) {
      const k = i + ',' + j, c = this.grid.get(k); if (!c) continue;
      const f = c.filter(p => !gone.has(p)); if (f.length) this.grid.set(k, f); else this.grid.delete(k);
    }
  }

  /** Wielokąty zawierające punkt. */
  containing(x: number, z: number): IndexedPoly[] {
    const l = this.grid.get(cellKey(x, z)); if (!l) return [];
    return l.filter(p => inside(p, x, z));
  }

  hit(x: number, z: number): boolean {
    const l = this.grid.get(cellKey(x, z)); if (!l) return false;
    for (const p of l) if (inside(p, x, z)) return true;
    return false;
  }

  /** Najwyższe h wielokątów zawierających punkt (def, gdy żaden). */
  top(x: number, z: number, def = 0): number {
    const l = this.grid.get(cellKey(x, z)); let t = def;
    if (l) for (const p of l) if (p.h > t && inside(p, x, z)) t = p.h;
    return t;
  }
}

/** Budynki stojące na gruncie (przeszkody). */
export class BuildingIndex extends PolyIndex {}

export const CAR_PTS: XZ[] = [[1, 2.3], [-1, 2.3], [1, -2.3], [-1, -2.3], [1, 0], [-1, 0]];
