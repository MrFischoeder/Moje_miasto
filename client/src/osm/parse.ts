// Wczytywanie pliku OSM: .osm (XML), Overpass JSON, GeoJSON.
import { FeatureCollector, parseJsonFeatures, type Feature, type LonLat, type Tags } from '@miasto/shared/osm/features';

export function parseOsmText(text: string): Feature[] {
  const t = text.trim();
  if (t[0] !== '<') return parseJsonFeatures(JSON.parse(t));
  const c = new FeatureCollector(), doc = new DOMParser().parseFromString(t, 'text/xml'), nodes = new Map<string, LonLat>();
  for (const n of doc.getElementsByTagName('node')) {
    const p: LonLat = [+n.getAttribute('lon')!, +n.getAttribute('lat')!]; nodes.set(n.getAttribute('id')!, p);
    const tg = n.getElementsByTagName('tag');
    if (tg.length) { const tags: Tags = {}; for (const x of tg) tags[x.getAttribute('k')!] = x.getAttribute('v')!; c.addP(p, tags); }
  }
  for (const w of doc.getElementsByTagName('way')) {
    const tags: Tags = {}; for (const x of w.getElementsByTagName('tag')) tags[x.getAttribute('k')!] = x.getAttribute('v')!;
    const pts: LonLat[] = []; for (const nd of w.getElementsByTagName('nd')) { const p = nodes.get(nd.getAttribute('ref')!); if (p) pts.push(p); }
    c.add(pts, tags);
  }
  return c.done();
}
