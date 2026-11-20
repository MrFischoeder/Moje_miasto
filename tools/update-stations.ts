// Aktualizuje data/cities.json prawdziwymi pozycjami stacji metra i wejść z OSM (Overpass API).
// Uruchamiaj po data/prep.py (prep.py buduje plik od nowa z danych źródłowych).
//   npm run update-stations -- --city warszawa   (albo --city londyn)
//   npm run update-stations -- --city warszawa --from .cache/osm/warszawa/stations.json   (z tools/pbf-extract.py, bez sieci)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CityData } from '@miasto/shared/data/cities';
import { makeProj, normName } from '@miasto/shared/data/projection';
import { args, cityArg, DEFAULT_SERVERS, ensureProxyEnv, overpass, ROOT, unproj } from './lib/common';

ensureProxyEnv();
const a = args(), key = cityArg(a), file = join(ROOT, 'data/cities.json');
const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, CityData>, city = all[key], proj = makeProj(city.o);
const servers = a.server ? a.server.split(',') : DEFAULT_SERVERS;

// obszar: stacje + 3 km
const pts = city.st.map(s => proj(s[1], s[2]));
const [n, w] = unproj(city.o, Math.min(...pts.map(p => p[0])) - 3000, Math.min(...pts.map(p => p[1])) - 3000);
const [s, e] = unproj(city.o, Math.max(...pts.map(p => p[0])) + 3000, Math.max(...pts.map(p => p[1])) + 3000);
const q = `[out:json][timeout:180][bbox:${s},${w},${n},${e}];
(
  nwr["railway"="station"]["station"="subway"]; nwr["public_transport"="station"]["subway"="yes"];
  nwr["railway"="construction"]["construction"="subway"]["public_transport"="station"];
  node["railway"="subway_entrance"];
);
out center tags;`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let j: { elements: any[] };
if (a.from) { j = JSON.parse(readFileSync(a.from, 'utf8')); console.log(`${city.name}: stacje i wejścia z pliku ${a.from}`); }
else { console.log(`${city.name}: pobieram stacje i wejścia z OSM…`); j = await overpass(q, servers) as typeof j; }
const pos = (e: { lat?: number; lon?: number; center?: { lat: number; lon: number } }) => e.center ? [e.center.lat, e.center.lon] : [e.lat!, e.lon!];

// stacje: dopasowanie po nazwie (bez polskich znaków i słów „metro”, „station”); każda stacja z danych bierze
// najbliższą stację OSM o tej nazwie (do 1500 m). Aliasy: literówki i nazwy z danych z 2016 r.
const ALIAS: Record<string, string> = {
  "Shepherd's Bush (H)": "Shepherd's Bush Market", "Shepherd's Bush (C)": "Shepherd's Bush", 'Picadilly Circus': 'Piccadilly Circus',
  'Harrow & Wealdston': 'Harrow & Wealdstone', 'Heathrow Terminals 1, 2 & 3': 'Heathrow Terminals 2 & 3', 'Edgware Road (B)': 'Edgware Road', 'Edgware Road (C)': 'Edgware Road',
};
const osmSt = j.elements.filter(el => el.tags && el.tags.railway !== 'subway_entrance' && el.tags.name).map(el => { const [la, lo] = pos(el); return { n: normName(el.tags.name), name: el.tags.name as string, la, lo, p: proj(la, lo) }; });
const found = new Map<number, [number, number]>(), usedOsm = new Set<string>();
city.st.forEach((st, i) => {
  const key = normName(ALIAS[st[0]] ?? st[0]); let best: typeof osmSt[0] | null = null, bd = 1500;
  for (const o of osmSt) if (o.n === key) { const d = Math.hypot(o.p[0] - pts[i][0], o.p[1] - pts[i][1]); if (d < bd) { bd = d; best = o; } }
  if (best) { found.set(i, [best.la, best.lo]); usedOsm.add(best.n); }
});
const unmatched = osmSt.filter(o => !usedOsm.has(o.n)).map(o => o.name);
const moved: [string, number][] = [];
for (const [i, [la, lo]] of found) {
  const p = proj(la, lo); moved.push([city.st[i][0], Math.round(Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))]);
  city.st[i] = [city.st[i][0], +la.toFixed(5), +lo.toFixed(5)];
}
city.osm = [...found.keys()].sort((x, y) => x - y);

// wejścia: do najbliższej stacji w promieniu 260 m
const ent: [number, number, number][] = [];
const npts = city.st.map(st => proj(st[1], st[2]));
for (const el of j.elements) {
  if (el.tags?.railway !== 'subway_entrance') continue;
  const [la, lo] = pos(el), p = proj(la, lo); let best = -1, bd = 260;
  npts.forEach((q2, i) => { const d = Math.hypot(p[0] - q2[0], p[1] - q2[1]); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) ent.push([best, +la.toFixed(6), +lo.toFixed(6)]);
}
city.ent = ent.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const withEnt = new Set(ent.map(x => x[0]));
writeFileSync(file, JSON.stringify(all, null, 0));
console.log(`stacje z pozycją z OSM: ${found.size}/${city.st.length}, wejść: ${ent.length} (stacji z wejściami: ${withEnt.size})`);
const big = moved.filter(m => m[1] > 50).sort((x, y) => y[1] - x[1]).slice(0, 15);
if (big.length) console.log('największe przesunięcia:', big.map(([nm, d]) => `${nm} ${d} m`).join(', '));
const miss = city.st.map((st, i) => found.has(i) ? null : st[0]).filter(Boolean);
if (miss.length) console.log('bez dopasowania w OSM:', miss.join(', '));
if (unmatched.length) console.log('stacje z OSM spoza danych:', [...new Set(unmatched)].slice(0, 30).join(', '));
