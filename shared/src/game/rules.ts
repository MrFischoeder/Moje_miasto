// Zasady gry: przestępstwa i poziom poszukiwania, zdrowie, potrącenia, śmierć i odrodzenie, zatrzymanie, pieniądze.
// Liczone na serwerze (autorytatywnie); gracz dostaje swój stan i zdarzenia.
import type { Entity, PlayerState } from '../sim/types';
import type { World } from '../world/world';
import type { Pedestrians } from '../traffic/peds';
import type { Traffic } from '../traffic/traffic';
import { Police } from '../traffic/police';
import { rng } from '../util/rng';
import type { Item } from '../interiors/plan';
import LOOT from '../interiors/data/lupy.json';

interface LootTable { p: number; money: number[]; items: (string | number)[][]; crime?: (string | number)[]; heal?: number }
const TABLES = LOOT.tabele as unknown as Record<string, LootTable>;

export interface GameEvent { pid: number; text: string; kind: 'crime' | 'arrest' | 'death' | 'info' }

/** Waluta, cena biletu jednorazowego, najmniejsza grzywna, utrata przy śmierci. */
export const MONEY: Record<string, { cur: string; fare: number; fine: number; death: number }> = {
  warszawa: { cur: 'zł', fare: 4.4, fine: 100, death: 100 },
  londyn: { cur: '£', fare: 1.75, fine: 50, death: 50 },
};

export interface RulesHost {
  readonly world: World;
  players(): Iterable<PlayerState>;
  entity(id: number): Entity | undefined;
  spawn(kind: 'car' | 'walker', x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  traffic: Traffic | null;
  peds: Pedestrians | null;
  /** gracz wysiada z pojazdu / komunikacji w miejscu (bez zmiany pozycji pieszego) */
  dropOut(p: PlayerState): void;
  /** przeniesienie pieszego gracza w punkt */
  place(p: PlayerState, x: number, z: number): void;
}

export class Rules {
  readonly events: GameEvent[] = [];
  readonly police: Police;
  readonly money: { cur: string; fare: number; fine: number; death: number };
  private t = 0;
  /** przeszukane pojemniki: id -> [czas, ile razy] */
  private searched = new Map<string, [number, number]>();

  constructor(private host: RulesHost) {
    this.money = MONEY[host.world.key] ?? MONEY.warszawa;
    this.police = new Police({
      world: host.world, spawn: (k, x, y, z, yaw) => host.spawn(k, x, y, z, yaw), despawn: id => host.despawn(id),
      graph: () => host.traffic?.graph ?? null, players: () => host.players(), entity: id => host.entity(id),
      arrest: p => this.arrest(p),
    });
  }

  private ev(p: PlayerState, text: string, kind: GameEvent['kind']): void { this.events.push({ pid: p.id, text, kind }); }

  /** Przestępstwo: +gwiazdki (do 5). */
  crime(p: PlayerState, stars: number, text: string): void {
    if (p.dead) return;
    const before = p.wanted; p.wanted = Math.min(5, p.wanted + stars); p.seenAt = this.t;
    this.ev(p, `${text}${p.wanted > before ? ' · poszukiwany ' + '★'.repeat(p.wanted) : ''}`, 'crime');
  }

  /** Obrażenia gracza. */
  hurt(p: PlayerState, dmg: number, cause: string): void {
    if (p.dead || dmg <= 0) return;
    p.hp = Math.max(0, p.hp - dmg); p.hurtAt = this.t;
    if (p.hp <= 0) {
      p.dead = 4; const lost = Math.min(p.money, this.money.death); p.money -= lost; p.wanted = 0;
      this.host.dropOut(p);
      const w = this.host.entity(p.walker); if (w) w.tilt = -Math.PI / 2;
      this.ev(p, `Nie żyjesz (${cause}). Szpital: -${lost} ${this.money.cur}`, 'death');
    }
  }

  /** Bilet na komunikację (prawdziwa cena); bez pieniędzy: jazda na gapę. */
  fare(p: PlayerState): void {
    if (p.money >= this.money.fare) { p.money = Math.round((p.money - this.money.fare) * 100) / 100; this.ev(p, `Bilet: ${this.money.fare.toFixed(2)} ${this.money.cur}`, 'info'); }
    else this.ev(p, 'Jedziesz na gapę (brak pieniędzy na bilet)', 'info');
  }

  /** Przeszukanie pojemnika: łup z tabeli (powtarzalny z ziarna), odnawianie po LOOT.respawn s. */
  search(p: PlayerState, it: Item): void {
    if (p.dead || !it.c || !it.id) return;
    const tb = TABLES[it.c]; if (!tb) return;
    const prev = this.searched.get(it.id);
    if (prev && this.t - prev[0] < LOOT.respawn) { this.ev(p, `${it.n}: pusto (już przeszukane)`, 'info'); return; }
    const n = prev ? prev[1] + 1 : 0; this.searched.set(it.id, [this.t, n]);
    const R = rng(`lup${it.id}#${n}`), k = this.host.world.key === 'londyn' ? .2 : 1, got: string[] = [];
    if (R() < tb.p) {
      const m = Math.round((tb.money[0] + (tb.money[1] - tb.money[0]) * R()) * k);
      if (m > 0) { p.money = Math.round((p.money + m) * 100) / 100; got.push(`+${m} ${this.money.cur}`); }
      for (const [name, ch] of tb.items) if (R() < (ch as number)) got.push(name as string);
      if (tb.heal && p.hp < 100) { p.hp = Math.min(100, p.hp + tb.heal); got.push(`+${tb.heal} zdrowia`); }
    }
    this.ev(p, `${it.n}: ${got.length ? got.join(', ') : 'nic'}`, got.length ? 'info' : 'info');
    if (tb.crime) this.crime(p, tb.crime[0] as number, tb.crime[1] as string);
  }

  /** Zatrzymanie przez policję: grzywna, gwiazdki zerowane, wypuszczenie przy komisariacie. */
  arrest(p: PlayerState): void {
    if (p.dead || !p.wanted) return;
    const fine = Math.min(p.money, Math.max(this.money.fine, Math.round(p.money * .1)));
    p.money -= fine; p.wanted = 0; this.host.dropOut(p);
    const at = this.nearestPoi(p, ['police']); if (at) this.host.place(p, at[0], at[1]);
    this.ev(p, `ZATRZYMANY! Grzywna ${fine} ${this.money.cur}`, 'arrest');
  }

  private nearestPoi(p: PlayerState, kinds: string[]): [number, number] | null {
    const me = this.host.entity(p.walker); if (!me) return null;
    let best: [number, number] | null = null, bd = Infinity;
    for (const t of this.host.world.tiles.values()) for (const poi of t.poi) if (kinds.includes(poi.t)) {
      const d = Math.hypot(poi.x - me.x, poi.z - me.z); if (d < bd) { bd = d; best = [poi.x, poi.z]; }
    }
    if (!best) return null;
    const [x, z] = this.host.world.freeSpot(best[0] + 6, best[1] + 6, 0, true); return [x, z];
  }

  /** Krok zasad (po ruchu graczy i ruchu ulicznego). t = czas zegara gry [s]. */
  step(dt: number, t: number): void {
    this.t = t; const H = this.host, players = [...H.players()];
    for (const p of players) {
      // odrodzenie po śmierci przy najbliższym szpitalu
      if (p.dead > 0) {
        p.dead -= dt;
        if (p.dead <= 0) {
          p.dead = 0; p.hp = 100; const w = H.entity(p.walker); if (w) w.tilt = 0;
          const at = this.nearestPoi(p, ['hospital', 'clinic']); if (at) H.place(p, at[0], at[1]);
          this.ev(p, 'Wypisany ze szpitala', 'info');
        }
        continue;
      }
      // regeneracja zdrowia po 8 s bez obrażeń
      if (p.hp < 100 && t - p.hurtAt > 8) p.hp = Math.min(100, p.hp + 4 * dt);
      // gwiazdki wygasają, gdy policja nie widzi gracza
      if (p.wanted && t - p.seenAt > 30 + 10 * p.wanted) { p.wanted--; p.seenAt = t; this.ev(p, p.wanted ? `Poziom poszukiwania spada: ${'★'.repeat(p.wanted)}` : 'Zgubiłeś policję', 'info'); }
    }
    this.police.step(dt, t);
    this.hits(players);
  }

  /** Potrącenia: auto gracza -> piesi NPC, policjanci, inni gracze; auta NPC i radiowozy -> piesi gracze. */
  private hits(players: PlayerState[]): void {
    const H = this.host;
    for (const p of players) {
      if (p.vehicle == null || p.passenger || p.dead) continue;
      const v = H.entity(p.vehicle); if (!v || v.kind !== 'car' || Math.abs(v.speed) < 3) continue;
      const hit = (e: Entity) => Math.abs(e.x - v.x) < 3 && Math.abs(e.z - v.z) < 3 && Math.hypot(e.x - v.x, e.z - v.z) < 2.3 && Math.abs(e.y - v.y) < 2;
      if (H.peds) for (const ped of [...H.peds.peds.values()]) if (hit(ped.e) && H.peds.knock(ped.e.id)) this.crime(p, 1, 'Potrącenie pieszego');
      for (const e of [...this.police.entities()]) if (e.kind === 'walker' && hit(e) && this.police.knockOfficer(e.id)) this.crime(p, 2, 'Potrącenie policjanta');
      for (const q of players) {
        if (q === p || q.vehicle != null || q.ride || q.dead) continue; const w = H.entity(q.walker);
        if (w && !w.hide && hit(w)) { this.hurt(q, Math.abs(v.speed) * 4, 'potrącenie przez ' + p.name); this.crime(p, 1, `Potrącenie gracza ${q.name}`); this.push(w, v); }
      }
    }
    // auta NPC i radiowozy potrącają pieszych graczy (np. wbiegających na jezdnię)
    const npcCars: Entity[] = [];
    if (H.traffic) for (const c of H.traffic.cars.values()) npcCars.push(c.e);
    for (const e of this.police.entities()) if (e.kind === 'car') npcCars.push(e);
    for (const q of players) {
      if (q.vehicle != null || q.ride || q.dead) continue; const w = H.entity(q.walker); if (!w || w.hide) continue;
      for (const c of npcCars) if (Math.abs(c.speed) > 3 && Math.hypot(c.x - w.x, c.z - w.z) < 2 && Math.abs(c.y - w.y) < 2) { this.hurt(q, Math.abs(c.speed) * 3, 'potrącenie'); this.push(w, c); break; }
    }
  }

  /** Odrzucenie potrąconego na bok. */
  private push(w: Entity, by: Entity): void {
    const rx = Math.cos(by.yaw), rz = -Math.sin(by.yaw), sd = (w.x - by.x) * rx + (w.z - by.z) * rz >= 0 ? 1 : -1;
    const nx = w.x + rx * 2.5 * sd, nz = w.z + rz * 2.5 * sd; if (!this.host.world.blocked(nx, nz, w.y)) { w.x = nx; w.z = nz; }
  }
}
