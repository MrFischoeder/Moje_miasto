// Regiony chodzenia pod ziemią: pasy (początek, kierunek, długość, półszerokość, wysokość y0 -> y1).
import { CELL, cellKey } from './grid';
/** Powierzchnia: czy punkt jest zablokowany (budynek, woda poza mostem). */
export interface Surface {
  blocked(x: number, z: number, y?: number): boolean;
  /** wysokość powierzchni najbliższa y (grunt albo pomost mostu) */
  surfaceAt(x: number, z: number, y: number): number;
}

export type RegionKind = 'hall' | 'tunnel' | 'ramp' | 'corr' | 'stair' | 'room';
export interface RegionInfo { s?: number; l?: number; A?: string; B?: string; room?: boolean; /** wnętrze: id budynku, piętro, opis */ b?: number; f?: number; nm?: string }
export interface Region {
  id: number; kind: RegionKind;
  a: [number, number]; u: [number, number]; n: [number, number];
  len: number; hw: number; y0: number; y1: number; slope: boolean;
  /** komórki siatki (regiony dynamiczne, do usunięcia) */
  cells?: string[];
  /** s = indeks stacji, l = indeks linii */
  info: RegionInfo;
}
export interface Support { h: number; r: Region | null }

/** Regiony dynamiczne mają id DYN_BASE..DYN_BASE+DYN_N (mieści się w int16 migawki). */
export const DYN_BASE = 16384, DYN_N = 16000, DCELL = 8;

export class RegionIndex {
  list: Region[] = [];
  grid = new Map<string, Region[]>();
  /** regiony dynamiczne (wnętrza budynków): id od DYN_BASE, numeracja w kółko */
  readonly dyn = new Map<number, Region>();
  /** drobna siatka (DCELL) tylko dla regionów dynamicznych: wnętrza są gęste */
  readonly dgrid = new Map<string, Region[]>();
  private nextDyn = 0;

  get(id: number): Region | undefined { return id >= DYN_BASE ? this.dyn.get(id) : this.list[id]; }

  /** Region dynamiczny (gęsta rejestracja w siatce, da się usunąć). */
  addDyn(kind: RegionKind, ax: number, az: number, ux: number, uz: number, len: number, hw: number, y0: number, y1: number, info: RegionInfo): Region {
    let id = DYN_BASE + this.nextDyn; for (let i = 0; i < DYN_N && this.dyn.has(id); i++) { this.nextDyn = (this.nextDyn + 1) % DYN_N; id = DYN_BASE + this.nextDyn; }
    this.nextDyn = (this.nextDyn + 1) % DYN_N;
    const r: Region = { id, kind, a: [ax, az], u: [ux, uz], n: [-uz, ux], len, hw, y0, y1, info, slope: Math.abs(y1 - y0) > .01, cells: [] };
    this.dyn.set(id, r); const seen = new Set<string>();
    // wszystkie komórki prostokąta otaczającego (obrócony region może zahaczać o komórkę bez swojego narożnika)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of [0, len]) for (const sv of [-hw, hw]) { const x = ax + ux * t + r.n[0] * sv, z = az + uz * t + r.n[1] * sv; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / DCELL); i <= Math.floor(x1 / DCELL); i++) for (let j = Math.floor(z0 / DCELL); j <= Math.floor(z1 / DCELL); j++) {
      const k = i + ',' + j; if (seen.has(k)) continue; seen.add(k); r.cells!.push(k); let l = this.dgrid.get(k); if (!l) this.dgrid.set(k, l = []); l.push(r);
    }
    return r;
  }
  removeDyn(r: Region): void {
    if (!this.dyn.delete(r.id)) return;
    for (const k of r.cells ?? []) { const l = this.dgrid.get(k); if (!l) continue; const i = l.indexOf(r); if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); } if (!l.length) this.dgrid.delete(k); }
  }

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
  support(x: number, z: number, y: number, surface: Surface): Support | null {
    let best: Support | null = null, bd = 0.95, slope = false;
    const l = this.grid.get(cellKey(x, z)), dl = this.dyn.size ? this.dgrid.get(Math.floor(x / DCELL) + ',' + Math.floor(z / DCELL)) : undefined;
    for (const list of [l, dl]) if (list) for (const r of list) {
      const h = inReg(r, x, z); if (h == null) continue; const d = Math.abs(h - y); if (d > .95) continue;
      if ((r.slope && !slope) || ((r.slope === slope) && d < bd)) { best = { h, r }; bd = d; slope = r.slope; }
    }
    if (!best) { const g = surface.surfaceAt(x, z, y); if (y > g - 1.2 && !surface.blocked(x, z, y)) best = { h: g, r: null }; }
    return best;
  }
}

export function inReg(r: Region, x: number, z: number): number | null {
  const dx = x - r.a[0], dz = z - r.a[1], t = dx * r.u[0] + dz * r.u[1], s = dx * r.n[0] + dz * r.n[1];
  if (t < -0.05 || t > r.len + 0.05 || Math.abs(s) > r.hw) return null;
  return r.y0 + (r.y1 - r.y0) * Math.max(0, Math.min(1, t / r.len));
}
