// Plan budynku: typologia (blok, kamienica, budynek korytarzowy, szeregowiec, sklep), układ lokalny
// (front od ulicy), klatki schodowe, korytarze, lokale z szablonów, sklepy w prawdziwych miejscach z OSM.
// buildLevel() składa jedno piętro: pomieszczenia ze ścianami i otworami (drzwi, okna z fasady), biegi schodów,
// meble i pojemniki, regiony chodzenia. Wszystko z ziarna (id budynku + piętro + nr lokalu): identyczne u wszystkich.
import { rng, type Rng } from '../util/rng';
import type { TileBuilding, TileData, TilePoi } from '../tiles/types';
import { pip, type XZ } from '../world/collision';
import { signText } from '../config/branding';
import { classify, windowSlots, type BuildingClass, type Typology } from './facade';
import { inset, maxRect, rd, rect, reframe, ringXZ, rw, toLocal, toWorld, type Frame, type Rect } from './geom';
import { layoutTemplate, TEMPLATES, TYPOLOGY, type ShopCfg, type Template, type TLayout } from './layout';
import CHAINS from './data/sieci.json';
import FURN from './data/meble.json';

export type Side = 0 | 1 | 2 | 3; // 0: y = y0 (front), 1: x = x1, 2: y = y1, 3: x = x0
export interface Hole { side: Side; a: number; b: number; y0: number; y1: number; kind: 'door' | 'win' | 'open' }
export interface Box { name: string; kind: string; r: Rect; y: number; h: number; holes: Hole[]; floor: boolean; ceil: boolean; accent?: string; unit: number }
/** Powierzchnia (podest, bieg schodów): wysokość ya przy mniejszej współrzędnej osi, yb przy większej. */
export interface Slab { r: Rect; axis: 'x' | 'y'; ya: number; yb: number; steps: boolean }
export interface Walk extends Omit<Slab, 'steps'> { nm: string }
export interface Item { r: Rect; y: number; h: number; k: string; n: string; c?: string; id?: string; unit: number }
/** Drzwi (skrzydło) w otworze: linia w układzie budynku (oś x: x = at, y od a do b; oś y: y = at, x od a do b), id stałe dla planu. */
export interface DoorDef { id: string; axis: 'x' | 'y'; at: number; a: number; b: number; y0: number; y1: number; ext: boolean }
export interface Level { k: number; boxes: Box[]; slabs: Slab[]; walks: Walk[]; items: Item[]; doors: DoorDef[]; ms: number }

export interface Unit {
  idx: number; tpl: Template; floor0: number; nFloors: number; slot: Rect;
  /** szablon -> układ lokalny budynku: o + ax·tx + ay·ty */
  o: XZ; ax: XZ; ay: XZ; W: number; D: number; ea: number; eb: number; ext: boolean;
  name: string; accent?: string; lay?: TLayout;
}
export interface Core { r: Rect; street: boolean; yv: number; sealed?: boolean }
export interface ExtDoor { x: number; w: number; tOut: number; g: number; yIn: number; c: XZ; u: XZ; y0: number; y1: number }
export interface Plan {
  id: number; city: string; typ: Typology; cls: BuildingClass; frame: Frame; base: number; f0: number; H: number; levels: number;
  units: Unit[]; cores: Core[]; corr: Rect | null; lobby: Rect | null; ext: ExtDoor[]; slots: [number, number][][];
  label: string; outer: XZ[]; holes: XZ[][];
}

export interface PlanWorld { ground(x: number, z: number): number; baseOf(pts: XZ[]): number; blocked(x: number, z: number): boolean }

const now = (): number => (globalThis as unknown as { performance?: { now(): number } }).performance?.now() ?? Date.now();
const SHOP_T = ['convenience', 'supermarket', 'discount'];
const M = 1.3; // głębokość podestu międzypiętrowego
export const flightLen = (H: number) => Math.ceil(H / 2 / .175) * .28;
const WALL = .06, INSET = .35;
export const floorName = (k: number) => k === 0 ? 'parter' : `piętro ${k}`;

/** Czy budynek dostanie wnętrze (szybki test przed planem). */
export function hasInterior(b: TileBuilding, t: TileData): boolean {
  const c = classify(b, t.city); if (c.typ && c.typ !== 'sklep') return true;
  return t.poi.some(p => p.b === b.id && p.c === 'shop' && SHOP_T.includes(p.t));
}

function chainOf(p: TilePoi, country: 'PL' | 'UK'): { tpl: string; accent?: string } {
  const s = (CHAINS.sieci as Record<string, { arch: string; accent: string }>)[p.brand ?? p.n ?? ''];
  if (s) return { tpl: s.arch, accent: s.accent };
  return { tpl: (CHAINS.domyslne as Record<string, Record<string, string>>)[country][p.t] ?? (country === 'UK' ? 'uk-conv' : 'pl-maly') };
}

/** Odległość od punktu do najbliższej drogi kafla (front budynku = strona od ulicy). */
function roadDist(t: TileData, x: number, z: number): number {
  let best = 1e9;
  for (const r of t.r) {
    if (r.tu) continue; const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      if (Math.min(ax, bx) - best > x || Math.max(ax, bx) + best < x || Math.min(az, bz) - best > z || Math.max(az, bz) + best < z) continue;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      best = Math.min(best, Math.hypot(ax + dx * u - x, az + dz * u - z));
    }
  }
  return best;
}

export function makePlan(b: TileBuilding, t: TileData, w: PlanWorld): Plan | null {
  const cls = classify(b, t.city), shops = t.poi.filter(p => p.b === b.id && p.c === 'shop' && SHOP_T.includes(p.t));
  let typ = cls.typ; if (!typ && shops.length) typ = 'sklep'; if (!typ || (typ === 'sklep' && !shops.length)) return null;
  const outer = ringXZ(b.o), holes = (b.i ?? []).map(ringXZ);
  let r = maxRect(cls.box, outer, holes); if (!r || rw(r) < 4.6 || rd(r) < 4.6) return null;
  r = inset(r, .25);
  // budynki nachodzące na siebie w OSM: wnętrze dostaje tylko większy
  {
    const area = (o: number[]) => { let s2 = 0; for (let i = 0; i < o.length; i += 2) { const j = (i + 2) % o.length; s2 += o[i] * o[j + 1] - o[j] * o[i + 1]; } return Math.abs(s2) / 2; };
    const me = area(b.o), probe: XZ[] = [[(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], [r.x0 + .5, r.y0 + .5], [r.x1 - .5, r.y0 + .5], [r.x0 + .5, r.y1 - .5], [r.x1 - .5, r.y1 - .5]].map(([x, y]) => toWorld(cls.box, x, y));
    for (const o of t.b) {
      if (o.id === b.id || o.part || o.mh >= 2) continue;
      const ar = area(o.o); if (ar < me || (ar === me && o.id > b.id)) continue;
      const ring = ringXZ(o.o); if (probe.some(([x, z]) => pip(ring, x, z))) return null;
    }
  }
  const rot = rw(r) < rd(r), f0 = reframe(cls.box, r, rot, false);
  // front: strona bliżej ulicy, nie zasłonięta innym budynkiem
  const side = (y: number) => [.15, .5, .85].reduce((s, q) => { const [x, z] = toWorld(f0, f0.W * q, y); return s + roadDist(t, x, z) + (w.blocked(x, z) || pip(outer, x, z) ? 200 : 0); }, 0);
  const frame = reframe(cls.box, r, rot, side(f0.D + 1.8) < side(-1.8) - 1);
  const W = frame.W, D = frame.D, R = rng('plan' + b.id);
  const base = w.baseOf(outer), H = cls.levelH, f = base + cls.raise;
  const p: Plan = { id: b.id, city: t.city, typ, cls, frame, base, f0: f, H, levels: cls.levels, units: [], cores: [], corr: null, lobby: null, ext: [], slots: [[], [], [], []], label: b.a || b.name || '', outer, holes };

  // okna fasady w układzie lokalnym (ta sama siatka co w shaderze ścian)
  for (let i = 0; i < outer.length; i++) {
    const A = outer[i], C = outer[(i + 1) % outer.length], L = Math.hypot(C[0] - A[0], C[1] - A[1]); if (L < 1) continue;
    const a = toLocal(frame, A[0], A[1]), c = toLocal(frame, C[0], C[1]);
    const near = (v: number, tgt: number) => Math.abs(v - tgt) < .8;
    let s: Side | -1 = -1;
    if (Math.abs(a[1] - c[1]) < .4) s = near((a[1] + c[1]) / 2, -.25) ? 0 : near((a[1] + c[1]) / 2, D + .25) ? 2 : -1;
    else if (Math.abs(a[0] - c[0]) < .4) s = near((a[0] + c[0]) / 2, -.25) ? 3 : near((a[0] + c[0]) / 2, W + .25) ? 1 : -1;
    if (s < 0) continue;
    for (const [s0, s1] of windowSlots(L, cls)) {
      const k = s === 0 || s === 2 ? 0 : 1, v0 = a[k] + (c[k] - a[k]) * s0 / L, v1 = a[k] + (c[k] - a[k]) * s1 / L;
      p.slots[s].push([Math.min(v0, v1), Math.max(v0, v1)]);
    }
  }

  const country = cls.country, T = TYPOLOGY[typ === 'kamienica' ? 'kamienica' : typ] ?? TYPOLOGY.blok;
  const pickR = (a: number[]) => a[0] + (a[1] - a[0]) * R();
  const flatTpl = (area: number): Template => TEMPLATES[typ === 'kamienica' ? 'pl-kamienica' : country === 'UK' ? (cls.levels >= 8 ? 'uk-council' : 'uk-newbuild') : area < 40 ? 'pl-m2' : 'pl-m3'];
  let nr = 0;
  const unit = (tpl: Template, floor0: number, nFloors: number, slot: Rect, o: XZ, ax: XZ, ay: XZ, Wt: number, Dt: number, ea: number, eb: number, ext: boolean, name?: string, accent?: string) => {
    const u: Unit = { idx: p.units.length, tpl, floor0, nFloors, slot, o, ax, ay, W: Wt, D: Dt, ea, eb, ext, name: name ?? '', ...(accent ? { accent } : {}) };
    if (!name) u.name = tpl.kind === 'house' ? `${tpl.name} nr ${++nr}` : `${tpl.name} · lokal ${++nr}`;
    p.units.push(u); return u;
  };
  // wolne miejsce przed fasadą frontową (co 0,25 m): drzwi zewnętrzne tylko tam
  const free: boolean[] = [];
  for (let x = 0; x <= W; x += .25) {
    let t = 0; for (; t < 6; t += .25) { const [wx, wz] = toWorld(frame, x, -t); if (!pip(outer, wx, wz)) break; }
    const [ax, az] = toWorld(frame, x, -t - .6), [bx, bz] = toWorld(frame, x, -t - 1.4);
    free.push(t < 3 && !w.blocked(ax, az) && !w.blocked(bx, bz));
  }
  /** najdłuższy wolny odcinek frontu w przedziale [a, b] */
  const freeIn = (a: number, b: number): [number, number] | null => {
    let best: [number, number] | null = null, s0 = -1;
    for (let i = Math.ceil(a / .25); i <= Math.floor(b / .25) + 1; i++) {
      const ok = i <= Math.floor(b / .25) && free[i];
      if (ok && s0 < 0) s0 = i; else if (!ok && s0 >= 0) { const seg: [number, number] = [s0 * .25, (i - 1) * .25]; if (!best || seg[1] - seg[0] > best[1] - best[0]) best = seg; s0 = -1; }
    }
    return best && best[1] - best[0] >= 1.1 ? best : null;
  };
  const front = (s: Rect, tpl: Template, floor0: number, nFloors: number, name?: string, accent?: string) => {
    const fr = freeIn(s.x0 + .3, s.x1 - .3); if (!fr) return null; // brak dostępu z ulicy: lokal zamknięty
    return unit(tpl, floor0, nFloors, s, [s.x0, s.y0], [1, 0], [0, 1], rw(s), rd(s), fr[0] - s.x0, fr[1] - s.x0, true, name, accent);
  };

  const yl = M + flightLen(H);
  if (typ === 'blok' || typ === 'kamienica') {
    if (D < yl + 1.6) return null;
    const Wc = T.core!, fr = T.flat!, Wf = pickR(fr);
    const segs: [number, number, number][] = []; // x0, x1, cx0
    if (W < Wc + 2 * 3.2) { if (W - Wc < 3.2) return null; segs.push([0, W, 0]); }
    else { const n = Math.max(1, Math.round(W / (2 * Wf + Wc))), Ls = W / n; for (let s = 0; s < n; s++) segs.push([s * Ls, (s + 1) * Ls, s * Ls + (Ls - Wc) / 2]); }
    for (const [, , cx0] of segs) p.cores.push({ r: rect(cx0, 0, cx0 + Wc, D), street: true, yv: f });
    for (let k = 0; k < p.levels; k++) for (const [x0, x1, cx0] of segs) {
      const cx1 = cx0 + Wc;
      if (cx0 - x0 >= 3) { const s = rect(x0, 0, cx0, D); unit(flatTpl(rw(s) * D), k, 1, s, [cx0, 0], [0, 1], [-1, 0], D, cx0 - x0, yl + .15, D - .15, false); }
      if (x1 - cx1 >= 3) { const s = rect(cx1, 0, x1, D); unit(flatTpl(rw(s) * D), k, 1, s, [cx1, 0], [0, 1], [1, 0], D, x1 - cx1, yl + .15, D - .15, false); }
    }
  } else if (typ === 'korytarz') {
    const Wc = T.core!, cw = T.corr!, yc0 = D / 2 - cw / 2, yc1 = D / 2 + cw / 2;
    if (yc0 < yl + .7 || W < Wc + 5) return null;
    const two = W > 45, xa = Wc, xb = two ? W - Wc : W;
    p.cores.push({ r: rect(0, 0, Wc, D), street: false, yv: f }); if (two) p.cores.push({ r: rect(W - Wc, 0, W, D), street: false, yv: f });
    p.corr = rect(xa, yc0, xb, yc1);
    const fw = country === 'UK' && cls.levels >= 8 ? [7.5, 9.5] : T.flat!; // mieszkania komunalne 2-pokojowe są szersze
    const n = Math.max(1, Math.round((xb - xa) / pickR(fw))), uw = (xb - xa) / n, lobbyI = Math.floor(n / 2);
    p.lobby = rect(xa + lobbyI * uw, 0, xa + (lobbyI + 1) * uw, yc0);
    for (let k = 0; k < p.levels; k++) for (let i = 0; i < n; i++) {
      const ux0 = xa + i * uw, ux1 = ux0 + uw;
      if (!(k === 0 && i === lobbyI)) { const s = rect(ux0, 0, ux1, yc0); unit(flatTpl(uw * yc0), k, 1, s, [ux0, yc0], [1, 0], [0, -1], uw, yc0, .2, uw - .2, false); }
      const s2 = rect(ux0, yc1, ux1, D); unit(flatTpl(uw * (D - yc1)), k, 1, s2, [ux0, yc1], [1, 0], [0, 1], uw, D - yc1, .2, uw - .2, false);
    }
  } else if (typ === 'szereg') {
    const n = Math.max(1, Math.round(W / pickR(T.house!))), hw = W / n;
    // płytki dom (< 8,6 m) nie mieści klatki schodowej szeregowca: parterowy układ mieszkania
    const deep = D >= 8.6, tpl = deep ? TEMPLATES['uk-terraced'] : TEMPLATES['uk-newbuild'];
    for (let i = 0; i < n; i++) front(rect(i * hw, 0, (i + 1) * hw, D), tpl, 0, deep ? Math.min(2, p.levels) : 1, deep ? undefined : `Dom nr ${++nr}`);
  }

  // sklepy w prawdziwych miejscach z OSM (parter)
  for (const sp of shops.slice(0, 1)) {
    const [px] = toLocal(frame, sp.x, sp.z), ch = chainOf(sp, country), name = signText(sp);
    let tpl = TEMPLATES[ch.tpl] ?? TEMPLATES['pl-maly'];
    const conv = TEMPLATES[country === 'UK' ? 'uk-conv' : 'pl-maly'];
    if (typ === 'sklep') {
      const d = tpl.id === 'dyskont' ? D : Math.min(D, 14);
      if (tpl.id === 'dyskont' && W * d < tpl.area[0]) tpl = conv;
      const wmax = Math.max(4, tpl.area[1] / d), ww = Math.min(W, wmax), x0 = Math.max(0, Math.min(W - ww, px - ww / 2));
      front(rect(x0, 0, x0 + ww, d), tpl, 0, 1, name, ch.accent);
    } else {
      const g = p.units.filter(u => u.floor0 === 0 && (typ !== 'korytarz' || u.slot.y0 < .1));
      if (!g.length) continue;
      const u = g.reduce((a, c) => Math.abs((a.slot.x0 + a.slot.x1) / 2 - px) < Math.abs((c.slot.x0 + c.slot.x1) / 2 - px) ? a : c);
      if (tpl.id === 'dyskont' && rw(u.slot) * rd(u.slot) < tpl.area[0]) tpl = conv;
      const s = u.slot; p.units.splice(p.units.indexOf(u), 1);
      const nu = front(s, tpl, 0, 1, name, ch.accent); if (nu) nu.idx = u.idx; else p.units.push(u);
    }
  }
  p.units.sort((a, b) => a.idx - b.idx);

  // drzwi zewnętrzne: klatki od ulicy, hol budynku korytarzowego, domy i sklepy
  const ext = (x: number, w0: number, yIn: number): ExtDoor => {
    let t = 0; for (; t < 6; t += .25) { const [wx, wz] = toWorld(frame, x, -t); if (!pip(outer, wx, wz)) break; }
    const tOut = t + .8, [gx, gz] = toWorld(frame, x, -tOut), g = w.ground(gx, gz), c = toWorld(frame, x, -Math.max(0, t - .25));
    return { x, w: w0, tOut, g, yIn, c, u: [frame.ux, frame.uz], y0: Math.min(g, yIn) - .3, y1: Math.max(g, yIn) + 2.25 };
  };
  for (const c of p.cores) if (c.street) {
    const fr = freeIn(c.r.x0 + .2, c.r.x1 - .2), mid = (c.r.x0 + c.r.x1) / 2;
    if (!fr) { // klatka bez wolnego wejścia od ulicy: klatka i jej mieszkania zamknięte
      c.street = false; c.sealed = true; p.units = p.units.filter(u => u.ext || (Math.abs(u.o[0] - c.r.x0) > .01 && Math.abs(u.o[0] - c.r.x1) > .01)); continue;
    }
    const cx = fr ? Math.max(fr[0] + .6, Math.min(fr[1] - .6, mid)) : mid, [gx, gz] = toWorld(frame, cx, -1.2);
    c.yv = Math.max(base, Math.min(f - .15, w.ground(gx, gz)));
    if (f - c.yv < .3) c.yv = f;
    p.ext.push(ext(cx, 1.2, c.yv));
  }
  if (p.lobby) {
    const fr = freeIn(p.lobby.x0 + .3, p.lobby.x1 - .3); if (!fr) return null;
    p.ext.push(ext(Math.max(fr[0] + .9, Math.min(fr[1] - .9, (p.lobby.x0 + p.lobby.x1) / 2)), 1.6, f));
  }
  for (const u of p.units) if (u.ext && u.floor0 === 0) {
    const lay = unitLayout(p, u); if (!lay.entry) continue;
    const [x0] = mapT(u, lay.entry.a, 0), [x1] = mapT(u, lay.entry.b, 0);
    p.ext.push(ext((x0 + x1) / 2, Math.abs(x1 - x0), f));
  }
  return p;
}

const mapT = (u: Unit, tx: number, ty: number): XZ => [u.o[0] + u.ax[0] * tx + u.ay[0] * ty, u.o[1] + u.ax[1] * tx + u.ay[1] * ty];
const mapR = (u: Unit, r: Rect): Rect => { const a = mapT(u, r.x0, r.y0), b = mapT(u, r.x1, r.y1); return rect(a[0], a[1], b[0], b[1]); };

export function unitLayout(p: Plan, u: Unit): TLayout {
  return u.lay ??= layoutTemplate(u.tpl, u.W, u.D, `${p.id}/${u.idx}`, u.ea, u.eb, u.nFloors);
}

// ---------------------------------------------------------------------------------------------
// składanie piętra

type Line = { axis: 'x' | 'y'; at: number; a: number; b: number };

function addHole(boxes: Box[], l: Line, y0: number, y1: number, kind: Hole['kind'], only?: Box[]): void {
  for (const bx of only ?? boxes) {
    const r = bx.r; let side: Side | -1 = -1;
    if (l.axis === 'x') { if (Math.abs(r.x0 - l.at) < .05) side = 3; else if (Math.abs(r.x1 - l.at) < .05) side = 1; if (side < 0 || l.b <= r.y0 + .05 || l.a >= r.y1 - .05) continue; }
    else { if (Math.abs(r.y0 - l.at) < .05) side = 0; else if (Math.abs(r.y1 - l.at) < .05) side = 2; if (side < 0 || l.b <= r.x0 + .05 || l.a >= r.x1 - .05) continue; }
    bx.holes.push({ side: side as Side, a: l.a, b: l.b, y0, y1, kind });
  }
}
const doorWalk = (l: Line, y: number, nm: string, narrow = .1): Walk => l.axis === 'x'
  ? { r: rect(l.at - .42, l.a + narrow, l.at + .42, l.b - narrow), axis: 'x', ya: y, yb: y, nm }
  : { r: rect(l.a + narrow, l.at - .42, l.b - narrow, l.at + .42), axis: 'y', ya: y, yb: y, nm };

export function buildLevel(p: Plan, k: number): Level {
  const t0 = now();
  const L: Level = { k, boxes: [], slabs: [], walks: [], items: [], doors: [], ms: 0 };
  const door = (l: Line, y0: number, y1: number, ext = false) => L.doors.push({ id: `${p.id}/${k}/${L.doors.length}`, axis: l.axis, at: l.at, a: l.a, b: l.b, y0, y1, ext });
  const H = p.H, F = (i: number) => p.f0 + i * H, top = p.levels - 1, yl = M + flightLen(H);
  const fl = floorName(k), addr = p.label ? p.label + ' · ' : '';

  // --- klatki schodowe ---
  for (const c of p.cores) {
    if (c.sealed) continue;
    const { x0: cx0, x1: cx1, y1: Dc } = c.r, cxm = (cx0 + cx1) / 2, nm = `${addr}Klatka schodowa · ${fl}`;
    const yBot = k === 0 && c.street ? Math.min(c.yv, F(0)) : F(k), yTop = k < top ? F(k + 1) : F(k) + H - .2;
    L.boxes.push({ name: 'Klatka schodowa', kind: 'core', r: c.r, y: yBot, h: yTop - yBot, holes: [], floor: false, ceil: k === top, unit: -1 });
    L.slabs.push({ r: rect(cx0, yl, cx1, Dc), axis: 'y', ya: F(k), yb: F(k), steps: false });
    L.walks.push({ r: rect(cx0 + .3, yl - .05, cx1 - .3, Dc - .3), axis: 'y', ya: F(k), yb: F(k), nm });
    if (k < top) {
      const mid = F(k) + H / 2;
      L.slabs.push({ r: rect(cx0, M, cxm, yl), axis: 'y', ya: mid, yb: F(k), steps: true }, { r: rect(cxm, M, cx1, yl), axis: 'y', ya: mid, yb: F(k + 1), steps: true }, { r: rect(cx0, 0, cx1, M), axis: 'y', ya: mid, yb: mid, steps: false });
      L.walks.push({ r: rect(cx0 + .25, M - .05, cxm + .12, yl + .05), axis: 'y', ya: mid, yb: F(k), nm }, { r: rect(cxm - .12, M - .05, cx1 - .25, yl + .05), axis: 'y', ya: mid, yb: F(k + 1), nm }, { r: rect(cx0 + .25, .3, cx1 - .25, M + .02), axis: 'y', ya: mid, yb: mid, nm });
    }
    if (k === 0 && c.street) {
      L.slabs.push({ r: rect(cx0, 0, cx1, M), axis: 'y', ya: c.yv, yb: c.yv, steps: false });
      L.walks.push({ r: rect(cx0 + .25, .3, cx1 - .25, M + .02), axis: 'y', ya: c.yv, yb: c.yv, nm });
      if (F(0) - c.yv > .05) { L.slabs.push({ r: rect(cxm, M, cx1, yl), axis: 'y', ya: c.yv, yb: F(0), steps: true }); L.walks.push({ r: rect(cxm - .12, M - .05, cx1 - .25, yl + .05), axis: 'y', ya: c.yv, yb: F(0), nm }); }
      else L.walks.push({ r: rect(cxm - .12, M - .05, cx1 - .25, yl + .05), axis: 'y', ya: F(0), yb: F(0), nm });
    }
  }
  // --- korytarz i hol ---
  const corrBox = p.corr ? { name: 'Korytarz', kind: 'corridor', r: p.corr, y: F(k), h: H - .2, holes: [], floor: true, ceil: true, unit: -1 } as Box : null;
  if (corrBox) {
    L.boxes.push(corrBox); const c = p.corr!;
    L.walks.push({ r: rect(c.x0 + .3, c.y0 + .3, c.x1 - .3, c.y1 - .3), axis: 'x', ya: F(k), yb: F(k), nm: `${addr}Korytarz · ${fl}` });
    for (const core of p.cores) {
      const at = core.r.x1 <= c.x0 + .05 ? core.r.x1 : core.r.x0, l: Line = { axis: 'x', at, a: (c.y0 + c.y1) / 2 - .6, b: (c.y0 + c.y1) / 2 + .6 };
      addHole(L.boxes, l, F(k), F(k) + 2.1, 'door'); door(l, F(k), F(k) + 2.1); L.walks.push(doorWalk(l, F(k), `${addr}Korytarz · ${fl}`));
    }
  }
  if (k === 0 && p.lobby) {
    const lb = p.lobby, nm = `${addr}Hol wejściowy`;
    L.boxes.push({ name: 'Hol wejściowy', kind: 'lobby', r: lb, y: F(0), h: H - .2, holes: [], floor: true, ceil: true, unit: -1 });
    L.walks.push({ r: inset(lb, .3), axis: 'x', ya: F(0), yb: F(0), nm });
    const cx = (lb.x0 + lb.x1) / 2, l: Line = { axis: 'y', at: lb.y1, a: cx - .8, b: cx + .8 };
    addHole(L.boxes, l, F(0), F(0) + 2.1, 'door'); door(l, F(0), F(0) + 2.1); L.walks.push(doorWalk(l, F(0), nm));
  }

  // --- lokale ---
  const unitBoxes = new Map<Unit, Box[]>();
  for (const u of p.units) {
    if (k < u.floor0 || k >= u.floor0 + u.nFloors) continue;
    const lay = unitLayout(p, u), tf = k - u.floor0, mine: Box[] = []; unitBoxes.set(u, mine);
    if (!lay.entry) continue; // bez wejścia: lokal zamknięty
    const roomNm = (n: string) => `${addr}${u.name} · ${n} · ${fl}`;
    for (const rm of lay.rooms) if (rm.floor === tf) {
      const r = mapR(u, rm.r), stair = !!rm.stair;
      const bx: Box = { name: rm.name, kind: rm.kind, r, y: F(k), h: stair ? 2 * H - .2 : H - .2, holes: [], floor: !stair, ceil: !stair, unit: u.idx, ...(u.accent ? { accent: u.accent } : {}) };
      mine.push(bx); L.boxes.push(bx);
      if (stair) {
        const ayPos = u.ay[0] + u.ay[1] > 0, axis: 'x' | 'y' = u.ay[0] !== 0 ? 'x' : 'y';
        const ya = ayPos ? F(k) : F(k + 1), yb = ayPos ? F(k + 1) : F(k);
        L.slabs.push({ r, axis, ya, yb, steps: true });
        const wr = axis === 'y' ? rect(r.x0 + .18, r.y0 - .05, r.x1 - .18, r.y1 + .05) : rect(r.x0 - .05, r.y0 + .18, r.x1 + .05, r.y1 - .18);
        L.walks.push({ r: wr, axis, ya, yb, nm: roomNm(rm.name) });
      } else {
        const wr = inset(r, INSET); if (wr.x1 - wr.x0 > .1 && wr.y1 - wr.y0 > .1) L.walks.push({ r: wr, axis: 'x', ya: F(k), yb: F(k), nm: roomNm(rm.name) });
      }
    }
    // drzwi wewnętrzne
    for (const d of lay.doors) if (d.floor === tf) {
      const a = d.axis === 'x' ? mapT(u, d.at, d.a) : mapT(u, d.a, d.at), b = d.axis === 'x' ? mapT(u, d.at, d.b) : mapT(u, d.b, d.at);
      const l: Line = Math.abs(a[0] - b[0]) < .01 ? { axis: 'x', at: a[0], a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) } : { axis: 'y', at: a[1], a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) };
      addHole(L.boxes, l, F(k), F(k) + (d.open ? 2.3 : 2.05), d.open ? 'open' : 'door', mine); if (!d.open) door(l, F(k), F(k) + 2.05);
      L.walks.push(doorWalk(l, F(k), roomNm(d.B), d.open ? .05 : .1));
    }
    // wejście do lokalu
    if (tf === 0 && lay.entry) {
      const a = mapT(u, lay.entry.a, 0), b = mapT(u, lay.entry.b, 0);
      const l: Line = Math.abs(a[0] - b[0]) < .01 ? { axis: 'x', at: a[0], a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) } : { axis: 'y', at: a[1], a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) };
      addHole(L.boxes, l, F(k), F(k) + 2.1, 'door'); if (!u.ext) door(l, F(k), F(k) + 2.1);
      if (!u.ext) L.walks.push(doorWalk(l, F(k), roomNm('wejście')));
    }
  }
  // schody w domach: otwór w ścianie biegu (wyższej o piętro) od strony podestu piętra wyżej
  for (const bx of L.boxes) if (bx.kind === 'stair') {
    const u = p.units.find(q => q.idx === bx.unit)!, lay = unitLayout(p, u);
    for (const d of lay.doors) if (d.floor === k + 1 - u.floor0 && d.A.startsWith('^')) {
      const a = mapT(u, d.a, d.at), b = mapT(u, d.b, d.at);
      const l: Line = Math.abs(a[0] - b[0]) < .01 ? { axis: 'x', at: a[0], a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) } : { axis: 'y', at: a[1], a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) };
      addHole(L.boxes, l, F(k + 1), F(k + 1) + 2.3, 'open', [bx]);
    }
  }
  // drzwi zewnętrzne (parter)
  if (k === 0) for (const e of p.ext) {
    const l: Line = { axis: 'y', at: 0, a: e.x - e.w / 2, b: e.x + e.w / 2 };
    addHole(L.boxes, l, e.yIn, e.yIn + 2.15, 'door'); door(l, e.yIn, e.yIn + 2.15, true);
    L.walks.push({ r: rect(e.x - e.w / 2 + .15, -e.tOut, e.x + e.w / 2 - .15, .45), axis: 'y', ya: e.g, yb: e.yIn, nm: `${addr}Wejście` });
  }
  // okna z fasady
  const W = p.frame.W, D = p.frame.D, { sill, wh } = p.cls;
  for (const bx of L.boxes) {
    const r = bx.r, sides: [Side, boolean, number, number][] = [[0, r.y0 < .05, r.x0, r.x1], [2, r.y1 > D - .05, r.x0, r.x1], [3, r.x0 < .05, r.y0, r.y1], [1, r.x1 > W - .05, r.y0, r.y1]];
    for (const [s, on, lo, hi] of sides) if (on) for (const [a, b] of p.slots[s]) if (a > lo + .12 && b < hi - .12 && !bx.holes.some(h => h.side === s && h.kind !== 'win' && h.a < b + .2 && h.b > a - .2))
      bx.holes.push({ side: s, a, b, y0: F(k) + sill, y1: F(k) + sill + wh, kind: 'win' });
  }
  // meble
  const R = rng(`meble${p.id}/${k}`);
  for (const bx of L.boxes) {
    if (bx.unit < 0 && bx.kind !== 'lobby') continue;
    const u = p.units.find(q => q.idx === bx.unit);
    const rm = u ? unitLayout(p, u).rooms.find(q => q.name === bx.name && q.floor === k - u.floor0) : undefined;
    if (rm?.shop) shopFill(bx, rm.shop, R, L, p, k);
    else furnish(bx, R, L, p, k);
  }
  L.ms = (now()) - t0;
  return L;
}

// ---------------------------------------------------------------------------------------------
// meble

interface FSpec { k: string; n: string; w: number[]; d: number; h: number; p: number; c?: string; mid?: boolean; n2?: number[] }
const FURNITURE = FURN as unknown as Record<string, FSpec[]>;

function doorZones(bx: Box, depth: number): Rect[] {
  const r = bx.r, out: Rect[] = [];
  for (const h of bx.holes) if (h.kind !== 'win') {
    const a = h.a - .25, b = h.b + .25;
    if (h.side === 0) out.push(rect(a, r.y0, b, r.y0 + depth)); else if (h.side === 2) out.push(rect(a, r.y1 - depth, b, r.y1));
    else if (h.side === 3) out.push(rect(r.x0, a, r.x0 + depth, b)); else out.push(rect(r.x1 - depth, a, r.x1, b));
  }
  return out;
}
/** Czy po dodaniu mebli wszystkie drzwi pokoju są połączone wolnym przejściem (siatka, sylwetka gracza). */
export function keepsOpen(bx: Box, items: Rect[]): boolean {
  const r = bx.r, wr = inset(r, INSET), a = rw(r) * rd(r), g = a > 500 ? .45 : a > 150 ? .3 : .2;
  const nx = Math.max(1, Math.floor((wr.x1 - wr.x0) / g) + 1), ny = Math.max(1, Math.floor((wr.y1 - wr.y0) / g) + 1);
  const pad = OBST_PAD + .14, free = (x: number, y: number) => !items.some(q => x > q.x0 - pad && x < q.x1 + pad && y > q.y0 - pad && y < q.y1 + pad);
  const cell = (x: number, y: number): number => { const i = Math.max(0, Math.min(nx - 1, Math.round((x - wr.x0) / g))), j = Math.max(0, Math.min(ny - 1, Math.round((y - wr.y0) / g))); return j * nx + i; };
  const seeds: number[] = [];
  for (const h of bx.holes) if (h.kind !== 'win') {
    const c = (h.a + h.b) / 2, p: [number, number] = h.side === 0 ? [c, wr.y0] : h.side === 2 ? [c, wr.y1] : h.side === 3 ? [wr.x0, c] : [wr.x1, c];
    const k = cell(p[0], p[1]);
    const x = wr.x0 + (k % nx) * g, y = wr.y0 + Math.floor(k / nx) * g; if (!free(x, y)) return false; seeds.push(k);
  }
  if (seeds.length < 2) return true;
  const seen = new Uint8Array(nx * ny), q = [seeds[0]]; seen[seeds[0]] = 1;
  while (q.length) {
    const k = q.pop()!, i = k % nx, j = Math.floor(k / nx);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const n = b * nx + a; if (seen[n]) continue;
      if (!free(wr.x0 + a * g, wr.y0 + b * g)) continue; seen[n] = 1; q.push(n);
    }
  }
  return seeds.every(k => seen[k]);
}
const hit = (a: Rect, b: Rect, g = .05) => a.x0 < b.x1 + g && b.x0 < a.x1 + g && a.y0 < b.y1 + g && b.y0 < a.y1 + g;

function furnish(bx: Box, R: Rng, L: Level, p: Plan, k: number): void {
  const specs = FURNITURE[bx.kind]; if (!specs) return;
  const r = bx.r, zones = doorZones(bx, 1.0), placed: { r: Rect; side: number; d: number }[] = [];
  let n = 0;
  for (const s of specs) {
    const cnt = s.n2 ? s.n2[0] + Math.floor(R() * (s.n2[1] - s.n2[0] + 1)) : 1;
    for (let c = 0; c < cnt; c++) {
      if (R() > s.p) continue;
      const w = s.w[0] + (s.w[1] - s.w[0]) * R(), d = s.d;
      let got: Rect | null = null, gs = -1;
      if (s.mid) {
        if (rw(r) < w + 1.8 || rd(r) < d + 1.8) continue;
        const cx = (r.x0 + r.x1) / 2 + (R() - .5) * .4, cy = (r.y0 + r.y1) / 2 + (R() - .5) * .4, q = rect(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2);
        if (!zones.some(z => hit(z, q)) && !placed.some(o => hit(o.r, q, .8))) got = q;
      } else {
        const order = [0, 1, 2, 3].sort(() => R() - .5);
        for (const side of order) {
          const along = side === 0 || side === 2, len = along ? rw(r) : rd(r), perp = along ? rd(r) : rw(r);
          const opp = placed.filter(o => o.side === (side + 2) % 4).reduce((m, o) => Math.max(m, o.d), 0);
          if (len < w + .2 || perp - d - opp < 1.1) continue;
          const start = R() * (len - w), steps = Math.ceil((len - w) / .15) + 1;
          for (let i = 0; i < steps && !got; i++) {
            const t = ((start + i * .15) % (len - w + 1e-6)) + (along ? r.x0 : r.y0);
            const q = side === 0 ? rect(t, r.y0 + WALL, t + w, r.y0 + WALL + d) : side === 2 ? rect(t, r.y1 - WALL - d, t + w, r.y1 - WALL)
              : side === 3 ? rect(r.x0 + WALL, t, r.x0 + WALL + d, t + w) : rect(r.x1 - WALL - d, t, r.x1 - WALL, t + w);
            if (zones.some(z => hit(z, q, 0)) || placed.some(o => hit(o.r, q))) continue;
            if (s.h > 1.05 && bx.holes.some(h => h.kind === 'win' && h.side === side && h.a < (along ? q.x1 : q.y1) && h.b > (along ? q.x0 : q.y0))) continue;
            got = q; gs = side;
          }
          if (got) break;
        }
      }
      if (!got || !keepsOpen(bx, [...placed.map(o => o.r), got])) continue;
      placed.push({ r: got, side: gs, d });
      L.items.push({ r: got, y: bx.y, h: s.h, k: s.k, n: s.n, unit: bx.unit, ...(s.c ? { c: s.c, id: `${p.id}/${k}/${bx.unit}/${bx.name}/${n++}` } : {}) });
    }
  }
}

/** Sala sprzedaży: kasy przy wejściu, regały przyścienne, lodówki pod tylną ścianą, alejki regałów (gondoli). */
function shopFill(bx: Box, cfg: ShopCfg, R: Rng, L: Level, p: Plan, k: number): void {
  const r = bx.r, zones = doorZones(bx, cfg.front), items: Item[] = [];
  let n = 0;
  const put = (q: Rect, h: number, kk: string, nm: string, c?: string) => {
    if (q.x1 - q.x0 < .3 || q.y1 - q.y0 < .3) return;
    if (zones.some(z => hit(z, q, 0)) || items.some(o => hit(o.r, q, .02))) return; // przejście sprawdzane raz na końcu
    items.push({ r: q, y: bx.y, h, k: kk, n: nm, unit: bx.unit, ...(c ? { c, id: `${p.id}/${k}/${bx.unit}/sala/${n++}` } : {}) });
  };
  const front = bx.holes.find(h => h.side === 0 && h.kind === 'door'), dx = front ? (front.a + front.b) / 2 : (r.x0 + r.x1) / 2;
  // kasy: wzdłuż frontu, po stronie dalszej od drzwi
  const dir = dx > (r.x0 + r.x1) / 2 ? -1 : 1;
  let x = dir > 0 ? Math.max(r.x0 + .8, dx + 1.6) : Math.min(r.x1 - .8, dx - 1.6);
  for (let i = 0; i < cfg.checkouts; i++) {
    const q = dir > 0 ? rect(x, r.y0 + 1.1, x + 1.5, r.y0 + 1.8) : rect(x - 1.5, r.y0 + 1.1, x, r.y0 + 1.8);
    if (q.x0 < r.x0 + .3 || q.x1 > r.x1 - .3) break;
    if (!keepsOpen(bx, [...items.map(o => o.r), q])) break;
    items.push({ r: q, y: bx.y, h: 1, k: 'kasa', n: 'Kasa', c: 'kasa', id: `${p.id}/${k}/${bx.unit}/kasa/${i}`, unit: bx.unit }); x += dir * 2.6;
  }
  if (!items.some(i => i.k === 'kasa')) { // wąski lokal: lada z kasą przy ścianie bocznej
    for (const q of [dir > 0 ? rect(r.x1 - WALL - .7, r.y0 + .9, r.x1 - WALL, r.y0 + 2.3) : rect(r.x0 + WALL, r.y0 + .9, r.x0 + WALL + .7, r.y0 + 2.3), dir > 0 ? rect(r.x0 + WALL, r.y0 + .9, r.x0 + WALL + .7, r.y0 + 2.3) : rect(r.x1 - WALL - .7, r.y0 + .9, r.x1 - WALL, r.y0 + 2.3)]) {
      if (zones.some(z => hit(z, q, 0)) || !keepsOpen(bx, [q])) continue;
      items.push({ r: q, y: bx.y, h: 1, k: 'kasa', n: 'Kasa', c: 'kasa', id: `${p.id}/${k}/${bx.unit}/kasa/0`, unit: bx.unit }); break;
    }
  }
  for (let i = 0; i < (cfg.selfcheck ?? 0); i++) {
    const q = dir > 0 ? rect(x, r.y0 + 1.2, x + .7, r.y0 + 1.8) : rect(x - .7, r.y0 + 1.2, x, r.y0 + 1.8);
    if (q.x0 < r.x0 + .3 || q.x1 > r.x1 - .3) break;
    if (!keepsOpen(bx, [...items.map(o => o.r), q])) break;
    items.push({ r: q, y: bx.y, h: 1.4, k: 'samoobsluga', n: 'Kasa samoobsługowa', unit: bx.unit }); x += dir * 1.3;
  }
  const yA = r.y0 + cfg.front, back = cfg.fridges ? .85 : 0;
  // lodówki pod tylną ścianą
  if (cfg.fridges) for (let t = r.x0 + .3; t + 1.25 <= r.x1 - .3; t += 1.3) put(rect(t, r.y1 - WALL - .8, t + 1.25, r.y1 - WALL), 2.1, 'lodowka_sklep', 'Lodówka z napojami', 'lodowka_sklep');
  // regały przyścienne
  for (const s of [1, 3]) for (let t = yA; t + 1.8 <= r.y1 - back - .9; t += 2) {
    const q = s === 3 ? rect(r.x0 + WALL, t, r.x0 + WALL + cfg.wall, t + 1.9) : rect(r.x1 - WALL - cfg.wall, t, r.x1 - WALL, t + 1.9);
    put(q, 1.8, 'polka', 'Regał', 'polka');
  }
  // piekarnia przy wejściu (dyskont)
  if (cfg.bakery) put(dir > 0 ? rect(r.x0 + .5, r.y0 + 2.4, r.x0 + 3.5, r.y0 + 3.2) : rect(r.x1 - 3.5, r.y0 + 2.4, r.x1 - .5, r.y0 + 3.2), 1.6, 'piekarnia', 'Pieczywo', 'polka');
  // gondole: rzędy prostopadle do frontu, z poprzecznymi alejkami co ~9 m
  const xs: number[] = []; for (let gx = r.x0 + WALL + cfg.wall + cfg.aisle; gx + cfg.gondola <= r.x1 - WALL - cfg.wall - cfg.aisle + .01; gx += cfg.gondola + cfg.aisle) xs.push(gx);
  const y0 = yA + .4, y1 = r.y1 - back - cfg.aisle;
  if (y1 - y0 > 1.2) for (const gx of xs) {
    const nseg = Math.max(1, Math.round((y1 - y0) / 9)), seg = (y1 - y0) / nseg;
    for (let i = 0; i < nseg; i++) put(rect(gx, y0 + i * seg + (i ? .9 : 0), gx + cfg.gondola, y0 + (i + 1) * seg - (i < nseg - 1 ? .9 : 0)), 1.45, 'gondola', 'Regał z towarem', 'polka');
  }
  // przejście między drzwiami: w razie potrzeby usuwa ostatnio dodane regały
  while (items.length && !keepsOpen(bx, items.map(o => o.r))) { const i = items.map(o => o.k).lastIndexOf('gondola'); items.splice(i >= 0 ? i : items.length - 1, 1); }
  L.items.push(...items);
}

/** Przeszkody mebli (z marginesem na sylwetkę). */
export const OBST_PAD = .2;
