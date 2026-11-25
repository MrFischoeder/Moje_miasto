// Wnętrza budynków: szablony, plany na prawdziwych budynkach z OSM, dostępność wszystkich pomieszczeń
// fizyką chodzenia, determinizm (identyczne wnętrza u każdego), przeszukiwanie i napad na kasę.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { World } from '../src/world/world';
import { Terrain } from '../src/world/terrain';
import type { TileData } from '../src/tiles/types';
import { layoutTemplate, TEMPLATES } from '../src/interiors/layout';
import { buildLevel, makePlan } from '../src/interiors/plan';
import { classify, windowSlots } from '../src/interiors/facade';
import { unreachable } from '../src/interiors/reach';
import { pip } from '../src/world/collision';
import { ringXZ, toWorld } from '../src/interiors/geom';
import { Simulation } from '../src/sim/sim';
import { NO_INPUT } from '../src/sim/types';

const ROOT = join(__dirname, '../..');
const tile = (city: string, x: number, y: number): TileData => JSON.parse(gunzipSync(readFileSync(join(ROOT, `client/public/tiles/${city}/${x}_${y}.json.gz`))).toString());
const terrain = (city: string) => { const b = gunzipSync(readFileSync(join(ROOT, `client/public/terrain/${city}.bin.gz`))); return Terrain.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
function worldAround(city: 'warszawa' | 'londyn', tx: number, ty: number): World {
  const tiles: TileData[] = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { try { tiles.push(tile(city, tx + dx, ty + dy)); } catch { /* brak kafla */ } }
  return new World(city, { tiles, terrain: terrain(city) });
}
const center = (o: number[]) => { let x = 0, z = 0; for (let i = 0; i < o.length; i += 2) { x += o[i]; z += o[i + 1]; } return [x / (o.length / 2), z / (o.length / 2)]; };

describe('szablony wnętrz', () => {
  it('9 szablonów: wejście i każde pomieszczenie osiągalne drzwiami (wiele ziaren i rozmiarów)', () => {
    expect(Object.keys(TEMPLATES).length).toBe(9);
    const sizes: Record<string, [number, number][]> = {
      'pl-m2': [[11, 4], [10, 5]], 'pl-m3': [[11, 5.5], [12, 6]], 'pl-kamienica': [[13, 8], [15, 9.5]], 'uk-terraced': [[5, 10], [5.8, 12]],
      'uk-newbuild': [[6.5, 7], [7.5, 8.5]], 'uk-council': [[8, 7], [9, 8]], 'pl-maly': [[7, 9], [10, 11]], 'uk-conv': [[12, 16], [15, 18]], 'dyskont': [[30, 40], [40, 45]],
    };
    for (const [id, list] of Object.entries(sizes)) for (const [W, D] of list) for (let s = 0; s < 6; s++) {
      const t = TEMPLATES[id], lay = layoutTemplate(t, W, D, `test${s}`, .3, W - .3);
      expect(lay.entry, `${id} ${W}x${D} #${s}: wejście`).not.toBeNull();
      // graf drzwi (piętra łączą się przez schody)
      const key = (r: { id: string; floor: number }) => r.floor + ':' + r.id, adj = new Map<string, string[]>();
      const add = (a: string, b: string) => { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); };
      for (const d of lay.doors) add(d.A.startsWith('^') ? (d.floor - 1) + ':' + d.A.slice(1) : d.floor + ':' + d.A, d.floor + ':' + d.B);
      const seen = new Set([`0:${lay.entry!.room}`]), q = [...seen];
      while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
      for (const r of lay.rooms) expect(seen.has(key(r)), `${id} ${W}x${D} #${s}: ${key(r)}`).toBe(true);
    }
  });

  it('okna wnętrza = okna fasady (ta sama funkcja), parametry z typologii', () => {
    const t = tile('warszawa', 0, 0), b = t.b.find(q => classify(q, 'warszawa').typ === 'blok')!, c = classify(b, 'warszawa');
    expect(c.raise).toBe(1); expect(c.spacing).toBeGreaterThan(2.8);
    const s = windowSlots(12, c); expect(s.length).toBe(Math.floor((12 - .6) / c.spacing));
    expect(s[0][0]).toBeCloseTo(12 - s[s.length - 1][1], 5); // symetrycznie na ścianie
  });
});

describe('wnętrza na prawdziwych budynkach', () => {
  for (const [city, tx, ty] of [['warszawa', 0, 0], ['londyn', 0, 0]] as const) {
    it(`${city}: z ulicy dojście do każdego pomieszczenia parteru i dwóch pięter`, () => {
      const w = worldAround(city, tx, ty), t = [...w.tiles.values()].find(q => q.x === tx && q.y === ty)!;
      let tested = 0; const typs = new Set<string>();
      for (const b of t.b) {
        if (tested >= 14) break;
        const [cx, cz] = center(b.o);
        w.interiors.sync([{ x: cx, y: -99, z: cz }], 50);
        const lv = w.interiors.live.get(b.id); if (!lv) { w.interiors.sync([]); continue; }
        const p = lv.plan; tested++; typs.add(p.typ);
        w.interiors.sync([{ x: cx, y: p.f0, z: cz }], 0); w.interiors.sync([{ x: cx, y: p.f0 + p.H, z: cz }], 0);
        // drzwi zewnętrzne zaczynają się na ulicy (poza budynkiem)
        for (const e of p.ext) { const [x, z] = toWorld(p.frame, e.x, -e.tOut + .1); expect(pip(p.outer, x, z), `${b.id}: wejście poza obrysem`).toBe(false); }
        // drzwi: zamknięte blokują przejście; po otwarciu wszystkich dojście do każdego pomieszczenia
        const fl = [0, 1, 2].filter(k => k < p.levels), ds = [...w.interiors.liveDoors()].filter(q => q.plan === p);
        if (ds.some(q => q.d.ext)) {
          for (const { d } of ds) w.interiors.setDoor(d.id, 0);
          expect(unreachable(w, lv, fl).length, `${b.id}: zamknięte drzwi nie blokują`).toBeGreaterThan(0);
          const e = ds.find(q => q.d.ext); if (e) { const m = (e.d.a + e.d.b) / 2, [x, z] = toWorld(p.frame, m, -.5); expect(w.interiors.nearDoor(x, z, e.d.y0)?.d.id).toBe(e.d.id); }
        }
        for (const { d } of ds) w.interiors.setDoor(d.id, 1);
        expect(unreachable(w, lv, fl), `${p.typ} ${b.id}`).toEqual([]);
        w.interiors.sync([]);
      }
      expect(tested).toBeGreaterThanOrEqual(10);
      expect(typs.size).toBeGreaterThanOrEqual(2);
      expect(w.interiors.live.size).toBe(0); expect(w.regions.dyn.size).toBe(0); // po odejściu wszystko zwolnione
    }, 120_000);
  }

  it('determinizm: dwa niezależne światy (serwer, klient) składają identyczne piętro', () => {
    const t = tile('warszawa', 0, 0), w1 = new World('warszawa', { tiles: [t] }), w2 = new World('warszawa', { tiles: [tile('warszawa', 0, 0)] });
    let n = 0;
    for (const b of t.b) {
      const p1 = makePlan(b, t, w1); if (!p1) continue;
      const p2 = makePlan(b, [...w2.tiles.values()][0], w2)!;
      for (const k of [0, Math.min(2, p1.levels - 1)]) {
        const a = buildLevel(p1, k), c = buildLevel(p2, k);
        expect(JSON.stringify({ b: a.boxes, i: a.items, w: a.walks, d: a.doors })).toBe(JSON.stringify({ b: c.boxes, i: c.items, w: c.walks, d: c.doors }));
      }
      if (++n >= 8) break;
    }
    expect(n).toBe(8);
  });
});

describe('przeszukiwanie', () => {
  it('szafa daje łup raz (potem pusto), kasa w sklepie to napad: gwiazdki', () => {
    const w = worldAround('warszawa', -3, 1);
    const b = [...w.tiles.values()].flatMap(t => t.b).find(q => q.id === 238177212)!; // Al. Jerozolimskie 121/123, Żabka w parterze
    const [cx, cz] = center(b.o);
    const sim = new Simulation(w), p = sim.addPlayer('a'), wk = sim.entity(p.walker); sim.enableTraffic();
    Object.assign(wk, { x: cx, z: cz, y: -99 }); for (let i = 0; i < 5; i++) sim.syncInteriors();
    const lv = w.interiors.live.get(b.id)!; expect(lv).toBeTruthy();
    const items = [...lv.levels.get(0)!.level.items];
    const till = items.find(i => i.c === 'kasa')!, shelf = items.find(i => i.c && i.c !== 'kasa' && i.c !== 'polka' && i.c !== 'lodowka_sklep')!;
    expect(till).toBeTruthy(); expect(shelf).toBeTruthy();
    const stand = (it: typeof till) => { const [x, z] = toWorld(lv.plan.frame, (it.r.x0 + it.r.x1) / 2, it.r.y0 - .4); Object.assign(wk, { x, z, y: it.y }); };
    const ev = () => sim.rules!.events.splice(0).map(e => e.text);
    stand(shelf); sim.command(p.id, { type: 'enter' });
    const e1 = ev(); expect(e1.length).toBeGreaterThan(0); expect(e1[0]).toContain(shelf.n);
    sim.command(p.id, { type: 'enter' }); expect(ev()[0]).toContain('pusto');
    const m0 = p.money; stand(till); sim.command(p.id, { type: 'enter' });
    expect(p.money).toBeGreaterThan(m0); expect(p.wanted).toBe(2);
    expect(ev().some(t => t.includes('Napad'))).toBe(true);
    sim.stepPlayer(p.id, NO_INPUT); sim.endStep();
  });
});

describe('przełącznik wnętrz', () => {
  it('wyłączenie zwalnia wnętrza, gracz z klatki wychodzi na ulicę i może chodzić; ponowne włączenie przywraca', () => {
    const w = worldAround('warszawa', -3, 1);
    const b = [...w.tiles.values()].flatMap(t => t.b).find(q => q.id === 238177212)!, [cx, cz] = center(b.o);
    const sim = new Simulation(w), p = sim.addPlayer('a'), wk = sim.entity(p.walker);
    Object.assign(wk, { x: cx, z: cz, y: -99 }); for (let i = 0; i < 5; i++) sim.syncInteriors();
    const lv = w.interiors.live.get(b.id)!, c = lv.plan.cores.find(q => !q.sealed)!;
    const [x, z] = toWorld(lv.plan.frame, (c.r.x0 + c.r.x1) / 2, c.r.y1 - 1), s = w.support(x, z, lv.plan.f0)!;
    Object.assign(wk, { x, z, y: s.h, reg: s.r!.id });
    sim.setInteriors(false);
    expect(w.interiors.live.size).toBe(0); expect(w.regions.dyn.size).toBe(0);
    expect(w.regions.get(wk.reg)?.info.b).toBeUndefined();
    sim.syncInteriors(); expect(w.interiors.live.size).toBe(0);
    const x0 = wk.x; for (let i = 0; i < 30; i++) sim.stepPlayer(p.id, { ...NO_INPUT, f: 1, yaw: 0 }); // idzie
    expect(Math.hypot(wk.x - x0, 0) + Math.abs(wk.z - z) > .5 || wk.x !== x0).toBe(true);
    sim.setInteriors(true); sim.syncInteriors(); expect(w.interiors.live.size).toBeGreaterThan(0);
  });
});

describe('drzwi', () => {
  it('domyślnie większość zamknięta, stan zmieniany i zapamiętany', async () => {
    const { doorOpenByDefault } = await import('../src/interiors/interiors');
    let open = 0; for (let i = 0; i < 2000; i++) if (doorOpenByDefault(`123/${i % 7}/${i}`)) open++;
    expect(open / 2000).toBeGreaterThan(.08); expect(open / 2000).toBeLessThan(.25);
    const w = new World('warszawa', { tiles: [tile('warszawa', 0, 0)] }), I = w.interiors, id = '1/0/0', c0 = I.doorCode(id), c1 = c0 ^ 1;
    expect(I.setDoor(id, c1)).toBe(true); expect(I.isOpen(id)).toBe(!(c0 & 1)); expect(I.doorStates()).toEqual([[id, c1]]);
    expect(I.setDoor(id, c1)).toBe(false);
    I.setDoor(id, c0); expect(I.doorStates()).toEqual([]);
  });
  it('drzwi na klucz: nie otwierają się, trzy kopniaki wyważają (bez zamka) i dają poszukiwanie', async () => {
    const { doorDefault, DOOR_LOCKED, DOOR_BROKEN, DOOR_OPEN } = await import('../src/interiors/interiors');
    let locked = 0; for (let i = 0; i < 2000; i++) if (doorDefault(`9/${i % 5}/${i}`) & DOOR_LOCKED) locked++;
    expect(locked / 2000).toBeGreaterThan(.2); expect(locked / 2000).toBeLessThan(.4);
    const w = worldAround('warszawa', -3, 1);
    const b = [...w.tiles.values()].flatMap(t => t.b).find(q => q.id === 238177212)!, [cx, cz] = center(b.o);
    const sim = new Simulation(w); sim.enableTraffic(); const p = sim.addPlayer('a'), wk = sim.entity(p.walker);
    Object.assign(wk, { x: cx, z: cz, y: -99 }); for (let i = 0; i < 5; i++) sim.syncInteriors();
    const lv = w.interiors.live.get(b.id)!, e = [...w.interiors.liveDoors()].find(q => q.plan === lv.plan && q.d.ext)!;
    const m = (e.d.a + e.d.b) / 2, [x, z] = toWorld(lv.plan.frame, m, e.d.at - .5); Object.assign(wk, { x, z, y: e.d.y0, reg: -1 });
    w.interiors.setDoor(e.d.id, DOOR_LOCKED);
    sim.command(p.id, { type: 'enter' }); expect(w.interiors.isOpen(e.d.id)).toBe(false);
    sim.command(p.id, { type: 'kick' }); sim.command(p.id, { type: 'kick' }); expect(w.interiors.isOpen(e.d.id)).toBe(false);
    sim.command(p.id, { type: 'kick' }); expect(w.interiors.doorCode(e.d.id)).toBe(DOOR_OPEN | DOOR_BROKEN);
    expect(p.wanted).toBeGreaterThan(0);
    sim.command(p.id, { type: 'enter' }); expect(w.interiors.doorCode(e.d.id)).toBe(DOOR_BROKEN); // wyważone: da się przymknąć, bez zamka
    sim.command(p.id, { type: 'enter' }); expect(w.interiors.isOpen(e.d.id)).toBe(true);
  });
});

describe('taksówka', () => {
  it('zamówienie, dojazd, wsiadanie, kurs z opłatą i wysiadanie u celu', () => {
    const w = worldAround('warszawa', -3, 1), sim = new Simulation(w); sim.enableTraffic();
    const p = sim.addPlayer('a'), wk = sim.entity(p.walker); p.money = 500;
    // gracz na jezdni (punkt grafu)
    sim.stepTraffic(0, 12); const G = sim.traffic!.graph, e0 = G.edges.find(e => e.len > 60)!, q = { x: 0, z: 0, yaw: 0 }; G.pose(e0, e0.len / 2, 4, q);
    Object.assign(wk, { x: q.x, z: q.z, y: w.surfaceAt(q.x, q.z, 1e6), reg: -1 });
    const dest: [number, number] = [q.x + 900, q.z + 300];
    const msg = sim.command(p.id, { type: 'taxi', x: dest[0], z: dest[1] }); expect(msg).toContain('Taksówka zamówiona');
    let info = sim.taxi!.info(p.id)!; expect(info.st).toBe('coming');
    for (let i = 0; i < 30 * 60 && sim.taxi!.info(p.id)?.st !== 'waiting'; i++) sim.stepTraffic(i / 30, 12);
    info = sim.taxi!.info(p.id)!; expect(info.st).toBe('waiting');
    const cab = sim.entity(info.id); Object.assign(wk, { x: cab.x + 2, z: cab.z }); // podejście do auta
    sim.command(p.id, { type: 'enter' }); expect(p.vehicle).toBe(info.id); expect(p.passenger).toBe(true);
    const m0 = p.money;
    for (let i = 0; i < 30 * 20 && sim.taxi!.info(p.id); i++) { sim.stepTraffic(i / 30, 12); sim.endStep(); }
    expect(sim.taxi!.info(p.id)).toBeNull(); expect(p.vehicle).toBeNull();
    expect(p.money).toBeLessThan(m0); expect(Math.hypot(wk.x - dest[0], wk.z - dest[1])).toBeLessThan(60);
  });
});

describe('auta gracza i praca kierowcy', () => {
  it('salon, dziupla, praca kierowcy tylko legalnym autem: klient wsiada i płaci u celu', async () => {
    const { DZIUPLA } = await import('../src/game/cars');
    const w = worldAround('warszawa', -3, 1), sim = new Simulation(w); sim.enableTraffic();
    const p = sim.addPlayer('a'); p.money = 5000;
    sim.stepTraffic(0, 12); const G = sim.traffic!.graph, e0 = G.edges.find(e => e.len > 60)!, q = { x: 0, z: 0, yaw: 0 }; G.pose(e0, e0.len / 2, 2, q);
    Object.assign(sim.entity(p.walker), { x: q.x, z: q.z, y: w.surfaceAt(q.x, q.z, 1e6), reg: -1 });
    // auto bez papierów: praca niedostępna
    sim.command(p.id, { type: 'mode', mode: 'car', v: 0 }); const car = sim.entity(p.vehicle!);
    expect(car.legal).toBeUndefined(); expect(sim.command(p.id, { type: 'cab', on: true })).toContain('legalnego');
    // dziupla: za daleko, potem na miejscu
    expect(sim.command(p.id, { type: 'rereg' })).toContain('Podjedź');
    const d = DZIUPLA.warszawa, x0 = car.x, z0 = car.z; Object.assign(car, { x: d.x, z: d.z });
    const m0 = p.money; expect(sim.command(p.id, { type: 'rereg' })).toContain('przerejestrowane'); expect(car.legal).toBe(p.id); expect(p.money).toBeLessThan(m0);
    Object.assign(car, { x: x0, z: z0 });
    // salon: kupno innego modelu
    expect(sim.command(p.id, { type: 'buyCar', v: 1 })).toContain('Kupiono'); expect(p.owned).toContain(1);
    // praca kierowcy
    expect(sim.command(p.id, { type: 'cab', on: true })).toContain('Zaczynasz');
    let info = sim.cab!.info(p.id)!;
    for (let i = 0; i < 30 * 10 && info.st === 'search'; i++) { sim.stepTraffic(i / 30, 12); info = sim.cab!.info(p.id)!; }
    expect(info.st).toBe('pickup');
    Object.assign(car, { x: info.target![0], z: info.target![1], speed: 0 }); sim.stepTraffic(11, 12); info = sim.cab!.info(p.id)!;
    expect(info.st).toBe('ride');
    const m1 = p.money; Object.assign(car, { x: info.target![0], z: info.target![1], speed: 0 }); sim.stepTraffic(12, 12);
    info = sim.cab!.info(p.id)!; expect(info.rides).toBe(1); expect(p.money).toBeGreaterThan(m1);
    // wyjście z auta kończy pracę
    sim.command(p.id, { type: 'mode', mode: 'walk' }); sim.stepTraffic(13, 12); expect(sim.cab!.info(p.id)).toBeNull();
  });
});
