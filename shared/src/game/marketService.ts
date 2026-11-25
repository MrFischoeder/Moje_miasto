// Giełda po stronie serwera: auto i sprzedający na miejscu ogłoszenia (gdy gracz jest blisko), kupno przy sprzedającym.
import type { Entity, PlayerState } from '../sim/types';
import { LANE_W, type RoadGraph } from '../traffic/graph';
import type { World } from '../world/world';
import { listings, marketSeed, type Listing } from './market';

export interface MarketHost {
  readonly world: World;
  graph(): RoadGraph | null;
  stops(): [string, number, number][];
  /** data i sekunda doby gry */
  now(): { date: string; sec: number } | null;
  spawn(kind: 'car' | 'walker', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  readonly cur: string; readonly scale: number; readonly side: number;
}

/** odległość od sprzedającego, z której można kupić [m] */
export const MARKET_BUY_R = 8;

export class MarketService {
  /** sprzedane ogłoszenia (id) */
  readonly sold = new Set<string>();
  private live = new Map<string, { car: Entity; seller: Entity }>();
  private seed = ''; private list: Listing[] = [];
  constructor(private h: MarketHost) {}

  current(): Listing[] {
    const t = this.h.now(); if (!t) return [];
    const seed = marketSeed(t.date, t.sec);
    if (seed !== this.seed) { this.seed = seed; this.list = listings(this.h.world.key, seed, this.h.stops(), this.h.scale); for (const [id, l] of this.live) if (!this.list.some(q => q.id === id)) this.drop(id, l); }
    return this.list;
  }

  /** Auto i sprzedający pojawiają się, gdy gracz jest bliżej niż 150 m; znikają powyżej 260 m. */
  step(players: { x: number; z: number }[]): void {
    for (const L of this.current()) {
      const near = players.some(p => Math.hypot(p.x - L.x, p.z - L.z) < 150), far = !players.some(p => Math.hypot(p.x - L.x, p.z - L.z) < 260), l = this.live.get(L.id);
      if (!l && near && !this.sold.has(L.id)) this.place(L);
      else if (l && far) this.drop(L.id, l);
    }
  }

  private place(L: Listing): void {
    const W = this.h.world, G = this.h.graph(), q = { x: L.x, z: L.z, yaw: 0 };
    // auto przy krawężniku najbliższej jezdni (do 40 m od przystanku)
    if (G) { let best: { e: (typeof G.edges)[number]; s: number; d: number } | null = null;
      for (const e of G.edges) { const P = e.pts; if (Math.abs(P[0][0] - L.x) > 300 || Math.abs(P[0][1] - L.z) > 300 || e.br) continue;
        for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((L.x - a[0]) * dx + (L.z - a[1]) * dz) / L2)), d = Math.hypot(a[0] + dx * u - L.x, a[1] + dz * u - L.z); if (d < 40 && (!best || d < best.d)) best = { e, s: e.cum[i] + (e.cum[i + 1] - e.cum[i]) * u, d }; } }
      if (best) G.pose(best.e, best.s, this.h.side * Math.max(best.e.w / 2 + .1, LANE_W * best.e.lanes + 1), q);
    }
    const car = this.h.spawn('car', q.x, W.surfaceAt(q.x, q.z, 1e6), q.z, q.yaw); car.v = L.v; car.npc = true; car.parked = true; // npc: nie da się go „przejąć” przed kupnem
    const rx = Math.cos(q.yaw), rz = -Math.sin(q.yaw), sx = q.x + rx * 2.2 * this.h.side, sz = q.z + rz * 2.2 * this.h.side;
    const seller = this.h.spawn('walker', sx, W.surfaceAt(sx, sz, 1e6), sz, q.yaw + Math.PI / 2); seller.npc = true;
    this.live.set(L.id, { car, seller });
  }
  private drop(id: string, l: { car: Entity; seller: Entity }): void { this.h.despawn(l.car.id); this.h.despawn(l.seller.id); this.live.delete(id); }

  /** Kupno: gracz przy sprzedającym, ma pieniądze; auto zostaje na miejscu z papierami na gracza. */
  buy(p: PlayerState, walker: Entity, id: string): string {
    const L = this.current().find(q => q.id === id); if (!L) return 'To ogłoszenie jest już nieaktualne.';
    if (this.sold.has(id)) return 'Auto zostało już sprzedane.';
    const l = this.live.get(id); if (!l || Math.hypot(l.seller.x - walker.x, l.seller.z - walker.z) > MARKET_BUY_R || p.vehicle != null) return `Spotkaj się ze sprzedającym (${L.seller}) – przystanek ${L.place}. Podejdź do niego pieszo.`;
    if (p.money < L.price) return `Za mało pieniędzy: ${L.price} ${this.h.cur}.`;
    p.money = Math.round((p.money - L.price) * 100) / 100; this.sold.add(id);
    const car = l.car; car.npc = false; car.parked = false; car.owner = p.id; car.legal = p.id;
    const own = p.owned ??= []; if (!own.includes(L.v)) own.push(L.v);
    this.h.despawn(l.seller.id); this.live.delete(id);
    return `${L.seller}: „Dobra, umowa stoi.” Kupiono ${L.title.replace('Sprzedam ', '')} za ${L.price} ${this.h.cur}. Auto stoi obok – ma papiery na ciebie.`;
  }
}
