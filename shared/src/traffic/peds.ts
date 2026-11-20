// Piesi NPC wokół graczy: chodniki (po obu stronach ulic), ścieżki i deptaki z kafli OSM.
// Na węzłach wybierają dalszą drogę (także przejście na drugą stronę), płynnie zmieniając odsunięcie od osi.
// Pojawiają się i znikają poza zasięgiem wzroku; liczba zależy od pory dnia. Wyrzucony z auta kierowca ucieka.
import { rng } from '../util/rng';
import { isVehicleRoad } from '../tiles/build';
import type { RoadClass } from '../tiles/types';
import type { XZ } from '../world/collision';
import type { Entity } from '../sim/types';
import { toXZ, type World } from '../world/world';

export interface WalkEdge { id: number; a: number; b: number; pts: XZ[]; cum: number[]; len: number; off: number }

/** Natężenie pieszych wg godziny (0..1). */
export const PED_DENSITY = [.05, .03, .02, .02, .03, .08, .25, .6, .8, .7, .7, .75, .85, .85, .8, .85, .95, 1, .9, .75, .55, .35, .2, .1];
export const PED_SPAWN = [50, 240], PED_DESPAWN = 320, PED_MAX = 50;
const WALKWAY: RoadClass[] = ['footway', 'path', 'pedestrian', 'living', 'steps'];
/** Klasy jezdni, przy których zakładamy chodniki (gdy OSM nie mówi inaczej). */
const URBAN: RoadClass[] = ['primary', 'secondary', 'tertiary', 'residential', 'living'];

export class WalkGraph {
  edges: WalkEdge[] = [];
  adj = new Map<number, WalkEdge[]>();
  private byTile = new Map<string, WalkEdge[]>();
  private nextId = 0;

  sync(world: World): boolean {
    let changed = false;
    for (const k of [...this.byTile.keys()]) if (!world.tiles.has(k)) {
      const gone = new Set(this.byTile.get(k)); this.byTile.delete(k); changed = true;
      for (const e of gone) for (const n of [e.a, e.b]) { const l = this.adj.get(n); if (l) { const f = l.filter(x => !gone.has(x)); if (f.length) this.adj.set(n, f); else this.adj.delete(n); } }
    }
    for (const [k, t] of world.tiles) if (!this.byTile.has(k)) {
      const list: WalkEdge[] = []; changed = true;
      const add = (a: number, b: number, pts: XZ[], off: number) => {
        if (pts.length < 2 || a === b) return;
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const len = cum[cum.length - 1]; if (len < 2) return;
        const e: WalkEdge = { id: this.nextId++, a, b, pts, cum, len, off }; list.push(e);
        for (const n of [a, b]) { let l = this.adj.get(n); if (!l) this.adj.set(n, l = []); l.push(e); }
      };
      for (const r of t.r) {
        if (r.tu || r.br || r.j.length < 4) continue;
        const walk = WALKWAY.includes(r.k), veh = isVehicleRoad(r.k);
        const sides = walk ? [0] : veh && (r.sw || URBAN.includes(r.k)) ? (r.sw === 1 ? [-1] : r.sw === 2 ? [1] : [-1, 1]) : [];
        if (!sides.length) continue;
        const P = toXZ(r.p);
        for (let i = 0; i + 3 < r.j.length; i += 2) {
          const seg = P.slice(r.j[i], r.j[i + 2] + 1);
          for (const sd of sides) add(r.j[i + 1], r.j[i + 3], seg, sd * (walk ? 0 : r.w / 2 + 1.3));
        }
      }
      this.byTile.set(k, list);
    }
    if (changed) this.edges = [...this.byTile.values()].flat();
    return changed;
  }

  has(e: WalkEdge): boolean { const l = this.adj.get(e.a); return !!l && l.includes(e); }

  /** Punkt na krawędzi (s od początku krawędzi), z odsunięciem w prawo względem jej kierunku. */
  pose(e: WalkEdge, s: number, off: number, out: { x: number; z: number; yaw: number }): void {
    const c = e.cum, P = e.pts; s = Math.max(0, Math.min(e.len, s));
    let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++;
    const L = c[i + 1] - c[i] || 1e-9, t = (s - c[i]) / L, dx = (P[i + 1][0] - P[i][0]) / L, dz = (P[i + 1][1] - P[i][1]) / L;
    out.x = P[i][0] + (P[i + 1][0] - P[i][0]) * t - dz * off; out.z = P[i][1] + (P[i + 1][1] - P[i][1]) * t + dx * off;
    out.yaw = Math.atan2(-dx, -dz);
  }

  /** Najbliższy węzeł (do umieszczenia uciekającego kierowcy). */
  nearest(x: number, z: number): { e: WalkEdge; s: number } | null {
    let best: { e: WalkEdge; s: number } | null = null, bd = 60 * 60;
    for (const e of this.edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const [ax, az] = e.pts[i], [bx, bz] = e.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
        if (d < bd) { bd = d; best = { e, s: e.cum[i] + Math.sqrt(L2) * t }; }
      }
    }
    return best;
  }
}

interface Ped { e: Entity; edge: WalkEdge; dir: 1 | -1; s: number; v: number; off: number; flee: number }

export interface PedHost {
  readonly world: World;
  spawn(kind: 'walker', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
}

export class Pedestrians {
  readonly graph = new WalkGraph();
  readonly peds = new Map<number, Ped>();
  /** potrąceni: leżą chwilę, potem znikają */
  private down = new Map<number, { e: Entity; t: number }>();
  private R = rng('piesi');
  private tileCount = -1; private tick = 0;
  constructor(private host: PedHost) {}

  /** Potrącenie: pieszy przewraca się i znika po 20 s. */
  knock(id: number): boolean {
    const p = this.peds.get(id); if (!p) return false;
    this.peds.delete(id); p.e.tilt = -Math.PI / 2; p.e.speed = 0; this.down.set(id, { e: p.e, t: 20 }); return true;
  }

  step(dt: number, hour: number, players: { x: number; z: number }[]): void {
    const W = this.host.world;
    for (const [id, d] of this.down) { d.t -= dt; if (d.t <= 0) { this.down.delete(id); this.host.despawn(id); } }
    if (W.tiles.size !== this.tileCount || this.tick++ % 30 === 0) {
      this.tileCount = W.tiles.size;
      if (this.graph.sync(W)) for (const p of [...this.peds.values()]) if (!this.graph.has(p.edge)) this.remove(p);
    }
    if (!this.graph.edges.length) return;
    for (const p of [...this.peds.values()]) if (!players.some(q => Math.hypot(q.x - p.e.x, q.z - p.e.z) < PED_DESPAWN)) this.remove(p);
    const target = Math.round(PED_MAX * PED_DENSITY[Math.floor(hour) % 24]);
    for (const pl of players) {
      let n = 0; for (const p of this.peds.values()) if (Math.abs(p.e.x - pl.x) < PED_DESPAWN && Math.abs(p.e.z - pl.z) < PED_DESPAWN) n++;
      for (let k = 0; k < 3 && n < target; k++) if (this.trySpawn(pl)) n++;
    }
    const q = { x: 0, z: 0, yaw: 0 };
    for (const p of this.peds.values()) {
      if (p.flee > 0) p.flee -= dt;
      const v = p.flee > 0 ? 4.2 : p.v;
      p.s += v * dt;
      while (p.s > p.edge.len) {
        p.s -= p.edge.len;
        const node = p.dir === 1 ? p.edge.b : p.edge.a, outs = (this.graph.adj.get(node) || []);
        const choices = outs.filter(e => e !== p.edge && !(e.a === p.edge.a && e.b === p.edge.b) && !(e.a === p.edge.b && e.b === p.edge.a));
        const nx = choices.length ? choices[Math.floor(this.R() * choices.length)] : outs.find(e => e !== p.edge && (e.a === p.edge.a && e.b === p.edge.b)) ?? p.edge;
        if (nx === p.edge) { p.dir = p.dir === 1 ? -1 : 1; continue; } // ślepy zaułek: zawraca
        p.edge = nx; p.dir = nx.a === node ? 1 : -1;
      }
      // płynna zmiana odsunięcia (przejście na drugą stronę ulicy na skrzyżowaniu)
      p.off += Math.max(-1.6 * dt, Math.min(1.6 * dt, p.edge.off - p.off));
      const sAlong = p.dir === 1 ? p.s : p.edge.len - p.s;
      this.graph.pose(p.edge, sAlong, p.off, q);
      const e = p.e; e.x = q.x; e.z = q.z; e.yaw = p.dir === 1 ? q.yaw : q.yaw + Math.PI; e.y = W.surfaceAt(q.x, q.z, e.y + 1); e.speed = v;
    }
  }

  /** Kierowca wyrzucony z auta: ucieka najbliższym chodnikiem. */
  flee(x: number, z: number): void {
    const n = this.graph.nearest(x, z); if (!n) return;
    const ent = this.host.spawn('walker', x, this.host.world.surfaceAt(x, z, 1e6), z, 0); ent.npc = true;
    const p: Ped = { e: ent, edge: n.e, dir: this.R() < .5 ? 1 : -1, s: 0, v: 1.4, off: 0, flee: 25 };
    p.s = p.dir === 1 ? n.s : n.e.len - n.s; this.peds.set(ent.id, p);
  }

  private trySpawn(pl: { x: number; z: number }): boolean {
    const E = this.graph.edges;
    for (let t = 0; t < 10; t++) {
      const e = E[Math.floor(this.R() * E.length)], s = this.R() * e.len, q = { x: 0, z: 0, yaw: 0 };
      this.graph.pose(e, s, e.off, q); const d = Math.hypot(q.x - pl.x, q.z - pl.z);
      if (d < PED_SPAWN[0] || d > PED_SPAWN[1] || this.host.world.buildings.hit(q.x, q.z)) continue;
      const ent = this.host.spawn('walker', q.x, this.host.world.surfaceAt(q.x, q.z, 1e6), q.z, q.yaw); ent.npc = true;
      const dir: 1 | -1 = this.R() < .5 ? 1 : -1;
      this.peds.set(ent.id, { e: ent, edge: e, dir, s: dir === 1 ? s : e.len - s, v: 1.1 + this.R() * .6, off: e.off, flee: 0 });
      return true;
    }
    return false;
  }

  private remove(p: Ped): void { this.peds.delete(p.e.id); this.host.despawn(p.e.id); }
}
