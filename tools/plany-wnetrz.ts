// Plany pięter (widok z góry, SVG) dla budynków pokazowych: pomieszczenia z nazwami, drzwi, okna, schody, meble.
// Użycie: npx tsx tools/plany-wnetrz.ts <showcase.json> <wyjście.html>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { World } from '../shared/src/world/world';
import { buildLevel, makePlan, type Level, type Plan } from '../shared/src/interiors/plan';
import { Terrain } from '../shared/src/world/terrain';

const [src, out] = process.argv.slice(2);
const SHOW = JSON.parse(readFileSync(src, 'utf8')) as Record<string, { city: 'warszawa' | 'londyn'; id: number; unit: string; floor0: number }>;
const worlds = new Map<string, { w: World; tiles: Map<number, unknown> }>();
const KOL: Record<string, string> = { core: '#22343a', corridor: '#22343a', lobby: '#2a3a40', hall: '#263226', kitchen: '#3a3a22', bath: '#1e3346', wc: '#1e3346', living: '#3a2c22', bedroom: '#34223a', room: '#2a2a36', study: '#3a3020', maid: '#30302a', storage: '#262626', office: '#22303a', staff: '#22302a', sala: '#2c3838', open: '#363620', stair: '#22343a' };
function load(city: 'warszawa' | 'londyn', id: number) {
  const dir = `client/public/tiles/${city}/`;
  let W = worlds.get(city);
  if (!W) {
    const tb = gunzipSync(readFileSync(`client/public/terrain/${city}.bin.gz`)), terrain = Terrain.parse(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
    const keys = readdirSync(dir).filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', '').split('_').map(Number)).filter(([x, y]) => Math.abs(x) <= 3 && Math.abs(y) <= 4);
    const tiles = keys.map(([x, y]) => JSON.parse(gunzipSync(readFileSync(dir + `${x}_${y}.json.gz`)).toString()));
    W = { w: new World(city, { tiles, terrain }), tiles: new Map() }; worlds.set(city, W);
  }
  for (const t of W.w.tiles.values()) { const b = t.b.find(q => q.id === id); if (b) return makePlan(b, t, W.w)!; }
  throw new Error('brak budynku ' + id);
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function svg(p: Plan, L: Level, title: string): string {
  const S = Math.min(16, 900 / Math.max(p.frame.W, 1), 520 / Math.max(p.frame.D + 4, 1)), pad = 24, Wp = p.frame.W * S + 2 * pad, Hp = (p.frame.D + 3) * S + 2 * pad + 20;
  const X = (x: number) => pad + x * S, Y = (y: number) => pad + 20 + (y + 3) * S; // front (ulica) na górze
  let g = `<rect x="0" y="0" width="${Wp}" height="${Hp}" fill="#050807"/><text x="${pad}" y="18" fill="#7dffb0" font-size="14" font-weight="600">${esc(title)}</text>`;
  g += `<text x="${X(p.frame.W / 2)}" y="${Y(-2.2)}" fill="#5a8070" font-size="11" text-anchor="middle">ulica (front)</text>`;
  for (const b of L.boxes) {
    const r = b.r; g += `<rect x="${X(r.x0)}" y="${Y(r.y0)}" width="${(r.x1 - r.x0) * S}" height="${(r.y1 - r.y0) * S}" fill="${KOL[b.kind] ?? '#2a2a2a'}" stroke="${b.accent ?? '#7dffb0'}" stroke-width="1.6"/>`;
  }
  for (const s of L.slabs) if (s.steps) {
    const r = s.r, n = Math.round((s.axis === 'y' ? r.y1 - r.y0 : r.x1 - r.x0) / .28);
    for (let i = 0; i <= n; i++) { if (s.axis === 'y') { const y = r.y0 + (r.y1 - r.y0) * i / n; g += `<line x1="${X(r.x0)}" y1="${Y(y)}" x2="${X(r.x1)}" y2="${Y(y)}" stroke="#8fb8a8" stroke-width=".7"/>`; } else { const x = r.x0 + (r.x1 - r.x0) * i / n; g += `<line x1="${X(x)}" y1="${Y(r.y0)}" x2="${X(x)}" y2="${Y(r.y1)}" stroke="#8fb8a8" stroke-width=".7"/>`; } }
    const up = s.yb > s.ya; const [x0, y0, x1, y1] = s.axis === 'y' ? [(r.x0 + r.x1) / 2, up ? r.y0 : r.y1, (r.x0 + r.x1) / 2, up ? r.y1 : r.y0] : [up ? r.x0 : r.x1, (r.y0 + r.y1) / 2, up ? r.x1 : r.x0, (r.y0 + r.y1) / 2];
    g += `<line x1="${X(x0)}" y1="${Y(y0)}" x2="${X(x1)}" y2="${Y(y1)}" stroke="#ffd23f" stroke-width="1.2" marker-end="url(#a)"/>`;
  }
  for (const it of L.items) { const r = it.r; g += `<rect x="${X(r.x0)}" y="${Y(r.y0)}" width="${(r.x1 - r.x0) * S}" height="${(r.y1 - r.y0) * S}" fill="${it.c ? '#7a6a3a' : '#4a4a4a'}" stroke="${it.c ? '#ffd23f' : '#9a9a9a'}" stroke-width=".7"><title>${esc(it.n)}</title></rect>`; }
  for (const b of L.boxes) for (const h of b.holes) {
    const r = b.r, c = h.kind === 'win' ? '#5aa0ff' : '#050807', w = h.kind === 'win' ? 3 : 5;
    const [x0, y0, x1, y1] = h.side === 0 ? [h.a, r.y0, h.b, r.y0] : h.side === 2 ? [h.a, r.y1, h.b, r.y1] : h.side === 3 ? [r.x0, h.a, r.x0, h.b] : [r.x1, h.a, r.x1, h.b];
    g += `<line x1="${X(x0)}" y1="${Y(y0)}" x2="${X(x1)}" y2="${Y(y1)}" stroke="${c}" stroke-width="${w}"/>`;
  }
  for (const b of L.boxes) {
    const r = b.r, cx = X((r.x0 + r.x1) / 2), cy = Y((r.y0 + r.y1) / 2), fs = Math.max(7, Math.min(12, (r.x1 - r.x0) * S / Math.max(4, b.name.length) * 1.6));
    if ((r.x1 - r.x0) * S > 26 && (r.y1 - r.y0) * S > 14) g += `<text x="${cx}" y="${cy}" fill="#dfffee" font-size="${fs}" text-anchor="middle" dominant-baseline="middle">${esc(b.name)}</text>`;
  }
  for (const e of p.ext) if (L.k === 0) g += `<line x1="${X(e.x)}" y1="${Y(-e.tOut)}" x2="${X(e.x)}" y2="${Y(.6)}" stroke="#ffd23f" stroke-width="2" marker-end="url(#a)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wp}" height="${Hp}" font-family="Chakra Petch, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ffd23f"/></marker></defs>${g}</svg>`;
}
let html = `<!doctype html><meta charset="utf-8"><title>Plany wnętrz</title><style>body{background:#000;color:#7dffb0;font-family:'Chakra Petch',sans-serif;margin:16px}h1{font-size:20px}.g{display:flex;flex-wrap:wrap;gap:14px}p{color:#9fc;max-width:900px}</style>
<h1>Wnętrza: 9 szablonów na prawdziwych budynkach z OSM</h1><p>Widok z góry, ulica (front) na górze. Zielone ramki: pomieszczenia; czarne przerwy: drzwi; niebieskie: okna (te same co na fasadzie); żółte strzałki: wejście z ulicy i kierunek schodów w górę; żółte prostokąty: pojemniki do przeszukania (E); szare: pozostałe meble.</p><div class="g">`;
for (const [key, s] of Object.entries(SHOW)) {
  const p = load(s.city, s.id); const floors = key.includes('terraced') ? [0, 1] : [0];
  for (const k of floors) { const L = buildLevel(p, k); html += svg(p, L, `${key.split(':')[1]} · ${p.label || s.city} · ${s.unit.split(' · ')[0]} · ${k === 0 ? 'parter' : 'piętro ' + k} (${p.typ}, ${p.levels} kond.)`); }
}
writeFileSync(out, html + '</div>');
console.log('zapisano', out);
