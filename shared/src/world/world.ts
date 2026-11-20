// Świat statyczny miasta: budynki (kolizje), ulice, metro i regiony chodzenia.
// Powstaje deterministycznie z danych miasta i (opcjonalnie) obiektów OSM,
// więc serwer i każdy klient mają identyczny świat bez przesyłania go przez sieć.
import { CITIES, type CityData, type CityKey } from '../data/cities';
import { makeProj, type Proj } from '../data/projection';
import type { Feature } from '../osm/features';
import { heightOf } from '../osm/heights';
import { BuildingIndex, type XZ } from './collision';
import { RegionIndex, type Region } from './regions';
import { buildMetroLayout, matchOsmStations, type MetroLayout, type Station } from './metro/layout';

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; reg: Region | null }

export class World {
  readonly key: CityKey;
  readonly city: CityData;
  readonly proj: Proj;
  readonly buildings = new BuildingIndex();
  readonly regions = new RegionIndex();
  /** ulice jako łamane w metrach */
  readonly roads: XZ[][] = [];
  readonly metro: MetroLayout;
  /** liczba stacji przesuniętych na pozycję z OSM */
  readonly osmStations: number;

  constructor(key: CityKey, feats: Feature[] | null = null) {
    this.key = key; this.city = CITIES[key]; this.proj = makeProj(this.city.o);
    if (feats) for (const f of feats) {
      if (f.k === 'p') continue;
      const pts = projectRing(f.pts, this.proj);
      if (f.k === 'r') { this.roads.push(pts); continue; }
      if (pts.length < 3) continue;
      const { h, mh } = heightOf(f.tags);
      if (mh < 2) this.buildings.add(pts, h);
    }
    const { ov, ent } = matchOsmStations(feats, this.city);
    this.osmStations = ov.size;
    this.metro = buildMetroLayout(this.city, ov, ent, this.buildings, this.regions);
  }

  get stations(): Station[] { return this.metro.stations; }

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
    if (bp.length) {
      let cx = 0, cz = 0; bp.forEach(p => { cx += p.a; cz += p.c; }); cx /= bp.length; cz /= bp.length;
      let best: XZ | null = null, bd = Infinity;
      for (const r of this.roads) for (const [x, z] of r) { const d = (x - cx) ** 2 + (z - cz) ** 2; if (d < bd && !this.buildings.hit(x, z)) { bd = d; best = [x, z]; } }
      if (best) return { x: best[0], z: best[1], y: 0, yaw: 0, pitch: 0, reg: null };
      return this.platformPose(this.stations.find(s => s.real) || this.stations[0]);
    }
    return this.platformPose(this.stations.find(s => s.name === this.city.spawn) || this.stations[0]);
  }
}

/** Rzutuje łamaną [lon, lat] na metry; usuwa powtórzony punkt zamykający. */
export function projectRing(ll: [number, number][], proj: Proj): XZ[] {
  let pts = ll.map(([lo, la]) => proj(la, lo));
  if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  return pts;
}
