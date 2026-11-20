import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { Simulation } from '../src/sim/sim';
import { NO_INPUT } from '../src/sim/types';

const buf = gunzipSync(readFileSync(join(__dirname, '../../client/public/terrain/warszawa.bin.gz')));
const terrain = Terrain.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const world = new World('warszawa', { terrain });
const st = (n: string) => world.stations.find(s => s.name === n)!;

describe('teren (Copernicus DEM)', () => {
  it('zapis i odczyt pliku', () => {
    const t2 = Terrain.parse(terrain.encode());
    expect(t2.height(1234, -567)).toBeCloseTo(terrain.height(1234, -567), 1);
  });

  it('skarpa wiślana: Powiśle ok. 20–35 m niżej niż Śródmieście', () => {
    const d = st('Centrum').surf - st('Centrum Nauki Kopernik').surf;
    expect(d).toBeGreaterThan(18); expect(d).toBeLessThan(36);
  });

  it('hale i schody pod ziemią, wyloty schodów na powierzchni', () => {
    for (const s of world.stations) {
      for (const h of s.halls) expect(h.y + h.H).toBeLessThan(world.ground(s.x, s.z) - 2);
      for (const e of s.exitGeoms) expect(e.stair.y1).toBeCloseTo(world.ground(e.top[0], e.top[1]), 3);
    }
  });

  it('pieszy chodzi po zboczu, auto jedzie po gruncie', () => {
    const sim = new Simulation(world), p = sim.addPlayer('a');
    sim.command(p.id, { type: 'goStation', station: st('Centrum Nauki Kopernik').i, street: true });
    const w = sim.entity(p.walker);
    expect(w.y).toBeCloseTo(world.ground(w.x, w.z), 3);
    sim.setInput(p.id, { ...NO_INPUT, f: 1, run: true, yaw: Math.PI / 2 }); // na zachód, pod skarpę
    for (let i = 0; i < 600; i++) sim.step();
    expect(w.y).toBeCloseTo(world.ground(w.x, w.z), 3);
    sim.command(p.id, { type: 'mode', mode: 'car' });
    const car = sim.entity(p.vehicle!); sim.setInput(p.id, { ...NO_INPUT, f: 1 });
    for (let i = 0; i < 300; i++) sim.step();
    expect(car.y).toBeCloseTo(world.ground(car.x, car.z), 3);
  });
});
