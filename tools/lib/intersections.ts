// Skrzyżowania z grafu dróg OSM (cała mapa naraz, po uproszczeniu kafli). OSM opisuje duże skrzyżowanie jako kilka
// węzłów (każda jezdnia ulicy dwujezdniowej, krótkie łączniki, osobne węzły sygnalizacji). Tu łączymy je w jedno
// skrzyżowanie: jedna sygnalizacja (fazy wg osi głównej), jeden rodzaj pierwszeństwa, lista wlotów z linią zatrzymania.
// Wynik: TileJunction (shared/src/tiles/types.ts) w każdym kaflu, w którym leży któryś z jego węzłów.
// Używane przez ruch NPC (światła: shared/src/traffic) i rysowanie (linie zatrzymania, sygnalizatory przy wlotach).
import { LANE_W } from '../../shared/src/tiles/build';
import type { RoadClass, TileData, TileJunction } from '../../shared/src/tiles/types';

const RANK: Partial<Record<RoadClass, number>> = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1, living: 0, service: 0 };
/** łącznik krótszy niż tyle [m] między węzłami skrzyżowania = wnętrze skrzyżowania */
const LINK = 28;

export function buildIntersections(tiles: Map<string, TileData>): { junctions: number; signals: number; merged: number } {
  interface N { id: number; x: number; z: number; sig: boolean; tiles: Set<string> }
  interface Seg { a: number; b: number; len: number; k: RoadClass; w: number; name: string; ow: number; ha: number; hb: number }
  const nodes = new Map<number, N>(), segs: Seg[] = [];
  for (const [k, t] of tiles) {
    for (const g of t.g) { let n = nodes.get(g.id); if (!n) nodes.set(g.id, n = { id: g.id, x: g.x, z: g.z, sig: false, tiles: new Set() }); n.tiles.add(k); if (g.sig) n.sig = true; }
    for (const r of t.r) {
      if (!LANE_W[r.k] || r.tu || r.j.length < 4) continue;
      for (let i = 0; i + 3 < r.j.length; i += 2) {
        const ia = r.j[i], ib = r.j[i + 2], p = r.p; let len = 0; for (let v = ia; v < ib; v++) len += Math.hypot(p[2 * v + 2] - p[2 * v], p[2 * v + 3] - p[2 * v + 1]);
        // kierunki przy końcach: od węzła w głąb odcinka
        const ha = Math.atan2(p[2 * ia + 3] - p[2 * ia + 1], p[2 * ia + 2] - p[2 * ia]), hb = Math.atan2(p[2 * ib - 1] - p[2 * ib + 1], p[2 * ib - 2] - p[2 * ib]);
        segs.push({ a: r.j[i + 1], b: r.j[i + 3], len, k: r.k, w: r.w, name: r.n ?? '', ow: r.ow ?? 0, ha, hb });
      }
    }
  }
  // stopień węzła (liczba odcinków jezdni)
  const deg = new Map<number, number>(); for (const s of segs) { deg.set(s.a, (deg.get(s.a) ?? 0) + 1); deg.set(s.b, (deg.get(s.b) ?? 0) + 1); }
  const cand = (id: number) => (deg.get(id) ?? 0) >= 3 || !!nodes.get(id)?.sig;
  // union-find: krótkie łączniki między węzłami skrzyżowania
  const par = new Map<number, number>(), find = (x: number): number => { let r = x; while (par.has(r) && par.get(r) !== r) r = par.get(r)!; let y = x; while (par.has(y) && par.get(y) !== r) { const n = par.get(y)!; par.set(y, r); y = n; } return r; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
  for (const id of nodes.keys()) if (cand(id)) par.set(id, id);
  let merged = 0;
  for (const s of segs) if (s.len < LINK && cand(s.a) && cand(s.b)) { union(s.a, s.b); merged++; }
  const groups = new Map<number, number[]>(); for (const id of par.keys()) { const r = find(id); let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(id); }
  let junctions = 0, signals = 0;
  for (const t of tiles.values()) delete t.jx;
  for (const ids of groups.values()) {
    const set = new Set(ids), ns = ids.map(i => nodes.get(i)!).filter(Boolean); if (!ns.length) continue;
    const isJn = ids.some(i => (deg.get(i) ?? 0) >= 3), sig = ns.some(n => n.sig); if (!isJn && !sig) continue;
    const cx = ns.reduce((s, n) => s + n.x, 0) / ns.length, cz = ns.reduce((s, n) => s + n.z, 0) / ns.length;
    // wloty: odcinki z węzła na brzegu skrzyżowania do węzła poza nim (kierunek wjazdu = od zewnątrz do węzła)
    const legs: { node: number; head: number; k: RoadClass; w: number; name: string; inbound: boolean; ow: boolean }[] = [];
    for (const s of segs) for (const [n, o, h, dirIn] of [[s.a, s.b, s.ha, s.ow !== 1], [s.b, s.a, s.hb, s.ow !== -1]] as [number, number, number, boolean][]) {
      if (!set.has(n) || set.has(o)) continue;
      legs.push({ node: n, head: h + Math.PI, k: s.k, w: s.w, name: s.name, inbound: dirIn, ow: !!s.ow });
    }
    if (isJn && legs.length < 2) continue;
    // oś główna: najwyższa klasa (przy remisie najszersza jezdnia)
    const top = legs.slice().sort((a, b) => (RANK[b.k] ?? 0) - (RANK[a.k] ?? 0) || b.w - a.w)[0];
    const ax = top ? Math.atan2(Math.sin(top.head * 2), Math.cos(top.head * 2)) / 2 : 0;
    const along = (h: number) => Math.abs(Math.cos(h - ax)) > .7071;
    // pierwszeństwo: wloty wzdłuż osi głównej o najwyższej klasie są główne, gdy żaden poprzeczny nie ma tej klasy
    const topRank = top ? RANK[top.k] ?? 0 : 0, mainLegs = legs.filter(l => (RANK[l.k] ?? 0) === topRank && along(l.head)), crossTop = legs.some(l => (RANK[l.k] ?? 0) === topRank && !along(l.head));
    const k: TileJunction['k'] = sig ? (isJn ? 'sig' : 'cross') : !crossTop && mainLegs.length >= 2 ? 'pri' : 'eq';
    const rad = Math.max(4, ...ns.map(n => Math.hypot(n.x - cx, n.z - cz)));
    const a: number[] = []; for (const l of legs) if (l.inbound) a.push(l.node, Math.round(l.head * 1000) / 1000, k === 'pri' ? (mainLegs.includes(l) ? 1 : 0) : 1, l.w, l.ow ? 1 : 0);
    const J: TileJunction = { id: Math.min(...ids), c: [Math.round(cx * 10) / 10, Math.round(cz * 10) / 10], r: Math.round(rad * 10) / 10, k, ax: Math.round(ax * 1000) / 1000, n: ids, a };
    const where = new Set<string>(); for (const n of ns) for (const tk of n.tiles) where.add(tk);
    for (const tk of where) { const t = tiles.get(tk); if (t) (t.jx ??= []).push(J); }
    junctions++; if (sig) signals++;
  }
  return { junctions, signals, merged };
}
