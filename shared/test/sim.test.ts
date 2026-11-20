import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { NO_INPUT } from '../src/sim/types';
import { World } from '../src/world/world';

const world = new World('warszawa');

describe('symulacja', () => {
  it('pieszy idzie po peronie (stały krok 60 Hz)', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a'), w = sim.entity(p.walker), x0 = w.x, z0 = w.z;
    sim.setInput(p.id, { ...NO_INPUT, f: 1, yaw: w.yaw });
    for (let i = 0; i < 60; i++) sim.step();
    expect(Math.hypot(w.x - x0, w.z - z0)).toBeCloseTo(4.5, 1);
    expect(sim.tick).toBe(60);
  });

  it('auto spod ziemi pojawia się na ulicy przy wyjściu, wysiadanie zostawia je zaparkowane', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a');
    sim.command(p.id, { type: 'mode', mode: 'car' });
    expect(sim.modeOf(p)).toBe('car');
    const car = sim.entity(p.vehicle!);
    expect(car.y).toBe(0);
    sim.setInput(p.id, { ...NO_INPUT, f: 1 });
    for (let i = 0; i < 120; i++) sim.step();
    expect(car.speed).toBeGreaterThan(5);
    sim.command(p.id, { type: 'mode', mode: 'walk' });
    expect(sim.modeOf(p)).toBe('walk');
    expect(car.driver).toBeNull(); expect(car.speed).toBe(0);
    expect(sim.entities.has(car.id)).toBe(true);
    // E: wsiadanie do najbliższego pojazdu
    sim.command(p.id, { type: 'enter' });
    expect(p.vehicle).toBe(car.id);
  });

  it('helikopter wznosi się', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a');
    sim.command(p.id, { type: 'mode', mode: 'heli' });
    const h = sim.entity(p.vehicle!), y0 = h.y;
    sim.setInput(p.id, { ...NO_INPUT, lift: 1 });
    for (let i = 0; i < 120; i++) sim.step();
    expect(h.y).toBeGreaterThan(y0 + 10); expect(h.air).toBe(true);
  });

  it('zapis i odczyt odtwarza stan', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a');
    sim.command(p.id, { type: 'mode', mode: 'car' });
    sim.setInput(p.id, { ...NO_INPUT, f: 1, s: .3 });
    for (let i = 0; i < 90; i++) sim.step();
    const save = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = new Simulation(world); sim2.load(save);
    for (const s of [sim, sim2]) { s.setInput(p.id, { ...NO_INPUT, f: 1 }); for (let i = 0; i < 30; i++) s.step(); }
    const a = sim.entity(p.vehicle!), b = sim2.entity(sim2.players.get(p.id)!.vehicle!);
    expect([b.x, b.z, b.yaw]).toEqual([a.x, a.z, a.yaw]);
  });
});
