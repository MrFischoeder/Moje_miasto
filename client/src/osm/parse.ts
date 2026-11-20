// Wczytywanie pliku OSM: .osm (XML), Overpass JSON, GeoJSON -> surowe dane (z relacjami).
import type { Tags } from '@miasto/shared/osm/features';
import { parseOsmJson, RawOsm, type RawMember } from '@miasto/shared/osm/raw';

export function parseOsmText(text: string): RawOsm {
  const t = text.trim();
  const raw = t[0] === '<' ? parseXml(t) : parseOsmJson(JSON.parse(t));
  let any = false;
  for (const w of raw.ways.values()) if (w.tags && (w.tags.building || w.tags['building:part'] || w.tags.highway)) { any = true; break; }
  if (!any) for (const r of raw.relations.values()) if (r.tags?.building) { any = true; break; }
  if (!any) throw new Error('W pliku nie ma budynków ani ulic');
  return raw;
}

function tagsOf(el: Element): Tags | undefined {
  const tg = el.getElementsByTagName('tag'); if (!tg.length) return undefined;
  const tags: Tags = {}; for (const x of tg) tags[x.getAttribute('k')!] = x.getAttribute('v')!; return tags;
}

function parseXml(t: string): RawOsm {
  const doc = new DOMParser().parseFromString(t, 'text/xml'), raw = new RawOsm();
  for (const n of doc.getElementsByTagName('node')) {
    const id = +n.getAttribute('id')!; raw.nodes.set(id, { id, lat: +n.getAttribute('lat')!, lon: +n.getAttribute('lon')!, tags: tagsOf(n) });
  }
  for (const w of doc.getElementsByTagName('way')) {
    const id = +w.getAttribute('id')!, nodes: number[] = [];
    for (const nd of w.getElementsByTagName('nd')) nodes.push(+nd.getAttribute('ref')!);
    raw.ways.set(id, { id, nodes, tags: tagsOf(w) });
  }
  for (const r of doc.getElementsByTagName('relation')) {
    const id = +r.getAttribute('id')!, members: RawMember[] = [];
    for (const m of r.getElementsByTagName('member')) members.push({ type: m.getAttribute('type') as RawMember['type'], ref: +m.getAttribute('ref')!, role: m.getAttribute('role') || '' });
    raw.relations.set(id, { id, tags: tagsOf(r), members });
  }
  return raw;
}
