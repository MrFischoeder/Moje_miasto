// Składanie pierścieni relacji multipolygon z odcinków dróg (dziedzińce kamienic, rzeki, parki).
import type { LonLat } from './features';
import type { RawOsm, RawRelation } from './raw';

const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

/** Łączy otwarte odcinki w zamknięte pierścienie; niedomknięte resztki są pomijane. */
export function joinRings(parts: LonLat[][]): LonLat[][] {
  const rings: LonLat[][] = [], open = parts.filter(p => p.length >= 2).map(p => p.slice());
  while (open.length) {
    let cur = open.pop()!;
    for (let guard = 0; !same(cur[0], cur[cur.length - 1]) && guard < 10000; guard++) {
      const end = cur[cur.length - 1]; let found = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        if (same(p[0], end)) cur = cur.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) cur = cur.concat(p.slice(0, -1).reverse());
        else if (same(p[p.length - 1], cur[0])) cur = p.concat(cur.slice(1));
        else if (same(p[0], cur[0])) cur = p.slice().reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1); found = true; break;
      }
      if (!found) break;
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

export interface Polygon { outer: LonLat[]; inner: LonLat[][] }

const pipLL = (poly: LonLat[], p: LonLat) => {
  let s = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) s = !s;
  }
  return s;
};

/** Wielokąty relacji multipolygon: każdy pierścień zewnętrzny z przypisanymi dziurami. */
export function multipolygon(raw: RawOsm, r: RawRelation): Polygon[] {
  const outerParts: LonLat[][] = [], innerParts: LonLat[][] = [];
  for (const m of r.members) {
    if (m.type !== 'way') continue;
    const c = raw.memberCoords(m); if (c.length < 2) continue;
    (m.role === 'inner' ? innerParts : outerParts).push(c);
  }
  const outers = joinRings(outerParts), inners = joinRings(innerParts);
  const polys: Polygon[] = outers.map(o => ({ outer: o, inner: [] }));
  for (const h of inners) { const p = polys.find(q => pipLL(q.outer, h[0])); if (p) p.inner.push(h); }
  return polys;
}
