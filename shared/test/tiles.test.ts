import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '../src/data/cities';
import { parseOsmJson } from '../src/osm/raw';
import { buildTiles } from '../src/tiles/build';
import { joinRings } from '../src/osm/assemble';
import { World, toXZ } from '../src/world/world';

const raw = parseOsmJson(JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/miasto-testowe.json'), 'utf8')));
const tiles = buildTiles(raw, 'warszawa', CITIES.warszawa.o);
const all = [...tiles.values()];
const world = new World('warszawa', { tiles: all, osmPoints: raw.taggedNodes() });
const o = world.proj(52.2355, 21.0082); // środek pliku testowego (stacja)
const at = (x: number, z: number): [number, number] => [o[0] + x, o[1] + z];

describe('kafelki z OSM', () => {
  it('relacja multipolygon daje budynek z dziedzińcem', () => {
    const b = all.flatMap(t => t.b).find(b => b.i);
    expect(b).toBeTruthy(); expect(b!.a).toMatch(/^Marszałkowska \d+$/); expect(b!.lv).toBeGreaterThan(3);
    // kwartał między ulicami -150 i 0 (x), -300 i -150 (z): ściana zablokowana, dziedziniec wolny
    expect(world.blocked(...at(-150 + 16, -225))).toBe(true);
    expect(world.blocked(...at(-75, -225))).toBe(false);
  });

  it('woda blokuje, most przez rzekę nie', () => {
    expect(world.blocked(...at(375, 100))).toBe(true);
    expect(world.blocked(...at(375, 0))).toBe(false);
    expect(world.carHit(...at(375, 0), Math.PI / 2)).toBe(false);
  });

  it('graf drogowy: skrzyżowania, sygnalizacja, pasy i szerokości', () => {
    const g = all.flatMap(t => t.g), roads = all.flatMap(t => t.r);
    expect(g.filter(n => n.jn).length).toBeGreaterThan(10);
    expect(g.some(n => n.sig)).toBe(true);
    const main = roads.find(r => r.n === 'Marszałkowska')!;
    expect(main.ln).toBe(4); expect(main.w).toBe(13); expect(main.sw).toBe(3);
    expect(roads.find(r => r.n === 'Poprzeczna 150')!.ow).toBe(1);
    expect(roads.some(r => r.br)).toBe(true);
    // każdy węzeł grafu wskazany przez drogę istnieje w kafelku
    for (const t of all) { const ids = new Set(t.g.map(n => n.id)); for (const r of t.r) for (let i = 1; i < r.j.length; i += 2) expect(ids.has(r.j[i])).toBe(true); }
  });

  it('sklepy przypisane do budynków, z adresem; przejścia z kierunkiem', () => {
    const poi = all.flatMap(t => t.poi), zabka = poi.find(p => p.brand === 'Żabka')!;
    expect(zabka.b).toBeTypeOf('number'); expect(zabka.a).toBe('Marszałkowska 100');
    const cr = all.flatMap(t => t.n).filter(n => n.k === 'crossing');
    expect(cr.length).toBe(2); expect(cr.every(n => n.d != null)).toBe(true);
  });

  it('stacja z pliku przesunięta, wejścia jako zejścia', () => {
    expect(world.osmStations).toBe(1);
    const s = world.stations.find(s => s.name === 'Świętokrzyska')!;
    expect(s.real).toBe(true); expect(s.exitGeoms.some(e => e.corr || e.stair)).toBe(true);
  });

  it('kafelki da się zwolnić (kolizje znikają)', () => {
    const w = new World('warszawa', { tiles: all }), p = at(-150 + 16, -225);
    expect(w.blocked(...p)).toBe(true);
    for (const k of [...w.tiles.keys()]) w.removeTile(k);
    expect(w.blocked(...p)).toBe(false); expect(w.buildings.polys.length).toBe(0);
  });

  it('łączenie pierścieni z odcinków w dowolnej kolejności i kierunku', () => {
    const r = joinRings([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 1], [0, 0]]]);
    expect(r.length).toBe(1); expect(r[0].length).toBe(5);
    expect(toXZ([1, 2, 3, 4])).toEqual([[1, 2], [3, 4]]);
  });
});
