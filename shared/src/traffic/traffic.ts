// Ruch uliczny wokół graczy: auta z kierowcami NPC jadą grafem pasów (model IDM: odstęp, hamowanie),
// zatrzymują się na czerwonym, hamują przed graczami. Pojawiają się i znikają poza zasięgiem wzroku;
// liczba aut zależy od pory dnia. Dalej od graczy ruch nie jest symulowany (jest tylko natężeniem).
import { npcVariant, vspec } from '../sim/vehicles';
import { rng } from '../util/rng';
import { TILE_SIZE, tileKey } from '../tiles/types';
import type { Entity } from '../sim/types';
import type { World } from '../world/world';
import { LANE_W, RoadGraph, type Edge } from './graph';

export interface TrafficHost {
  readonly world: World;
  spawn(kind: 'car', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  /** byty, na które auta mają uważać (gracze, ich pojazdy) */
  obstacles(): Entity[];
  /** pieszy NPC w promieniu r od punktu wsiada do auta (znika); false, gdy nikogo nie ma */
  boardPed?(x: number, z: number, r: number): boolean;
}

/** Auto zaparkowane przy krawężniku (krawędź grafu, odległość) albo na parkingu (bez krawędzi). */
interface Parked { e: Entity; edge: Edge | null; s: number; slot: string | null }
/** Klasy ulic z parkowaniem przy krawężniku. */
const PARK_CLS = new Set(['residential', 'service', 'living', 'tertiary']);
/** Udział zaparkowanych w limicie aut wokół gracza. */
export const PARKED_SHARE = .4;
/** Udział limitu aut wg ożywienia miejsca (shared/src/world/activity.ts): pustkowie 20%, centrum 100%. */
export const carShare = (A: number) => Math.min(1, .2 + .8 * Math.pow(Math.max(0, A), .8));

interface Car { e: Entity; edge: Edge; lane: number; s: number; v: number; v0: number; next: Edge | null }

/** Natężenie ruchu wg godziny (0..1): szczyty 7–9 i 15–18, noc ~10%. */
export const DENSITY = [.12, .08, .06, .06, .08, .2, .5, .9, 1, .8, .65, .6, .62, .65, .7, .85, 1, .95, .8, .6, .45, .35, .25, .18];
/** Strona ruchu: 1 prawostronny, -1 lewostronny. */
const SIDE: Record<string, number> = { wroclaw: 1, warszawa: 1, londyn: -1 };
/** Cykl sygnalizacji [s]: zielone grupy 1, żółte, zielone grupy 2, żółte. */
const CYCLE = 60, GREEN = 27, AMBER = 3;
export const SPAWN_R = [140, 380], DESPAWN_R = 480, MAX_PER_PLAYER = 70, HIDE_R = 200;

export class Traffic {
  readonly graph = new RoadGraph();
  readonly cars = new Map<number, Car>();
  /** auta zaparkowane (wliczane do limitu aut wokół gracza) */
  readonly parked = new Map<number, Parked>();
  private parkByEdge = new Map<number, Parked[]>();
  private slotsUsed = new Set<string>();
  private lots = new Map<string, { k: string; x: number; z: number; yaw: number }[]>(); // kafel -> miejsca na parkingach
  private byEdge = new Map<number, Car[]>();
  private tileCount = -1; private tick = 0;
  private R = rng('ruch');
  private side: number;
  /** najwięcej aut wokół gracza w szczycie (ustawienie gry); natężenie wg godziny mnoży ten limit */
  maxPerPlayer = MAX_PER_PLAYER;
  constructor(private host: TrafficHost) { this.side = SIDE[host.world.key] ?? 1; }

  /** Faza świateł dla wjazdu na węzeł z kierunku heading w chwili t [s]: 0 zielone, 1 żółte, 2 czerwone. */
  light(node: number, heading: number, t: number): number {
    // jedno skrzyżowanie = jedna sygnalizacja: faza wg osi głównej skrzyżowania (wloty wzdłuż osi razem, poprzeczne razem)
    const J = this.graph.junctions.get(node), id = J ? J.id : node;
    const group = J ? (Math.abs(Math.sin(heading + J.ax)) > .7071 ? 0 : 1) : (Math.abs(Math.cos(heading - (this.graph.axis.get(node) ?? 0))) > .7071 ? 0 : 1);
    const ph = ((t + (Math.abs(id) % 97) * 7) % CYCLE + CYCLE) % CYCLE, start = group * (GREEN + AMBER), u = ((ph - start) % CYCLE + CYCLE) % CYCLE;
    return u < GREEN ? 0 : u < GREEN + AMBER ? 1 : 2;
  }

  /** Krok ruchu: dt [s], czas zegara t [s], godzina lokalna, pozycje graczy. */
  step(dt: number, t: number, hour: number, players: { x: number; z: number }[]): void {
    const W = this.host.world;
    if (W.tiles.size !== this.tileCount || this.tick++ % 30 === 0) {
      this.tileCount = W.tiles.size;
      const ch = this.graph.sync(W);
      if (ch.removed.length) { for (const k of ch.removed) this.lots.delete(k); for (const p of [...this.parked.values()]) if (p.edge && !this.graph.has(p.edge)) this.removeParked(p); }
      if (ch.removed.length) for (const c of [...this.cars.values()]) if (!this.graph.has(c.edge) || (c.next && !this.graph.has(c.next))) { if (this.graph.has(c.edge)) c.next = null; else this.remove(c); }
    }
    if (!this.graph.edges.length) return;
    // znikanie daleko od graczy
    for (const c of [...this.cars.values()]) {
      const q = c.e; if (!players.some(p => Math.hypot(p.x - q.x, p.z - q.z) < DESPAWN_R)) this.remove(c);
    }
    for (const c of [...this.parked.values()]) { const q = c.e; if (!players.some(p => Math.hypot(p.x - q.x, p.z - q.z) < DESPAWN_R)) this.removeParked(c); }
    // pojawianie się (najwyżej kilka na krok). Limit wg ożywienia miejsca: centrum pełne, odludzie ok. 20%;
    // część limitu to auta zaparkowane, reszta jedzie (wg natężenia o tej godzinie)
    for (const p of players) {
      const B = this.maxPerPlayer * carShare(W.activity.around(p.x, p.z)), parkT = Math.round(B * PARKED_SHARE), target = Math.round((B - parkT) * DENSITY[Math.floor(hour) % 24]);
      let n = 0, far: Car | null = null, fd = 0;
      for (const c of this.cars.values()) { const d = Math.hypot(c.e.x - p.x, c.e.z - p.z); if (d < DESPAWN_R) { n++; if (d > fd) { fd = d; far = c; } } }
      for (let k = 0; k < 3 && n < target; k++) if (this.trySpawn(p)) n++;
      if (n > target + (target ? 2 : 0) && far && players.length === 1) this.remove(far); // limit zmniejszony: najdalsze auto znika
      let np = 0, farP: Parked | null = null, fdP = 0;
      for (const c of this.parked.values()) { const d = Math.hypot(c.e.x - p.x, c.e.z - p.z); if (d < DESPAWN_R) { np++; if (d > fdP && d > HIDE_R) { fdP = d; farP = c; } } }
      // na początku (teleport, wejście do gry) wypełnienie także bliżej gracza; potem tylko poza zasięgiem wzroku
      for (let k = 0; k < 3 && np < parkT; k++) if (this.trySpawnParked(p, np < parkT / 2 ? 30 : SPAWN_R[0])) np++;
      if (np > parkT + 3 && farP && players.length === 1) this.removeParked(farP);
    }
    // NPC wsiadają do zaparkowanych aut i odjeżdżają (częściej, gdy ruch jest duży)
    if (this.host.boardPed) for (const c of [...this.parked.values()]) {
      if (!c.edge || this.R() > dt * DENSITY[Math.floor(hour) % 24] / 90) continue;
      if (this.host.boardPed(c.e.x, c.e.z, 12)) this.depart(c);
    }
    // ruch (IDM)
    this.index();
    // siatka przeszkód (gracze, ich pojazdy, piesi) – auta sprawdzają tylko komórki przed sobą
    const grid = new Map<string, Entity[]>(), G = 20, q = { x: 0, z: 0, yaw: 0 };
    for (const o of this.host.obstacles()) { const k = Math.floor(o.x / G) + ',' + Math.floor(o.z / G); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(o); }
    for (const c of this.cars.values()) {
      let gap = Infinity, vl = c.v;
      const ahead = this.leader(c); if (ahead) { gap = ahead.gap; vl = ahead.v; }
      // czerwone / żółte: linia zatrzymania na końcu krawędzi
      if (c.edge.sig) {
        const L = this.light(c.edge.to, c.edge.endHeading, t), dStop = c.edge.len - 3 - c.s;
        const canStop = dStop > c.v * c.v / (2 * 4); // zdąży zahamować
        if ((L === 2 || (L === 1 && canStop)) && dStop > -1 && dStop < gap) { gap = Math.max(.1, dStop); vl = 0; }
      }
      // gracze, ich pojazdy i piesi przed autem
      const fx = -Math.sin(c.e.yaw), fz = -Math.cos(c.e.yaw);
      if (grid.size) for (const d of [0, 20, 40]) {
        const cx = Math.floor((c.e.x + fx * d) / G), cz = Math.floor((c.e.z + fz * d) / G);
        for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) for (const o of grid.get(i + ',' + j) || []) {
          const dx = o.x - c.e.x, dz = o.z - c.e.z, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
          if (along > 0 && along < 40 && lat < 2.2 && Math.abs(o.y - c.e.y) < 3) { const g = along - (o.kind === 'walker' ? 2.5 : (vspec(o).len + vspec(c.e).len) / 2); if (g < gap) { gap = Math.max(.1, g); vl = 0; } }
        }
      }
      const s0 = 2.5, T = 1.3, a = 1.6, b = 2.8, dv = c.v - vl, sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(a * b)));
      const acc = a * (1 - (c.v / c.v0) ** 4 - (gap === Infinity ? 0 : (sStar / Math.max(gap, .1)) ** 2));
      c.v = Math.max(0, c.v + Math.max(-9, acc) * dt);
      c.s += c.v * dt;
      while (c.s > c.edge.len) {
        const nx = c.next ?? this.pickNext(c.edge) ?? this.uTurn(c.edge);
        if (!nx) { // ślepy koniec bez zawracania: auto stoi i znika dopiero poza wzrokiem gracza
          c.s = c.edge.len; c.v = 0;
          if (!players.some(p => Math.hypot(p.x - c.e.x, p.z - c.e.z) < HIDE_R)) this.remove(c);
          break;
        }
        c.s -= c.edge.len; c.edge = nx; c.lane = Math.min(c.lane, nx.lanes - 1); c.next = null; c.v0 = Math.min(vspec(c.e).max, nx.speed * (0.9 + (c.e.id % 7) * .03));
      }
      if (!this.cars.has(c.e.id)) continue;
      if (!c.next && c.edge.len - c.s < 60) c.next = this.pickNext(c.edge);
      this.graph.pose(c.edge, c.s, this.side * (c.lane + .5) * LANE_W, q);
      const e = c.e; e.x = q.x; e.z = q.z; e.yaw = q.yaw; e.y = W.surfaceAt(q.x, q.z, e.y + 1); e.speed = c.v;
    }
  }

  private index(): void {
    this.byEdge.clear();
    for (const c of this.cars.values()) { let l = this.byEdge.get(c.edge.id); if (!l) this.byEdge.set(c.edge.id, l = []); l.push(c); }
    for (const l of this.byEdge.values()) l.sort((a, b) => a.s - b.s);
  }

  /** Najbliższe auto przed nami na tym samym pasie (także na następnej krawędzi). */
  private leader(c: Car): { gap: number; v: number } | null {
    const l = this.byEdge.get(c.edge.id) || [];
    const half = (o: Car) => (vspec(o.e).len + vspec(c.e).len) / 2; // odstęp liczony od środków pojazdów różnej długości
    for (const o of l) if (o !== c && o.lane === c.lane && o.s > c.s) return { gap: o.s - c.s - half(o), v: o.v };
    if (c.next) { const n = this.byEdge.get(c.next.id) || []; for (const o of n) if (o.lane === Math.min(c.lane, c.next.lanes - 1)) return { gap: c.edge.len - c.s + o.s - half(o), v: o.v }; }
    return null;
  }

  /** Następna krawędź na skrzyżowaniu (losowo, bez zawracania; częściej prosto). */
  private pickNext(e: Edge): Edge | null {
    const outs = (this.graph.out.get(e.to) || []).filter(o => o.to !== e.from);
    if (!outs.length) return null;
    const w = outs.map(o => { const h0 = e.endHeading, p = o.pts, h1 = Math.atan2(p[1][0] - p[0][0], p[1][1] - p[0][1]); return 1 + 3 * Math.max(0, Math.cos(h1 - h0)); });
    let r = this.R() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) return outs[i]; }
    return outs[outs.length - 1];
  }

  /** Zawrócenie na ślepym końcu drogi (krawędź w przeciwną stronę tej samej ulicy). */
  private uTurn(e: Edge): Edge | null { return (this.graph.out.get(e.to) || []).find(o => o.to === e.from) ?? null; }

  private trySpawn(p: { x: number; z: number }): boolean {
    const E = this.graph.edges;
    for (let tries = 0; tries < 12; tries++) {
      const e = E[Math.floor(this.R() * E.length)], s = this.R() * e.len, q = { x: 0, z: 0, yaw: 0 };
      this.graph.pose(e, s, 0, q); const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < SPAWN_R[0] || d > SPAWN_R[1]) continue;
      const lane = Math.floor(this.R() * e.lanes);
      if ((this.byEdge.get(e.id) || []).some(o => o.lane === lane && Math.abs(o.s - s) < 20)) continue;
      this.graph.pose(e, s, this.side * (lane + .5) * LANE_W, q);
      const ent = this.host.spawn('car', q.x, this.host.world.surfaceAt(q.x, q.z, 1e6), q.z, q.yaw);
      ent.npc = true; ent.driver = null; ent.v = npcVariant(this.R());
      const c: Car = { e: ent, edge: e, lane, s, v: Math.min(vspec(ent).max, e.speed * .6), v0: Math.min(vspec(ent).max, e.speed * (0.9 + (ent.id % 7) * .03)), next: null };
      this.cars.set(ent.id, c); let l = this.byEdge.get(e.id); if (!l) this.byEdge.set(e.id, l = []); l.push(c);
      return true;
    }
    return false;
  }

  private remove(c: Car): void { this.cars.delete(c.e.id); this.host.despawn(c.e.id); }

  /** Odsunięcie zaparkowanego auta od osi drogi: przy krawężniku, poza pasem ruchu (wąskie ulice: częściowo na chodniku). */
  private parkOff(e: Edge): number { return this.side * Math.max(e.w / 2 + .1, LANE_W * e.lanes + 1); }

  private trySpawnParked(p: { x: number; z: number }, dMin: number): boolean {
    const W = this.host.world, E = this.graph.edges, q = { x: 0, z: 0, yaw: 0 };
    for (let tries = 0; tries < 16; tries++) {
      // co trzecia próba: miejsce na parkingu (teren parking z OSM)
      if (tries % 3 === 2) { if (this.trySpawnLot(p, dMin)) return true; continue; }
      const e = E[Math.floor(this.R() * E.length)]; if (!PARK_CLS.has(e.cls) || e.br || e.len < 30) continue;
      const s = 10 + this.R() * (e.len - 20);
      this.graph.pose(e, s, this.parkOff(e), q); const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < dMin || d > SPAWN_R[1]) continue;
      if (this.R() > Math.max(.1, W.activity.at(q.x, q.z) * 1.5)) continue; // mniej aut na odludziu
      if (W.buildings.hit(q.x, q.z) || W.water.hit(q.x, q.z)) continue;
      if ((this.parkByEdge.get(e.id) || []).some(o => Math.abs(o.s - s) < 6.5)) continue;
      if ((this.byEdge.get(e.id) || []).some(o => Math.abs(o.s - s) < 15)) continue;
      const ent = this.spawnParkedEnt(q.x, q.z, q.yaw);
      const c: Parked = { e: ent, edge: e, s, slot: null }; this.parked.set(ent.id, c);
      let l = this.parkByEdge.get(e.id); if (!l) this.parkByEdge.set(e.id, l = []); l.push(c);
      return true;
    }
    return false;
  }

  private spawnParkedEnt(x: number, z: number, yaw: number): Entity {
    const ent = this.host.spawn('car', x, this.host.world.surfaceAt(x, z, 1e6), z, yaw);
    ent.npc = true; ent.parked = true; ent.driver = null; ent.v = npcVariant(this.R()); ent.speed = 0;
    return ent;
  }

  /** Miejsca na parkingach kafla: rzędy co 2,6 m wzdłuż dłuższego boku, 5,5 m głębokości. */
  private lotSlots(k: string): { k: string; x: number; z: number; yaw: number }[] {
    let l = this.lots.get(k); if (l) return l; l = []; this.lots.set(k, l);
    const t = this.host.world.tiles.get(k); if (!t) return l;
    for (const a of t.a) {
      if (a.k !== 'parking') continue;
      const o = a.o, n = o.length / 2; if (n < 3) continue;
      let bi = 0, bl = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, L = Math.hypot(o[2 * j] - o[2 * i], o[2 * j + 1] - o[2 * i + 1]); if (L > bl) { bl = L; bi = i; } }
      const j = (bi + 1) % n, ux = (o[2 * j] - o[2 * bi]) / bl, uz = (o[2 * j + 1] - o[2 * bi + 1]) / bl, vx = -uz, vz = ux;
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; const x0 = o[0], z0 = o[1];
      for (let i = 0; i < n; i++) { const dx = o[2 * i] - x0, dz = o[2 * i + 1] - z0, u = dx * ux + dz * uz, v = dx * vx + dz * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      if ((u1 - u0) * (v1 - v0) > 40000) continue; // bardzo duże (całe kompleksy): pomijamy
      const inside = (x: number, z: number) => { let c = false; for (let i = 0, k2 = n - 1; i < n; k2 = i++) { const ax = o[2 * i], az = o[2 * i + 1], bx = o[2 * k2], bz = o[2 * k2 + 1]; if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c; } return c; };
      // rzędy: dwa rzędy aut (głębokość 5,5 m) na alejkę 6 m
      const yaw = Math.atan2(-vx, -vz);
      for (let v = v0 + 3.2, row = 0; v < v1 - 2.5; v += row % 2 ? 11.5 : 5.5, row++)
        for (let u = u0 + 2; u < u1 - 1.5; u += 2.6) {
          const x = x0 + ux * u + vx * v, z = z0 + uz * u + vz * v;
          if (!inside(x, z) || !inside(x + vx * 2.4, z + vz * 2.4) || !inside(x - vx * 2.4, z - vz * 2.4)) continue;
          if (this.host.world.buildings.hit(x, z)) continue;
          l.push({ k: a.id + ':' + row + ':' + Math.round(u * 10), x, z, yaw: row % 2 ? yaw + Math.PI : yaw });
        }
    }
    return l;
  }

  private trySpawnLot(p: { x: number; z: number }, dMin: number): boolean {
    const W = this.host.world, cx = Math.floor(p.x / TILE_SIZE), cz = Math.floor(p.z / TILE_SIZE);
    const keys: string[] = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const k = tileKey(cx + i, cz + j); if (W.tiles.has(k)) keys.push(k); }
    if (!keys.length) return false;
    const L = this.lotSlots(keys[Math.floor(this.R() * keys.length)]); if (!L.length) return false;
    const sl = L[Math.floor(this.R() * L.length)], d = Math.hypot(sl.x - p.x, sl.z - p.z);
    if (d < dMin || d > SPAWN_R[1] || this.slotsUsed.has(sl.k)) return false;
    if (this.R() > Math.max(.25, W.activity.at(sl.x, sl.z) * 1.6)) return false;
    const ent = this.spawnParkedEnt(sl.x, sl.z, sl.yaw + (this.R() < .5 ? 0 : Math.PI));
    this.parked.set(ent.id, { e: ent, edge: null, s: 0, slot: sl.k }); this.slotsUsed.add(sl.k);
    return true;
  }

  private dropParked(c: Parked): void {
    this.parked.delete(c.e.id); if (c.slot) this.slotsUsed.delete(c.slot);
    if (c.edge) { const l = this.parkByEdge.get(c.edge.id); if (l) { const f = l.filter(o => o !== c); if (f.length) this.parkByEdge.set(c.edge.id, f); else this.parkByEdge.delete(c.edge.id); } }
  }
  private removeParked(c: Parked): void { this.dropParked(c); this.host.despawn(c.e.id); }

  /** Kierowca wsiadł: auto włącza się do ruchu z miejsca parkowania (prawy pas). */
  private depart(c: Parked): void {
    const e = c.edge!; if ((this.byEdge.get(e.id) || []).some(o => o.lane === 0 && Math.abs(o.s - c.s) < 15)) return;
    this.dropParked(c); c.e.parked = false;
    const car: Car = { e: c.e, edge: e, lane: 0, s: c.s, v: 0, v0: Math.min(vspec(c.e).max, e.speed * (0.9 + (c.e.id % 7) * .03)), next: null };
    this.cars.set(c.e.id, car); let l = this.byEdge.get(e.id); if (!l) this.byEdge.set(e.id, l = []); l.push(car);
  }

  /** Czy auto stoi zaparkowane (kradzież: nikt nie wyskakuje zza kierownicy). */
  isParked(id: number): boolean { return this.parked.has(id); }

  /** Auto przestaje należeć do ruchu ulicznego (przejęte przez gracza); byt zostaje. */
  release(id: number): Entity | null {
    const pk = this.parked.get(id); if (pk) { this.dropParked(pk); pk.e.npc = false; pk.e.parked = false; return pk.e; }
    const c = this.cars.get(id); if (!c) return null; this.cars.delete(id); c.e.npc = false; c.e.speed = c.v; return c.e;
  }
}
