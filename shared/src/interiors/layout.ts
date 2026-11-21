// Rozkład szablonu lokalu na prostokąt: drzewo podziałów (wymiary z zakresów, warianty, odbicie),
// drzwi między pomieszczeniami (z listy szablonu + uzupełnienie, by każde pomieszczenie było dostępne),
// drzwi wejściowe w zadanym przedziale ściany. Wszystko w układzie szablonu: x wzdłuż ściany wejściowej, y w głąb.
import { rng, type Rng } from '../util/rng';
import DATA from './data/szablony.json';
import { rect, type Rect } from './geom';

export interface ShopCfg { aisle: number; gondola: number; wall: number; fridges?: number; checkouts: number; selfcheck?: number; front: number; bakery?: number }
export interface TNode {
  split?: 'x' | 'y'; parts?: { size?: number[]; flex?: number; key?: string; node: TNode }[];
  room?: string; kind?: string; name?: string; stair?: number; void?: boolean; well?: boolean; pick?: TNode[]; shop?: ShopCfg;
}
export interface Template {
  id: string; name: string; kind: 'flat' | 'house' | 'shop'; country: string; area: number[];
  entry: string; floors: TNode[]; doors: string[][];
}
export interface TypologyCfg { core?: number; flat?: number[]; corr?: number; house?: number[]; opis: string }

export const TEMPLATES: Record<string, Template> = Object.fromEntries((DATA.szablony as unknown as Template[]).map(t => [t.id, t]));
export const TYPOLOGY = DATA.typologie as Record<string, TypologyCfg>;

export interface TRoom { id: string; kind: string; name: string; r: Rect; floor: number; stair?: boolean; shop?: ShopCfg }
/** Drzwi: na linii x = at (axis 'x': ściana pionowa) albo y = at, od a do b; open = przejście na całą szerokość. */
export interface TDoor { floor: number; axis: 'x' | 'y'; at: number; a: number; b: number; A: string; B: string; open?: boolean }
export interface TLayout { rooms: TRoom[]; doors: TDoor[]; entry: { room: string; a: number; b: number } | null; W: number; D: number; floors: number }

const EPS = .02;

function sizes(parts: NonNullable<TNode['parts']>, len: number, R: Rng, keyR: (k: string) => number): number[] {
  const fixed = parts.map(p => p.size ? p.size[0] + (p.size[1] - p.size[0]) * (p.key ? keyR(p.key) : R()) : 0);
  const flexW = parts.map(p => p.size ? 0 : p.flex ?? 1), nFlex = flexW.filter(w => w > 0).length, sumW = flexW.reduce((a, b) => a + b, 0);
  let sumF = fixed.reduce((a, b) => a + b, 0);
  if (!nFlex) return fixed.map(f => f * len / (sumF || 1));
  const minFlex = 1.2 * nFlex;
  if (len - sumF < minFlex) { const k = Math.max(.3, (len - minFlex) / (sumF || 1)); for (let i = 0; i < fixed.length; i++) fixed[i] *= k; sumF = fixed.reduce((a, b) => a + b, 0); }
  const rem = Math.max(0, len - sumF);
  return parts.map((p, i) => p.size ? fixed[i] : rem * flexW[i] / sumW);
}

function evalNode(n: TNode, r: Rect, floor: number, R: Rng, keyR: (k: string) => number, out: TRoom[]): void {
  if (n.pick) { evalNode(n.pick[Math.floor(R() * n.pick.length)], r, floor, R, keyR, out); return; }
  if (n.void) return;
  if (n.room) { out.push({ id: n.room, kind: n.kind ?? 'room', name: n.name ?? n.room, r, floor, ...(n.stair ? { stair: true } : {}), ...(n.shop ? { shop: n.shop } : {}) }); return; }
  if (!n.split || !n.parts) return;
  const len = n.split === 'x' ? r.x1 - r.x0 : r.y1 - r.y0, s = sizes(n.parts, len, R, keyR);
  let p = n.split === 'x' ? r.x0 : r.y0;
  n.parts.forEach((part, i) => {
    const q = p + s[i], sub = n.split === 'x' ? rect(p, r.y0, q, r.y1) : rect(r.x0, p, r.x1, q); p = q;
    evalNode(part.node, sub, floor, R, keyR, out);
  });
}

/** Wspólna krawędź dwóch prostokątów: oś, położenie, przedział. */
export function shared(A: Rect, B: Rect): { axis: 'x' | 'y'; at: number; a: number; b: number } | null {
  if (Math.abs(A.x1 - B.x0) < EPS || Math.abs(B.x1 - A.x0) < EPS) {
    const a = Math.max(A.y0, B.y0), b = Math.min(A.y1, B.y1); if (b - a > EPS) return { axis: 'x', at: Math.abs(A.x1 - B.x0) < EPS ? A.x1 : A.x0, a, b };
  }
  if (Math.abs(A.y1 - B.y0) < EPS || Math.abs(B.y1 - A.y0) < EPS) {
    const a = Math.max(A.x0, B.x0), b = Math.min(A.x1, B.x1); if (b - a > EPS) return { axis: 'y', at: Math.abs(A.y1 - B.y0) < EPS ? A.y1 : A.y0, a, b };
  }
  return null;
}

/**
 * Rozkład szablonu na prostokąt W × D. entryA..entryB: przedział ściany wejściowej (y = 0), w którym mogą być drzwi.
 * floors: ile pięter szablonu użyć (domy).
 */
export function layoutTemplate(t: Template, W: number, D: number, seed: string, entryA: number, entryB: number, floors = t.floors.length): TLayout {
  let lay: TLayout | null = null;
  for (let i = 0; i < 8; i++) { lay = layoutOnce(t, W, D, i ? seed + '#' + i : seed, entryA, entryB, floors); if (lay.entry) break; }
  return lay!;
}

function layoutOnce(t: Template, W: number, D: number, seed: string, entryA: number, entryB: number, floors: number): TLayout {
  const R = rng('lokal' + seed), keys = new Map<string, number>();
  const keyR = (k: string) => { let v = keys.get(k); if (v == null) keys.set(k, v = R()); return v; };
  const rooms: TRoom[] = [];
  for (let f = 0; f < Math.min(floors, t.floors.length); f++) evalNode(t.floors[f], rect(0, 0, W, D), f, R, keyR, rooms);
  // odbicie lustrzane
  if (R() < .5) for (const r of rooms) r.r = rect(W - r.r.x1, r.r.y0, W - r.r.x0, r.r.y1);
  // schody na najwyższym piętrze prowadziłyby donikąd: zostają podestem
  const top = Math.min(floors, t.floors.length) - 1;
  for (const r of rooms) if (r.stair && r.floor >= top) { delete r.stair; r.kind = 'hall'; r.name = 'Podest'; }
  const doors: TDoor[] = [];
  const byId = (id: string, f: number) => rooms.find(r => r.id === id && r.floor === f);
  const parent = new Map<TRoom, TRoom>(); const find = (r: TRoom): TRoom => { let p = parent.get(r) ?? r; if (p !== r) { p = find(p); parent.set(r, p); } return p; };
  const unite = (a: TRoom, b: TRoom) => parent.set(find(a), find(b));
  const addDoor = (A: TRoom, B: TRoom, open: boolean): boolean => {
    if (A.floor !== B.floor) return false;
    const s = shared(A.r, B.r); if (!s || s.b - s.a < .95) return false;
    const w = open ? Math.max(.9, s.b - s.a - .2) : .9, lo = s.a + w / 2 + .1, hi = s.b - w / 2 - .1;
    const c = hi > lo ? lo + (hi - lo) * R() : (s.a + s.b) / 2;
    doors.push({ floor: A.floor, axis: s.axis, at: s.at, a: c - w / 2, b: c + w / 2, A: A.id, B: B.id, ...(open ? { open: true } : {}) });
    unite(A, B); return true;
  };
  for (const [a, b, o] of t.doors) for (let f = 0; f < floors; f++) { const A = byId(a, f), B = byId(b, f); if (A && B) addDoor(A, B, o === 'open'); }
  // schody: góra biegu łączy się z pomieszczeniem piętra wyżej przylegającym do końca biegu
  for (const s of rooms) if (s.stair) {
    const up = rooms.find(r => r.floor === s.floor + 1 && Math.abs(r.r.y0 - s.r.y1) < EPS && Math.min(r.r.x1, s.r.x1) - Math.max(r.r.x0, s.r.x0) > .6);
    if (up) { doors.push({ floor: s.floor + 1, axis: 'y', at: s.r.y1, a: Math.max(up.r.x0, s.r.x0), b: Math.min(up.r.x1, s.r.x1), A: '^' + s.id, B: up.id, open: true }); unite(s, up); }
  }
  // wejście
  let entry: TLayout['entry'] = null;
  const pref = ['hall', 'open', 'sala', 'living', 'kitchen', 'room'];
  const cands = rooms.filter(r => r.floor === 0 && r.r.y0 < EPS).sort((p, q) => (p.id === t.entry ? -1 : 0) - (q.id === t.entry ? -1 : 0) || pref.indexOf(p.kind) - pref.indexOf(q.kind));
  for (const r of cands) {
    const a = Math.max(r.r.x0 + .15, entryA), b = Math.min(r.r.x1 - .15, entryB); if (b - a < .95) continue;
    const w = r.kind === 'sala' ? Math.min(r.r.x1 - r.r.x0 < 6 ? 1.2 : 1.8, b - a - .1) : .9, c = a + w / 2 + (b - a - w) * R(); entry = { room: r.id, a: c - w / 2, b: c + w / 2 }; break;
  }
  // uzupełnienie: każde pomieszczenie osiągalne z wejścia
  const start = entry ? byId(entry.room, 0) : null;
  if (start) for (let it = 0; it < 12; it++) {
    let changed = false; const root = find(start);
    for (const r of rooms) if (find(r) !== root) {
      const n = rooms.filter(q => q !== r && find(q) === root && q.floor === r.floor);
      for (const q of n) if (addDoor(r, q, false)) { changed = true; break; }
    }
    if (!changed) break;
  }
  return { rooms, doors, entry, W, D, floors };
}
