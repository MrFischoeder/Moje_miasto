import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '../src/data/cities';
import { parseOsmJson } from '../src/osm/raw';
import { buildTiles } from '../src/tiles/build';
import { World } from '../src/world/world';
import { Simulation } from '../src/sim/sim';

const raw = parseOsmJson(JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/miasto-testowe.json'), 'utf8')));
const world = new World('warszawa', { tiles: buildTiles(raw, 'warszawa', CITIES.warszawa.o).values() });

describe('ruch uliczny', () => {
  it('auta NPC pojawiają się wokół gracza, jadą jezdniami, nie wjeżdżają w budynki', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a'), w = sim.entity(p.walker), o = world.proj(52.2355, 21.0082);
    Object.assign(w, { x: o[0] - 75, z: o[1] + 75, y: 0, reg: -1 });
    const tr = sim.enableTraffic();
    for (let i = 0; i < 300; i++) sim.stepTraffic(i / 30, 8);
    const cars = [...tr.cars.values()];
    expect(cars.length).toBeGreaterThan(5);
    expect(cars.filter(c => c.v > 1).length).toBeGreaterThan(0);
    for (const c of cars) { expect(world.buildings.hit(c.e.x, c.e.z)).toBe(false); expect(c.e.npc).toBe(true); }
    // do auta NPC nie da się wsiąść
    const c = cars[0]; Object.assign(w, { x: c.e.x + 1.5, z: c.e.z, y: c.e.y });
    sim.command(p.id, { type: 'enter' }); expect(p.vehicle).not.toBe(c.e.id);
  });
  it('sygnalizacja: dwie grupy kierunków na zmianę (zielone, żółte, czerwone)', () => {
    const sim = new Simulation(world); const tr = sim.enableTraffic(); tr.graph.sync(world);
    const node = [...tr.graph.axis.keys()][0], ax = tr.graph.axis.get(node)!;
    const seen = new Set<string>();
    for (let t = 0; t < 60; t++) seen.add(`${tr.light(node, ax, t)}${tr.light(node, ax + Math.PI / 2, t)}`);
    expect(seen.has('02')).toBe(true); expect(seen.has('20')).toBe(true); expect(seen.has('00')).toBe(false);
  });
});
