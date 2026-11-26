// Bez ślepych końców (docs/ZADANIA.md, punkt 1): każda ścieżka i droga albo prowadzi do budynku
// (ścieżka – do drzwi wejściowych, droga – do bramy na podwórko), albo łączy się z inną w sensowną pętlę.
// Etap potoku tools/simplify-tiles.ts po wyprostowaniu ścieżek (geometria jest już ostateczna).
import type { TileBuilding, TileData, TileRoad } from '../../shared/src/tiles/types';
import { LANE_W } from '../../shared/src/tiles/build';
import { makePlan, type PlanWorld } from '../../shared/src/interiors/plan';
import { toWorld } from '../../shared/src/interiors/geom';
import { BldGrid, pip, ringOf, type Bld, type XZ } from './roads';

const PATH = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian']);
/** drogi, do których wolno dołączyć ścieżkę lub ślepą drogę (bez autostrad i dróg ekspresowych) */
const JOIN = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'living', 'pedestrian', 'footway', 'path', 'cycleway']);
const VEH_FIX = new Set(['residential', 'service', 'living', 'tertiary']);
const C = 40;

interface Seg { r: TileRoad; i: number; a: XZ; b: XZ; v: number }
type End = { r: TileRoad; e: 0 | 1; tile: TileData };

export interface DeadEndStats {
  pathDoor: number; pathWall: number; pathNoDoor: number; pathJoin: number; pathRemoved: number; pathLeft: number;
  vehOk: number; vehJoin: number; vehRemoved: number; vehLeft: number;
}

export function closeDeadEnds(tiles: Map<string, TileData>): DeadEndStats {
  const st: DeadEndStats = { pathDoor: 0, pathWall: 0, pathNoDoor: 0, pathJoin: 0, pathRemoved: 0, pathLeft: 0, vehOk: 0, vehJoin: 0, vehRemoved: 0, vehLeft: 0 };
  const G = new BldGrid(tiles);
  const grid = <T>() => new Map<string, T[]>();
  const put = <T>(m: Map<string, T[]>, x0: number, z0: number, x1: number, z1: number, v: T) => { for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = i + ',' + j; let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); } };
  const near = <T>(m: Map<string, T[]>, x: number, z: number, r: number) => { const s = new Set<T>(); for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (const v of m.get(i + ',' + j) ?? []) s.add(v); return s; };
  const water = grid<XZ[]>(), parking = grid<XZ[]>(), walls = grid<number[]>(), segs = grid<Seg>(), ends = grid<{ r: TileRoad; p: XZ }>();
  const bbox = (o: XZ[]) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1] as const; };
  // wersja geometrii drogi: odcinki ze starszej wersji (przed wstawieniem wierzchołka) są pomijane
  const ver = new Map<TileRoad, number>();
  const addSegs = (r: TileRoad) => { const v = (ver.get(r) ?? 0) + 1; ver.set(r, v); const p = ringOf(r.p); for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1]; put(segs, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { r, i, a, b, v }); } };
  const segsNear = (x: number, z: number, rr: number) => [...near(segs, x, z, rr)].filter(sg => sg.v === ver.get(sg.r));
  const deg = new Map<number, number>();
  for (const t of tiles.values()) {
    for (const a of t.a) if (a.k === 'water' || a.k === 'parking') { const o = ringOf(a.o); put(a.k === 'water' ? water : parking, ...bbox(o), o); }
    for (const f of t.fe ?? []) for (let i = 0; i + 3 < f.s.length; i += 4) { const s = f.s.slice(i, i + 4); put(walls, Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3]), s); }
    for (const l of t.l) for (let i = 0; i + 3 < l.p.length; i += 2) { const s = [l.p[i], l.p[i + 1], l.p[i + 2], l.p[i + 3]]; put(walls, Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3]), s); }
    for (const r of t.r) {
      for (let i = 1; i < r.j.length; i += 2) deg.set(r.j[i], (deg.get(r.j[i]) ?? 0) + 1);
      if (r.tu) continue; addSegs(r);
      const n = r.p.length / 2; for (const v of [0, n - 1]) { const p: XZ = [r.p[2 * v], r.p[2 * v + 1]]; put(ends, p[0], p[1], p[0], p[1], { r, p }); }
    }
  }
  const inWater = (x: number, z: number) => [...near(water, x, z, 0)].some(o => pip(o, x, z));
  const cross = (a: XZ, b: XZ, s: number[]) => {
    const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = s[2] - s[0], d2z = s[3] - s[1], den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) return false;
    const t = ((s[0] - a[0]) * d2z - (s[1] - a[1]) * d2x) / den, u = ((s[0] - a[0]) * d1z - (s[1] - a[1]) * d1x) / den; return t > .01 && t < .99 && u > -.001 && u < 1.001;
  };
  /** odcinek a→b wolny: bez budynków (poza docelowym na ostatnim metrze), wody, płotów, torów i przecięć z innymi drogami */
  const clear = (a: XZ, b: XZ, self: TileRoad, target: TileRoad | null, veh: boolean, sideM?: number) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .05) return true;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, side = sideM ?? (veh ? 2 : .8);
    for (let s = self.bp ? 1.5 : .5; s <= L - .6; s += 1) {
      const x = a[0] + ux * s, z = a[1] + uz * s;
      if (G.at(x, z) || G.at(x - uz * side, z + ux * side) || G.at(x + uz * side, z - ux * side) || inWater(x, z)) return false;
    }
    const r = L / 2 + 1, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    for (const s of near(walls, mx, mz, r)) if (cross(a, b, s)) return false;
    for (const sg of segsNear(mx, mz, r)) {
      if (sg.r === self || sg.r === target || sg.r.bp) continue;
      // ścieżka może przeciąć inną ścieżkę (w terenie i tak to skrzyżowanie), droga – żadnej jezdni ani ścieżki
      if (!veh && PATH.has(sg.r.k)) continue;
      if (cross(a, b, [sg.a[0], sg.a[1], sg.b[0], sg.b[1]])) return false;
    }
    return true;
  };
  let nid = -1_000_000_000;
  /** węzeł grafu w punkcie odcinka i drogi r (istniejący wierzchołek albo nowy) */
  const junction = (r: TileRoad, i: number, q: XZ): number => {
    const p = ringOf(r.p);
    for (const v of [i, i + 1]) if (Math.hypot(p[v][0] - q[0], p[v][1] - q[1]) < .6) {
      for (let k = 0; k < r.j.length; k += 2) if (r.j[k] === v) return r.j[k + 1];
      const id = nid--; const js: [number, number][] = []; for (let k = 0; k < r.j.length; k += 2) js.push([r.j[k], r.j[k + 1]]); js.push([v, id]); js.sort((x, y) => x[0] - y[0]); r.j = js.flat(); return id;
    }
    const id = nid--, js: [number, number][] = [];
    for (let k = 0; k < r.j.length; k += 2) js.push([r.j[k] > i ? r.j[k] + 1 : r.j[k], r.j[k + 1]]);
    js.push([i + 1, id]); js.sort((x, y) => x[0] - y[0]); r.j = js.flat();
    r.p = [...r.p.slice(0, 2 * (i + 1)), Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10, ...r.p.slice(2 * (i + 1))];
    addSegs(r); // nowa wersja odcinków tej drogi
    return id;
  };
  /** przedłużenie końca e drogi r do punktu q (z węzłem id albo bez) */
  const extend = (r: TileRoad, e: 0 | 1, q: XZ, id: number | null) => {
    const qx = Math.round(q[0] * 10) / 10, qz = Math.round(q[1] * 10) / 10;
    if (e === 0) {
      const js: number[] = []; if (id != null) js.push(0, id); for (let k = 0; k < r.j.length; k += 2) js.push(r.j[k] + 1, r.j[k + 1]);
      r.p = [qx, qz, ...r.p]; r.j = js;
    } else { r.p = [...r.p, qx, qz]; if (id != null) r.j = [...r.j, r.p.length / 2 - 1, id]; }
    addSegs(r);
    if (id != null) deg.set(id, (deg.get(id) ?? 0) + 1);
  };
  const endInfo = (r: TileRoad, e: 0 | 1) => {
    const p = ringOf(r.p), i = e ? p.length - 1 : 0, ip = e ? p.length - 2 : 1;
    let id: number | null = null; for (let k = 0; k < r.j.length; k += 2) if (r.j[k] === i) id = r.j[k + 1];
    return { p, P: p[i], Q: p[ip], id };
  };
  const isDead = (r: TileRoad, e: 0 | 1) => {
    const { P, id } = endInfo(r, e);
    if (id != null && (deg.get(id) ?? 0) >= 2) return false;
    // ciąg dalej w sąsiednim kaflu (koniec innej drogi w tym samym miejscu)
    for (const o of near(ends, P[0], P[1], .7)) if (o.r !== r && Math.hypot(o.p[0] - P[0], o.p[1] - P[1]) < .7) return false;
    // brama przejazdowa (inferPassages) zaczyna się przy końcu: wjazd na podwórko
    for (const sg of segsNear(P[0], P[1], 3)) if (sg.r.bp && sg.r !== r && sg.r.id < 0 && Math.min(Math.hypot(sg.a[0] - P[0], sg.a[1] - P[1]), Math.hypot(sg.b[0] - P[0], sg.b[1] - P[1])) < 3) return false;
    return true;
  };
  const lengthOf = (r: TileRoad) => { const p = ringOf(r.p); let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

  /** najbliższy punkt ściany budynku (do maxD), z wolnym dojściem */
  const wallTarget = (r: TileRoad, P: XZ, maxD: number, Q?: XZ): { q: Bld; w: XZ; out: XZ } | null => {
    // ściana przed końcem (nie za nim – np. ta, przez którą prowadzi brama)
    const fx = Q ? P[0] - Q[0] : 0, fz = Q ? P[1] - Q[1] : 0, fl = Math.hypot(fx, fz) || 1, minCos = r.bp ? .3 : -.2;
    let best: { q: Bld; w: XZ; out: XZ; d: number } | null = null;
    for (const q of G.around(P[0], P[1], maxD)) {
      if (q.b.part || q.A < 20) continue;
      for (const o of [q.o, ...q.holes]) for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; if (L2 < 1) continue;
        const t = Math.max(.15, Math.min(.85, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dz) / L2)), w: XZ = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(w[0] - P[0], w[1] - P[1]);
        if (d > maxD || (best && d >= best.d)) continue;
        if (Q && d > .05 && ((w[0] - P[0]) * fx + (w[1] - P[1]) * fz) / (d * fl) < minCos) continue;
        if (r.bp && d < 2) continue;
        const L = Math.sqrt(L2); let nx = -dz / L, nz = dx / L; if (G.at(w[0] + nx * .5, w[1] + nz * .5) === q) { nx = -nx; nz = -nz; }
        const out: XZ = [w[0] + nx * .4, w[1] + nz * .4];
        if (G.at(out[0], out[1])) continue; // ściana wspólna z sąsiadem
        if (!clear(P, out, r, null, false)) continue;
        best = { q, w, out, d };
      }
    }
    return best;
  };
  /** najlepsze połączenie z inną drogą (punkt na odcinku), do maxD; kierunek mniej więcej „do przodu” */
  const joinTarget = (r: TileRoad, P: XZ, Q: XZ, maxD: number, veh: boolean, ownId: number | null): { sg: Seg; q: XZ; d: number } | null => {
    const fx = P[0] - Q[0], fz = P[1] - Q[1], fl = Math.hypot(fx, fz) || 1;
    let best: { sg: Seg; q: XZ; d: number; score: number } | null = null;
    for (const sg of segsNear(P[0], P[1], maxD)) {
      if (sg.r === r || sg.r.bp || sg.r.br || !JOIN.has(sg.r.k)) continue;
      if (veh && (PATH.has(sg.r.k) || !LANE_W[sg.r.k])) continue;
      if (ownId != null && sg.r.j.some((v, k) => k % 2 === 1 && v === ownId)) continue;
      const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((P[0] - sg.a[0]) * dx + (P[1] - sg.a[1]) * dz) / L2));
      const q: XZ = [sg.a[0] + dx * t, sg.a[1] + dz * t], d = Math.hypot(q[0] - P[0], q[1] - P[1]); if (d > maxD || d < .3) continue;
      const cos = ((q[0] - P[0]) * fx + (q[1] - P[1]) * fz) / (d * fl); if (cos < -.35) continue; // nie zawracać
      const score = d * (1.6 - .6 * cos) * (veh || PATH.has(sg.r.k) ? 1 : 1.15);
      if (best && score >= best.score) continue;
      if (!clear(P, q, r, sg.r, veh)) continue;
      best = { sg, q, d, score };
    }
    return best;
  };

  /** droga wzdłuż obrysu budynku q od punktu A (przy ścianie) do B (przed drzwiami), max 45 m; null gdy za daleko */
  const aroundWall = (q: Bld, A: XZ, B: XZ): XZ[] | null => {
    const o = q.o, n = o.length; if (n < 3) return null;
    const edgeOf = (P: XZ) => { let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const a = o[i], b = o[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dz) / L2)), d = Math.hypot(a[0] + dx * t - P[0], a[1] + dz * t - P[1]); if (d < bd) { bd = d; bi = i; } } return bd < 3 ? bi : -1; };
    const ea = edgeOf(A), eb = edgeOf(B); if (ea < 0 || eb < 0) return null;
    const normal = (i: number): XZ => { const a = o[i], b = o[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; const m: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (G.at(m[0] + nx * .5, m[1] + nz * .5) === q) { nx = -nx; nz = -nz; } return [nx, nz]; };
    const corner = (v: number): XZ => { const n1 = normal((v - 1 + n) % n), n2 = normal(v); return [o[v][0] + (n1[0] + n2[0]) * 1.1, o[v][1] + (n1[1] + n2[1]) * 1.1]; };
    const walk = (dir: 1 | -1): XZ[] => { const pts: XZ[] = []; let i = ea; while (i !== eb && pts.length < n) { const v = dir > 0 ? (i + 1) % n : i; pts.push(corner(v)); i = (i + dir + n) % n; } return [...pts, B]; };
    const len = (pts: XZ[]) => { let L = 0, c = A; for (const q2 of pts) { L += Math.hypot(q2[0] - c[0], q2[1] - c[1]); c = q2; } return L; };
    const a1 = walk(1), a2 = walk(-1), best = len(a1) <= len(a2) ? a1 : a2;
    return len(best) <= 45 && best.length <= 5 ? best : null;
  };
  const doorEnds: { r: TileRoad; e: 0 | 1; q: Bld }[] = [];
  const remove = new Set<TileRoad>();
  // przejścia bramne z OSM (bp, id > 0) też: brama do nikąd zostaje dołączona do chodnika albo usunięta; bramy dorobione (id < 0) prowadzą z ulicy na podwórko
  const all: End[] = []; for (const t of tiles.values()) for (const r of t.r) if (!r.br && !r.tu && (!r.bp || (r.id > 0 && PATH.has(r.k)))) for (const e of [0, 1] as const) all.push({ r, e, tile: t });
  for (const { r, e, tile } of all) {
    if (remove.has(r) || !isDead(r, e)) continue;
    const { P, Q, id } = endInfo(r, e);
    if (r.bp) {
      const j = joinTarget(r, P, Q, 30, false, id);
      if (j) { const nidJ = junction(j.sg.r, j.sg.i, j.q); extend(r, e, j.q, nidJ); st.pathJoin++; }
      else {
        // brama wychodzi na podwórko (min. 3 m wolnego miejsca na wprost i obok) – zostaje; wprost w ścianę – usunięta
        const L = Math.hypot(P[0] - Q[0], P[1] - Q[1]) || 1, ux = (P[0] - Q[0]) / L, uz = (P[1] - Q[1]) / L;
        let open = true; for (let k = .5; k <= 3.5 && open; k += .5) for (const o of [0, -1.2, 1.2]) if (G.at(P[0] + ux * k - uz * o, P[1] + uz * k + ux * o)) { open = false; break; }
        if (!open || isDead(r, e ? 0 : 1)) { remove.add(r); st.pathRemoved++; continue; }
        // z bramy przez podwórko do drzwi oficyny
        const w = wallTarget(r, P, 22, Q);
        if (w) { extend(r, e, w.out, null); doorEnds.push({ r, e, q: w.q }); st.pathWall++; } else st.pathLeft++;
      }
      continue;
    }
    if (PATH.has(r.k)) {
      // 1) budynek tuż obok: ścieżka do jego ściany (potem do drzwi)
      const w0 = wallTarget(r, P, 12, Q);
      if (w0) { extend(r, e, w0.out, null); doorEnds.push({ r, e, q: w0.q }); st.pathWall++; continue; }
      // 2) połączenie z inną ścieżką / chodnikiem ulicy
      const j = joinTarget(r, P, Q, 30, false, id);
      if (j) { const nidJ = junction(j.sg.r, j.sg.i, j.q); extend(r, e, j.q, nidJ); st.pathJoin++; continue; }
      // 3) budynek dalej (do 22 m)
      const w1 = wallTarget(r, P, 22, Q);
      if (w1) { extend(r, e, w1.out, null); doorEnds.push({ r, e, q: w1.q }); st.pathWall++; continue; }
      // 4) krótka odnoga donikąd: usunięta
      if (lengthOf(r) < 50) { remove.add(r); st.pathRemoved++; } else st.pathLeft++;
    } else if (VEH_FIX.has(r.k)) {
      // dojazd do budynku (garaż, posesja) albo na parking: zostaje
      if (G.near(P[0], P[1], 15) && G.around(P[0], P[1], 15).some(q => { const o = q.o; for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dz) / L2)); if (Math.hypot(a[0] + dx * t - P[0], a[1] + dz * t - P[1]) < 15) return true; } return false; })) { st.vehOk++; continue; }
      if ([...near(parking, P[0], P[1], 6)].some(o => pip(o, P[0], P[1]) || o.some(([x, z]) => Math.hypot(x - P[0], z - P[1]) < 6))) { st.vehOk++; continue; }
      const j = joinTarget(r, P, Q, 45, true, id);
      if (j) { const nidJ = junction(j.sg.r, j.sg.i, j.q); extend(r, e, j.q, nidJ); st.vehJoin++; continue; }
      if (lengthOf(r) < 80 && !isDead(r, e ? 0 : 1)) { remove.add(r); st.vehRemoved++; } else st.vehLeft++;
    }
    void tile;
  }
  for (const t of tiles.values()) t.r = t.r.filter(r => !remove.has(r));

  // ścieżki przy budynkach: koniec przy drzwiach wejściowych (te same plany wnętrz co w grze)
  const tileOf = new Map<TileBuilding, TileData>(); for (const t of tiles.values()) for (const b of t.b) tileOf.set(b, t);
  const pw: PlanWorld = { ground: () => 0, baseOf: () => 0, blocked: (x, z) => !!G.at(x, z) || inWater(x, z), inBuilding: (x, z) => !!G.at(x, z) };
  const plans = new Map<TileBuilding, ReturnType<typeof makePlan>>();
  for (const { r, e, q } of doorEnds) {
    if (remove.has(r)) continue;
    const t = tileOf.get(q.b); if (!t) continue;
    let plan = plans.get(q.b); if (plan === undefined) { try { plan = makePlan(q.b, t, pw); } catch { plan = null; } plans.set(q.b, plan); }
    if (!plan || !plan.ext.length) { st.pathNoDoor++; continue; }
    const { p, P, Q } = endInfo(r, e);
    let best: XZ | null = null, bd = 1e9;
    for (const d of plan.ext) {
      const o = toWorld(plan.frame, d.x, -d.tOut - .3) as XZ, dd = Math.hypot(o[0] - P[0], o[1] - P[1]);
      if (dd < bd && dd < 40) { bd = dd; best = o; }
    }
    if (!best) continue;
    const i = e ? p.length - 1 : 0;
    if (clear(Q, best, r, null, false)) { r.p[2 * i] = Math.round(best[0] * 10) / 10; r.p[2 * i + 1] = Math.round(best[1] * 10) / 10; st.pathDoor++; st.pathWall--; continue; }
    if (clear(P, best, r, null, false)) { extend(r, e, best, null); st.pathDoor++; st.pathWall--; continue; }
    // drzwi na innej ścianie: wzdłuż obrysu (narożniki odsunięte o 1 m na zewnątrz), krótszą stroną
    const route = aroundWall(q, P, best);
    if (route && route.every((pt, k) => clear(k ? route[k - 1] : P, pt, r, null, false, .2))) { for (const pt of route) extend(r, e, pt, null); st.pathDoor++; st.pathWall--; }
  }
  return st;
}
