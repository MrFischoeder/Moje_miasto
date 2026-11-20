// Symulacja bez przeglądarki: dowód, że shared/sim działa w Node.js (podstawa serwera).
// Uruchom: npm run sim:headless -- [miasto] [liczba graczy] [sekundy]
import { CITY_KEYS, type CityKey } from '@miasto/shared/data/cities';
import { Simulation } from '@miasto/shared/sim/sim';
import { SIM_DT, SIM_HZ } from '@miasto/shared/sim/loop';
import { World } from '@miasto/shared/world/world';

const [cityArg = 'warszawa', nArg = '8', secArg = '10'] = process.argv.slice(2);
if (!CITY_KEYS.includes(cityArg as CityKey)) throw new Error(`Nieznane miasto: ${cityArg}`);
const t0 = performance.now();
const world = new World(cityArg as CityKey);
const tWorld = performance.now() - t0;
const sim = new Simulation(world);
const n = +nArg, ticks = Math.round(+secArg * SIM_HZ);
const players = Array.from({ length: n }, (_, i) => sim.addPlayer('bot' + i));
// boty: co drugi jedzie autem, reszta chodzi peronem
players.forEach((p, i) => { if (i % 2) sim.command(p.id, { type: 'mode', mode: 'car' }); });
const t1 = performance.now();
for (let k = 0; k < ticks; k++) {
  players.forEach((p, i) => sim.setInput(p.id, { f: 1, s: Math.sin(k * SIM_DT + i) * .5, run: i % 3 === 0, brake: false, lift: 0, yaw: i, pitch: 0 }));
  sim.step();
}
const tSim = performance.now() - t1;
console.log(`miasto: ${world.city.name}, stacji: ${world.stations.length}, regionów: ${world.regions.list.length}, budowa świata: ${tWorld.toFixed(1)} ms`);
console.log(`graczy: ${n}, kroków: ${ticks} (${SIM_HZ} Hz), średni krok: ${(tSim / ticks * 1000).toFixed(1)} µs`);
for (const p of players.slice(0, 4)) { const e = sim.controlled(p); console.log(`  ${p.name}: ${sim.modeOf(p)} x=${e.x.toFixed(1)} y=${e.y.toFixed(1)} z=${e.z.toFixed(1)}`); }
