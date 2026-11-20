// Policja: radiowozy z kierowcami NPC ścigają poszukiwanych graczy (graf ulic, z bliska wprost na cel),
// policjanci wysiadają i biegną zatrzymać gracza. Radiowozy jeżdżą tą samą fizyką co auta graczy.
import { carStep } from '../sim/vehicles';
import type { Entity, InputCmd, PlayerState } from '../sim/types';
import { NO_INPUT } from '../sim/types';
import type { XZ } from '../world/collision';
import type { World } from '../world/world';
import type { RoadGraph } from './graph';

export interface PoliceHost {
  readonly world: World;
  spawn(kind: 'car' | 'walker', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  graph(): RoadGraph | null;
  players(): Iterable<PlayerState>;
  entity(id: number): Entity | undefined;
  /** zatrzymanie gracza przez policjanta */
  arrest(p: PlayerState): void;
}

interface Officer { e: Entity; t: number; back: boolean }
interface Unit { car: Entity; target: number; path: XZ[]; pathAt: number; stuck: number; rev: number; officers: Officer[]; leaving: number }

/** Radiowozy na poziom poszukiwania. */
export const UNITS = [0, 1, 2, 3, 4, 6];
const SEE_R = 150, DESPAWN_R = 320, CHASE_R = 1500, OFFICER_V = 6.2, ARREST_R = 1.8, ARREST_T = 1.6;
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Police {
  readonly units: Unit[] = [];
  private lastSpawn = -99;
  constructor(private host: PoliceHost) {}

  /** Byty policji (radiowozy i policjanci). */
  *entities(): Generator<Entity> { for (const u of this.units) { yield u.car; for (const o of u.officers) yield o.e; } }
  isUnitCar(id: number): boolean { return this.units.some(u => u.car.id === id); }

  /** Radiowóz przejęty przez gracza: przestaje należeć do policji. */
  release(id: number): Entity | null {
    const i = this.units.findIndex(u => u.car.id === id); if (i < 0) return null;
    const u = this.units[i]; this.units.splice(i, 1);
    for (const o of u.officers) o.back = true; // policjanci zostają na miejscu i znikną
    for (const o of u.officers) this.host.despawn(o.e.id);
    u.car.npc = false; return u.car;
  }
  /** Potrącony policjant znika z jednostki. */
  knockOfficer(id: number): boolean {
    for (const u of this.units) { const i = u.officers.findIndex(o => o.e.id === id); if (i >= 0) { u.officers.splice(i, 1); this.host.despawn(id); return true; } }
    return false;
  }

  step(dt: number, t: number): void {
    const H = this.host, W = H.world, players = [...H.players()];
    // widoczność: policja w pobliżu „widzi” gracza
    for (const p of players) {
      if (!p.wanted) continue; const me = H.entity(p.vehicle ?? p.walker); if (!me) continue;
      for (const e of this.entities()) if (Math.hypot(e.x - me.x, e.z - me.z) < SEE_R) { p.seenAt = t; break; }
    }
    // nowe radiowozy dla poszukiwanych
    for (const p of players) {
      if (!p.wanted || p.dead) continue;
      const have = this.units.filter(u => u.target === p.id && !u.leaving).length;
      if (have < UNITS[p.wanted] && t - this.lastSpawn > 2.5) { this.spawnUnit(p); this.lastSpawn = t; }
    }
    for (const u of [...this.units]) {
      const p = players.find(q => q.id === u.target);
      const tgt = p && !p.dead && p.wanted ? H.entity(p.vehicle ?? p.walker) : undefined;
      if (!tgt && !u.leaving) u.leaving = t;
      // znikanie: daleko od wszystkich graczy albo po zakończeniu pościgu
      // pościg: radiowóz jedzie z komisariatu (do 700 m); po pościgu znika poza zasięgiem wzroku graczy
      const R = tgt && !u.leaving ? CHASE_R : DESPAWN_R;
      const near = players.some(q => { const e = H.entity(q.vehicle ?? q.walker); return e && Math.hypot(e.x - u.car.x, e.z - u.car.z) < R; });
      if (!near || (u.leaving && t - u.leaving > 20)) { this.remove(u); continue; }
      this.drive(u, tgt, dt, t);
      this.foot(u, p, tgt, dt);
    }
  }

  private drive(u: Unit, tgt: Entity | undefined, dt: number, t: number): void {
    const c = u.car, W = this.host.world, cmd: InputCmd = { ...NO_INPUT };
    if (u.officers.some(o => !o.back) || !tgt) { cmd.brake = true; carStep(c, cmd, dt, W); return; }
    const d = Math.hypot(tgt.x - c.x, tgt.z - c.z);
    // cel na wprost z bliska, dalej po grafie ulic
    let aim: XZ = [tgt.x, tgt.z];
    if (d > 70) {
      if (t - u.pathAt > 4 || !u.path.length) {
        u.path = this.route(c.x, c.z, tgt.x, tgt.z); u.pathAt = t;
        // pierwszy punkt za autem (między dwoma pierwszymi): pomiń
        if (u.path.length > 1) { const [a, b] = u.path, ab = Math.hypot(b[0] - a[0], b[1] - a[1]); if (Math.hypot(b[0] - c.x, b[1] - c.z) < ab) u.path.shift(); }
      }
      while (u.path.length && Math.hypot(u.path[0][0] - c.x, u.path[0][1] - c.z) < 12) u.path.shift();
      if (u.path.length) aim = u.path[0];
    }
    const want = Math.atan2(-(aim[0] - c.x), -(aim[1] - c.z)), diff = wrap(want - c.yaw);
    const tgtSlow = Math.abs(tgt.speed) < 2;
    // zwolnij przed zakrętem: ostry kąt przy następnym punkcie trasy
    let slow = Math.abs(diff) > .9;
    if (u.path.length > 1 && Math.hypot(u.path[0][0] - c.x, u.path[0][1] - c.z) < 35) {
      const a1 = Math.atan2(u.path[0][0] - c.x, u.path[0][1] - c.z), a2 = Math.atan2(u.path[1][0] - u.path[0][0], u.path[1][1] - u.path[0][1]);
      if (Math.abs(wrap(a2 - a1)) > .6 && Math.abs(c.speed) > 9) slow = true;
    }
    if (u.rev > 0) { u.rev -= dt; cmd.f = -1; cmd.s = Math.sign(diff); }
    else {
      cmd.s = Math.max(-1, Math.min(1, -diff * 2.2)); cmd.f = slow ? (Math.abs(c.speed) > 9 ? -1 : .35) : Math.abs(c.speed) > 22 ? 0 : 1; cmd.run = false;
      if (d < 14 && tgtSlow) { cmd.f = 0; cmd.brake = true; }
      if (Math.abs(c.speed) < .8 && cmd.f > 0) { u.stuck += dt; if (u.stuck > 2.2) { u.rev = 1.4; u.stuck = 0; } } else u.stuck = 0;
    }
    carStep(c, cmd, dt, W);
    // policjanci wysiadają przy stojącym celu (albo gdy radiowóz dalej nie dojedzie: koniec trasy, cel blisko)
    const endOfRoad = d < 80 && d > 16 && !u.path.length && Math.abs(c.speed) < 1 && u.stuck > 1;
    if (((d < 16 && tgtSlow) || endOfRoad) && Math.abs(c.speed) < 1.5 && !u.officers.length) {
      for (const side of [-1, 1]) {
        const rx = Math.cos(c.yaw) * side * 1.8, rz = -Math.sin(c.yaw) * side * 1.8;
        const e = this.host.spawn('walker', c.x + rx, c.y, c.z + rz, c.yaw); e.npc = true; e.police = true;
        u.officers.push({ e, t: 0, back: false });
      }
    }
  }

  private foot(u: Unit, p: PlayerState | undefined, tgt: Entity | undefined, dt: number): void {
    const W = this.host.world;
    for (const o of [...u.officers]) {
      const e = o.e, far = !tgt || Math.hypot(tgt.x - u.car.x, tgt.z - u.car.z) > 45;
      if (far) o.back = true;
      const goal: XZ = o.back || !tgt ? [u.car.x, u.car.z] : [tgt.x, tgt.z];
      const dx = goal[0] - e.x, dz = goal[1] - e.z, d = Math.hypot(dx, dz);
      if (o.back && d < 2.5) { u.officers.splice(u.officers.indexOf(o), 1); this.host.despawn(e.id); continue; }
      if (d > .5) {
        const step = Math.min(d, OFFICER_V * dt), nx = e.x + dx / d * step, nz = e.z + dz / d * step;
        if (!W.blocked(nx, nz, e.y)) { e.x = nx; e.z = nz; } else if (!W.blocked(nx, e.z, e.y)) e.x = nx; else if (!W.blocked(e.x, nz, e.y)) e.z = nz;
        e.y = W.surfaceAt(e.x, e.z, e.y + 1); e.yaw = Math.atan2(-dx, -dz); e.speed = OFFICER_V;
      } else e.speed = 0;
      // zatrzymanie: pieszy obok policjanta albo kierowca w stojącym pojeździe
      if (!o.back && p && tgt && d < (tgt.kind === 'walker' ? ARREST_R : 3.2) && Math.abs(tgt.speed) < 1.5) {
        o.t += dt; if (o.t > ARREST_T) { this.host.arrest(p); o.t = 0; }
      } else o.t = Math.max(0, o.t - dt);
    }
  }

  /** Trasa po grafie ulic (w pościgu bez względu na jednokierunkowe): punkty węzłów. */
  private route(x0: number, z0: number, x1: number, z1: number): XZ[] {
    const g = this.host.graph(); if (!g || !g.edges.length) return [];
    const pos = new Map<number, XZ>(), adj = new Map<number, number[]>();
    for (const e of g.edges) {
      pos.set(e.from, e.pts[0]); pos.set(e.to, e.pts[e.pts.length - 1]);
      (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
    }
    const nearest = (x: number, z: number) => { let b = -1, bd = Infinity; for (const [n, p] of pos) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; b = n; } } return b; };
    const a = nearest(x0, z0), b = nearest(x1, z1); if (a < 0 || b < 0) return [];
    const prev = new Map<number, number>([[a, -1]]), q = [a];
    while (q.length) { const n = q.shift()!; if (n === b) break; for (const m of adj.get(n) || []) if (!prev.has(m)) { prev.set(m, n); q.push(m); } }
    if (!prev.has(b)) return [];
    const out: XZ[] = []; let n = b; while (n >= 0) { out.push(pos.get(n)!); n = prev.get(n)!; }
    return out.reverse();
  }

  private spawnUnit(p: PlayerState): void {
    const H = this.host, W = H.world, me = H.entity(p.vehicle ?? p.walker); if (!me) return;
    // komisariat z OSM do 700 m, inaczej skrzyżowanie 180–320 m od gracza
    let at: XZ | null = null, bd = 700;
    for (const t of W.tiles.values()) for (const poi of t.poi) if (poi.t === 'police') { const d = Math.hypot(poi.x - me.x, poi.z - me.z); if (d > 120 && d < bd) { bd = d; at = [poi.x, poi.z]; } }
    const g = H.graph();
    if (g && g.edges.length) {
      const cand: XZ[] = [];
      for (const e of g.edges) { const p0 = e.pts[0], d = Math.hypot(p0[0] - me.x, p0[1] - me.z); if (at ? Math.hypot(p0[0] - at[0], p0[1] - at[1]) < 120 : d > 180 && d < 320) cand.push(p0); if (cand.length > 40) break; }
      if (cand.length) at = cand[Math.floor((p.id * 7919 + this.units.length * 104729) % cand.length)];
    }
    if (!at) { const a = (this.units.length * 2.4) % (2 * Math.PI); at = [me.x + Math.cos(a) * 220, me.z + Math.sin(a) * 220]; }
    const [x, z] = W.freeSpot(at[0], at[1], 0);
    const car = H.spawn('car', x, W.surfaceAt(x, z, 1e6), z, Math.atan2(-(me.x - x), -(me.z - z))); car.npc = true; car.police = true;
    this.units.push({ car, target: p.id, path: [], pathAt: -99, stuck: 0, rev: 0, officers: [], leaving: 0 });
  }

  private remove(u: Unit): void {
    this.units.splice(this.units.indexOf(u), 1); this.host.despawn(u.car.id); for (const o of u.officers) this.host.despawn(o.e.id);
  }
}
