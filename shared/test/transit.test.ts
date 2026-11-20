import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { World } from '../src/world/world';
import { GameClock, localTime } from '../src/transit/clock';
import { TransitSystem } from '../src/transit/system';
import type { TransitData } from '../src/transit/timetable';
import { Simulation } from '../src/sim/sim';

const data = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../../client/public/transit/warszawa.json.gz'))).toString()) as TransitData;
const world = new World('warszawa');
// środa 7:30 czasu warszawskiego
const WED_0730 = Date.parse('2026-11-25T06:30:00Z');

describe('rozkłady jazdy (GTFS ZTM)', () => {
  const sys = new TransitSystem(data, world, new GameClock(Date.now(), WED_0730, 0));

  it('czas lokalny i typ dnia', () => {
    const lt = localTime(WED_0730, 'Europe/Warsaw');
    expect(lt.day).toBe(0); expect(Math.round(lt.sec)).toBe(7.5 * 3600);
    expect(localTime(Date.parse('2026-11-28T12:00:00Z'), 'Europe/Warsaw').day).toBe(1);
    expect(localTime(Date.parse('2026-11-29T12:00:00Z'), 'Europe/Warsaw').day).toBe(2);
  });

  it('w szczycie jeździ metro, tramwaje, autobusy i koleje; w nocy tylko nocne', () => {
    const lt = sys.local(), c = sys.tt.count(lt.sec, lt.day, lt.prevDay);
    expect(c.metro).toBeGreaterThan(30); expect(c.tram).toBeGreaterThan(200); expect(c.bus).toBeGreaterThan(600); expect(c.rail).toBeGreaterThan(20);
    const n = localTime(WED_0730 - 5.5 * 3600e3, 'Europe/Warsaw'), cn = sys.tt.count(n.sec, n.day, n.prevDay);
    expect(cn.tram ?? 0).toBe(0); expect(cn.bus).toBeGreaterThan(20);
    expect(sys.metro.ok).toBeGreaterThan(0); expect(sys.metro.failed).toBe(0);
  });

  it('pojazd stoi na przystanku, potem rusza i przyspiesza (profil trapezowy)', () => {
    const p = sys.tt.patterns.find(q => q.kind === 'bus' && q.stops.length > 5)!, prof = p.profiles[0];
    const atStop = sys.tt.state(p, prof, prof[2] + 1)!; // sekundę po przyjeździe na drugi przystanek
    expect(atStop.stop).toBe(1); expect(atStop.speed).toBe(0);
    const mid = prof[4] - 5, a = sys.tt.state(p, prof, mid)!; // 5 s przed trzecim przystankiem
    expect(a.stop).toBe(-1); expect(a.s).toBeGreaterThan(p.stopS[1]); expect(a.s).toBeLessThan(p.stopS[2]); expect(a.speed).toBeGreaterThan(0);
    expect(sys.tt.state(p, prof, prof[prof.length - 1] + 1000)).toBeNull();
  });

  it('metro jedzie tunelami pod ziemią', () => {
    const a = sys.near([-20000, -20000, 20000, 20000]).find(x => x.p.kind === 'metro')!;
    const q = sys.pose(a.p, a.st.s); expect(q.y).toBeLessThan(world.ground(q.x, q.z) - 5);
  });

  it('gracz wsiada na przystanku, nie wysiada w biegu, wysiada na następnym', () => {
    const clock = new GameClock(0, WED_0730, 1);
    const sim = new Simulation(world); sim.transit = new TransitSystem(data, world, clock);
    const p = sim.addPlayer('a'), w = sim.entity(p.walker);
    // pojazd stojący na przystanku: postaw gracza obok
    let a = sim.transit.near([-30000, -30000, 30000, 30000], clock.now(0)).find(x => x.st.stop > 0 && x.p.kind === 'tram' && x.st.stop < x.p.stops.length - 2)!;
    const at = sim.transit.alightPose(a); Object.assign(w, { x: at.x, y: at.y, z: at.z, reg: -1 });
    // zegar „stoi” w tej chwili (skala 0), żeby pojazd był na przystanku
    clock.set(clock.now(0), 0, 0);
    expect(sim.command(p.id, { type: 'enter' })).toBeUndefined();
    expect(p.ride).toBe(a.key); expect(w.hide).toBe(true);
    // ruszamy: krok zegara do chwili jazdy
    const prof = a.p.profiles[a.p.trips[a.k * 3 + 1]], start = a.p.trips[a.k * 3];
    const lt = sim.transit.local(), mid = (prof[2 * a.st.stop + 1] + prof[2 * a.st.stop + 2]) / 2;
    clock.set(clock.now(0) + (mid - (lt.sec + (a.key.endsWith(':1') ? 86400 : 0) - start)) * 1000, 0, 0);
    sim.endStep();
    expect(sim.command(p.id, { type: 'alight' })).toMatch(/Drzwi zamknięte/);
    a = sim.transit.trip(p.ride!)!; const q = sim.transit.pose(a.p, a.st.s); expect(w.x).toBeCloseTo(q.x, 3);
    clock.set(clock.now(0) + (prof[2 * a.p.stopS.findIndex(s => s > a.st.s)] - mid + 1) * 1000, 0, 0);
    expect(sim.command(p.id, { type: 'alight' })).toBeUndefined(); expect(p.ride).toBeNull(); expect(w.hide).toBe(false);
  });
});
