// Symulacja gry: stały krok, byty, gracze, polecenia. Bez three.js i DOM,
// więc ten sam kod działa w przeglądarce i na serwerze Node.js.
import type { World } from '../world/world';
import type { TransitSystem } from '../transit/system';
import { Traffic } from '../traffic/traffic';
import { SIM_DT } from './loop';
import { carStep, heliStep, walkStep } from './vehicles';
import { NO_INPUT, PLAYER_COLORS, SEATS, type Command, type Entity, type EntityKind, type InputCmd, type Mode, type PlayerState, type SaveState } from './types';

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
  private readonly inputs = new Map<number, InputCmd>();
  private nextId = 1;

  /** komunikacja miejska (rozkłady); null = brak danych */
  transit: TransitSystem | null = null;
  /** ruch uliczny wokół graczy (włączany przez serwer) */
  traffic: Traffic | null = null;

  /** Włącza ruch uliczny (auta NPC). */
  enableTraffic(): Traffic {
    return this.traffic = new Traffic({
      world: this.world,
      spawn: (k, x, y, z, yaw) => this.spawn(k, x, y, z, yaw),
      despawn: id => { this.entities.delete(id); },
      obstacles: () => { const out: Entity[] = []; for (const p of this.players.values()) { const e = this.controlled(p); if (!e.hide) out.push(e); } return out; },
    });
  }
  /** Krok ruchu ulicznego: t = czas zegara [s], hour = godzina lokalna. */
  stepTraffic(t: number, hour: number): void {
    if (!this.traffic) return;
    const pts: { x: number; z: number }[] = []; for (const p of this.players.values()) { const w = this.entity(p.walker); pts.push({ x: w.x, z: w.z }); }
    this.traffic.step(SIM_DT, t, hour, pts);
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
    const p: PlayerState = { id: w.id, name, walker: w.id, vehicle: null, passenger: false, ride: null, color, viewSeq: 1, viewYaw: w.yaw, viewPitch: w.pitch };
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
  driven(p: PlayerState): Entity | null { return p.passenger || p.ride ? null : this.controlled(p); }

  // ---------- wejście ----------
  setInput(pid: number, cmd: InputCmd): void { this.inputs.set(pid, cmd); }

  /** Polecenie gracza; zwraca komunikat dla gracza (np. „drzwi zamknięte”) albo undefined. */
  command(pid: number, c: Command): string | undefined {
    const p = this.players.get(pid); if (!p) return;
    if (p.ride) {
      if (c.type === 'goStation') { this.leaveRide(p, null); }
      else if (c.type === 'enter' || c.type === 'alight' || c.type === 'mode') return this.alight(p);
      else return;
    }
    if (c.type === 'mode') this.setMode(p, c.mode);
    else if (c.type === 'enter') { if (!this.board(p)) this.enterNearest(p); }
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
    const x = e.x, z = e.z, yaw = e.yaw;
    stepEntity(e, cmd, SIM_DT, this.world);
    // zderzenie auta gracza z autem NPC (prosto: okręgi 3,2 m)
    if (e.kind === 'car' && this.traffic) for (const c of this.traffic.cars.values()) {
      const o = c.e; if (Math.abs(o.x - e.x) > 6 || Math.abs(o.z - e.z) > 6) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) < 3.2) { e.x = x; e.z = z; e.yaw = yaw; e.speed *= -.3; c.v = 0; break; }
    }
  }

  /** Koniec kroku świata: pieszy siedzący w pojeździe jedzie razem z nim (zainteresowanie, zapis). */
  endStep(): void {
    if (this.transit) for (const p of this.players.values()) if (p.ride) {
      const a = this.transit.trip(p.ride), w = this.entity(p.walker);
      if (!a) { this.leaveRide(p, null); continue; } // kurs się skończył: wysiada na pętli
      if (a.st.terminal && a.st.stop === a.p.stops.length - 1) { this.leaveRide(p, this.transit.alightPose(a)); continue; }
      const q = this.transit.pose(a.p, a.st.s); w.x = q.x; w.y = q.y; w.z = q.z; w.yaw = q.yaw;
    }
    for (const p of this.players.values()) if (p.vehicle != null) {
      const v = this.entity(p.vehicle), wk = this.entity(p.walker); wk.x = v.x; wk.y = v.y; wk.z = v.z;
    }
    this.tick++;
  }

  // ---------- komunikacja miejska ----------
  /** Wsiada do pojazdu komunikacji stojącego na przystanku obok. */
  board(p: PlayerState): boolean {
    if (!this.transit || p.vehicle != null || p.ride) return false;
    const w = this.entity(p.walker), a = this.transit.boardable(w.x, w.y, w.z); if (!a) return false;
    p.ride = a.key; w.hide = true; w.reg = -1; return true;
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
  private personal(p: PlayerState, kind: 'car' | 'heli'): Entity {
    for (const e of this.entities.values()) if (e.kind === kind && e.owner === p.id && (e.driver == null || e.driver === p.id) && !e.pass.length) return e;
    const e = this.spawn(kind, 0, 0, 0); e.owner = p.id; return e;
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
      if (e.kind === 'walker' || e.npc || (e.driver != null && e.pass.length >= SEATS[e.kind])) continue;
      const d = (e.x - w.x) ** 2 + (e.z - w.z) ** 2 + ((e.y - w.y) / 2) ** 2; if (d < bd) { bd = d; best = e; }
    }
    if (!best) return false;
    this.enter(p, best, best.driver != null); return true;
  }

  /** Przełączanie trybu jak w prototypie: ponowne wybranie trybu pojazdu = wysiadanie. */
  setMode(p: PlayerState, m: Mode): void {
    if (p.passenger) { this.exitVehicle(p); return; }
    const from = this.modeOf(p);
    if (m === from && m !== 'walk') m = 'walk'; if (m === from) return;
    const W = this.world;
    if (m === 'walk') { this.exitVehicle(p); return; }
    if (from === 'walk') {
      const w = this.entity(p.walker); let x = w.x, z = w.z, yaw = w.yaw; const under = W.underground(w.x, w.z, w.y);
      if (under) {
        const s = W.nearestStation(w.x, w.z), t = s.tops[0];
        if (t) { x = t[0] + t[2][0] * 5; z = t[1] + t[2][1] * 5; yaw = Math.atan2(-t[2][0], -t[2][1]); } else { x = s.x; z = s.z; }
      }
      if (m === 'car') [x, z] = W.freeSpot(x, z, yaw);
      const v = this.personal(p, m);
      Object.assign(v, { x, z, yaw, y: m === 'heli' ? W.roofTop(x, z) + (under ? 40 : 0) : under ? W.ground(x, z) : W.surfaceAt(x, z, w.y), speed: 0, vx: 0, vz: 0, vy: 0, tilt: 0, roll: 0, air: false });
      this.enter(p, v);
      return;
    }
    // przesiadka między pojazdami
    const old = this.entity(p.vehicle!), v = this.personal(p, m);
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
    for (const p of s.players) this.players.set(p.id, { ...p, ride: null, passenger: p.passenger ?? false, color: p.color ?? PLAYER_COLORS[0], viewSeq: p.viewSeq + 1 });
    for (const e of this.entities.values()) { e.pass ??= []; e.hide ??= false; }
  }
}
