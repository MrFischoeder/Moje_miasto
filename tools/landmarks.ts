// Landmarki miasta: ranking z kafli (Wikidata, zabytek, świątynia, wysokość, powierzchnia, pomniki z nazwą)
// i ramy (prostokąt opisany) dla budynków z własnym modelem. Wynik: data/landmarks/<miasto>.json, docs/landmarki-<miasto>.md
//   npx tsx tools/landmarks.ts --city wroclaw
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { gunzipSync } from 'node:zlib';
import { obb } from '../shared/src/interiors/geom';
import type { TileData } from '../shared/src/tiles/types';
const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2), city = argv[argv.indexOf('--city') + 1] || 'wroclaw';
const dir = join(ROOT, 'client/public/tiles-pelne', city);
/** budynki z własnym modelem: Wikidata -> model */
const MODELS: Record<string, string> = {
  Q910225: 'ratusz', Q910211: 'katedra', Q155743: 'hala', Q2320729: 'piasek',
  Q1545815: 'magdalena', Q381449: 'wincenty', Q11747624: 'wojciech', Q597262: 'imieniajezus', Q9160346: 'arsenal', Q444070: 'palac',
  Q11819161: 'gielda', Q1329563: 'muzeum', Q2968370: 'wiezacisnien', Q16619009: 'lesnica',
  Q428443: 'dworzec', Q1093429: 'halatargowa', Q11741013: 'kolegiata', Q1336270: 'opera', Q1330584: 'elzbieta', Q6972777: 'nfm',
  // bez Wikidata w obrysie: identyfikator budynku OSM
  '101205499': 'uniwersytet', '165880544': 'skytower',
};
/** mosty z własnym modelem: nazwa jezdni na moście (małe litery) -> model */
const BRIDGES: Record<string, string> = {}; // (stary sposób: oś z jezdni; mosty biorą się teraz z obrysów, tools/bridges.py)
/** mosty z własnym modelem (nazwa z obrysu man_made=bridge, małe litery); pozostałe: szablon wg bridge:structure */
const BRIDGE_MODELS: Record<string, string> = { 'most grunwaldzki': 'grunwaldzki', 'most zwierzyniecki': 'zwierzyniecki', 'most tumski': 'tumski', 'most piaskowy': 'piaskowy', 'most pokoju': 'pokoju', 'most pomorski północny': 'pomorski', 'most pomorski środkowy': 'pomorski', 'most pomorski południowy': 'pomorski' };
const bridgePts = new Map<string, { pts: [number, number][]; w: number }>();
/** nazwy budynków bez nazwy w OSM */
const NAMES: Record<string, string> = { '101205499': 'Uniwersytet Wrocławski – Gmach Główny z Aulą Leopoldina', '165880544': 'Sky Tower' };
/** modele bez budynku (konstrukcje): punkt [lat, lon], wielkość obrysu do ukrycia [m] */
const POINTS: { model: string; name: string; lat: number; lon: number; r: number }[] = [
  { model: 'iglica', name: 'Iglica', lat: 51.107537, lon: 17.075414, r: 4 },
];
const CHURCH = ['church', 'cathedral', 'chapel', 'basilica', 'monastery'];
type Row = { name: string; kind: string; score: number; x: number; z: number; wd?: string; h?: number; id: number };
const rows: Row[] = [], models: unknown[] = [];
const ring = (o: number[]) => { const r: [number, number][] = []; for (let i = 0; i < o.length; i += 2) r.push([o[i], o[i + 1]]); return r; };
for (const f of readdirSync(dir).filter(f => f.endsWith('.json.gz'))) {
  const t = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString()) as TileData;
  for (const b of t.b) {
    if (b.part) continue;
    if (!b.name && !MODELS[String(b.id)]) continue;
    const bname = b.name ?? NAMES[String(b.id)] ?? '';
    const r = ring(b.o); let A = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; A += p[0] * q[1] - q[0] * p[1]; } A = Math.abs(A / 2);
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    const church = CHURCH.includes(b.t);
    const score = (MODELS[b.wd ?? ''] ?? MODELS[String(b.id)] ? 6 : 0) + (b.wd ? 4 : 0) + (b.hist ? 4 : 0) + (church ? (b.hist ? 3 : .5) : 0) + Math.min(6, b.h / 15) + Math.min(4, A / 2500);
    const mk = MODELS[b.wd ?? ''] ?? MODELS[String(b.id)];
    if (mk) { const fr = obb(r)!; models.push({ model: mk, name: bname, id: b.id, frame: fr, ring: b.o }); }
    if (score < 7) continue;
    rows.push({ name: bname, kind: church ? 'świątynia' : b.t, score, x: Math.round(cx), z: Math.round(cz), wd: b.wd, h: b.h, id: b.id });
  }
  for (const r of t.r) { const nm = (r.n ?? '').toLowerCase(); if (r.br && BRIDGES[nm]) { let e = bridgePts.get(nm); if (!e) bridgePts.set(nm, e = { pts: [], w: 0 }); for (let i = 0; i < r.p.length; i += 2) e.pts.push([r.p[i], r.p[i + 1]]); e.w = Math.max(e.w, r.w); } }
  for (const p of t.poi) if (p.c === 'pomnik' && p.n && (p.wd || ['statue', 'monument', 'memorial', 'bust', 'war_memorial', 'obelisk'].includes(p.t)))
    rows.push({ name: p.n, kind: 'pomnik', score: (p.wd ? 9 : 6.5), x: Math.round(p.x), z: Math.round(p.z), wd: p.wd, id: p.id });
}
for (const [nm, e] of bridgePts) { // oś mostu: najdalsze punkty jezdni
  let a = e.pts[0], b = e.pts[0], best = -1;
  for (const p of e.pts) for (const q of e.pts) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; a = p; b = q; } }
  if (b[0] < a[0]) [a, b] = [b, a];
  const L = best, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, D = Math.max(15, e.w + 6), nx = -uz, nz = ux, h = D / 2 + 3;
  models.push({ model: BRIDGES[nm], name: nm, id: 0, frame: { ox: a[0], oz: a[1], ux, uz, W: L, D },
    ring: [a[0] - nx * h, a[1] - nz * h, b[0] - nx * h, b[1] - nz * h, b[0] + nx * h, b[1] + nz * h, a[0] + nx * h, a[1] + nz * h].map(v => Math.round(v * 10) / 10) });
}
{ // obrysy mostów z tools/bridges.py
  const mf = join(ROOT, 'data/landmarks', `${city}-mosty.json`);
  if (existsSync(mf)) for (const b of JSON.parse(readFileSync(mf, 'utf8')) as { name: string; s: string; id: number; frame: { ox: number; oz: number; ux: number; uz: number; W: number; D: number } }[]) {
    const f = b.frame, nx = -f.uz, nz = f.ux, h = f.D / 2, bx = f.ox + f.ux * f.W, bz = f.oz + f.uz * f.W;
    models.push({ model: BRIDGE_MODELS[b.name.toLowerCase()] ?? 'most:' + b.s, name: b.name || 'most', id: 0, frame: f,
      ring: [f.ox - nx * h, f.oz - nz * h, bx - nx * h, bz - nz * h, bx + nx * h, bz + nz * h, f.ox + nx * h, f.oz + nz * h].map(v => Math.round(v * 10) / 10) });
  }
}
for (const q of POINTS) { // konstrukcje: kwadrat wokół punktu (układ gry jak w makeProj)
  const cities = JSON.parse(readFileSync(join(ROOT, 'data/cities.json'), 'utf8')), o = cities[city].o, kx = Math.cos(o[0] * Math.PI / 180) * 111320;
  const x = (q.lon - o[1]) * kx, z = -(q.lat - o[0]) * 110540, R = q.r;
  models.push({ model: q.model, name: q.name, id: 0, frame: { ox: x - R, oz: z - R, ux: 1, uz: 0, W: 2 * R, D: 2 * R }, ring: [x - R, z - R, x + R, z - R, x + R, z + R, x - R, z + R] });
}
// bez powtórzeń nazw (części kompleksów), najlepsze 100
const seen = new Set<string>(), top = rows.sort((a, b) => b.score - a.score).filter(r => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 100);
writeFileSync(join(ROOT, 'data/landmarks', city + '.json'), JSON.stringify({ city, models, top }, null, 1));
const md = ['# 100 landmarków: ' + city, '', 'Ranking z danych OSM (Wikidata, zabytek, świątynia, wysokość, powierzchnia; pomniki z nazwą). Budowa: `npx tsx tools/landmarks.ts --city ' + city + '`.', '',
  '| # | Nazwa | Rodzaj | Wysokość | Wygląd w grze |', '|---|---|---|---|---|',
  ...top.map((r, i) => `| ${i + 1} | ${r.name} | ${r.kind} | ${r.h ? Math.round(r.h) + ' m' : ''} | ${(r.wd && MODELS[r.wd]) || MODELS[String(r.id)] ? 'własny model' : r.kind === 'pomnik' ? 'własny model pomnika' : r.kind === 'świątynia' ? 'kształty z OSM + styl gotycki (cegła, ostrołuki, hełmy)' : 'kształty, dachy i kolory z OSM'} |`)];
writeFileSync(join(ROOT, 'docs', `landmarki-${city}.md`), md.join('\n') + '\n');
console.log(`landmarki: ${top.length}, modele: ${models.length}`, top.slice(0, 15).map(r => r.name).join(' · '));
console.log(JSON.stringify(models).slice(0, 400));
