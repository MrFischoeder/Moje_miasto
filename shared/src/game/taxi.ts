// Taksówka na wezwanie (aplikacja w telefonie): podjeżdża ulicami z okolicy (graf pasów ruchu), czeka na gracza,
// wiezie do wybranego celu. Część drogi widać, resztę gra przewija (cel może leżeć poza wczytanymi kaflami).
// Opłata: trzaskowe + stawka za km (wg odległości), pobierana po kursie albo przy wcześniejszym wysiadaniu.
import type { Entity, PlayerState } from '../sim/types';
import { LANE_W, type Edge, type RoadGraph } from '../traffic/graph';
import type { World } from '../world/world';

type XZ = [number, number];
export type TaxiStage = 'coming' | 'waiting' | 'riding';
/** Stan taksówki dla klienta (telefon): etap, byt auta, szacowany czas [s], opłata. */
export interface TaxiInfo { st: TaxiStage; id: number; eta: number; fare: number; dest: XZ }

/** Cennik [waluta miasta]: trzaskowe, za km; czasy [s]: najdłuższy dojazd, czekanie, pokazana jazda. */
export const TAXI = { base: 8, perKm: 3.2, comeMax: 45, waitMax: 120, rideShow: 15, taxiVariant: 6 };

export interface TaxiHost {
  readonly world: World;
  graph(): RoadGraph | null;
  spawnCar(x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  walker(p: PlayerState): Entity;
  /** gracz wsiada jako pasażer */
  seat(p: PlayerState, e: Entity): void;
  /** gracz wysiada; at: miejsce docelowe (przewinięty kurs) albo obok auta */
  unseat(p: PlayerState, at: XZ | null): void;
  notify(p: PlayerState, text: string): void;
  /** pobiera opłatę (do posiadanej kwoty); zwraca pobraną */
  charge(p: PlayerState, amount: number): number;
  readonly cur: string;
  /** 1 prawostronny, -1 lewostronny */
  readonly side: number;
}

interface Taxi { p: PlayerState; e: Entity; st: TaxiStage; edge: Edge | null; s: number; v: number; t: number; dest: XZ; from: XZ; scale: number }

const d2 = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class TaxiService {
  readonly taxis = new Map<number, Taxi>();
  constructor(private h: TaxiHost, private scale = 1) {}

  /** Szacowana opłata za kurs z punktu a do b. */
  fare(a: XZ, b: XZ): number { return Math.round((TAXI.base + TAXI.perKm * d2(a, b) * 1.3 / 1000) * this.scale * 10) / 10; }

  order(p: PlayerState, dest: XZ): string {
    if (this.taxis.has(p.id)) return 'Taksówka już jedzie – możesz ją odwołać w telefonie.';
    if (p.vehicle != null || p.ride) return 'Najpierw wysiądź z pojazdu.';
    const G = this.h.graph(); if (!G || !G.edges.length) return 'Brak taksówek w tej okolicy.';
    const w = this.h.walker(p), me: XZ = [w.x, w.z], est = this.fare(me, dest);
    if (p.money < est) return `Za mało pieniędzy na kurs (ok. ${est.toFixed(0)} ${this.h.cur}).`;
    // start: punkt na jezdni 70–160 m od gracza (dojazd widać), inaczej najbliższy
    const q = { x: 0, z: 0, yaw: 0 }; let pick: { e: Edge; s: number } | null = null;
    for (let k = 0; k < 80 && !pick; k++) { const e = G.edges[Math.floor(Math.random() * G.edges.length)], s = Math.random() * e.len; G.pose(e, s, 0, q); const d = Math.hypot(q.x - w.x, q.z - w.z); if (d > 70 && d < 160) pick = { e, s }; }
    pick ??= this.nearest(G, me);
    if (!pick) return 'Brak taksówek w tej okolicy.';
    G.pose(pick.e, pick.s, this.h.side * .5 * LANE_W, q);
    const e = this.h.spawnCar(q.x, this.h.world.surfaceAt(q.x, q.z, 1e6), q.z, q.yaw); e.npc = true; e.v = TAXI.taxiVariant;
    this.taxis.set(p.id, { p, e, st: 'coming', edge: pick.e, s: pick.s, v: 0, t: 0, dest, from: me, scale: this.scale });
    return `Taksówka zamówiona: przyjedzie za ok. ${Math.max(10, Math.round(d2(me, [q.x, q.z]) / 9))} s. Szacunkowo ${est.toFixed(0)} ${this.h.cur}.`;
  }

  cancel(p: PlayerState): string {
    const t = this.taxis.get(p.id); if (!t) return 'Nie masz zamówionej taksówki.';
    if (t.st === 'riding') return this.alight(p) ?? '';
    this.remove(t); return 'Taksówka odwołana.';
  }

  /** Wsiadanie (E): gracz przy swojej czekającej (albo dojeżdżającej) taksówce. */
  tryBoard(p: PlayerState): boolean {
    const t = this.taxis.get(p.id); if (!t || t.st === 'riding' || p.vehicle != null) return false;
    const w = this.h.walker(p); if (Math.hypot(t.e.x - w.x, t.e.z - w.z) > 5) return false;
    t.st = 'riding'; t.t = 0; t.v = 0; t.e.speed = 0; t.from = [t.e.x, t.e.z]; this.h.seat(p, t.e);
    this.h.notify(p, 'Jedziemy. Wysiądziesz na miejscu albo wcześniej (E / tryb pieszo).'); return true;
  }

  /** Wysiadanie przed celem: opłata za przejechaną odległość. */
  alight(p: PlayerState): string | undefined {
    const t = this.taxis.get(p.id); if (!t || t.st !== 'riding') return;
    const paid = this.h.charge(p, this.fare(t.from, [t.e.x, t.e.z]));
    this.h.unseat(p, null); this.remove(t);
    return `Wysiadasz wcześniej. Opłata: ${paid.toFixed(2)} ${this.h.cur}.`;
  }

  isTaxi(id: number): boolean { for (const t of this.taxis.values()) if (t.e.id === id) return true; return false; }

  info(pid: number): TaxiInfo | null {
    const t = this.taxis.get(pid); if (!t) return null;
    const w = this.h.walker(t.p), eta = t.st === 'coming' ? Math.max(0, Math.round(Math.max(Math.hypot(t.e.x - w.x, t.e.z - w.z) / 9, 0) )) : t.st === 'riding' ? Math.max(0, Math.round(TAXI.rideShow - t.t)) : 0;
    return { st: t.st, id: t.e.id, eta, fare: this.fare(t.st === 'riding' ? t.from : [w.x, w.z], t.dest), dest: t.dest };
  }

  step(dt: number): void {
    const G = this.h.graph();
    for (const t of [...this.taxis.values()]) {
      t.t += dt;
      if (t.p.dead || !G) { if (t.st === 'riding') this.h.unseat(t.p, null); this.remove(t); continue; }
      if (t.edge && !G.has(t.edge)) t.edge = null;
      const w = this.h.walker(t.p);
      if (t.st === 'coming') {
        const me: XZ = [w.x, w.z];
        if (Math.hypot(t.e.x - w.x, t.e.z - w.z) < 14) { t.st = 'waiting'; t.t = 0; t.v = 0; t.e.speed = 0; this.h.notify(t.p, 'Taksówka czeka – podejdź i wsiądź (E albo przycisk „Wsiądź”).'); continue; }
        if (t.t > TAXI.comeMax || !t.edge) { const n = this.nearest(G, me); if (n) { t.edge = n.e; t.s = n.s; this.place(G, t); } t.st = 'waiting'; t.t = 0; t.v = 0; t.e.speed = 0; this.h.notify(t.p, 'Taksówka czeka – podejdź i wsiądź (E albo przycisk „Wsiądź”).'); continue; }
        this.drive(G, t, me, dt);
      } else if (t.st === 'waiting') {
        if (t.t > TAXI.waitMax) { this.h.notify(t.p, 'Taksówka odjechała (nikt nie wsiadł).'); this.remove(t); }
      } else {
        if (t.p.vehicle !== t.e.id) { this.remove(t); continue; } // gracz opuścił auto inaczej (teleport, śmierć)
        const here: XZ = [t.e.x, t.e.z], near = d2(here, t.dest) < 40;
        if (near || t.t > TAXI.rideShow || !t.edge) { // na miejscu albo przewinięcie reszty drogi
          const paid = this.h.charge(t.p, this.fare(t.from, t.dest));
          this.h.unseat(t.p, near ? null : t.dest); this.remove(t);
          this.h.notify(t.p, `Jesteś na miejscu. Kurs: ${paid.toFixed(2)} ${this.h.cur}.`); continue;
        }
        this.drive(G, t, t.dest, dt);
      }
    }
  }

  /** Jazda prawym pasem; na skrzyżowaniu wybór wylotu najbliżej celu (bez zawracania, chyba że ślepa uliczka). */
  private drive(G: RoadGraph, t: Taxi, target: XZ, dt: number): void {
    let e: Edge | null = t.edge; if (!e) return;
    const max = Math.min(e.speed, 14), brake = t.st === 'coming' && Math.hypot(t.e.x - target[0], t.e.z - target[1]) < 35;
    t.v = Math.max(0, Math.min(brake ? 5 : max, t.v + (t.v < max ? 3 : -4) * dt)); t.s += t.v * dt;
    const end = (q: Edge): XZ => q.pts[q.pts.length - 1];
    while (t.s > e.len) {
      const cur: Edge = e, outs: Edge[] = G.out.get(cur.to) ?? [], fwd = outs.filter(o => o.to !== cur.from), back = outs.filter(o => o.to === cur.from);
      const cands = fwd.length ? fwd : back; if (!cands.length) { t.s = cur.len; t.v = 0; break; }
      t.s -= cur.len; e = cands.reduce((a, b) => d2(end(a), target) <= d2(end(b), target) ? a : b);
    }
    t.edge = e;
    this.place(G, t); t.e.speed = t.v;
  }

  private place(G: RoadGraph, t: Taxi): void {
    if (!t.edge) return; const q = { x: 0, z: 0, yaw: 0 }; G.pose(t.edge, t.s, this.h.side * .5 * LANE_W, q);
    t.e.x = q.x; t.e.z = q.z; t.e.yaw = q.yaw; t.e.y = this.h.world.surfaceAt(q.x, q.z, t.e.y + 1);
  }

  /** Najbliższy punkt jezdni (do 80 m). */
  private nearest(G: RoadGraph, p: XZ): { e: Edge; s: number } | null {
    let best: { e: Edge; s: number; d: number } | null = null;
    for (const e of G.edges) {
      const P = e.pts, c = e.cum; if (Math.abs(P[0][0] - p[0]) > 400 || Math.abs(P[0][1] - p[1]) > 400) continue;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
        const d = Math.hypot(a[0] + dx * u - p[0], a[1] + dz * u - p[1]); if (d < 80 && (!best || d < best.d)) best = { e, s: c[i] + (c[i + 1] - c[i]) * u, d };
      }
    }
    return best;
  }

  private remove(t: Taxi): void { this.taxis.delete(t.p.id); this.h.despawn(t.e.id); }
}
