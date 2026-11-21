// Wyszukuje prawdziwe budynki (kafle wokół centrum) dla każdego szablonu wnętrza; wynik JSON na stdout.
// Użycie: npx tsx tools/pokaz-wnetrz.ts > pokaz.json; potem npx tsx tools/plany-wnetrz.ts pokaz.json plany.html
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { World } from '../shared/src/world/world';
import { makePlan, unitLayout } from '../shared/src/interiors/plan';
import { toWorld } from '../shared/src/interiors/geom';
const out: Record<string, unknown> = {};
for (const city of ['warszawa', 'londyn'] as const) {
  const dir = `client/public/tiles/${city}/`;
  const keys = readdirSync(dir).filter(f => f.endsWith('.json.gz')).map(f => f.replace('.json.gz', '').split('_').map(Number)).filter(([x, y]) => Math.abs(x) <= 3 && Math.abs(y) <= 3);
  const tiles = keys.map(([x, y]) => JSON.parse(gunzipSync(readFileSync(dir + `${x}_${y}.json.gz`)).toString()));
  const w = new World(city, { tiles });
  for (const t of tiles) for (const b of t.b) {
    const p = makePlan(b, t, w); if (!p || !p.ext.length) continue;
    for (const u of p.units) {
      const id = u.tpl.id, key = city + ':' + id; if (out[key]) continue;
      if (!unitLayout(p, u).entry) continue;
      if (id.startsWith('pl-m') && (p.typ !== 'blok' || p.levels < 4 || p.frame.W < 30)) continue;
      if (id === 'uk-council' && p.levels < 8) continue;
      if (u.tpl.kind === 'shop' && !u.accent) continue;
      if (id === 'uk-newbuild' && p.typ !== 'korytarz') continue;
      const e = p.ext.find(e => Math.abs(e.x - (u.slot.x0 + u.slot.x1) / 2) < (u.slot.x1 - u.slot.x0) / 2 + 3) ?? p.ext[0];
      out[key] = { city, id: b.id, typ: p.typ, unit: u.name, label: p.label, levels: p.levels, door: toWorld(p.frame, e.x, -e.tOut - 1.2), n: [-p.frame.uz, p.frame.ux], floor0: u.floor0 };
    }
  }
}
console.log(JSON.stringify(out, null, 1));
