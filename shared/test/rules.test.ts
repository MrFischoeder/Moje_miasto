import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '../src/data/cities';
import { parseOsmJson } from '../src/osm/raw';
import { buildTiles } from '../src/tiles/build';
import { World } from '../src/world/world';
import { Simulation, START_MONEY } from '../src/sim/sim';
import { NO_INPUT } from '../src/sim/types';

const raw = parseOsmJson(JSON.parse(readFileSync(join(__dirname, '../../tests/fixtures/miasto-testowe.json'), 'utf8')));
const world = new World('warszawa', { tiles: buildTiles(raw, 'warszawa', CITIES.warszawa.o).values() });
const o = world.proj(52.2355, 21.0082);

function setup() {
  const sim = new Simulation(world), p = sim.addPlayer('a'), w = sim.entity(p.walker);
  Object.assign(w, { x: o[0] - 75, z: o[1] + 12, y: 0, reg: -1 }); // chodnik Świętokrzyskiej
  const tr = sim.enableTraffic(); let t = 0;
  const run = (sec: number, each?: () => void) => { for (let i = 0; i < sec * 30; i++) { each?.(); sim.stepPlayer(p.id, NO_INPUT); sim.endStep(); sim.stepTraffic((t += 1 / 30), 12); } };
  return { sim, p, w, tr, run };
}

describe('policja i zasady gry', () => {
  it('kradzież auta: gwiazdka, policja przyjeżdża, wysiada i zatrzymuje (grzywna, zero gwiazdek)', () => {
    const { sim, p, w, tr, run } = setup();
    run(5);
    const c = [...tr.cars.values()][0]; c.v = 0; c.e.speed = 0;
    Object.assign(w, { x: c.e.x + 1.5, z: c.e.z, y: c.e.y });
    sim.command(p.id, { type: 'enter' });
    expect(p.wanted).toBe(1); expect(sim.rules!.events.some(e => e.kind === 'crime')).toBe(true);
    sim.command(p.id, { type: 'mode', mode: 'walk' }); // stoi pieszo obok auta
    expect(p.vehicle).toBeNull();
    let units = 0, minD = Infinity;
    run(90, () => {
      units = Math.max(units, sim.rules!.police.units.length);
      for (const u of sim.rules!.police.units) minD = Math.min(minD, Math.hypot(u.car.x - w.x, u.car.z - w.z));
    });
    expect(units).toBeGreaterThan(0);
    expect(minD).toBeLessThan(25);
    expect(p.wanted).toBe(0);
    expect(p.money).toBe(START_MONEY - 100);
    expect(sim.rules!.events.some(e => e.kind === 'arrest')).toBe(true);
  });

  it('potrącenie pieszego NPC autem: przestępstwo, pieszy leży', () => {
    const { sim, p, w, run } = setup();
    run(8);
    sim.command(p.id, { type: 'mode', mode: 'car' }); const car = sim.entity(p.vehicle!);
    const ped = [...sim.peds!.peds.values()][0];
    Object.assign(car, { x: ped.e.x + 1, z: ped.e.z, y: ped.e.y, speed: 10 });
    sim.rules!.step(1 / 30, 100);
    expect(p.wanted).toBe(1); expect(ped.e.tilt).toBeLessThan(-1); expect(sim.peds!.peds.has(ped.e.id)).toBe(false);
    void w;
  });

  it('śmierć: odrodzenie po 4 s z pełnym zdrowiem, strata pieniędzy, bez gwiazdek', () => {
    const { sim, p, run } = setup();
    p.wanted = 2; sim.rules!.hurt(p, 150, 'test');
    expect(p.hp).toBe(0); expect(p.dead).toBeGreaterThan(0); expect(p.wanted).toBe(0); expect(p.money).toBe(START_MONEY - 100);
    expect(sim.command(p.id, { type: 'mode', mode: 'car' })).toBeUndefined(); expect(p.vehicle).toBeNull(); // martwy nie steruje
    run(5);
    expect(p.dead).toBe(0); expect(p.hp).toBe(100);
  });
});
