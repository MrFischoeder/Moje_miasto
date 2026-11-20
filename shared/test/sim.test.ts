import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { NO_INPUT } from '../src/sim/types';
import { World } from '../src/world/world';
import { SIM_HZ } from '../src/sim/loop';

const world = new World('warszawa');

describe('symulacja', () => {
  it('pieszy idzie po peronie (stały krok SIM_HZ)', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a'), w = sim.entity(p.walker), x0 = w.x, z0 = w.z;
    sim.setInput(p.id, { ...NO_INPUT, f: 1, yaw: w.yaw });
    for (let i = 0; i < SIM_HZ; i++) sim.step();
    expect(Math.hypot(w.x - x0, w.z - z0)).toBeCloseTo(4.5, 1);
    expect(sim.tick).toBe(SIM_HZ);
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

describe('pasażerowie', () => {
  it('drugi gracz wsiada jako pasażer, kierowca jedzie, pasażer jedzie z nim i wysiada', () => {
    const sim = new Simulation(world), a = sim.addPlayer('a'), b = sim.addPlayer('b');
    expect(a.color).not.toBe(b.color);
    sim.command(a.id, { type: 'mode', mode: 'car' });
    const car = sim.entity(a.vehicle!), wb = sim.entity(b.walker);
    Object.assign(wb, { x: car.x + 2, z: car.z, y: car.y, reg: -1 });
    sim.command(b.id, { type: 'enter' });
    expect(b.vehicle).toBe(car.id); expect(b.passenger).toBe(true); expect(car.pass).toEqual([b.id]); expect(wb.hide).toBe(true);
    sim.setInput(a.id, { ...NO_INPUT, f: 1 }); sim.setInput(b.id, { ...NO_INPUT, f: -1, s: 1 }); // wejście pasażera ignorowane
    for (let i = 0; i < 60; i++) sim.step();
    expect(car.speed).toBeGreaterThan(5); expect(wb.x).toBeCloseTo(car.x, 5);
    sim.command(b.id, { type: 'mode', mode: 'walk' });
    expect(b.vehicle).toBeNull(); expect(car.pass).toEqual([]); expect(car.driver).toBe(a.id); expect(wb.hide).toBe(false);
    sim.removePlayer(a.id); expect(car.driver).toBeNull();
  });
});
