// Symulacja gry: stały krok, byty, gracze, polecenia. Bez three.js i DOM,
// więc ten sam kod działa w przeglądarce i na serwerze Node.js.
import type { World } from '../world/world';
import { SIM_DT } from './loop';
import { carStep, heliStep, walkStep } from './vehicles';
import { NO_INPUT, type Command, type Entity, type EntityKind, type InputCmd, type Mode, type PlayerState, type SaveState } from './types';

/** Promień, w którym można wsiąść do pojazdu. */
export const ENTER_RADIUS = 4.5;

export class Simulation {
  tick = 0;
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, PlayerState>();
  private readonly inputs = new Map<number, InputCmd>();
  private nextId = 1;

  constructor(readonly world: World) {}

  // ---------- byty ----------
  spawn(kind: EntityKind, x: number, y: number, z: number, yaw = 0): Entity {
    const e: Entity = { id: this.nextId++, kind, x, y, z, yaw, pitch: 0, speed: 0, vx: 0, vy: 0, vz: 0, roll: 0, tilt: 0, reg: -1, air: false, lift: 0, driver: null, owner: null };
    this.entities.set(e.id, e);
    return e;
  }
  entity(id: number): Entity { return this.entities.get(id)!; }

  addPlayer(name: string): PlayerState {
    const pose = this.world.spawnPose();
    const w = this.spawn('walker', pose.x, pose.y, pose.z, pose.yaw);
    w.pitch = pose.pitch; w.reg = pose.reg ? pose.reg.id : -1;
    const p: PlayerState = { id: w.id, name, walker: w.id, vehicle: null, viewSeq: 1 };
    w.owner = p.id;
    this.players.set(p.id, p);
    return p;
  }
  removePlayer(id: number): void {
    const p = this.players.get(id); if (!p) return;
    if (p.vehicle != null) this.entity(p.vehicle).driver = null;
    this.entities.delete(p.walker); this.players.delete(id); this.inputs.delete(id);
  }

  modeOf(p: PlayerState): Mode {
    if (p.vehicle == null) return 'walk';
    return this.entity(p.vehicle).kind === 'heli' ? 'heli' : 'car';
  }
  /** Byt, którym gracz steruje (pieszy albo pojazd). */
  controlled(p: PlayerState): Entity { return this.entity(p.vehicle ?? p.walker); }

  // ---------- wejście ----------
  setInput(pid: number, cmd: InputCmd): void { this.inputs.set(pid, cmd); }

  command(pid: number, c: Command): void {
    const p = this.players.get(pid); if (!p) return;
    if (c.type === 'mode') this.setMode(p, c.mode);
    else if (c.type === 'enter') this.enterNearest(p);
    else if (c.type === 'goStation') {
      const s = this.world.stations[c.station]; if (!s) return;
      this.exitVehicle(p, false);
      const pose = c.street ? this.world.streetPose(s) : this.world.platformPose(s);
      const w = this.entity(p.walker);
      Object.assign(w, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, reg: pose.reg ? pose.reg.id : -1 });
      p.viewSeq++;
    }
  }

  // ---------- krok ----------
  step(): void {
    const dt = SIM_DT, w = this.world;
    for (const p of this.players.values()) {
      const cmd = this.inputs.get(p.id) ?? NO_INPUT, e = this.controlled(p);
      if (e.kind === 'walker') walkStep(e, cmd, dt, w);
      else if (e.kind === 'car') carStep(e, cmd, dt, w);
      else heliStep(e, cmd, dt, w);
    }
    this.tick++;
  }

  // ---------- pojazdy ----------
  /** Pojazd gracza danego typu (przywoływany klawiszem); tworzy go, gdy nie istnieje. */
  private personal(p: PlayerState, kind: 'car' | 'heli'): Entity {
    for (const e of this.entities.values()) if (e.kind === kind && e.owner === p.id && (e.driver == null || e.driver === p.id)) return e;
    const e = this.spawn(kind, 0, 0, 0); e.owner = p.id; return e;
  }

  private enter(p: PlayerState, v: Entity): void { p.vehicle = v.id; v.driver = p.id; }

  /** Zatrzymuje pojazd i zostawia go zaparkowanego. */
  private park(v: Entity): void {
    v.driver = null; v.speed = 0; v.vx = v.vy = v.vz = 0; v.lift = 0;
    if (v.kind === 'heli') { v.y = this.world.buildings.top(v.x, v.z); v.air = false; v.tilt = v.roll = 0; }
  }

  /** Wysiada obok pojazdu (z lewej strony, a gdy tam budynek, w najbliższym wolnym miejscu). */
  private exitVehicle(p: PlayerState, place = true): void {
    if (p.vehicle == null) return;
    const v = this.entity(p.vehicle), w = this.entity(p.walker), B = this.world.buildings;
    if (place) {
      const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw); let q: [number, number] = [v.x - rx * 2.6, v.z - rz * 2.6];
      if (B.hit(q[0], q[1])) q = B.freeSpot(v.x, v.z, v.yaw, true);
      Object.assign(w, { x: q[0], z: q[1], y: 0, reg: -1, yaw: v.yaw, pitch: 0 });
      p.viewSeq++;
    }
    this.park(v); p.vehicle = null;
  }

  /** Wsiada do najbliższego wolnego pojazdu w zasięgu. */
  enterNearest(p: PlayerState): boolean {
    if (p.vehicle != null) return false;
    const w = this.entity(p.walker); if (w.y < -1) return false;
    let best: Entity | null = null, bd = ENTER_RADIUS ** 2;
    for (const e of this.entities.values()) {
      if (e.kind === 'walker' || e.driver != null) continue;
      const d = (e.x - w.x) ** 2 + (e.z - w.z) ** 2 + ((e.y - w.y) / 2) ** 2; if (d < bd) { bd = d; best = e; }
    }
    if (!best) return false;
    this.enter(p, best); return true;
  }

  /** Przełączanie trybu jak w prototypie: ponowne wybranie trybu pojazdu = wysiadanie. */
  setMode(p: PlayerState, m: Mode): void {
    const from = this.modeOf(p);
    if (m === from && m !== 'walk') m = 'walk'; if (m === from) return;
    const W = this.world, B = W.buildings;
    if (m === 'walk') { this.exitVehicle(p); return; }
    if (from === 'walk') {
      const w = this.entity(p.walker); let x = w.x, z = w.z, yaw = w.yaw; const under = w.y < -1;
      if (under) {
        const s = W.nearestStation(w.x, w.z), t = s.tops[0];
        if (t) { x = t[0] + t[2][0] * 5; z = t[1] + t[2][1] * 5; yaw = Math.atan2(-t[2][0], -t[2][1]); } else { x = s.x; z = s.z; }
      }
      if (m === 'car') [x, z] = B.freeSpot(x, z, yaw);
      const v = this.personal(p, m);
      Object.assign(v, { x, z, yaw, y: m === 'heli' ? B.top(x, z) + (under ? 40 : 0) : 0, speed: 0, vx: 0, vz: 0, vy: 0, tilt: 0, roll: 0, air: false });
      this.enter(p, v);
      return;
    }
    // przesiadka między pojazdami
    const old = this.entity(p.vehicle!), v = this.personal(p, m);
    if (m === 'car') {
      const [x, z] = B.freeSpot(old.x, old.z, old.yaw);
      Object.assign(v, { x, z, y: 0, yaw: old.yaw, speed: 0, roll: 0, tilt: 0 });
    } else {
      Object.assign(v, { x: old.x, y: old.y, z: old.z, yaw: old.yaw, vx: -Math.sin(old.yaw) * old.speed, vz: -Math.cos(old.yaw) * old.speed, vy: 0, roll: old.roll, tilt: 0 });
    }
    this.park(old); this.enter(p, v);
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
      if (c.kind === 'walker') { const g = this.world.regions.support(c.x, c.z, c.y, this.world.buildings); c.reg = g && g.r ? g.r.id : -1; }
      this.entities.set(c.id, c);
    }
    for (const p of s.players) this.players.set(p.id, { ...p, viewSeq: p.viewSeq + 1 });
  }
}
