// Surowe dane OSM (węzły, drogi, relacje) niezależne od formatu pliku.
// Parsery: Overpass JSON (out geom / out body; >; out skel) i GeoJSON. XML parsuje klient (parser przeglądarki)
// do tego samego modelu; skrypt w tools/ używa Overpass JSON.
import type { LonLat, Tags } from './features';

export interface RawNode { id: number; lat: number; lon: number; tags?: Tags }
export interface RawWay { id: number; nodes?: number[]; geom?: LonLat[]; tags?: Tags }
export interface RawMember { type: 'node' | 'way' | 'relation'; ref: number; role: string; geom?: LonLat[] }
export interface RawRelation { id: number; tags?: Tags; members: RawMember[] }

export class RawOsm {
  readonly nodes = new Map<number, RawNode>();
  readonly ways = new Map<number, RawWay>();
  readonly relations = new Map<number, RawRelation>();

  /** Współrzędne drogi [lon, lat] (z geometrii albo z węzłów). */
  wayCoords(w: RawWay): LonLat[] {
    if (w.geom) return w.geom;
    const out: LonLat[] = [];
    for (const id of w.nodes || []) { const n = this.nodes.get(id); if (n) out.push([n.lon, n.lat]); }
    return out;
  }

  /** Współrzędne członka relacji (geometria z Overpass albo droga z pliku). */
  memberCoords(m: RawMember): LonLat[] {
    if (m.geom && m.geom.length) return m.geom;
    const w = this.ways.get(m.ref); return w ? this.wayCoords(w) : [];
  }

  /** Dokłada dane (deduplikacja po id; geometria uzupełnia brakującą). */
  merge(o: RawOsm): void {
    for (const [id, n] of o.nodes) { const c = this.nodes.get(id); if (!c || (!c.tags && n.tags)) this.nodes.set(id, n); }
    for (const [id, w] of o.ways) { const c = this.ways.get(id); if (!c || (!c.geom && w.geom)) this.ways.set(id, w); }
    for (const [id, r] of o.relations) { const c = this.relations.get(id); if (!c || r.members.some(m => m.geom)) this.relations.set(id, r); }
  }

  get size(): number { return this.nodes.size + this.ways.size + this.relations.size; }

  /** Środek danych [lat, lon] (średnia węzłów albo geometrii dróg). */
  center(): [number, number] {
    let la = 0, lo = 0, n = 0;
    for (const v of this.nodes.values()) { la += v.lat; lo += v.lon; n++; }
    if (!n) for (const w of this.ways.values()) for (const p of this.wayCoords(w)) { lo += p[0]; la += p[1]; n++; }
    return [la / n, lo / n];
  }

  /** Węzły z tagami (stacje, wejścia, punkty). */
  taggedNodes(): { lat: number; lon: number; tags: Tags }[] {
    const out: { lat: number; lon: number; tags: Tags }[] = [];
    for (const n of this.nodes.values()) if (n.tags) out.push({ lat: n.lat, lon: n.lon, tags: n.tags });
    return out;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const geomOf = (g: any): LonLat[] | undefined => Array.isArray(g) ? g.filter(Boolean).map((p: any): LonLat => [p.lon, p.lat]) : undefined;

/** Overpass JSON. */
export function parseOverpass(j: any, into = new RawOsm()): RawOsm {
  for (const e of j.elements || []) {
    if (e.type === 'node') into.nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, tags: e.tags });
    else if (e.type === 'way') into.ways.set(e.id, { id: e.id, nodes: e.nodes, geom: geomOf(e.geometry), tags: e.tags });
    else if (e.type === 'relation') into.relations.set(e.id, {
      id: e.id, tags: e.tags,
      members: (e.members || []).map((m: any): RawMember => ({ type: m.type, ref: m.ref, role: m.role || '', geom: geomOf(m.geometry) })),
    });
  }
  return into;
}

/** GeoJSON (np. eksport z overpass-turbo): obiekty dostają sztuczne ujemne id. */
export function parseGeoJson(j: any): RawOsm {
  const raw = new RawOsm(); let id = -1;
  const way = (coords: LonLat[], tags: Tags) => { const w: RawWay = { id: id--, geom: coords, tags }; raw.ways.set(w.id, w); return w.id; };
  for (const f of j.features || []) {
    const g = f.geometry, tags = (f.properties && (f.properties.tags || f.properties)) || {}; if (!g) continue;
    if (g.type === 'Point') { const n = { id: id--, lon: g.coordinates[0], lat: g.coordinates[1], tags }; raw.nodes.set(n.id, n); }
    else if (g.type === 'LineString') way(g.coordinates, tags);
    else if (g.type === 'MultiLineString') g.coordinates.forEach((c: LonLat[]) => way(c, tags));
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys: LonLat[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      if (polys.length === 1 && polys[0].length === 1) { way(polys[0][0], tags); continue; }
      const members: RawMember[] = [];
      for (const p of polys) p.forEach((ring, k) => members.push({ type: 'way', ref: way(ring, {}), role: k ? 'inner' : 'outer' }));
      raw.relations.set(id, { id: id--, tags: { ...tags, type: 'multipolygon' }, members });
    }
  }
  return raw;
}

export function parseOsmJson(j: any): RawOsm {
  if (j.features) return parseGeoJson(j);
  if (j.elements) return parseOverpass(j);
  throw new Error('Nieznany format pliku');
}
