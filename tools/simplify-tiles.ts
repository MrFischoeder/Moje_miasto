// Uproszczenie i ujednolicenie kafli mapy (szybsza gra): zachowuje układ ulic i ważne budynki, resztę łączy w bryły
// kwartałów o ujednoliconej wysokości, usuwa drobnicę i wygładza geometrię. Pełne kafle zostają w tiles-pelne/.
//   npx tsx tools/simplify-tiles.ts --city warszawa
// Wejście: client/public/tiles-pelne/<miasto>/, wyjście: client/public/tiles/<miasto>/ (to czyta gra i serwer).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import pc from 'polygon-clipping';
import type { Flat, TileBuilding, TileData, TileIndex, TileRoad } from '../shared/src/tiles/types';
import { writeTiles } from './lib/common';
import { cityPavements, inferPassages, normalizeRoads } from './lib/roads';
import { makePlots } from './lib/plots';
import { CITIES, type CityKey } from '../shared/src/data/cities';
import { makeProj } from '../shared/src/data/projection';
import { obb } from '../shared/src/interiors/geom';
import { smoothStyles, styleOf, type BStyle } from '../shared/src/world/style';

const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2);
const city = argv[argv.indexOf('--city') + 1] || 'warszawa';
const src = join(ROOT, 'client/public/tiles-pelne', city), dst = join(ROOT, 'client/public/tiles', city);
if (!existsSync(join(src, 'index.json'))) { console.error(`Brak pełnych kafli w ${src}`); process.exit(1); }

type XZ = [number, number];
const ring = (f: Flat): XZ[] => { const o: XZ[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const flat = (r: XZ[]): Flat => r.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
const area = (r: XZ[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const len = (r: XZ[]) => { let s = 0; for (let i = 1; i < r.length; i++) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return s; };

/** Douglas–Peucker dla łamanej (końce zostają). */
function dp(p: XZ[], eps: number): XZ[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1; const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!, [ax, az] = p[a], [bx, bz] = p[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9; let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - ax) * dz - (p[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
/** Douglas–Peucker dla pierścienia (podział w dwóch najdalszych punktach). */
function dpRing(r: XZ[], eps: number): XZ[] {
  if (r.length <= 4) return r;
  let j = 0, md = 0; for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > md) { md = d; j = i; } }
  const out = [...dp(r.slice(0, j + 1), eps).slice(0, -1), ...dp([...r.slice(j), r[0]], eps).slice(0, -1)];
  return out.length >= 3 && area(out) > area(r) * .7 ? out : r;
}

// --- ważne budynki: zachowane z prawdziwym kształtem ---
const KEEP_T = ['church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'train_station', 'transportation', 'school', 'university', 'college',
  'kindergarten', 'hospital', 'public', 'civic', 'government', 'museum', 'theatre', 'stadium', 'sports_hall', 'castle', 'palace', 'fire_station'];
const DROP_T = ['garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'allotment_house', 'outbuilding', 'farm_auxiliary', 'container', 'kiosk', 'toilets', 'greenhouse'];
const SHOP_POI = ['convenience', 'supermarket', 'discount'];
/** Ujednolicone liczby kondygnacji (pasma). */
const BANDS = [1, 2, 3, 5, 8, 11, 14, 18, 24];
const band = (lv: number) => BANDS.reduce((b, v) => Math.abs(v - lv) < Math.abs(b - lv) ? v : b, BANDS[0]);

const stats = { b0: 0, b1: 0, v0: 0, v1: 0, r0: 0, r1: 0, a0: 0, a1: 0, merged: 0, kept: 0, st: {} as Record<string, number> };
const nearEdge0 = (o: XZ[], x: number, z: number, e: number) => { for (let i = 0; i < o.length; i++) { const [ax, az] = o[i], [bx, bz] = o[(i + 1) % o.length], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); if (Math.hypot(ax + dx * u - x, az + dz * u - z) < e) return true; } return false; };

/** Stare Miasto (data/cities.json, pole stare): budynki zostają osobno, z prawdziwym obrysem (kamienice) */
const ST = CITIES[city as CityKey]?.stare, stareC = ST ? makeProj(CITIES[city as CityKey].o)(ST[0], ST[1]) : null;
const inStare = (o: XZ[]) => { if (!ST || !stareC) return false; const cx = o.reduce((s, p) => s + p[0], 0) / o.length, cz = o.reduce((s, p) => s + p[1], 0) / o.length; return Math.hypot(cx - stareC[0], cz - stareC[1]) < ST[2]; };

function simplifyTile(t: TileData): TileData {
  const shopB = new Set(t.poi.filter(p => p.c === 'shop' && SHOP_POI.includes(p.t) && p.b != null).map(p => p.b!));
  const info = t.b.map(b => { const o = ring(b.o); return { b, o, A: area(o), H: b.h - b.mh }; });
  const important = (q: typeof info[0]) => !q.b.part && (inStare(q.o) || q.H >= 35 || (q.b.lv ?? 0) >= 12 || !!q.b.name || !!q.b.wd || !!q.b.hist || (!!q.b.rs && q.b.rs !== 'flat') || KEEP_T.includes(q.b.t) || shopB.has(q.b.id) || q.A > 6000);
  const impPolys = info.filter(important).map(q => q.o);
  const inside = (o: XZ[], x: number, z: number) => { let s = false; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, zi] = o[i], [xj, zj] = o[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; } return s; };
  // styk z innym budynkiem (zabudowa zwarta): wspólne lub bliskie krawędzie
  const attached = new Set<number>();
  { const G0 = 4, gr = new Map<string, number[]>(), base = info.filter(q => !q.b.part);
    base.forEach((q, i) => { for (const [x, z] of q.o) { const k = Math.floor(x / G0) + ',' + Math.floor(z / G0); let l = gr.get(k); if (!l) gr.set(k, l = []); if (l[l.length - 1] !== i) l.push(i); } });
    base.forEach((q, i) => { if (attached.has(q.b.id)) return; for (const [x, z] of q.o) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const j of gr.get((Math.floor(x / G0) + a) + ',' + (Math.floor(z / G0) + c)) || []) {
      if (j !== i && nearEdge0(base[j].o, x, z, .6)) { attached.add(q.b.id); attached.add(base[j].b.id); return; }
    } }); }
  const out: TileBuilding[] = [], idMap = new Map<number, number>(), cand: typeof info = [];
  const styled: { b: TileBuilding; x: number; z: number; st: BStyle; sure: boolean; res: boolean; lv: number; lvTag: boolean; W: number }[] = [];
  const setStyle = (b: TileBuilding, o: XZ[], members: number, att: boolean, lvTag: boolean, rs?: string) => {
    if (b.part) return;
    const f = obb(o), A = area(o), Pm = o.reduce((s, p, i) => s + Math.hypot(o[(i + 1) % o.length][0] - p[0], o[(i + 1) % o.length][1] - p[1]), 0), cx = o.reduce((s, p) => s + p[0], 0) / o.length, cz = o.reduce((s, p) => s + p[1], 0) / o.length;
    const lv = b.lv ?? Math.max(1, Math.round((b.h - b.mh) / 3.2));
    const r = styleOf({ t: b.t, lv, lvTag, A, W: f.W, D: f.D, rect: A / Math.max(1, f.W * f.D), dEff: 2 * A / Math.max(1, Pm), mE: Pm / o.length, holes: b.i?.length ?? 0, members, attached: att, yr: b.yr, hist: !!b.hist, rs, dc: stareC ? Math.hypot(cx - stareC[0], cz - stareC[1]) : 99999 });
    styled.push({ b, x: cx, z: cz, ...r, lvTag, W: f.W, res: ['apartments', 'residential', 'yes', 'dormitory', 'flats'].includes(b.t), lv });
  };
  for (const q of info) {
    stats.b0++; stats.v0 += q.o.length;
    const cx = q.o.reduce((s, p) => s + p[0], 0) / q.o.length, cz = q.o.reduce((s, p) => s + p[1], 0) / q.o.length;
    if (q.b.part) { // części budynków: tylko wysokie albo należące do ważnego budynku
      if (q.H >= 35 || impPolys.some(o => inside(o, cx, cz))) { out.push({ ...q.b, o: flat(dpRing(q.o, .4)) }); stats.kept++; }
      continue;
    }
    if (important(q)) { const nb: TileBuilding = { ...q.b, o: flat(dpRing(q.o, .4)), ...(q.b.i ? { i: q.b.i.map(h => flat(dpRing(ring(h), .4))) } : {}) }; out.push(nb); setStyle(nb, q.o, 1, attached.has(q.b.id), q.b.lv != null, q.b.rs); idMap.set(q.b.id, q.b.id); stats.kept++; continue; }
    if (q.A < 30 || (DROP_T.includes(q.b.t) && q.A < 400)) continue; // drobnica
    cand.push(q);
  }
  // --- łączenie stykających się budynków w kwartały (unia-find po wspólnych / bliskich wierzchołkach i krawędziach) ---
  const par = cand.map((_, i) => i), find = (i: number): number => par[i] === i ? i : (par[i] = find(par[i]));
  const G = 4, grid = new Map<string, number[]>();
  cand.forEach((q, i) => { for (const [x, z] of q.o) { const k = Math.floor(x / G) + ',' + Math.floor(z / G); let l = grid.get(k); if (!l) grid.set(k, l = []); if (l[l.length - 1] !== i) l.push(i); } });
  const nearEdge = (o: XZ[], x: number, z: number, e: number) => { for (let i = 0; i < o.length; i++) { const [ax, az] = o[i], [bx, bz] = o[(i + 1) % o.length], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); if (Math.hypot(ax + dx * u - x, az + dz * u - z) < e) return true; } return false; };
  cand.forEach((q, i) => {
    for (const [x, z] of q.o) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const j of grid.get((Math.floor(x / G) + a) + ',' + (Math.floor(z / G) + c)) || []) {
      if (j <= i || find(i) === find(j)) continue;
      // nie łączymy budynków o bardzo różnej wysokości (np. pawilon przy bloku)
      const h1 = q.H, h2 = cand[j].H; if (Math.max(h1, h2) > 2.2 * Math.min(h1, h2) + 3) continue;
      if (nearEdge(cand[j].o, x, z, .5)) par[find(i)] = find(j);
    }
  });
  const groups = new Map<number, typeof cand>(); cand.forEach((q, i) => { const r = find(i); let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(q); });
  for (const g of groups.values()) {
    // wysokość: mediana ważona powierzchnią, liczba kondygnacji w pasmach, wysokość kondygnacji z budynków
    const tagged = g.filter(q => q.b.lv != null), src = tagged.length && tagged.reduce((s, q) => s + q.A, 0) >= .3 * g.reduce((s, q) => s + q.A, 0) ? tagged : g;
    const lvH = src.map(q => ({ A: q.A, lv: q.b.lv ?? Math.max(1, Math.round(q.H / 3.1)), lh: q.H / (q.b.lv ?? Math.max(1, Math.round(q.H / 3.1))) })).sort((a, b) => a.lv - b.lv);
    const tot = lvH.reduce((s, q) => s + q.A, 0); let acc = 0, med = lvH[0];
    for (const q of lvH) { acc += q.A; if (acc >= tot / 2) { med = q; break; } }
    const lv = band(med.lv), lh = Math.max(2.8, Math.min(4, Math.round(med.lh * 10) / 10)), h = Math.round(lv * lh * 10) / 10;
    const types = new Map<string, number>(); for (const q of g) types.set(q.b.t, (types.get(q.b.t) ?? 0) + q.A);
    const t0 = [...types.entries()].sort((a, b) => b[1] - a[1])[0][0], main = g.reduce((a, q) => q.A > a.A ? q : a, g[0]);
    const id = Math.min(...g.map(q => q.b.id)); for (const q of g) idMap.set(q.b.id, id);
    // kształt dachu z OSM (płaski / stromy), jeśli opisana większość powierzchni; najstarszy rok budowy
    const rsA = new Map<string, number>(); for (const q of g) if (q.b.rs) { const k = q.b.rs === 'flat' ? 'flat' : 'gabled'; rsA.set(k, (rsA.get(k) ?? 0) + q.A); }
    const rsTop = [...rsA.entries()].sort((a, b) => b[1] - a[1])[0], rsG = rsTop && rsTop[1] >= g.reduce((s, q) => s + q.A, 0) / 2 ? rsTop[0] : undefined;
    const yrs = g.map(q => q.b.yr).filter((v): v is number => v != null), yr = yrs.length ? Math.min(...yrs) : undefined;
    let parts: XZ[][][];
    if (g.length === 1) parts = [[main.o, ...(main.b.i ?? []).map(ring)]];
    else {
      try { parts = (pc.union as (...geoms: pc.Geom[]) => pc.MultiPolygon)(...g.map(q => [[...q.o, q.o[0]], ...(q.b.i ?? []).map(h => { const r = ring(h); return [...r, r[0]]; })] as unknown as pc.Polygon)).map(poly => poly.map(r => (r as XZ[]).slice(0, -1))); stats.merged += g.length; }
      catch { parts = g.map(q => [q.o]); }
    }
    parts.forEach((poly, k) => {
      const o = dpRing(poly[0], 1.5); if (o.length < 3 || area(o) < 30) return;
      const holes = poly.slice(1).filter(hh => area(hh) > 100).map(hh => flat(dpRing(hh, 1.5)));
      const nb: TileBuilding = { id: k ? id * 10 + k : id, o: flat(o), ...(holes.length ? { i: holes } : {}), h, mh: 0, t: t0, lv, ...(main.b.a ? { a: main.b.a } : {}), ...(yr ? { yr } : {}), ...(rsG ? { rs: rsG } : {}) };
      out.push(nb); setStyle(nb, o, g.length, g.length > 1 || g.some(q => attached.has(q.b.id)), g.some(q => q.b.lv != null), rsG);
    });
  }
  smoothStyles(styled); for (const q of styled) {
    q.b.st = q.st;
    // blok bez opisanej liczby kondygnacji (domyślne 9 m): typowe 5 kondygnacji (krótkie segmenty 4)
    if (q.st === 'blok' && !q.lvTag && q.lv < 4) { q.b.lv = q.W >= 30 ? 5 : 4; q.b.h = Math.round((q.b.lv * 2.8 + .6) * 10) / 10; } stats.st[q.st] = (stats.st[q.st] ?? 0) + 1; }
  for (const b of out) { stats.b1++; stats.v1 += b.o.length / 2; }
  // --- drogi: bez drobnych ścieżek i dojazdów; mniej punktów, węzły grafu zachowane ---
  const roads: TileRoad[] = [], deg = new Map<number, number>();
  for (const r of t.r) for (let i = 1; i < r.j.length; i += 2) deg.set(r.j[i], (deg.get(r.j[i]) ?? 0) + 1);
  for (const r of t.r) {
    stats.r0++; const p = ring(r.p), L = len(p);
    // ślepa końcówka: jeden z końców nie łączy się z inną drogą (dojścia do drzwi, krótkie wjazdy)
    const ends = [r.j[1], r.j[r.j.length - 1]], stub = r.j[0] !== 0 || r.j[r.j.length - 2] !== p.length - 1 || ends.some(id => (deg.get(id) ?? 0) < 2);
    if (r.k === 'track' || (!r.br && !r.tu && !r.bp && stub && ((['footway', 'path', 'cycleway', 'steps'].includes(r.k) && L < 40) || (r.k === 'service' && L < 60)))) continue;
    const jv = new Set<number>(); for (let i = 0; i < r.j.length; i += 2) jv.add(r.j[i]);
    const cut = [0, ...[...jv].filter(v => v > 0 && v < p.length - 1).sort((a, b) => a - b), p.length - 1];
    const np: XZ[] = [], map = new Map<number, number>();
    for (let s = 0; s + 1 < cut.length; s++) {
      const seg = dp(p.slice(cut[s], cut[s + 1] + 1), r.br ? .3 : 1);
      if (!np.length) { map.set(cut[s], 0); np.push(seg[0]); }
      for (let q = 1; q < seg.length; q++) np.push(seg[q]); map.set(cut[s + 1], np.length - 1);
    }
    const j: number[] = []; for (let i = 0; i < r.j.length; i += 2) j.push(map.get(r.j[i]) ?? 0, r.j[i + 1]);
    roads.push({ ...r, p: flat(np), j }); stats.r1++;
  }
  // --- tereny: bez bardzo małych, gładsze obrysy ---
  const areas = t.a.filter(a => { stats.a0++; return a.k === 'water' || area(ring(a.o)) >= 300; }).map(a => {
    stats.a1++; const o = dpRing(ring(a.o), 2); const i = (a.i ?? []).filter(h => area(ring(h)) > 50).map(h => flat(dpRing(ring(h), 2)));
    return { ...a, o: flat(o), ...(i.length ? { i } : {}) };
  });
  const rails = t.l.map(l => ({ ...l, p: flat(dp(ring(l.p), .7)) }));
  const ways = (t.w ?? []).map(q => ({ ...q, p: flat(dp(ring(q.p), .8)) }));
  const poi = t.poi.map(p => p.b != null && idMap.has(p.b) ? { ...p, b: idMap.get(p.b) } : p);
  return { ...t, b: out, r: roads, a: areas, l: rails, poi, ...(ways.length ? { w: ways } : {}) };
}

const idx = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8')) as TileIndex, tiles = new Map<string, TileData>();
let n = 0;
for (const f of readdirSync(src)) {
  if (!f.endsWith('.json.gz')) continue;
  const t = JSON.parse(gunzipSync(readFileSync(join(src, f))).toString('utf8')) as TileData;
  tiles.set(t.x + '_' + t.y, simplifyTile(t));
  if (++n % 100 === 0) console.log(`${n}/${idx.tiles.length}`);
}
const rn = normalizeRoads(tiles); console.log(`ulice: ${rn.roads} odcinków, wyrównane krótkie: ${rn.absorbed}, płynne zwężenia: ${rn.tapers}`);
const ps = inferPassages(tiles); console.log(`bramy przejazdowe: przez budynek ${ps.through}, ślepe końce przy ścianie ${ps.deadEnd}`);
const pl = makePlots(tiles); console.log(`posesje z płotem: ${pl.plots} (pominięte ${pl.skipped}), odcinki płotu ${pl.segs}`);
const pv = cityPavements(tiles); console.log(`chodniki: ulice miejskie ${pv.urban} (dodane chodniki ${pv.added}), podmiejskie ${pv.suburban}`);
const ix = writeTiles(city, tiles, dst, idx.source + ' · uproszczone (tools/simplify-tiles.ts)');
const kb = (a: number) => (a / 1024 / 1024).toFixed(1) + ' MB';
console.log('style:', JSON.stringify(stats.st));
console.log(`budynki ${stats.b0} → ${stats.b1} (ważne zachowane: ${stats.kept}, połączone w kwartały: ${stats.merged}); wierzchołki budynków ${stats.v0} → ${stats.v1}`);
console.log(`drogi ${stats.r0} → ${stats.r1}; tereny ${stats.a0} → ${stats.a1}; rozmiar ${kb(idx.tiles.reduce((s, q) => s + q[2], 0))} → ${kb(ix.tiles.reduce((s, q) => s + q[2], 0))}`);
