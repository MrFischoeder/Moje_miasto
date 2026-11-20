// Ruch uliczny wokół graczy: auta z kierowcami NPC jadą grafem pasów (model IDM: odstęp, hamowanie),
// zatrzymują się na czerwonym, hamują przed graczami. Pojawiają się i znikają poza zasięgiem wzroku;
// liczba aut zależy od pory dnia. Dalej od graczy ruch nie jest symulowany (jest tylko natężeniem).
import { rng } from '../util/rng';
import type { Entity } from '../sim/types';
import type { World } from '../world/world';
import { LANE_W, RoadGraph, type Edge } from './graph';

export interface TrafficHost {
  readonly world: World;
  spawn(kind: 'car', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  /** byty, na które auta mają uważać (gracze, ich pojazdy) */
  obstacles(): Entity[];
}

interface Car { e: Entity; edge: Edge; lane: number; s: number; v: number; v0: number; next: Edge | null }

/** Natężenie ruchu wg godziny (0..1): szczyty 7–9 i 15–18, noc ~10%. */
export const DENSITY = [.12, .08, .06, .06, .08, .2, .5, .9, 1, .8, .65, .6, .62, .65, .7, .85, 1, .95, .8, .6, .45, .35, .25, .18];
/** Strona ruchu: 1 prawostronny, -1 lewostronny. */
const SIDE: Record<string, number> = { warszawa: 1, londyn: -1 };
/** Cykl sygnalizacji [s]: zielone grupy 1, żółte, zielone grupy 2, żółte. */
const CYCLE = 60, GREEN = 27, AMBER = 3;
export const SPAWN_R = [140, 380], DESPAWN_R = 480, MAX_PER_PLAYER = 70;

export class Traffic {
  readonly graph = new RoadGraph();
  readonly cars = new Map<number, Car>();
  private byEdge = new Map<number, Car[]>();
  private tileCount = -1; private tick = 0;
  private R = rng('ruch');
  private side: number;
  constructor(private host: TrafficHost) { this.side = SIDE[host.world.key] ?? 1; }

  /** Faza świateł dla wjazdu na węzeł z kierunku heading w chwili t [s]: 0 zielone, 1 żółte, 2 czerwone. */
  light(node: number, heading: number, t: number): number {
    const ax = this.graph.axis.get(node) ?? 0, group = Math.abs(Math.cos(heading - ax)) > .7071 ? 0 : 1;
    const ph = ((t + (node % 97) * 7) % CYCLE + CYCLE) % CYCLE, start = group * (GREEN + AMBER), u = ((ph - start) % CYCLE + CYCLE) % CYCLE;
    return u < GREEN ? 0 : u < GREEN + AMBER ? 1 : 2;
  }

  /** Krok ruchu: dt [s], czas zegara t [s], godzina lokalna, pozycje graczy. */
  step(dt: number, t: number, hour: number, players: { x: number; z: number }[]): void {
    const W = this.host.world;
    if (W.tiles.size !== this.tileCount || this.tick++ % 30 === 0) {
      this.tileCount = W.tiles.size;
      const ch = this.graph.sync(W);
      if (ch.removed.length) for (const c of [...this.cars.values()]) if (!this.graph.has(c.edge) || (c.next && !this.graph.has(c.next))) { if (this.graph.has(c.edge)) c.next = null; else this.remove(c); }
    }
    if (!this.graph.edges.length) return;
    // znikanie daleko od graczy
    for (const c of [...this.cars.values()]) {
      const q = c.e; if (!players.some(p => Math.hypot(p.x - q.x, p.z - q.z) < DESPAWN_R)) this.remove(c);
    }
    // pojawianie się (najwyżej kilka na krok)
    const target = Math.round(MAX_PER_PLAYER * DENSITY[Math.floor(hour) % 24]);
    for (const p of players) {
      let n = 0; for (const c of this.cars.values()) if (Math.hypot(c.e.x - p.x, c.e.z - p.z) < DESPAWN_R) n++;
      for (let k = 0; k < 3 && n < target; k++) if (this.trySpawn(p)) n++;
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
          if (along > 0 && along < 40 && lat < 2.2 && Math.abs(o.y - c.e.y) < 3) { const g = along - (o.kind === 'walker' ? 2.5 : 4.6); if (g < gap) { gap = Math.max(.1, g); vl = 0; } }
        }
      }
      const s0 = 2.5, T = 1.3, a = 1.6, b = 2.8, dv = c.v - vl, sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(a * b)));
      const acc = a * (1 - (c.v / c.v0) ** 4 - (gap === Infinity ? 0 : (sStar / Math.max(gap, .1)) ** 2));
      c.v = Math.max(0, c.v + Math.max(-9, acc) * dt);
      c.s += c.v * dt;
      while (c.s > c.edge.len) {
        const nx = c.next ?? this.pickNext(c.edge); if (!nx) { this.remove(c); break; }
        c.s -= c.edge.len; c.edge = nx; c.lane = Math.min(c.lane, nx.lanes - 1); c.next = null; c.v0 = nx.speed * (0.9 + (c.e.id % 7) * .03);
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
    for (const o of l) if (o !== c && o.lane === c.lane && o.s > c.s) return { gap: o.s - c.s - 4.6, v: o.v };
    if (c.next) { const n = this.byEdge.get(c.next.id) || []; for (const o of n) if (o.lane === Math.min(c.lane, c.next.lanes - 1)) return { gap: c.edge.len - c.s + o.s - 4.6, v: o.v }; }
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
      ent.npc = true; ent.driver = null;
      const c: Car = { e: ent, edge: e, lane, s, v: e.speed * .6, v0: e.speed * (0.9 + (ent.id % 7) * .03), next: null };
      this.cars.set(ent.id, c); let l = this.byEdge.get(e.id); if (!l) this.byEdge.set(e.id, l = []); l.push(c);
      return true;
    }
    return false;
  }

  private remove(c: Car): void { this.cars.delete(c.e.id); this.host.despawn(c.e.id); }

  /** Auto przestaje należeć do ruchu ulicznego (przejęte przez gracza); byt zostaje. */
  release(id: number): Entity | null {
    const c = this.cars.get(id); if (!c) return null; this.cars.delete(id); c.e.npc = false; c.e.speed = c.v; return c.e;
  }
}
