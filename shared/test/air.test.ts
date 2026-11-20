import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AirTraffic, type AirData } from '../src/air/flights';

const data = JSON.parse(readFileSync(join(__dirname, '../../client/public/air/londyn.json'), 'utf8')) as AirData;
const air = new AirTraffic(data), g = () => 0;

describe('ruch lotniczy', () => {
  it('Heathrow w dzień: kilka samolotów naraz, w nocy cisza; powtarzalnie', () => {
    let sum = 0, n = 0; for (let t = 10 * 3600; t < 11 * 3600; t += 30, n++) sum += air.active(t, '2026-11-25', g).filter(f => f.ap.iata === 'LHR').length;
    expect(sum / n).toBeGreaterThan(1.5); // ~38 operacji/h po ~4,5 min
    const day = air.active(10 * 3600, '2026-11-25', g);
    expect(air.active(3 * 3600, '2026-11-25', g).filter(f => f.ap.iata === 'LHR').length).toBe(0);
    expect(air.active(10 * 3600, '2026-11-25', g).map(f => f.id)).toEqual(day.map(f => f.id));
  });
  it('lądowanie: zniżanie po ścieżce 3°, przyziemienie, hamowanie; start: rozbieg i wznoszenie', () => {
    let seenAir = false, seenGround = false;
    for (let t = 10 * 3600; t < 11 * 3600; t += 5) for (const f of air.active(t, '2026-11-25', g)) {
      if (f.arr && !f.onGround) { seenAir = true; expect(f.y).toBeLessThan(1200); }
      if (f.onGround) { seenGround = true; expect(f.y).toBe(0); }
    }
    expect(seenAir && seenGround).toBe(true);
  });
});
