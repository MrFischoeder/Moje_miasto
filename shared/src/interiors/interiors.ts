// Wnętrza budynków wokół graczy: plan budynku powstaje, gdy ktoś podejdzie (R_ON), piętra składane
// leniwie (parter + piętra wokół gracza w budynku), regiony chodzenia i przeszkody mebli dodawane do świata.
// Serwer i klient robią to samo z tych samych danych, więc wnętrza są identyczne bez przesyłania przez sieć.
import { tileKey, type TileBuilding, type TileData } from '../tiles/types';
import { partsCover } from '../tiles/parts';
import { DCELL, type Region, type RegionIndex } from '../world/regions';
import { cellKey, CELL } from '../world/grid';
import { nOf, toLocal, toWorld } from './geom';
import { buildLevel, hasInterior, makePlan, OBST_PAD, type DoorDef, type Item, type Level, type Plan, type PlanWorld } from './plan';

export const R_ON = 45, R_OFF = 70;

interface Cand { b: TileBuilding; t: TileData; a: number; b2: number; c: number; d: number }
export interface LiveLevel { level: Level; regions: Region[]; obst: { item: Item; cells: string[] }[]; dcells: { d: DoorDef; cells: string[] }[] }
export interface Live { plan: Plan; levels: Map<number, LiveLevel>; box: [number, number, number, number] }
interface Obst { item: Item; live: Live }
interface DoorRef { d: DoorDef; live: Live }
/** pół-grubość zamkniętego skrzydła jako przeszkody [m] (więcej niż krok pieszego w jednym takcie) */
const LEAF = .22;
/** Domyślny stan drzwi (bez zapisanej zmiany): większość zamknięta, ok. 15% otwartych (stałe dla danych drzwi). */
export function doorOpenByDefault(id: string): boolean { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) < 150; }

export interface InteriorsHost extends PlanWorld { readonly regions: RegionIndex }

export class Interiors {
  readonly live = new Map<number, Live>();
  /** rośnie przy każdej zmianie (widok klienta przebudowuje się po zmianie) */
  version = 0;
  /** wnętrza włączone (ustawienie gry; wyłączone = budynki bez wnętrz, mniejsze obciążenie) */
  enabled = true;
  /** czas składania ostatnich pięter [ms] (pomiar) */
  readonly stats = { plans: 0, levels: 0, planMs: 0, levelMs: 0, maxLevelMs: 0 };
  private plans = new Map<number, Plan | null>();
  private grid = new Map<string, Cand[]>();
  private byTile = new Map<string, Cand[]>();
  private obst = new Map<string, Obst[]>();
  private dgrid = new Map<string, DoorRef[]>();
  /** stan drzwi zmieniony przez graczy (id -> otwarte); reszta: doorOpenByDefault */
  private doorState = new Map<string, boolean>();
  /** rośnie przy zmianie stanu drzwi (widok skrzydeł) */
  doorVersion = 0;

  constructor(private host: InteriorsHost) {}

  addTile(t: TileData): void {
    const k = tileKey(t.x, t.y); if (this.byTile.has(k)) return; const list: Cand[] = [];
    const covered = partsCover(t); // budynek zastąpiony częściami (inna wysokość): bez wnętrza, żeby nie wystawało ponad dach
    // budynek z bramą przejazdową (droga bp przez obrys): na razie bez wnętrza (plan nie omija przejazdu)
    const passPts: number[] = []; for (const r of t.r) if (r.bp) for (let i = 0; i + 3 < r.p.length; i += 2) for (const q of [.25, .5, .75]) passPts.push(r.p[i] + (r.p[i + 2] - r.p[i]) * q, r.p[i + 1] + (r.p[i + 3] - r.p[i + 1]) * q);
    const inOutline = (o: number[], x: number, z: number) => { let s = false; for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) { const xi = o[i], zi = o[i + 1], xj = o[j], zj = o[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; } return s; };
    const hasPassage = (o: number[]) => { for (let i = 0; i < passPts.length; i += 2) if (inOutline(o, passPts[i], passPts[i + 1])) return true; return false; };
    for (const b of t.b) {
      if (b.part || b.mh >= 2 || covered(b.o) || !hasInterior(b, t) || hasPassage(b.o)) continue;
      let a = Infinity, b2 = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < b.o.length; i += 2) { a = Math.min(a, b.o[i]); b2 = Math.max(b2, b.o[i]); c = Math.min(c, b.o[i + 1]); d = Math.max(d, b.o[i + 1]); }
      const cand: Cand = { b, t, a, b2, c, d }; list.push(cand);
      for (let i = Math.floor(a / CELL); i <= Math.floor(b2 / CELL); i++) for (let j = Math.floor(c / CELL); j <= Math.floor(d / CELL); j++) {
        const key = i + ',' + j; let l = this.grid.get(key); if (!l) this.grid.set(key, l = []); l.push(cand);
      }
    }
    this.byTile.set(k, list);
  }

  removeTile(k: string): void {
    const list = this.byTile.get(k); if (!list) return; this.byTile.delete(k);
    const gone = new Set(list);
    for (const c of list) {
      this.plans.delete(c.b.id); const lv = this.live.get(c.b.id); if (lv) this.drop(lv);
      for (let i = Math.floor(c.a / CELL); i <= Math.floor(c.b2 / CELL); i++) for (let j = Math.floor(c.c / CELL); j <= Math.floor(c.d / CELL); j++) {
        const key = i + ',' + j, l = this.grid.get(key); if (!l) continue; const f = l.filter(x => !gone.has(x)); if (f.length) this.grid.set(key, f); else this.grid.delete(key);
      }
    }
  }

  /** Aktualizacja wokół punktów (gracze). maxNew: ile nowych planów najwyżej na wywołanie. */
  /** Włącza / wyłącza wnętrza; wyłączenie zwalnia wszystkie plany, regiony i meble. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return; this.enabled = on;
    if (!on) for (const lv of [...this.live.values()]) this.drop(lv);
    this.version++;
  }

  sync(points: { x: number; y: number; z: number }[], maxNew = 6, budgetMs = 4): void {
    if (!this.enabled) return;
    const start = now(), over = () => now() - start > budgetMs;
    const dist = (c: { a: number; b2: number; c: number; d: number }, x: number, z: number) => Math.hypot(Math.max(c.a - x, 0, x - c.b2), Math.max(c.c - z, 0, z - c.d));
    // zwalnianie
    for (const lv of [...this.live.values()]) {
      const [a, b2, c, d] = lv.box;
      if (!points.some(p => dist({ a, b2, c, d }, p.x, p.z) < R_OFF)) this.drop(lv);
    }
    // nowe plany
    const want: { c: Cand; d: number }[] = [], seen = new Set<number>();
    for (const p of points) {
      const r = Math.ceil(R_ON / CELL);
      for (let i = Math.floor(p.x / CELL) - r; i <= Math.floor(p.x / CELL) + r; i++) for (let j = Math.floor(p.z / CELL) - r; j <= Math.floor(p.z / CELL) + r; j++) {
        for (const c of this.grid.get(i + ',' + j) || []) {
          if (seen.has(c.b.id) || this.live.has(c.b.id)) continue; seen.add(c.b.id);
          const d = dist(c, p.x, p.z); if (d < R_ON) want.push({ c, d });
        }
      }
    }
    want.sort((p, q) => p.d - q.d);
    let made = 0;
    for (const { c } of want) {
      if (made >= maxNew || (made && over())) break;
      let plan = this.plans.get(c.b.id);
      if (plan === undefined) {
        const t0 = now(); plan = makePlan(c.b, c.t, this.host); this.plans.set(c.b.id, plan); made++;
        this.stats.plans++; this.stats.planMs += now() - t0;
      }
      if (!plan) continue;
      this.live.set(c.b.id, { plan, levels: new Map(), box: [c.a, c.b2, c.c, c.d] }); this.version++;
    }
    // piętra
    for (const lv of this.live.values()) {
      const p = lv.plan, need = new Set<number>([0]), keep = new Set<number>([0]);
      const [a, b2, c, d] = lv.box;
      for (const q of points) {
        if (q.x < a - 3 || q.x > b2 + 3 || q.z < c - 3 || q.z > d + 3) continue;
        const kp = Math.max(0, Math.min(p.levels - 1, Math.round((q.y - p.f0) / p.H)));
        for (let k = kp - 1; k <= kp + 1; k++) if (k >= 0 && k < p.levels) need.add(k);
        for (let k = kp - 2; k <= kp + 2; k++) if (k >= 0 && k < p.levels) keep.add(k);
      }
      for (const [k, L] of [...lv.levels]) if (!keep.has(k)) { this.unlevel(lv, L); lv.levels.delete(k); this.version++; }
      for (const k of need) if (!lv.levels.has(k)) { if (k !== 0 && over()) break; lv.levels.set(k, this.level(lv, k)); this.version++; }
    }
  }

  private level(lv: Live, k: number): LiveLevel {
    const p = lv.plan, f = p.frame, level = buildLevel(p, k), R = this.host.regions, N = nOf(f);
    this.stats.levels++; this.stats.levelMs += level.ms; this.stats.maxLevelMs = Math.max(this.stats.maxLevelMs, level.ms);
    const regions: Region[] = [];
    for (const w of level.walks) {
      const r = w.r; let a, u: [number, number], len, hw;
      if (w.axis === 'y') { a = toWorld(f, (r.x0 + r.x1) / 2, r.y0); u = N; len = r.y1 - r.y0; hw = (r.x1 - r.x0) / 2; }
      else { a = toWorld(f, r.x0, (r.y0 + r.y1) / 2); u = [f.ux, f.uz]; len = r.x1 - r.x0; hw = (r.y1 - r.y0) / 2; }
      if (len <= .02 || hw <= .02) continue;
      regions.push(R.addDyn('room', a[0], a[1], u[0], u[1], len, hw, w.ya, w.yb, { b: p.id, f: k, nm: w.nm }));
    }
    const obst: LiveLevel['obst'] = [];
    for (const it of level.items) {
      const cells = new Set<string>();
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, y] of [[it.r.x0 - OBST_PAD, it.r.y0 - OBST_PAD], [it.r.x1 + OBST_PAD, it.r.y0 - OBST_PAD], [it.r.x0 - OBST_PAD, it.r.y1 + OBST_PAD], [it.r.x1 + OBST_PAD, it.r.y1 + OBST_PAD]]) { const [wx, wz] = toWorld(f, x, y); x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz); }
      for (let i = Math.floor(x0 / DCELL); i <= Math.floor(x1 / DCELL); i++) for (let j = Math.floor(z0 / DCELL); j <= Math.floor(z1 / DCELL); j++) cells.add(i + ',' + j);
      for (const ck of cells) { let l = this.obst.get(ck); if (!l) this.obst.set(ck, l = []); l.push({ item: it, live: lv }); }
      obst.push({ item: it, cells: [...cells] });
    }
    const dcells: LiveLevel['dcells'] = [];
    for (const d of level.doors) {
      const cells = new Set<string>();
      for (const [x, y] of d.axis === 'x' ? [[d.at, d.a], [d.at, d.b]] : [[d.a, d.at], [d.b, d.at]]) { const [wx, wz] = toWorld(f, x, y); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.add((Math.floor(wx / DCELL) + i) + ',' + (Math.floor(wz / DCELL) + j)); }
      for (const ck of cells) { let l = this.dgrid.get(ck); if (!l) this.dgrid.set(ck, l = []); l.push({ d, live: lv }); }
      dcells.push({ d, cells: [...cells] });
    }
    return { level, regions, obst, dcells };
  }

  private unlevel(lv: Live, L: LiveLevel): void {
    for (const r of L.regions) this.host.regions.removeDyn(r);
    for (const o of L.dcells) for (const ck of o.cells) { const l = this.dgrid.get(ck); if (!l) continue; const f = l.filter(x => x.d !== o.d); if (f.length) this.dgrid.set(ck, f); else this.dgrid.delete(ck); }
    for (const o of L.obst) for (const ck of o.cells) { const l = this.obst.get(ck); if (!l) continue; const f = l.filter(x => x.item !== o.item); if (f.length) this.obst.set(ck, f); else this.obst.delete(ck); }
    void lv;
  }

  private drop(lv: Live): void {
    for (const L of lv.levels.values()) this.unlevel(lv, L);
    lv.levels.clear(); this.live.delete(lv.plan.id); this.version++;
  }

  // ---------- drzwi ----------
  isOpen(id: string): boolean { return this.doorState.get(id) ?? doorOpenByDefault(id); }
  /** Ustawia stan drzwi; true = zmiana. */
  setDoor(id: string, open: boolean): boolean {
    if (this.isOpen(id) === open) return false;
    if (open === doorOpenByDefault(id)) this.doorState.delete(id); else this.doorState.set(id, open);
    this.doorVersion++; return true;
  }
  /** Wszystkie drzwi w stanie domyślnym (przed pełną listą z serwera). */
  resetDoors(): void { if (this.doorState.size) { this.doorState.clear(); this.doorVersion++; } }
  /** Drzwi o stanie innym niż domyślny (do wysłania nowemu graczowi). */
  doorStates(): [string, boolean][] { return [...this.doorState]; }
  /** Wszystkie drzwi aktywnych pięter (widok). */
  *liveDoors(): Generator<{ d: DoorDef; plan: Plan; open: boolean }> {
    for (const lv of this.live.values()) for (const L of lv.levels.values()) for (const d of L.level.doors) yield { d, plan: lv.plan, open: this.isOpen(d.id) };
  }
  /** Najbliższe drzwi w zasięgu ręki (środek skrzydła, ta sama kondygnacja). */
  nearDoor(x: number, z: number, y: number, maxD = 1.6): { d: DoorDef; plan: Plan; open: boolean; dist: number } | null {
    let best: { d: DoorDef; plan: Plan; open: boolean; dist: number } | null = null;
    const l = this.dgrid.get(Math.floor(x / DCELL) + ',' + Math.floor(z / DCELL)); if (!l) return null;
    for (const { d, live } of l) {
      if (y < d.y0 - 1 || y > d.y0 + 1.2) continue;
      const [lx, ly] = toLocal(live.plan.frame, x, z), m = (d.a + d.b) / 2;
      const dist = d.axis === 'x' ? Math.hypot(lx - d.at, Math.max(0, Math.abs(ly - m) - (d.b - d.a) / 2)) : Math.hypot(ly - d.at, Math.max(0, Math.abs(lx - m) - (d.b - d.a) / 2));
      if (dist < maxD && (!best || dist < best.dist)) best = { d, plan: live.plan, open: this.isOpen(d.id), dist };
    }
    return best;
  }

  /** Mebel albo zamknięte drzwi blokują punkt (x, z) na wysokości podłogi y. */
  blocked(x: number, z: number, y: number): boolean {
    const ck = Math.floor(x / DCELL) + ',' + Math.floor(z / DCELL), dl = this.dgrid.get(ck);
    if (dl) for (const { d, live } of dl) {
      if (Math.abs(d.y0 - y) > 1.2 || this.isOpen(d.id)) continue;
      const [lx, ly] = toLocal(live.plan.frame, x, z);
      if (d.axis === 'x' ? Math.abs(lx - d.at) < LEAF && ly > d.a - .05 && ly < d.b + .05 : Math.abs(ly - d.at) < LEAF && lx > d.a - .05 && lx < d.b + .05) return true;
    }
    const l = this.obst.get(ck); if (!l) return false;
    for (const o of l) {
      const it = o.item; if (Math.abs(it.y - y) > .6) continue;
      const [lx, ly] = toLocal(o.live.plan.frame, x, z);
      if (lx > it.r.x0 - OBST_PAD && lx < it.r.x1 + OBST_PAD && ly > it.r.y0 - OBST_PAD && ly < it.r.y1 + OBST_PAD) return true;
    }
    return false;
  }

  /** Najbliższy pojemnik do przeszukania w zasięgu ręki. */
  container(x: number, z: number, y: number, maxD = 1.3): { item: Item; plan: Plan } | null {
    let best: { item: Item; plan: Plan } | null = null, bd = maxD;
    for (const lv of this.live.values()) {
      const [a, b2, c, d] = lv.box; if (x < a - 3 || x > b2 + 3 || z < c - 3 || z > d + 3) continue;
      const [lx, ly] = toLocal(lv.plan.frame, x, z);
      for (const L of lv.levels.values()) for (const it of L.level.items) {
        if (!it.c || Math.abs(it.y - y) > 1) continue;
        const dd = Math.hypot(Math.max(it.r.x0 - lx, 0, lx - it.r.x1), Math.max(it.r.y0 - ly, 0, ly - it.r.y1));
        if (dd < bd) { bd = dd; best = { item: it, plan: lv.plan }; }
      }
    }
    return best;
  }

  /** Drzwi wejściowe aktywnych budynków (wycięcia w ścianach po stronie klienta). */
  doors(): { c: [number, number]; u: [number, number]; w: number; y0: number; y1: number }[] {
    const out = []; for (const lv of this.live.values()) for (const e of lv.plan.ext) out.push({ c: e.c, u: e.u, w: e.w, y0: e.y0, y1: e.y1 }); return out;
  }
}

const now = (): number => (globalThis as unknown as { performance?: { now(): number } }).performance?.now() ?? Date.now();
