// Wspólny format obiektów z OSM po parsowaniu (niezależny od źródła pliku).
export type Tags = Record<string, string>;
/** Punkt [lon, lat] */
export type LonLat = [number, number];
/** b = budynek (obrys), r = ulica (linia), p = punkt (stacja, wejście) */
export interface Feature { k: 'b' | 'r' | 'p'; pts: LonLat[]; tags: Tags }

export class FeatureCollector {
  out: Feature[] = [];
  add(pts: LonLat[], tags: Tags | null | undefined): void {
    if (!tags) return;
    const b = (tags.building && tags.building !== 'no') || tags['building:part'];
    if (b && pts.length >= 3) this.out.push({ k: 'b', pts, tags });
    else if (tags.highway && pts.length >= 2) this.out.push({ k: 'r', pts, tags });
  }
  addP(p: LonLat, tags: Tags | null | undefined): void {
    if (tags && (tags.railway || tags.public_transport)) this.out.push({ k: 'p', pts: [p], tags });
  }
  done(): Feature[] {
    if (!this.out.some(f => f.k !== 'p')) throw new Error('W pliku nie ma budynków ani ulic');
    return this.out;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Overpass JSON (out geom albo out body; >; out skel) oraz GeoJSON. */
export function parseJsonFeatures(j: any): Feature[] {
  const c = new FeatureCollector();
  if (j.features) {
    for (const f of j.features) {
      const g = f.geometry, tags = f.properties && (f.properties.tags || f.properties); if (!g) continue;
      if (g.type === 'Polygon') c.add(g.coordinates[0], tags);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((x: any) => c.add(x[0], tags));
      else if (g.type === 'LineString') c.add(g.coordinates, tags);
      else if (g.type === 'MultiLineString') g.coordinates.forEach((x: any) => c.add(x, tags));
      else if (g.type === 'Point') c.addP(g.coordinates, tags);
    }
  } else if (j.elements) {
    const nodes = new Map<number, LonLat>();
    for (const e of j.elements) if (e.type === 'node') { nodes.set(e.id, [e.lon, e.lat]); c.addP([e.lon, e.lat], e.tags); }
    for (const e of j.elements) if (e.type === 'way') c.add(e.geometry
      ? e.geometry.filter(Boolean).map((g: any) => [g.lon, g.lat])
      : (e.nodes || []).map((i: number) => nodes.get(i)).filter(Boolean), e.tags);
  } else throw new Error('Nieznany format pliku');
  return c.done();
}

/** Średni punkt wszystkich obiektów: [lat, lon]. */
export function featuresCenter(feats: Feature[]): [number, number] {
  let la = 0, lo = 0, n = 0;
  for (const x of feats) for (const p of x.pts) { lo += p[0]; la += p[1]; n++; }
  return [la / n, lo / n];
}
