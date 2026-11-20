// Regiony chodzenia pod ziemią: pasy (początek, kierunek, długość, półszerokość, wysokość y0 -> y1).
import { cellKey } from './grid';
import type { BuildingIndex } from './collision';

export type RegionKind = 'hall' | 'tunnel' | 'ramp' | 'corr' | 'stair' | 'room';
export interface RegionInfo { s?: number; l?: number; A?: string; B?: string; room?: boolean }
export interface Region {
  id: number; kind: RegionKind;
  a: [number, number]; u: [number, number]; n: [number, number];
  len: number; hw: number; y0: number; y1: number; slope: boolean;
  /** s = indeks stacji, l = indeks linii */
  info: RegionInfo;
}
export interface Support { h: number; r: Region | null }

export class RegionIndex {
  list: Region[] = [];
  grid = new Map<string, Region[]>();

  add(kind: RegionKind, ax: number, az: number, ux: number, uz: number, len: number, hw: number, y0: number, y1: number, info: RegionInfo): Region {
    const r: Region = { id: this.list.length, kind, a: [ax, az], u: [ux, uz], n: [-uz, ux], len, hw, y0, y1, info, slope: Math.abs(y1 - y0) > .01 };
    this.list.push(r); const seen = new Set<string>();
    for (let t = 0; t <= len + 5; t += 8) for (const s of [-hw, 0, hw]) {
      const tt = Math.min(t, len), k = cellKey(ax + ux * tt + r.n[0] * s, az + uz * tt + r.n[1] * s);
      if (!seen.has(k)) { seen.add(k); let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(r); }
    }
    return r;
  }

  /**
   * Podłoże pod punktem: region o wysokości najbliższej obecnej (tolerancja 0,95 m),
   * pochyłe mają pierwszeństwo; powierzchnia (y = 0 poza budynkami) też jest podłożem.
   * null = ściana.
   */
  support(x: number, z: number, y: number, buildings: BuildingIndex): Support | null {
    let best: Support | null = null, bd = 0.95, slope = false;
    const l = this.grid.get(cellKey(x, z));
    if (l) for (const r of l) {
      const h = inReg(r, x, z); if (h == null) continue; const d = Math.abs(h - y); if (d > .95) continue;
      if ((r.slope && !slope) || ((r.slope === slope) && d < bd)) { best = { h, r }; bd = d; slope = r.slope; }
    }
    if (!best && y > -1.2 && !buildings.hit(x, z)) best = { h: 0, r: null };
    return best;
  }
}

export function inReg(r: Region, x: number, z: number): number | null {
  const dx = x - r.a[0], dz = z - r.a[1], t = dx * r.u[0] + dz * r.u[1], s = dx * r.n[0] + dz * r.n[1];
  if (t < -0.05 || t > r.len + 0.05 || Math.abs(s) > r.hw) return null;
  return r.y0 + (r.y1 - r.y0) * Math.max(0, Math.min(1, t / r.len));
}
