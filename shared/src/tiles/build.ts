// Budowa kafelków z surowych danych OSM: budynki (z dziedzińcami), graf drogowy z pasami,
// tereny (parki, woda), tory, węzły (sygnalizacja, przejścia), punkty sklepów i usług, adresy.
// Ten sam kod uruchamia skrypt tools/fetch-osm.ts i gra przy wczytywaniu pliku OSM.
import { makeProj, type Proj } from '../data/projection';
import type { LonLat, Tags } from '../osm/features';
import { heightOf, num } from '../osm/heights';
import { lookOf, monumentKind } from '../osm/look';
import { multipolygon } from '../osm/assemble';
import type { RawOsm, RawWay } from '../osm/raw';
import { pip, type XZ } from '../world/collision';
import { clipRing, ringArea, splitPolyline, tileRange } from './clip';
import {
  TILE_SIZE, TILE_VERSION, tileKey, tileOf,
  type AreaKind, type Flat, type GraphNode, type NodeKind, type RailKind, type RoadClass, type TileData, type TileNode, type WaterwayKind,
} from './types';

const r1 = (v: number) => Math.round(v * 10) / 10;
const flat = (pts: XZ[]): Flat => { const f: Flat = []; for (const [x, z] of pts) f.push(r1(x), r1(z)); return f; };

/** Rzutuje pierścień; usuwa powtórzony punkt zamykający. */
function ring(ll: LonLat[], proj: Proj): XZ[] {
  const p = ll.map(([lo, la]) => proj(la, lo));
  if (p.length > 2 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  return p;
}

// ---------- klasyfikacja ----------
const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 'motorway', motorway_link: 'motorway', trunk: 'trunk', trunk_link: 'trunk',
  primary: 'primary', primary_link: 'primary', secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary', residential: 'residential', unclassified: 'residential', road: 'residential',
  service: 'service', living_street: 'living', pedestrian: 'pedestrian', footway: 'footway', bridleway: 'path',
  cycleway: 'cycleway', path: 'path', steps: 'steps', track: 'track',
};
/** szerokość pasa [m] */
export const LANE_W: Partial<Record<RoadClass, number>> = { motorway: 3.5, trunk: 3.5, primary: 3.25, secondary: 3.25, tertiary: 3, residential: 3, service: 2.75, living: 2.75 };
/** domyślna liczba pasów (dwukierunkowa / jednokierunkowa) */
const LANES: Partial<Record<RoadClass, [number, number]>> = { motorway: [4, 2], trunk: [4, 2], primary: [2, 2], secondary: [2, 1], tertiary: [2, 1], residential: [2, 1], service: [1, 1], living: [1, 1] };
const PATH_W: Partial<Record<RoadClass, number>> = { pedestrian: 5, footway: 2, cycleway: 2, path: 1.6, steps: 2, track: 3 };
export const isVehicleRoad = (k: RoadClass) => k in LANE_W;

function roadInfo(t: Tags): { k: RoadClass; w: number; ln: number; ow?: 1 | -1 } | null {
  const k = ROAD_CLASS[t.highway]; if (!k || t.area === 'yes') return null;
  if (t.footway === 'sidewalk' && k === 'footway') { /* chodnik jako osobna droga */ }
  const ow: 1 | -1 | undefined = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || (k === 'motorway' && t.oneway !== 'no') ? 1 : t.oneway === '-1' ? -1 : undefined;
  const lw = LANE_W[k];
  if (!lw) { const w = num(t.width) ?? PATH_W[k] ?? 2; return { k, w, ln: 0 }; }
  const lanes = Math.max(1, Math.round(num(t.lanes) ?? LANES[k]![ow ? 1 : 0]));
  const w = num(t.width) ?? Math.max(lanes * lw, ow ? 3.5 : 5);
  return { k, w: Math.min(w, 40), ln: lanes, ow };
}

function areaKind(t: Tags): AreaKind | null {
  if (t.natural === 'water' || t.water || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (['park', 'garden', 'dog_park'].includes(t.leisure) || ['grass', 'meadow', 'recreation_ground', 'village_green', 'flowerbed'].includes(t.landuse) || ['grassland', 'scrub', 'heath'].includes(t.natural)) return 'park';
  if (['pitch', 'playground', 'track', 'sports_centre'].includes(t.leisure)) return 'pitch';
  if (t.amenity === 'parking' && !['underground', 'multi-storey'].includes(t.parking)) return 'parking';
  if (t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes')) return 'square';
  return null;
}

const RAIL: Record<string, RailKind> = { rail: 'rail', tram: 'tram', light_rail: 'light_rail', subway: 'subway', narrow_gauge: 'narrow_gauge' };

function nodeKind(t: Tags): NodeKind | null {
  if (t.highway === 'traffic_signals') return 'signals';
  if (t.highway === 'crossing' || (t.crossing && t.highway !== 'traffic_signals')) return 'crossing';
  if (t.highway === 'stop') return 'stop';
  if (t.highway === 'give_way') return 'give_way';
  if (t.highway === 'street_lamp') return 'lamp';
  if (t.railway === 'tram_stop') return 'tram_stop';
  if (t.railway === 'subway_entrance') return 'entrance';
  if ((t.railway === 'station' && t.station === 'subway') || (t.public_transport === 'station' && t.subway === 'yes')) return 'station';
  return null;
}

const BORING_AMENITY = new Set(['bench', 'waste_basket', 'bicycle_parking', 'parking_entrance', 'parking_space', 'recycling', 'waste_disposal', 'drinking_water', 'clock', 'post_box', 'telephone', 'grit_bin', 'hunting_stand', 'shelter', 'vending_machine', 'parking', 'motorcycle_parking', 'charging_station', 'bicycle_rental', 'loading_dock', 'fountain', 'smoking_area', 'letter_box', 'ticket_validator']);
const addr = (t: Tags) => t['addr:housenumber'] ? ((t['addr:street'] || t['addr:place'] || '') + ' ' + t['addr:housenumber']).trim() : undefined;

// ---------- budowa ----------
export interface BuildOptions {
  /** tylko kafelki z tego zakresu [x0, y0, x1, y1] (włącznie) */
  range?: [number, number, number, number];
}

export function buildTiles(raw: RawOsm, cityKey: string, origin: [number, number], opt: BuildOptions = {}): Map<string, TileData> {
  const proj = makeProj(origin), tiles = new Map<string, TileData>();
  const inRange = (x: number, y: number) => !opt.range || (x >= opt.range[0] && y >= opt.range[1] && x <= opt.range[2] && y <= opt.range[3]);
  const tile = (x: number, y: number): TileData | null => {
    if (!inRange(x, y)) return null;
    const k = tileKey(x, y); let t = tiles.get(k);
    if (!t) tiles.set(k, t = { v: TILE_VERSION, city: cityKey, x, y, size: TILE_SIZE, b: [], r: [], a: [], l: [], n: [], g: [], poi: [] });
    return t;
  };
  const nodeXZ = (id: number): XZ | null => { const n = raw.nodes.get(id); return n ? proj(n.lat, n.lon) : null; };

  // --- budynki (drogi i relacje multipolygon) ---
  const buildingTiles = new Map<number, TileData>();
  const addBuilding = (id: number, t: Tags, outer: XZ[], inner: XZ[][]) => {
    if (outer.length < 3) return;
    let cx = 0, cz = 0; for (const [x, z] of outer) { cx += x; cz += z; } cx /= outer.length; cz /= outer.length;
    const tt = tile(...tileOf(cx, cz)); if (!tt) return;
    const { h, mh } = heightOf(t), lv = num(t['building:levels']);
    tt.b.push({
      id, o: flat(outer), ...(inner.length ? { i: inner.map(flat) } : {}), h: r1(h), mh: r1(mh), t: t.building || t['building:part'] || 'yes',
      ...(lv != null ? { lv } : {}), ...(t['building:part'] && !t.building ? { part: 1 as const } : {}),
      ...(addr(t) ? { a: addr(t) } : {}), ...(t.name ? { name: t.name } : {}), ...lookOf(t, h, mh),
    });
    buildingTiles.set(id, tt);
  };
  const isBuilding = (t?: Tags) => !!t && ((t.building && t.building !== 'no') || !!t['building:part']);

  // --- tereny ---
  const addArea = (id: number, k: AreaKind, outer: XZ[], inner: XZ[][]) => {
    if (outer.length < 3) return;
    const [x0, y0, x1, y1] = tileRange(outer);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const t = tile(x, y); if (!t) continue;
      const bx = x * TILE_SIZE, bz = y * TILE_SIZE, c = clipRing(outer, bx, bz, bx + TILE_SIZE, bz + TILE_SIZE);
      if (c.length < 3 || Math.abs(ringArea(c)) < 1) continue;
      const holes = inner.map(h => clipRing(h, bx, bz, bx + TILE_SIZE, bz + TILE_SIZE)).filter(h => h.length >= 3 && Math.abs(ringArea(h)) >= 1);
      t.a.push({ id, k, o: flat(c), ...(holes.length ? { i: holes.map(flat) } : {}) });
    }
  };

  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t) continue;
    if (isBuilding(t)) { const c = raw.wayCoords(w); if (c.length >= 4) addBuilding(w.id, t, ring(c, proj), []); continue; }
    const ak = areaKind(t);
    if (ak) { const c = raw.wayCoords(w); if (c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) addArea(w.id, ak, ring(c, proj), []); }
  }
  for (const r of raw.relations.values()) {
    const t = r.tags; if (!t || t.type !== 'multipolygon') continue;
    const b = isBuilding(t), ak = b ? null : areaKind(t); if (!b && !ak) continue;
    for (const p of multipolygon(raw, r)) {
      const outer = ring(p.outer, proj), inner = p.inner.map(h => ring(h, proj));
      if (b) addBuilding(r.id, t, outer, inner); else addArea(r.id, ak!, outer, inner);
    }
  }

  // --- ciągi mostów (kilka dróg OSM połączonych końcami): końce i położenie każdej drogi ---
  const bridgeInfo = bridgeChains(raw, proj);

  // --- drogi i graf ---
  const roads: { w: RawWay; info: NonNullable<ReturnType<typeof roadInfo>> }[] = [];
  const use = new Map<number, number>();
  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t || !t.highway) continue; const info = roadInfo(t); if (!info) continue;
    roads.push({ w, info }); for (const id of w.nodes || []) use.set(id, (use.get(id) || 0) + 1);
  }
  const special = new Map<number, NodeKind>();
  for (const n of raw.nodes.values()) { if (!n.tags) continue; const k = nodeKind(n.tags); if (k) special.set(n.id, k); }
  const nodeDir = new Map<number, number>();
  const graphAdded = new Set<string>();
  for (const { w, info } of roads) {
    const t = w.tags!, coords = raw.wayCoords(w); if (coords.length < 2) continue;
    const pts = coords.map(([lo, la]) => proj(la, lo)), ids = w.nodes && w.nodes.length === pts.length ? w.nodes : null;
    const sw = t.sidewalk === 'both' ? 3 : t.sidewalk === 'left' ? 1 : t.sidewalk === 'right' ? 2 : (t['sidewalk:left'] === 'yes' ? 1 : 0) | (t['sidewalk:right'] === 'yes' ? 2 : 0) || (t['sidewalk:both'] === 'yes' ? 3 : 0);
    const br = t.bridge && t.bridge !== 'no' ? Math.max(1, num(t.layer) ?? 1) : undefined;
    if (ids) for (let i = 0; i < ids.length; i++) if (special.has(ids[i]) && !nodeDir.has(ids[i])) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; nodeDir.set(ids[i], Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    const bi = br ? bridgeInfo.get(w.id) : undefined, arcs = bi ? arcLengths(pts) : null;
    for (const [tx, ty, i0, i1] of splitPolyline(pts)) {
      const tt = tile(tx, ty); if (!tt) continue;
      const j: number[] = [];
      const bw = bi && arcs ? [r1(bi.a[0]), r1(bi.a[1]), r1(bi.b[0]), r1(bi.b[1]), r1(bi.s + bi.dir * arcs[i0]), bi.dir, r1(bi.total)] : undefined;
      if (ids) for (let i = i0; i <= i1; i++) {
        const id = ids[i], isG = i === i0 || i === i1 || (use.get(id) || 0) > 1 || special.get(id) === 'signals' || special.get(id) === 'crossing';
        if (!isG) continue; j.push(i - i0, id);
        const gk = tt.x + '_' + tt.y + ':' + id;
        if (!graphAdded.has(gk)) {
          graphAdded.add(gk); const s = special.get(id);
          const g: GraphNode = { id, x: r1(pts[i][0]), z: r1(pts[i][1]) }; if ((use.get(id) || 0) > 1) g.jn = 1; if (s === 'signals') g.sig = 1; if (s === 'crossing') g.cr = 1; tt.g.push(g);
        }
      }
      tt.r.push({
        id: w.id, p: flat(pts.slice(i0, i1 + 1)), k: info.k, w: r1(info.w), ln: info.ln, ...(info.ow ? { ow: info.ow } : {}),
        ...(t.name ? { n: t.name } : {}), ...(br ? { br } : {}), ...(bw ? { bw } : {}), ...(t.tunnel && t.tunnel !== 'no' ? { tu: 1 as const } : {}), ...(sw ? { sw } : {}), j,
      });
    }
  }

  // --- tory ---
  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t || !t.railway) continue; const k = RAIL[t.railway]; if (!k) continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    const pts = raw.wayCoords(w).map(([lo, la]) => proj(la, lo)); if (pts.length < 2) continue;
    const br = t.bridge && t.bridge !== 'no' ? Math.max(1, num(t.layer) ?? 1) : undefined;
    const bi = br ? bridgeInfo.get(w.id) : undefined, arcs = bi ? arcLengths(pts) : null;
    for (const [tx, ty, i0, i1] of splitPolyline(pts)) {
      const tt = tile(tx, ty); if (!tt) continue;
      const bw = bi && arcs ? [r1(bi.a[0]), r1(bi.a[1]), r1(bi.b[0]), r1(bi.b[1]), r1(bi.s + bi.dir * arcs[i0]), bi.dir, r1(bi.total)] : undefined;
      tt.l.push({ id: w.id, k, p: flat(pts.slice(i0, i1 + 1)), ...(br ? { br } : {}), ...(bw ? { bw } : {}) });
    }
  }

  // --- cieki: rzeki, strumienie, kanały, rowy (bez przepustów i odcinków pod ziemią) ---
  const WW: Record<string, [WaterwayKind, number]> = { river: ['river', 12], canal: ['canal', 7], stream: ['stream', 3], ditch: ['ditch', 1.5], drain: ['ditch', 1.5] };
  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t || !t.waterway) continue; const spec = WW[t.waterway]; if (!spec) continue;
    if ((t.tunnel && t.tunnel !== 'no') || t.location === 'underground') continue;
    const pts = raw.wayCoords(w).map(([lo, la]) => proj(la, lo)); if (pts.length < 2) continue;
    const wd = Math.max(.8, Math.min(60, num(t.width) ?? spec[1]));
    for (const [tx, ty, i0, i1] of splitPolyline(pts)) {
      const tt = tile(tx, ty); if (!tt) continue;
      (tt.w ??= []).push({ id: w.id, k: spec[0], p: flat(pts.slice(i0, i1 + 1)), wd, ...(t.name ? { n: t.name } : {}) });
    }
  }

  // --- węzły specjalne ---
  for (const [id, k] of special) {
    const p = nodeXZ(id); if (!p) continue; const tt = tile(...tileOf(p[0], p[1])); if (!tt) continue;
    const t = raw.nodes.get(id)!.tags!, nd: TileNode = { id, k, x: r1(p[0]), z: r1(p[1]) };
    const d = nodeDir.get(id); if (d != null) nd.d = Math.round(d * 1000) / 1000;
    const name = t.name || t.ref; if (name && (k === 'station' || k === 'entrance' || k === 'tram_stop')) nd.n = name;
    tt.n.push(nd);
  }

  // --- punkty sklepów i usług, adresy ---
  const inBuilding = (tt: TileData, x: number, z: number) => {
    for (const b of tt.b) {
      if (b.part) continue; const o = b.o; let a = Infinity, bb = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < o.length; i += 2) { a = Math.min(a, o[i]); bb = Math.max(bb, o[i]); c = Math.min(c, o[i + 1]); d = Math.max(d, o[i + 1]); }
      if (x < a || x > bb || z < c || z > d) continue;
      const poly: XZ[] = []; for (let i = 0; i < o.length; i += 2) poly.push([o[i], o[i + 1]]);
      if (pip(poly, x, z)) return b;
    }
    return null;
  };
  const addPoi = (id: number, t: Tags, p: XZ, building?: number) => {
    const mk = monumentKind(t);
    if (mk) { // pomnik / rzeźba (punkt): rodzaj w t, nazwa w n
      const tm = tile(...tileOf(p[0], p[1])); if (!tm) return;
      tm.poi.push({ id, c: 'pomnik', t: mk, x: r1(p[0]), z: r1(p[1]), ...(t.name ? { n: t.name } : {}), ...(t.wikidata ? { wd: t.wikidata } : {}), ...(t.height ? { h: num(t.height) ?? undefined } : {}) });
      return;
    }
    const c = t.shop ? 'shop' : t.amenity ? 'amenity' : t.craft ? 'craft' : t.office ? 'office' : null; if (!c) return;
    if (c === 'amenity' && BORING_AMENITY.has(t.amenity)) return;
    const tt = tile(...tileOf(p[0], p[1])); if (!tt) return;
    const b = building ?? inBuilding(tt, p[0], p[1])?.id;
    tt.poi.push({
      id, c, t: t[c], x: r1(p[0]), z: r1(p[1]), ...(t.name ? { n: t.name } : {}), ...(t.brand ? { brand: t.brand } : {}),
      ...(t['brand:wikidata'] ? { wd: t['brand:wikidata'] } : {}), ...(b != null ? { b } : {}), ...(addr(t) ? { a: addr(t) } : {}),
    });
  };
  for (const n of raw.nodes.values()) {
    const t = n.tags; if (!t) continue; const p = proj(n.lat, n.lon);
    if (t.shop || t.amenity || t.craft || t.office || monumentKind(t)) addPoi(n.id, t, p);
    else if (t['addr:housenumber']) { const tt = tile(...tileOf(p[0], p[1])); const b = tt && inBuilding(tt, p[0], p[1]); if (b && !b.a) b.a = addr(t); }
  }
  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t || !(t.shop || t.amenity || t.craft || t.office || monumentKind(t)) || areaKind(t) === 'parking') continue;
    const pts = raw.wayCoords(w).map(([lo, la]) => proj(la, lo)); if (pts.length < 3) continue;
    let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; }
    addPoi(w.id, t, [cx / pts.length, cz / pts.length], isBuilding(t) && buildingTiles.has(w.id) ? w.id : undefined);
  }
  return tiles;
}

const arcLengths = (p: XZ[]) => { const a = [0]; for (let i = 1; i < p.length; i++) a.push(a[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return a; };

interface BridgeInfo { a: XZ; b: XZ; s: number; dir: 1 | -1; total: number }

/** Łączy drogi i tory z bridge=* w ciągi po wspólnych węzłach końcowych (most bywa podzielony w OSM na kilka dróg). */
function bridgeChains(raw: RawOsm, proj: Proj): Map<number, BridgeInfo> {
  const ways: { id: number; ids: number[]; pts: XZ[]; len: number; kind: string }[] = [];
  for (const w of raw.ways.values()) {
    const t = w.tags; if (!t || !t.bridge || t.bridge === 'no' || !(t.highway || t.railway) || !w.nodes || w.nodes.length < 2) continue;
    const pts = raw.wayCoords(w).map(([lo, la]) => proj(la, lo)); if (pts.length !== w.nodes.length) continue;
    ways.push({ id: w.id, ids: w.nodes, pts, len: arcLengths(pts)[pts.length - 1], kind: t.railway ? 'rail' : 'road' });
  }
  const ends = new Map<string, number[]>(), key = (k: string, id: number) => k + id;
  ways.forEach((w, i) => { for (const id of [w.ids[0], w.ids[w.ids.length - 1]]) { const k = key(w.kind, id); let l = ends.get(k); if (!l) ends.set(k, l = []); l.push(i); } });
  const out = new Map<number, BridgeInfo>(), done = new Set<number>();
  ways.forEach((w0, i0) => {
    if (done.has(i0)) return;
    // idź do jednego końca ciągu, potem przejdź cały ciąg
    let cur = i0, fromEnd = w0.ids[0], guard = 0;
    for (;;) {
      const nb = (ends.get(key(w0.kind, fromEnd)) || []).filter(j => j !== cur);
      if (nb.length !== 1 || nb[0] === i0 || guard++ > 200) break;
      const w = ways[nb[0]]; cur = nb[0]; fromEnd = w.ids[0] === fromEnd ? w.ids[w.ids.length - 1] : w.ids[0];
    }
    const chain: { i: number; dir: 1 | -1 }[] = []; let at = fromEnd, c = cur; guard = 0;
    for (;;) {
      const w = ways[c], dir: 1 | -1 = w.ids[0] === at ? 1 : -1; chain.push({ i: c, dir }); done.add(c);
      at = dir === 1 ? w.ids[w.ids.length - 1] : w.ids[0];
      const nb = (ends.get(key(w0.kind, at)) || []).filter(j => j !== c && !done.has(j));
      if (nb.length !== 1 || guard++ > 200) break; c = nb[0];
    }
    const first = ways[chain[0].i], last = ways[chain[chain.length - 1].i];
    const a = chain[0].dir === 1 ? first.pts[0] : first.pts[first.pts.length - 1];
    const b = chain[chain.length - 1].dir === 1 ? last.pts[last.pts.length - 1] : last.pts[0];
    const total = chain.reduce((s, x) => s + ways[x.i].len, 0); let s = 0;
    for (const { i, dir } of chain) { const w = ways[i]; out.set(w.id, { a, b, s: dir === 1 ? s : s + w.len, dir, total }); s += w.len; }
  });
  return out;
}
