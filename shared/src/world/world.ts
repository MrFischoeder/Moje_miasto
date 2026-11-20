// Świat statyczny miasta: metro (zawsze całe) i kafelki z OSM (doładowywane wokół graczy).
// Powstaje deterministycznie z danych miasta i plików kafelków, więc serwer i każdy klient
// mają identyczny świat bez przesyłania go przez sieć.
import { CITIES, type CityData, type CityKey } from '../data/cities';
import { makeProj, normName, type Proj } from '../data/projection';
import type { Tags } from '../osm/features';
import { tileKey, type Flat, type TileData } from '../tiles/types';
import { CAR_PTS, PolyIndex, type XZ } from './collision';
import { RegionIndex, type Region, type Support, type Surface } from './regions';
import { buildMetroLayout, type MetroLayout, type Station } from './metro/layout';

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; reg: Region | null }

export interface WorldOptions {
  /** kafelki dostępne od razu (np. z wczytanego pliku), przed zbudowaniem metra */
  tiles?: Iterable<TileData>;
  /** punkty stacji i wejść z wczytanego pliku OSM (przesuwają stacje i zejścia) */
  osmPoints?: OsmPoint[];
}
export interface OsmPoint { lat: number; lon: number; tags: Tags }

export const toXZ = (f: Flat): XZ[] => { const out: XZ[] = []; for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]); return out; };

export class World implements Surface {
  readonly key: CityKey;
  readonly city: CityData;
  readonly proj: Proj;
  /** budynki stojące na gruncie (przeszkody) */
  readonly buildings = new PolyIndex();
  /** woda (nie da się po niej chodzić ani jeździć) */
  readonly water = new PolyIndex();
  /** pomosty: jezdnie mostów nad wodą */
  readonly decks = new PolyIndex();
  readonly regions = new RegionIndex();
  readonly tiles = new Map<string, TileData>();
  readonly metro: MetroLayout;
  /** liczba stacji przesuniętych na pozycję z OSM (z pliku) */
  readonly osmStations: number;

  constructor(key: CityKey, opt: WorldOptions = {}) {
    this.key = key; this.city = CITIES[key]; this.proj = makeProj(this.city.o);
    if (opt.tiles) for (const t of opt.tiles) this.addTile(t);
    const { ov, ent } = matchOsmStations(opt.osmPoints ?? null, this.city);
    if (!opt.osmPoints) for (const [i, lat, lon] of this.city.ent || []) { let l = ent.get(i); if (!l) ent.set(i, l = []); l.push(this.proj(lat, lon)); }
    this.osmStations = ov.size;
    this.metro = buildMetroLayout(this.city, ov, ent, this.buildings, this.regions);
  }

  get stations(): Station[] { return this.metro.stations; }

  // ---------- kafelki ----------
  addTile(t: TileData): void {
    const k = tileKey(t.x, t.y); if (this.tiles.has(k)) return; this.tiles.set(k, t);
    for (const b of t.b) if (b.mh < 2) this.buildings.add(toXZ(b.o), b.h, b.i?.map(toXZ), k);
    for (const a of t.a) if (a.k === 'water') this.water.add(toXZ(a.o), 0, a.i?.map(toXZ), k);
    for (const r of t.r) if (r.br) {
      const p = toXZ(r.p), hw = r.w / 2 + (r.sw ? 2.5 : .6);
      for (let i = 0; i < p.length - 1; i++) {
        const [x0, z0] = p[i], [x1, z1] = p[i + 1], L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L * hw, nz = (x1 - x0) / L * hw;
        const ex = (x1 - x0) / L * .5, ez = (z1 - z0) / L * .5;
        this.decks.add([[x0 - ex + nx, z0 - ez + nz], [x1 + ex + nx, z1 + ez + nz], [x1 + ex - nx, z1 + ez - nz], [x0 - ex - nx, z0 - ez - nz]], 0, undefined, k);
      }
    }
  }
  removeTile(k: string): void {
    if (!this.tiles.delete(k)) return;
    this.buildings.removeTile(k); this.water.removeTile(k); this.decks.removeTile(k);
  }

  // ---------- zapytania fizyki ----------
  /** Punkt zablokowany: budynek albo woda poza mostem. */
  blocked(x: number, z: number): boolean { return this.buildings.hit(x, z) || (this.water.hit(x, z) && !this.decks.hit(x, z)); }
  /** Podłoże dla pieszego (region podziemny albo powierzchnia). */
  support(x: number, z: number, y: number): Support | null { return this.regions.support(x, z, y, this); }
  /** Wysokość najwyższego dachu w punkcie (0 = grunt). */
  roofTop(x: number, z: number): number { return this.buildings.top(x, z); }

  /** Kolizja auta: 6 punktów prostokąta. */
  carHit(x: number, z: number, yaw: number): boolean {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (const [a, b] of CAR_PTS) if (this.blocked(x + rx * a + fx * b, z + rz * a + fz * b)) return true;
    return false;
  }

  /** Najbliższe wolne miejsce na auto (albo na pieszego, gdy point = true). */
  freeSpot(x: number, z: number, yaw: number, point = false): XZ {
    const ok = (a: number, b: number) => point ? !this.blocked(a, b) : !this.carHit(a, b, yaw);
    if (ok(x, z)) return [x, z];
    for (let r = 2; r < 300; r += 2) for (let a = 0; a < 6.28; a += .4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return [px, pz]; }
    return [x, z];
  }

  // ---------- stacje i start ----------
  nearestStation(x: number, z: number): Station {
    let b = this.stations[0], bd = Infinity;
    for (const s of this.stations) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; b = s; } }
    return b;
  }

  /** Pozycja na peronie stacji (teleport). */
  platformPose(s: Station): Pose {
    const h = s.halls[0]; const off = h.island ? (h.W - 7 > 1.2 ? 0 : 2) : -(h.W - 2);
    return { x: s.x - h.uz * off + h.ux * 3, z: s.z + h.ux * off + h.uz * 3, y: h.y, yaw: Math.atan2(-h.ux, -h.uz), pitch: 0, reg: h.reg };
  }

  /** Pozycja na ulicy przy pierwszym wyjściu stacji. */
  streetPose(s: Station): Pose {
    const [x, z, d] = s.tops[0];
    return { x: x + d[0] * 2.5, z: z + d[1] * 2.5, y: 0, yaw: Math.atan2(-d[0], -d[1]), pitch: 0, reg: null };
  }

  /** Start: na ulicy przy budynkach z pliku albo na peronie stacji startowej. */
  spawnPose(): Pose {
    const bp = this.buildings.polys;
    if (this.tiles.size && bp.length) {
      let cx = 0, cz = 0; bp.forEach(p => { cx += p.a; cz += p.c; }); cx /= bp.length; cz /= bp.length;
      let best: XZ | null = null, bd = Infinity;
      for (const t of this.tiles.values()) for (const r of t.r) for (let i = 0; i < r.p.length; i += 2) {
        const x = r.p[i], z = r.p[i + 1], d = (x - cx) ** 2 + (z - cz) ** 2; if (d < bd && !this.blocked(x, z)) { bd = d; best = [x, z]; }
      }
      if (best) return { x: best[0], z: best[1], y: 0, yaw: 0, pitch: 0, reg: null };
      return this.platformPose(this.stations.find(s => s.real) || this.stations[0]);
    }
    return this.platformPose(this.stations.find(s => s.name === this.city.spawn) || this.stations[0]);
  }
}

/**
 * Stacje i wejścia z pliku OSM: stacja przesuwa się na prawdziwe miejsce (do 900 m),
 * wejścia w promieniu 260 m od stacji stają się prawdziwymi zejściami.
 */
export function matchOsmStations(pts: OsmPoint[] | null, city: CityData): { ov: Map<number, XZ>; ent: Map<number, XZ[]> } {
  const ov = new Map<number, XZ>(), ent = new Map<number, XZ[]>(); if (!pts) return { ov, ent };
  const proj = makeProj(city.o), idx = new Map(city.st.map((s, i) => [normName(s[0]), i]));
  for (const f of pts) {
    const t = f.tags, isSt = (t.railway === 'station' && t.station === 'subway') || (t.public_transport === 'station' && t.subway === 'yes');
    if (isSt && t.name) {
      const i = idx.get(normName(t.name));
      if (i != null) { const p = proj(f.lat, f.lon), q = proj(city.st[i][1], city.st[i][2]); if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 900) ov.set(i, p); }
    }
  }
  for (const f of pts) if (f.tags.railway === 'subway_entrance') {
    const p = proj(f.lat, f.lon); let best = -1, bd = 260;
    city.st.forEach((s, i) => { const q = ov.get(i) || proj(s[1], s[2]); const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { let l = ent.get(best); if (!l) ent.set(best, l = []); l.push(p); }
  }
  return { ov, ent };
}
