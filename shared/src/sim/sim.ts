// Symulacja gry: stały krok, byty, gracze, polecenia. Bez three.js i DOM,
// więc ten sam kod działa w przeglądarce i na serwerze Node.js.
import { VEH } from './vehicles';
import { TILE_SIZE, tileKey } from '../tiles/types';
import type { World } from '../world/world';
import type { TransitSystem } from '../transit/system';
import { Traffic } from '../traffic/traffic';
import { Pedestrians } from '../traffic/peds';
import { Rules } from '../game/rules';
import { SIM_DT } from './loop';
import { carStep, heliStep, walkStep } from './vehicles';
import { NO_INPUT, PLAYER_COLORS, SEATS, type Command, type Entity, type EntityKind, type InputCmd, type Mode, type PlayerState, type SaveState } from './types';

/** Pieniądze na start. */
export const START_MONEY = 500;

/** Promień, w którym można wsiąść do pojazdu. */
export const ENTER_RADIUS = 4.5;

/** Jeden krok fizyki bytu sterowanego poleceniem (wspólny dla serwera i przewidywania klienta). */
export function stepEntity(e: Entity, cmd: InputCmd, dt: number, w: World): void {
  if (e.kind === 'walker') walkStep(e, cmd, dt, w);
  else if (e.kind === 'car') carStep(e, cmd, dt, w);
  else heliStep(e, cmd, dt, w);
}

export class Simulation {
  tick = 0;
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, PlayerState>();
  /** zmiany stanu drzwi do rozesłania graczom [id, otwarte] */
  readonly doorEvents: [string, boolean][] = [];
  private readonly inputs = new Map<number, InputCmd>();
  private nextId = 1;

  /** komunikacja miejska (rozkłady); null = brak danych */
  transit: TransitSystem | null = null;
  /** ruch uliczny wokół graczy (włączany przez serwer) */
  traffic: Traffic | null = null;

  /** piesi NPC wokół graczy */
  peds: Pedestrians | null = null;

  /** zasady gry: przestępstwa, policja, zdrowie, pieniądze */
  rules: Rules | null = null;

  /** Włącza ruch uliczny (auta NPC), pieszych NPC, policję i zasady gry. */
  enableTraffic(): Traffic {
    this.peds = new Pedestrians({ world: this.world, spawn: (k, x, y, z, yaw) => this.spawn(k, x, y, z, yaw), despawn: id => { this.entities.delete(id); } });
    this.rules = new Rules({
      world: this.world, players: () => this.players.values(), entity: id => this.entities.get(id),
      spawn: (k, x, y, z, yaw) => this.spawn(k, x, y, z, yaw), despawn: id => { this.entities.delete(id); },
      get traffic() { return sim.traffic; }, get peds() { return sim.peds; },
      dropOut: p => { if (p.ride) this.leaveRide(p, null); else this.exitVehicle(p, true); },
      place: (p, x, z) => this.place(p, x, z),
    });
    const sim = this;
    return this.traffic = new Traffic({
      world: this.world,
      spawn: (k, x, y, z, yaw) => this.spawn(k, x, y, z, yaw),
      despawn: id => { this.entities.delete(id); },
      obstacles: () => {
        const out: Entity[] = []; for (const p of this.players.values()) { const e = this.controlled(p); if (!e.hide) out.push(e); }
        if (this.peds) for (const p of this.peds.peds.values()) out.push(p.e);
        if (this.rules) for (const e of this.rules.police.entities()) if (e.kind === 'walker') out.push(e);
        return out;
      },
      boardPed: (x, z, r) => {
        if (!this.peds) return false;
        for (const q of this.peds.peds.values()) if (q.flee <= 0 && Math.hypot(q.e.x - x, q.e.z - z) < r) { this.peds.peds.delete(q.e.id); this.entities.delete(q.e.id); return true; }
        return false;
      },
    });
  }
  /** Krok ruchu ulicznego: t = czas zegara [s], hour = godzina lokalna. */
  stepTraffic(t: number, hour: number): void {
    if (!this.traffic) return;
    const pts: { x: number; z: number }[] = []; for (const p of this.players.values()) { const w = this.entity(p.walker); pts.push({ x: w.x, z: w.z }); }
    this.traffic.step(SIM_DT, t, hour, pts);
    this.peds?.step(SIM_DT, hour, pts);
    this.rules?.step(SIM_DT, t);
  }

  /** Przeniesienie pieszego gracza w punkt (teleport, szpital, komisariat). */
  place(p: PlayerState, x: number, z: number): void {
    const w = this.entity(p.walker); w.x = x; w.z = z; w.y = this.world.surfaceAt(x, z, 1e6); w.reg = -1; w.hide = false;
    p.viewSeq++; p.viewYaw = w.yaw; p.viewPitch = 0;
  }

  /** Przejęcie auta NPC albo radiowozu: kierowca wyrzucony (ucieka chodnikiem), gracz siada za kierownicą. */
  private hijack(p: PlayerState, v: Entity): boolean {
    if (Math.abs(v.speed) > 2) return false;
    if (this.rules?.police.isUnitCar(v.id)) { this.rules.police.release(v.id); this.rules.crime(p, 2, 'Kradzież radiowozu'); this.enter(p, v); return true; }
    const parked = !!this.traffic?.isParked(v.id);
    if (!this.traffic || !this.traffic.release(v.id)) return false;
    this.rules?.crime(p, 1, 'Kradzież auta');
    if (parked) { v.speed = 0; this.enter(p, v); return true; } // zaparkowane: bez kierowcy
    const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), side = this.world.key === 'londyn' ? 1 : -1; // drzwi kierowcy
    this.peds?.flee(v.x + rx * 1.8 * side, v.z + rz * 1.8 * side);
    v.speed = 0; this.enter(p, v); return true;
  }

  constructor(readonly world: World) {}

  // ---------- byty ----------
  spawn(kind: EntityKind, x: number, y: number, z: number, yaw = 0): Entity {
    const e: Entity = { id: this.allocId(), kind, x, y, z, yaw, pitch: 0, speed: 0, vx: 0, vy: 0, vz: 0, roll: 0, tilt: 0, reg: -1, air: false, lift: 0, driver: null, pass: [], hide: false, owner: null };
    this.entities.set(e.id, e);
    return e;
  }
  entity(id: number): Entity { return this.entities.get(id)!; }
  /** Id bytu 1..65535 (sieć przesyła 16 bitów); po przepełnieniu wraca do wolnych. */
  private allocId(): number {
    for (let i = 0; i < 65535; i++) { const id = this.nextId; this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1; if (!this.entities.has(id)) return id; }
    throw new Error('Brak wolnych id bytów');
  }

  /** Nowy gracz (opcjonalnie w zapamiętanym miejscu). */
  addPlayer(name: string, at?: { x: number; y: number; z: number; yaw: number }): PlayerState {
    const pose = this.world.spawnPose();
    const w = this.spawn('walker', pose.x, pose.y, pose.z, pose.yaw);
    w.pitch = pose.pitch; w.reg = pose.reg ? pose.reg.id : -1;
    if (at) { Object.assign(w, at); const g = this.world.support(w.x, w.z, w.y); w.reg = g && g.r ? g.r.id : -1; }
    const used = new Set([...this.players.values()].map(q => q.color));
    const color = PLAYER_COLORS.find(c => !used.has(c)) ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
    const p: PlayerState = { id: w.id, name, walker: w.id, vehicle: null, passenger: false, ride: null, color, hp: 100, money: START_MONEY, wanted: 0, seenAt: 0, hurtAt: 0, dead: 0, viewSeq: 1, viewYaw: w.yaw, viewPitch: w.pitch };
    w.owner = p.id;
    this.players.set(p.id, p);
    return p;
  }
  removePlayer(id: number): void {
    const p = this.players.get(id); if (!p) return;
    if (p.vehicle != null) this.leaveSeat(p, this.entity(p.vehicle));
    this.entities.delete(p.walker); this.players.delete(id); this.inputs.delete(id);
  }

  modeOf(p: PlayerState): Mode {
    if (p.vehicle == null) return 'walk';
    return this.entity(p.vehicle).kind === 'heli' ? 'heli' : 'car';
  }
  /** Byt, za którym podąża gracz (pieszy albo pojazd, także jako pasażer). */
  controlled(p: PlayerState): Entity { return this.entity(p.vehicle ?? p.walker); }
  /** Byt, którym gracz steruje (null dla pasażera). */
  driven(p: PlayerState): Entity | null { return p.passenger || p.ride || p.dead ? null : this.controlled(p); }

  // ---------- wejście ----------
  setInput(pid: number, cmd: InputCmd): void { this.inputs.set(pid, cmd); }

  /** Polecenie gracza; zwraca komunikat dla gracza (np. „drzwi zamknięte”) albo undefined. */
  command(pid: number, c: Command): string | undefined {
    const p = this.players.get(pid); if (!p || p.dead) return;
    if (p.ride) {
      if (c.type === 'goStation') { this.leaveRide(p, null); }
      else if (c.type === 'enter' || c.type === 'alight' || c.type === 'mode') return this.alight(p);
      else return;
    }
    if (c.type === 'teleport') {
      this.exitVehicle(p, false); const w = this.entity(p.walker);
      w.x = c.x; w.z = c.z; w.y = this.world.surfaceAt(c.x, c.z, 1e6); w.reg = -1; p.viewSeq++; p.viewYaw = w.yaw; p.viewPitch = 0; this.unstuck.set(p.id, 300); return;
    }
    if (c.type === 'mode') this.setMode(p, c.mode, c.v);
    else if (c.type === 'enter') { if (!this.board(p) && !this.door(p) && !this.search(p)) this.enterNearest(p); }
    else if (c.type === 'goStation') {
      const s = this.world.stations[c.station]; if (!s) return;
      this.exitVehicle(p, false);
      const pose = c.street ? this.world.streetPose(s) : this.world.platformPose(s);
      const w = this.entity(p.walker);
      Object.assign(w, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, reg: pose.reg ? pose.reg.id : -1 });
      p.viewSeq++; p.viewYaw = this.entity(p.walker).yaw; p.viewPitch = this.entity(p.walker).pitch;
    }
  }

  // ---------- krok ----------
  step(): void {
    for (const p of this.players.values()) this.stepPlayer(p.id, this.inputs.get(p.id) ?? NO_INPUT);
    this.endStep();
  }

  /** Jeden krok sterowanego bytu gracza (serwer: jeden krok na jedno wejście klienta). */
  stepPlayer(pid: number, cmd: InputCmd): void {
    const p = this.players.get(pid), e = p && this.driven(p); if (!e) return;
    const x = e.x, z = e.z, yaw = e.yaw, v0 = e.speed;
    stepEntity(e, cmd, SIM_DT, this.world);
    // zderzenie auta gracza z autami NPC, radiowozami i innymi autami (prosto: okręgi 3,2 m)
    if (e.kind === 'car') for (const o of this.entities.values()) {
      if (o === e || o.kind !== 'car' || Math.abs(o.x - e.x) > 6 || Math.abs(o.z - e.z) > 6 || Math.abs(o.y - e.y) > 2) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) < 3.2) { e.x = x; e.z = z; e.yaw = yaw; e.speed *= -.3; const c = this.traffic?.cars.get(o.id); if (c) c.v = 0; break; }
    }
    // mocne uderzenie (w budynek albo auto) rani kierowcę i pasażerów
    if (e.kind === 'car' && Math.abs(v0) > 12 && Math.sign(e.speed) !== Math.sign(v0) && this.rules) {
      const dmg = (Math.abs(v0) - 12) * 3;
      for (const q of this.players.values()) if (q.vehicle === e.id) this.rules.hurt(q, dmg, 'wypadek');
    }
  }

  /** Koniec kroku świata: pieszy siedzący w pojeździe jedzie razem z nim (zainteresowanie, zapis). */
  /** po teleporcie: gracze do sprawdzenia, czy nie stoją w budynku (kafle doczytują się z opóźnieniem) */
  private unstuck = new Map<number, number>();
  private freeNear(x: number, z: number): [number, number] | null {
    for (let r = 2; r <= 80; r += 2) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (!this.world.blocked(px, pz)) return [px, pz]; }
    return null;
  }

  endStep(): void {
    for (const [pid, n] of this.unstuck) {
      const p = this.players.get(pid); if (!p || n <= 0) { this.unstuck.delete(pid); continue; } this.unstuck.set(pid, n - 1);
      const w = this.entity(p.walker); if (!this.world.tiles.has(tileKey(Math.floor(w.x / TILE_SIZE), Math.floor(w.z / TILE_SIZE)))) continue;
      if (this.world.blocked(w.x, w.z)) { const q = this.freeNear(w.x, w.z); if (q) { w.x = q[0]; w.z = q[1]; w.y = this.world.surfaceAt(q[0], q[1], 1e6); p.viewSeq++; } }
      this.unstuck.delete(pid);
    }
    if (this.transit) for (const p of this.players.values()) if (p.ride) {
      const a = this.transit.trip(p.ride), w = this.entity(p.walker);
      if (!a) { this.leaveRide(p, null); continue; } // kurs się skończył: wysiada na pętli
      if (a.st.terminal && a.st.stop === a.p.stops.length - 1) { this.leaveRide(p, this.transit.alightPose(a)); continue; }
      const q = this.transit.pose(a.p, a.st.s); w.x = q.x; w.y = q.y; w.z = q.z; w.yaw = q.yaw;
    }
    for (const p of this.players.values()) if (p.vehicle != null) {
      const v = this.entity(p.vehicle), wk = this.entity(p.walker); wk.x = v.x; wk.y = v.y; wk.z = v.z;
    }
    // wnętrza budynków wokół graczy (co 1/3 s)
    if (this.tick % 10 === 0) this.syncInteriors();
    this.tick++;
  }

  /** Wnętrza wokół graczy: plany budynków, piętra, regiony chodzenia. */
  syncInteriors(): void {
    const pts: { x: number; y: number; z: number }[] = [];
    for (const p of this.players.values()) { const w = this.entity(p.walker); pts.push({ x: w.x, y: w.y, z: w.z }); }
    this.world.interiors.sync(pts);
  }

  /** Limity ruchu (ustawienie gry): najwięcej aut i pieszych wokół gracza w szczycie. */
  setTrafficLimits(cars: number, peds: number): void {
    if (this.traffic && Number.isFinite(cars)) this.traffic.maxPerPlayer = Math.max(0, Math.min(500, Math.round(cars)));
    if (this.peds && Number.isFinite(peds)) this.peds.max = Math.max(0, Math.min(400, Math.round(peds)));
  }

  /** Włącza / wyłącza wnętrza budynków; gracz stojący w środku wychodzi na ulicę obok. */
  setInteriors(on: boolean): void {
    if (!on) for (const p of this.players.values()) {
      if (p.vehicle != null || p.ride) continue;
      const w = this.entity(p.walker); if (this.world.regions.get(w.reg)?.info.b == null) continue;
      const [x, z] = this.world.freeSpot(w.x, w.z, 0, true); this.place(p, x, z);
    }
    this.world.interiors.setEnabled(on);
  }

  /** Otwiera / zamyka najbliższe drzwi w zasięgu ręki (pierwszeństwo przed pojemnikiem, gdy drzwi są bliżej niż 1 m). */
  door(p: PlayerState): boolean {
    if (p.vehicle != null || p.ride) return false;
    const w = this.entity(p.walker), I = this.world.interiors, d = I.nearDoor(w.x, w.z, w.y);
    if (!d || (d.dist > 1 && I.container(w.x, w.z, w.y))) return false;
    if (I.setDoor(d.d.id, !d.open)) this.doorEvents.push([d.d.id, !d.open]);
    return true;
  }

  /** Przeszukanie pojemnika (szafa, lodówka, kasa...) w zasięgu ręki. */
  search(p: PlayerState): boolean {
    if (!this.rules || p.vehicle != null) return false;
    const w = this.entity(p.walker), c = this.world.interiors.container(w.x, w.z, w.y); if (!c) return false;
    this.rules.search(p, c.item); return true;
  }

  // ---------- komunikacja miejska ----------
  /** Wsiada do pojazdu komunikacji stojącego na przystanku obok. */
  board(p: PlayerState): boolean {
    if (!this.transit || p.vehicle != null || p.ride) return false;
    const w = this.entity(p.walker), a = this.transit.boardable(w.x, w.y, w.z); if (!a) return false;
    p.ride = a.key; w.hide = true; w.reg = -1; this.rules?.fare(p); return true;
  }
  /** Wysiada, jeśli pojazd stoi na przystanku. */
  alight(p: PlayerState): string | undefined {
    if (!p.ride || !this.transit) return;
    const a = this.transit.trip(p.ride);
    if (a && a.st.stop < 0) return 'Drzwi zamknięte: wysiądziesz na najbliższym przystanku.';
    this.leaveRide(p, a ? this.transit.alightPose(a) : null);
  }
  private leaveRide(p: PlayerState, at: { x: number; y: number; z: number; yaw: number } | null): void {
    const w = this.entity(p.walker); p.ride = null; w.hide = false;
    if (at) { w.x = at.x; w.y = at.y; w.z = at.z; w.yaw = at.yaw; }
    const g = this.world.support(w.x, w.z, w.y); if (g) { w.y = g.h; w.reg = g.r ? g.r.id : -1; } else w.reg = -1;
    w.pitch = 0; p.viewSeq++; p.viewYaw = w.yaw; p.viewPitch = 0;
  }

  // ---------- pojazdy ----------
  /** Pojazd gracza danego typu (przywoływany klawiszem); tworzy go, gdy nie istnieje. */
  private personal(p: PlayerState, kind: 'car' | 'heli', variant?: number): Entity {
    const v = kind === 'car' && Number.isInteger(variant) && VEH[variant!] ? variant! : 0;
    for (const e of this.entities.values()) if (e.kind === kind && e.owner === p.id && (e.driver == null || e.driver === p.id) && !e.pass.length) { if (kind === 'car') e.v = v; return e; }
    const e = this.spawn(kind, 0, 0, 0); e.owner = p.id; if (kind === 'car') e.v = v; return e;
  }

  private enter(p: PlayerState, v: Entity, passenger = false): void {
    p.vehicle = v.id; p.passenger = passenger; this.entity(p.walker).hide = true;
    if (passenger) v.pass.push(p.id); else v.driver = p.id;
  }
  private leaveSeat(p: PlayerState, v: Entity): void {
    if (v.driver === p.id) v.driver = null; v.pass = v.pass.filter(id => id !== p.id);
    p.vehicle = null; p.passenger = false; const w = this.entities.get(p.walker); if (w) w.hide = false;
  }

  /** Zatrzymuje pojazd i zostawia go zaparkowanego. */
  private park(v: Entity): void {
    v.speed = 0; v.vx = v.vy = v.vz = 0; v.lift = 0;
    if (v.kind === 'heli') { v.y = this.world.roofTop(v.x, v.z); v.air = false; v.tilt = v.roll = 0; }
  }

  /** Wysiada obok pojazdu (z lewej strony, a gdy tam budynek, w najbliższym wolnym miejscu). */
  private exitVehicle(p: PlayerState, place = true): void {
    if (p.vehicle == null) return;
    const v = this.entity(p.vehicle), w = this.entity(p.walker), W = this.world;
    if (place) {
      const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw); let q: [number, number] = [v.x - rx * 2.6, v.z - rz * 2.6];
      if (W.blocked(q[0], q[1])) q = W.freeSpot(v.x, v.z, v.yaw, true);
      Object.assign(w, { x: q[0], z: q[1], y: W.surfaceAt(q[0], q[1], v.y), reg: -1, yaw: v.yaw, pitch: 0 });
      p.viewSeq++; p.viewYaw = this.entity(p.walker).yaw; p.viewPitch = this.entity(p.walker).pitch;
    }
    const wasDriver = v.driver === p.id; this.leaveSeat(p, v);
    if (wasDriver && !v.pass.length) this.park(v); else if (wasDriver) { v.speed *= .5; }
  }

  /** Wsiada do najbliższego pojazdu w zasięgu: za kierownicę albo jako pasażer, gdy ktoś prowadzi. */
  enterNearest(p: PlayerState): boolean {
    if (p.vehicle != null) return false;
    const w = this.entity(p.walker); if (this.world.underground(w.x, w.z, w.y)) return false;
    let best: Entity | null = null, bd = ENTER_RADIUS ** 2;
    for (const e of this.entities.values()) {
      if (e.kind === 'walker' || (e.npc && Math.abs(e.speed) > 2) || (e.driver != null && e.pass.length >= SEATS[e.kind])) continue;
      const d = (e.x - w.x) ** 2 + (e.z - w.z) ** 2 + ((e.y - w.y) / 2) ** 2; if (d < bd) { bd = d; best = e; }
    }
    if (!best) return false;
    if (best.npc) return this.hijack(p, best);
    this.enter(p, best, best.driver != null); return true;
  }

  /** Przełączanie trybu jak w prototypie: ponowne wybranie trybu pojazdu = wysiadanie. */
  setMode(p: PlayerState, m: Mode, variant?: number): void {
    if (p.passenger) { this.exitVehicle(p); return; }
    const from = this.modeOf(p);
    if (m === from && m !== 'walk') m = 'walk'; if (m === from) return;
    const W = this.world;
    if (m === 'walk') { this.exitVehicle(p); return; }
    if (from === 'walk') {
      const w = this.entity(p.walker); let x = w.x, z = w.z, yaw = w.yaw; const under = W.underground(w.x, w.z, w.y);
      if (under) {
        const s = W.nearestStation(w.x, w.z), t = s?.tops[0];
        if (t) { x = t[0] + t[2][0] * 5; z = t[1] + t[2][1] * 5; yaw = Math.atan2(-t[2][0], -t[2][1]); } else if (s) { x = s.x; z = s.z; }
      }
      if (m === 'car') [x, z] = W.freeSpot(x, z, yaw);
      const v = this.personal(p, m, variant);
      Object.assign(v, { x, z, yaw, y: m === 'heli' ? W.roofTop(x, z) + (under ? 40 : 0) : under ? W.ground(x, z) : W.surfaceAt(x, z, w.y), speed: 0, vx: 0, vz: 0, vy: 0, tilt: 0, roll: 0, air: false });
      this.enter(p, v);
      return;
    }
    // przesiadka między pojazdami
    const old = this.entity(p.vehicle!), v = this.personal(p, m, variant);
    if (m === 'car') {
      const [x, z] = W.freeSpot(old.x, old.z, old.yaw);
      Object.assign(v, { x, z, y: W.ground(x, z), yaw: old.yaw, speed: 0, roll: 0, tilt: 0 });
    } else {
      Object.assign(v, { x: old.x, y: old.y, z: old.z, yaw: old.yaw, vx: -Math.sin(old.yaw) * old.speed, vz: -Math.cos(old.yaw) * old.speed, vy: 0, roll: old.roll, tilt: 0 });
    }
    this.leaveSeat(p, old); this.park(old); this.enter(p, v);
  }

  // ---------- zapis i odczyt ----------
  serialize(): SaveState {
    return {
      v: 1, city: this.world.key, tick: this.tick, nextId: this.nextId,
      entities: [...this.entities.values()].map(e => ({ ...e })),
      players: [...this.players.values()].map(p => ({ ...p })),
    };
  }

  load(s: SaveState): void {
    if (s.v !== 1) throw new Error('Nieznana wersja zapisu');
    if (s.city !== this.world.key) throw new Error('Zapis dotyczy innego miasta');
    this.entities.clear(); this.players.clear(); this.inputs.clear();
    this.tick = s.tick; this.nextId = s.nextId;
    for (const e of s.entities) {
      const c = { ...e };
      // region liczony od nowa: świat mógł powstać z innego pliku OSM
      if (c.kind === 'walker') { const g = this.world.support(c.x, c.z, c.y); c.reg = g && g.r ? g.r.id : -1; }
      this.entities.set(c.id, c);
    }
    for (const p of s.players) this.players.set(p.id, { ...p, hp: p.hp ?? 100, money: p.money ?? START_MONEY, wanted: p.wanted ?? 0, seenAt: 0, hurtAt: 0, dead: 0, ride: null, passenger: p.passenger ?? false, color: p.color ?? PLAYER_COLORS[0], viewSeq: p.viewSeq + 1 });
    for (const e of this.entities.values()) { e.pass ??= []; e.hide ??= false; }
  }
}
