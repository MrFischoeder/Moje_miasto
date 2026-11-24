// Landmarki miasta: ranking z kafli (Wikidata, zabytek, świątynia, wysokość, powierzchnia, pomniki z nazwą)
// i ramy (prostokąt opisany) dla budynków z własnym modelem. Wynik: data/landmarks/<miasto>.json, docs/landmarki-<miasto>.md
//   npx tsx tools/landmarks.ts --city wroclaw
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { gunzipSync } from 'node:zlib';
import { obb } from '../shared/src/interiors/geom';
import type { TileData } from '../shared/src/tiles/types';
const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2), city = argv[argv.indexOf('--city') + 1] || 'wroclaw';
const dir = join(ROOT, 'client/public/tiles-pelne', city);
/** budynki z własnym modelem: Wikidata -> model */
const MODELS: Record<string, string> = { Q910225: 'ratusz' };
const CHURCH = ['church', 'cathedral', 'chapel', 'basilica', 'monastery'];
type Row = { name: string; kind: string; score: number; x: number; z: number; wd?: string; h?: number; id: number };
const rows: Row[] = [], models: unknown[] = [];
const ring = (o: number[]) => { const r: [number, number][] = []; for (let i = 0; i < o.length; i += 2) r.push([o[i], o[i + 1]]); return r; };
for (const f of readdirSync(dir).filter(f => f.endsWith('.json.gz'))) {
  const t = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString()) as TileData;
  for (const b of t.b) {
    if (b.part || !b.name) continue;
    const r = ring(b.o); let A = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; A += p[0] * q[1] - q[0] * p[1]; } A = Math.abs(A / 2);
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    const church = CHURCH.includes(b.t);
    const score = (b.wd ? 4 : 0) + (b.hist ? 4 : 0) + (church ? (b.hist ? 3 : .5) : 0) + Math.min(6, b.h / 15) + Math.min(4, A / 2500);
    if (score < 7) continue;
    rows.push({ name: b.name, kind: church ? 'świątynia' : b.t, score, x: Math.round(cx), z: Math.round(cz), wd: b.wd, h: b.h, id: b.id });
    if (b.wd && MODELS[b.wd]) { const fr = obb(r)!; models.push({ model: MODELS[b.wd], name: b.name, id: b.id, frame: fr, ring: b.o }); }
  }
  for (const p of t.poi) if (p.c === 'pomnik' && p.n && (p.wd || ['statue', 'monument', 'memorial', 'bust', 'war_memorial', 'obelisk'].includes(p.t)))
    rows.push({ name: p.n, kind: 'pomnik', score: (p.wd ? 9 : 6.5), x: Math.round(p.x), z: Math.round(p.z), wd: p.wd, id: p.id });
}
// bez powtórzeń nazw (części kompleksów), najlepsze 100
const seen = new Set<string>(), top = rows.sort((a, b) => b.score - a.score).filter(r => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 100);
writeFileSync(join(ROOT, 'data/landmarks', city + '.json'), JSON.stringify({ city, models, top }, null, 1));
const md = ['# 100 landmarków: ' + city, '', 'Ranking z danych OSM (Wikidata, zabytek, świątynia, wysokość, powierzchnia; pomniki z nazwą). Budowa: `npx tsx tools/landmarks.ts --city ' + city + '`.', '',
  '| # | Nazwa | Rodzaj | Wysokość | Wygląd w grze |', '|---|---|---|---|---|',
  ...top.map((r, i) => `| ${i + 1} | ${r.name} | ${r.kind} | ${r.h ? Math.round(r.h) + ' m' : ''} | ${r.wd && MODELS[r.wd] ? 'własny model' : r.kind === 'pomnik' ? 'własny model pomnika' : r.kind === 'świątynia' ? 'kształty z OSM + styl gotycki (cegła, ostrołuki, hełmy)' : 'kształty, dachy i kolory z OSM'} |`)];
writeFileSync(join(ROOT, 'docs', `landmarki-${city}.md`), md.join('\n') + '\n');
console.log(`landmarki: ${top.length}, modele: ${models.length}`, top.slice(0, 15).map(r => r.name).join(' · '));
console.log(JSON.stringify(models).slice(0, 400));
