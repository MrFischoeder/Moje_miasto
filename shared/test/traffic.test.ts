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
  });

  it('jadącego auta NPC nie da się przejąć; stojące: kierowca ucieka, gracz prowadzi, drugi gracz wsiada jako pasażer', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a'), b = sim.addPlayer('b'), w = sim.entity(p.walker), o = world.proj(52.2355, 21.0082);
    Object.assign(w, { x: o[0] - 75, z: o[1] + 75, y: 0, reg: -1 });
    const tr = sim.enableTraffic();
    for (let i = 0; i < 200; i++) sim.stepTraffic(i / 30, 8);
    const c = [...tr.cars.values()][0]; c.v = 12; c.e.speed = 12;
    Object.assign(w, { x: c.e.x + 1.5, z: c.e.z, y: c.e.y });
    sim.command(p.id, { type: 'enter' }); expect(p.vehicle).toBeNull();
    c.v = 0; c.e.speed = 0; const peds0 = sim.peds!.peds.size;
    sim.command(p.id, { type: 'enter' });
    expect(p.vehicle).toBe(c.e.id); expect(c.e.npc).toBe(false); expect(tr.cars.has(c.e.id)).toBe(false);
    expect(sim.peds!.peds.size).toBe(peds0 + 1); // wyrzucony kierowca
    const wb = sim.entity(b.walker); Object.assign(wb, { x: c.e.x - 1.5, z: c.e.z, y: c.e.y, reg: -1 });
    sim.command(b.id, { type: 'enter' }); expect(b.vehicle).toBe(c.e.id); expect(b.passenger).toBe(true);
  });

  it('piesi chodzą chodnikami i ścieżkami, poza budynkami, więcej w dzień niż w nocy', () => {
    const run = (hour: number) => {
      const sim = new Simulation(world), p = sim.addPlayer('a'), w = sim.entity(p.walker), o = world.proj(52.2355, 21.0082);
      Object.assign(w, { x: o[0] - 75, z: o[1] + 75, y: 0, reg: -1 });
      sim.enableTraffic(); for (let i = 0; i < 300; i++) sim.stepTraffic(i / 30, hour);
      return [...sim.peds!.peds.values()];
    };
    const day = run(17), night = run(3);
    expect(day.length).toBeGreaterThan(night.length); expect(day.length).toBeGreaterThan(10);
    for (const p of day) { expect(world.buildings.hit(p.e.x, p.e.z)).toBe(false); expect(p.e.kind).toBe('walker'); expect(p.e.npc).toBe(true); }
    expect(day.some(p => p.e.speed > 1)).toBe(true);
  });
  it('sygnalizacja: dwie grupy kierunków na zmianę (zielone, żółte, czerwone)', () => {
    const sim = new Simulation(world); const tr = sim.enableTraffic(); tr.graph.sync(world);
    const node = [...tr.graph.axis.keys()][0], ax = tr.graph.axis.get(node)!;
    const seen = new Set<string>();
    for (let t = 0; t < 60; t++) seen.add(`${tr.light(node, ax, t)}${tr.light(node, ax + Math.PI / 2, t)}`);
    expect(seen.has('02')).toBe(true); expect(seen.has('20')).toBe(true); expect(seen.has('00')).toBe(false);
  });
});
