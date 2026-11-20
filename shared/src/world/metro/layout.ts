// Układ metra: stacje, hale peronowe, tunele, przesiadki, zejścia i lokale.
// Czysta logika (bez three.js i DOM): ten sam wynik na kliencie i serwerze.
// Ziarno losowości = nazwa miasta + nazwa stacji, więc stacja zawsze wygląda tak samo.
// Kolejność wywołań R() i tworzenia regionów jest taka jak w prototypie (legacy/index.html).
import type { CityData } from '../../data/cities';
import { makeProj } from '../../data/projection';
import { rng, type Rng } from '../../util/rng';
import type { XZ } from '../collision';
import type { Region, RegionIndex } from '../regions';

export type Span = [number, number];
/** Otwór w ścianie czołowej: [szerokość, wysokość], 'open' = brak ściany */
export type EndOpening = [number, number] | 'open' | undefined;

export interface Hall {
  l: number; ux: number; uz: number;
  /** połowa długości hali */
  L: number; W: number; H: number; y: number; island: boolean;
  /** najniższy teren nad halą */
  surf: number;
  side: { left: Span[]; right: Span[] };
  start: EndOpening; end: EndOpening;
  reg: Region; pillarStep: number;
}
export interface Exit {
  t: number; side: number;
  /** prawdziwe wejście z OSM: punkt startu korytarza i punkt wejścia */
  px?: number; pz?: number; ex?: number; ez?: number; D?: number;
}
export interface ExitGeom {
  /** początek przy hali */
  sx: number; sz: number;
  corr: Region | null; stair: Region;
  /** wylot schodów na ulicy: [x, z, kierunek] */
  top: [number, number, XZ];
  /** wysokość terenu na wylocie */
  ty: number;
  /** najniższy teren nad schodami (ściany nie wystają ponad grunt) */
  surfMin: number;
  /** obrys otworu w gruncie i pawilonu */
  P4: XZ[];
}
export interface Room { t: number; side: number; len: number; rw: number; rl: number; corr?: Region; room?: Region }
export interface Station {
  i: number; name: string; x: number; z: number; real: boolean;
  /** wysokość terenu nad stacją (0 bez modelu terenu) */
  surf: number;
  /** linia -> sąsiednie stacje */
  lines: Map<number, number[]>;
  halls: Hall[];
  tops: [number, number, XZ][];
  exits: Exit[]; exitGeoms: ExitGeom[]; rooms: Room[];
}
export interface Tunnel { l: number; a: XZ; b: XZ; ya: number; yb: number; A: string; B: string; reg: Region | null }
export interface Ramp { s: number; hall: number; up: number; ax: number; az: number; ux: number; uz: number; Lr: number; reg: Region }

export interface MetroLayout {
  stations: Station[];
  tunnels: Tunnel[];
  ramps: Ramp[];
  /** otwory w gruncie nad zejściami */
  holes: XZ[][];
}

type HallDraft = Omit<Hall, 'reg' | 'pillarStep'> & { R: Rng; reg?: Region; pillarStep?: number };

export function buildMetroLayout(city: CityData, stOverride: Map<number, XZ> | null, entrances: Map<number, XZ[]>,
  buildings: { hit(x: number, z: number): boolean }, regions: RegionIndex, ground: (x: number, z: number) => number = () => 0): MetroLayout {
  const proj = makeProj(city.o);
  const stations: Station[] = city.st.map(([name, lat, lon], i) => {
    const ov = stOverride && stOverride.get(i); const [x, z] = ov || proj(lat, lon);
    return { i, name, x, z, surf: ground(x, z), lines: new Map(), halls: [], tops: [], real: !!ov, exits: [], exitGeoms: [], rooms: [] };
  });
  // sąsiedzi na każdej linii
  for (const [a, b, l] of city.ed) for (const [p, q] of [[a, b], [b, a]]) {
    const s = stations[p]; let n = s.lines.get(l); if (!n) s.lines.set(l, n = []); n.push(q);
  }
  // hale peronowe
  const drafts: HallDraft[][] = [];
  for (const s of stations) {
    const R = rng(city.name + s.name); const ls = [...s.lines.keys()].sort((a, b) => city.lines[a].d[0] - city.lines[b].d[0]);
    let prevY = 0; const hs: HallDraft[] = [];
    ls.forEach((l, k) => {
      const nb = s.lines.get(l)!.map(q => stations[q]); let ux = 0, uz = 0;
      if (nb.length === 1) { ux = nb[0].x - s.x; uz = nb[0].z - s.z; } else { const a = nb[0], b = nb[1]; ux = b.x - a.x; uz = b.z - a.z; }
      const m = Math.hypot(ux, uz) || 1; ux /= m; uz /= m;
      const [d0, d1] = city.lines[l].d, depth = d0 + R() * (d1 - d0);
      const L = 52 + R() * 16, W = 8.5 + R() * 4, H = 5.2 + R() * 1.8, island = R() < .6;
      // głębokość od najniższego punktu terenu nad halą (hala nie wystaje na skarpie)
      let surf = Infinity; for (let t = -L; t <= L; t += 8) for (const q of [-W, 0, W]) surf = Math.min(surf, ground(s.x + ux * t - uz * q, s.z + uz * t + ux * q));
      let y = surf - depth; if (k > 0) y = Math.min(y, prevY - 7); prevY = y;
      hs.push({ l, ux, uz, L, W, H, y, surf, island, R, side: { left: [], right: [] }, start: [6.4, 5.4], end: [6.4, 5.4] });
    });
    drafts.push(hs);
  }
  const hallOf = (s: Station, l: number) => drafts[s.i].find(h => h.l === l)!;
  // tunele
  const tunnels: Tunnel[] = [];
  for (const [a, b, l] of city.ed) {
    const A = stations[a], B = stations[b], ha = hallOf(A, l), hb = hallOf(B, l);
    const end = (S: Station, h: HallDraft, T: Station): XZ => { const sg = Math.sign((T.x - S.x) * h.ux + (T.z - S.z) * h.uz) || 1; return [S.x + h.ux * h.L * sg, S.z + h.uz * h.L * sg]; };
    tunnels.push({ l, a: end(A, ha, B), b: end(B, hb, A), ya: ha.y, yb: hb.y, A: A.name, B: B.name, reg: null });
  }
  // przesiadki, zejścia, korytarze techniczne i lokale (losowanie)
  const rampDrafts: Omit<Ramp, 'reg'>[] = [];
  for (const s of stations) {
    const hs = drafts[s.i];
    hs.forEach((h, k) => {
      if (k === 0) return; const up = hs[k - 1], dy = up.y - h.y, Lr = dy / .5, sg = k % 2 ? 1 : -1, t0 = 3 + (k - 1) * 5;
      rampDrafts.push({ s: s.i, hall: k, up: k - 1, ax: s.x + h.ux * t0 * sg, az: s.z + h.uz * t0 * sg, ux: h.ux * sg, uz: h.uz * sg, Lr });
    });
    const top = hs[0]; if (!top) continue;
    const R = top.R, ent = (entrances.get(s.i) || []).slice(0, 4), exits: Exit[] = [];
    for (const [ex, ez] of ent) {
      const dx = ex - s.x, dz = ez - s.z, t = Math.max(-top.L + 6, Math.min(top.L - 6, dx * top.ux + dz * top.uz)), sv = -dx * top.uz + dz * top.ux, side = sv >= 0 ? 1 : -1;
      const px = s.x + top.ux * t + (-top.uz) * side * (top.W - .5), pz = s.z + top.uz * t + top.ux * side * (top.W - .5);
      const D = Math.hypot(ex - px, ez - pz); if (D < 8) exits.push({ t, side }); else exits.push({ t, side, px, pz, ex, ez, D });
    }
    if (!exits.length) for (const sg of [-1, 1]) {
      const t = sg * (top.L - 10 - R() * 12); let side = R() < .5 ? -1 : 1;
      const len = (s.surf - top.y) / .55, nx = -top.uz * side, nz = top.ux * side, tx = s.x + top.ux * t + nx * (top.W + len), tz = s.z + top.uz * t + nz * (top.W + len);
      if (buildings.hit(tx, tz)) side = -side; exits.push({ t, side });
    }
    s.exits = exits;
    const nr = Math.floor(R() * 3);
    for (let i = 0; i < nr; i++) {
      const t = (R() * 2 - 1) * (top.L - 18);
      if (exits.some(e => Math.abs(e.t - t) < 8) || s.rooms.some(q => Math.abs(q.t - t) < 10)) continue;
      s.rooms.push({ t, side: R() < .5 ? -1 : 1, len: 10 + R() * 25, rw: 5 + R() * 4, rl: 8 + R() * 8 });
    }
  }
  // regiony hal (+ otwory w ścianach na zejścia i korytarze, krok filarów)
  for (const s of stations) drafts[s.i].forEach((h, k) => {
    if (k === 0) {
      for (const e of s.exits) (e.side < 0 ? h.side.left : h.side.right).push([e.t + h.L - 2.2, e.t + h.L + 2.2]);
      for (const q of s.rooms) (q.side < 0 ? h.side.left : h.side.right).push([q.t + h.L - 1.6, q.t + h.L + 1.6]);
    }
    h.reg = regions.add('hall', s.x - h.ux * h.L, s.z - h.uz * h.L, h.ux, h.uz, h.L * 2, h.W, h.y, h.y, { s: s.i, l: h.l });
    h.pillarStep = 8 + h.R() * 5;
  });
  for (const s of stations) s.halls = drafts[s.i].map(({ R: _R, ...h }) => h as Hall);
  // regiony tuneli
  for (const tn of tunnels) {
    const dx = tn.b[0] - tn.a[0], dz = tn.b[1] - tn.a[1], len = Math.hypot(dx, dz); if (len < 1) continue;
    tn.reg = regions.add('tunnel', tn.a[0], tn.a[1], dx / len, dz / len, len, 1.5, tn.ya, tn.yb, { l: tn.l, A: tn.A, B: tn.B });
  }
  // przejścia między liniami
  const ramps: Ramp[] = rampDrafts.map(rp => {
    const S = stations[rp.s];
    return { ...rp, reg: regions.add('ramp', rp.ax, rp.az, rp.ux, rp.uz, rp.Lr, 1.8, S.halls[rp.up].y, S.halls[rp.hall].y, { s: rp.s }) };
  });
  // zejścia i lokale
  const holes: XZ[][] = [];
  for (const s of stations) {
    const h = s.halls[0]; if (!h) continue; const u = [h.ux, h.uz], n = [-h.uz, h.ux];
    for (const e of s.exits) {
      const sx = s.x + u[0] * e.t + n[0] * e.side * (h.W - .5), sz = s.z + u[1] * e.t + n[1] * e.side * (h.W - .5);
      let stairA: XZ = [sx, sz], dir: XZ = [n[0] * e.side, n[1] * e.side], sl = (s.surf - h.y) / .55, corr: Region | null = null;
      if (e.ex != null && e.ez != null) {
        const dx = e.ex - sx, dz = e.ez - sz, D = Math.hypot(dx, dz); dir = [dx / D, dz / D];
        if (D > sl + 2) { const cl = D - sl; corr = regions.add('corr', sx, sz, dir[0], dir[1], cl, 1.7, h.y, h.y, { s: s.i }); stairA = [sx + dir[0] * cl, sz + dir[1] * cl]; }
        else sl = D;
      }
      const tx = stairA[0] + dir[0] * sl, tz = stairA[1] + dir[1] * sl, ty = ground(tx, tz); s.tops.push([tx, tz, dir]);
      let surfMin = ty; for (let t = 0; t <= sl; t += 4) surfMin = Math.min(surfMin, ground(stairA[0] + dir[0] * t, stairA[1] + dir[1] * t));
      const stair = regions.add('stair', stairA[0], stairA[1], dir[0], dir[1], sl, 1.8, h.y, ty, { s: s.i });
      const th = sl * (1 - 3.4 / (ty - h.y)), nn = [-dir[1], dir[0]], hw = 2.1;
      const P4 = ([[th, -hw], [sl + .2, -hw], [sl + .2, hw], [th, hw]] as XZ[]).map(([t, q]): XZ => [stairA[0] + dir[0] * t + nn[0] * q, stairA[1] + dir[1] * t + nn[1] * q]);
      holes.push(P4);
      s.exitGeoms.push({ sx, sz, corr, stair, top: [tx, tz, dir], ty, surfMin, P4 });
    }
    for (const q of s.rooms) {
      const ax = s.x + u[0] * q.t + n[0] * q.side * (h.W - .5), az = s.z + u[1] * q.t + n[1] * q.side * (h.W - .5), d = [n[0] * q.side, n[1] * q.side];
      q.corr = regions.add('corr', ax, az, d[0], d[1], q.len, 1.4, h.y, h.y, { s: s.i });
      q.room = regions.add('room', ax + d[0] * q.len, az + d[1] * q.len, d[0], d[1], q.rl, q.rw, h.y, h.y, { s: s.i, room: true });
    }
  }
  return { stations, tunnels, ramps, holes };
}
