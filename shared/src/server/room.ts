// Pokój gry (sesja = jedno miasto): autorytatywna symulacja, kolejki wejść graczy, zarządzanie
// zainteresowaniem (każdy dostaje byty wokół siebie), migawki z samymi zmianami, czat, kafelki.
// Bez Node i DOM: ten sam kod działa w serwerze (WebSocket) i w Workerze (gra jednoosobowa).
import { Jobs } from '../game/jobs';
import { Simulation } from '../sim/sim';
import { CITY_TZ, GameClock, localTime } from '../transit/clock';
import { TransitSystem } from '../transit/system';
import type { TransitData } from '../transit/timetable';
import { SIM_HZ } from '../sim/loop';
import type { Command, PlayerState, SaveState } from '../sim/types';
import type { World } from '../world/world';
import { TILE_SIZE, tileKey, type TileData } from '../tiles/types';
import {
  decodeInput, encodeSnapshot, MSG_INPUT, NF, PROTOCOL_VERSION, playerInfo, quantize,
  type ClientMsg, type InputMsg, type QState, type ServerMsg, type SnapshotEntity,
} from '../net/protocol';

/** Połączenie z klientem (WebSocket, Worker, test). */
export interface Conn { send(data: ArrayBuffer | string): void; close(): void }

export interface RoomOptions {
  maxPlayers?: number;
  /** co ile kroków migawka (2 = 15 Hz przy 30 Hz symulacji) */
  snapEvery?: number;
  /** promień zainteresowania [m] (pieszo / auto); helikopter dostaje 2,5 × */
  interest?: number;
  /** gra jednoosobowa: wolno zapisywać i wczytywać stan */
  local?: boolean;
  /** wersja deweloperska: teleport z mapy w telefonie także w grze sieciowej */
  dev?: boolean;
}
export interface TileLoader { has(x: number, y: number): boolean; load(x: number, y: number): Promise<TileData | null> }

interface Client {
  conn: Conn; player: PlayerState;
  /** ostatnio wysłany stan gracza (hp, pieniądze, gwiazdki) */
  meSig: string;
  inputs: InputMsg[]; ack: number;
  /** żetony: ile wejść wolno przetworzyć (średnio jedno na krok serwera) */
  credit: number;
  sent: Map<number, QState>;
  bytes: number; chat: number[];
}

export interface RoomStats {
  players: number; entities: number; tiles: number; tick: number;
  tickMs: number; tickMsMax: number; bytesPerClientPerSec: number;
}

const MAX_QUEUE = 6, MAX_CREDIT = 4;
const clean = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

export class Room {
  readonly sim: Simulation;
  /** zegar gry (czas lokalny miasta liczony z niego) */
  readonly clock = new GameClock();
  transit: TransitSystem | null = null;
  readonly clients = new Map<number, Client>();
  readonly opt: Required<RoomOptions>;
  /** ruch uliczny wokół graczy */
  enableTraffic(): void { this.sim.enableTraffic(); }
  private playersSig = '';
  private loadingTiles = new Set<string>();
  private jobs: Jobs;
  private q = new Map<number, QState>();
  private timing = { sum: 0, n: 0, max: 0, bytes: 0, since: 0 };
  stats: RoomStats = { players: 0, entities: 0, tiles: 0, tick: 0, tickMs: 0, tickMsMax: 0, bytesPerClientPerSec: 0 };
  /** zapis stanu graczy przy wyjściu (serwer zapisuje w pliku) */
  onLeave: (p: PlayerState, pos: { x: number; y: number; z: number; yaw: number; money: number }) => void = () => {};

  constructor(readonly id: string, readonly world: World, private tiles: TileLoader | null, opt: RoomOptions = {}, private now: () => number = () => Date.now()) {
    this.sim = new Simulation(world);
    this.opt = { maxPlayers: 64, snapEvery: 2, interest: 1000, local: false, dev: true, ...opt };
    this.jobs = new Jobs({
      world, now: () => this.now(),
      pos: pid => { const p = this.sim.players.get(pid); if (!p) return null; const e = this.sim.entities.get(p.vehicle ?? p.walker); return e ? { x: e.x, z: e.z } : null; },
      send: (pid, msg) => { const c = this.clients.get(pid); if (c) this.sendJson(c.conn, msg); },
      pay: (pid, amount) => { const p = this.sim.players.get(pid); if (p) p.money = Math.round((p.money + amount) * 100) / 100; return this.sim.rules?.money.cur ?? 'zł'; },
    });
  }

  /** Rozkłady jazdy (komunikacja miejska liczona z zegara). */
  setTransit(data: TransitData): TransitSystem { this.transit = new TransitSystem(data, this.world, this.clock); this.sim.transit = this.transit; return this.transit; }

  private welcome(c: Conn, pid: number): void {
    this.sendJson(c, { t: 'welcome', v: PROTOCOL_VERSION, you: pid, city: this.world.key, session: this.id, tick: this.sim.tick, hz: SIM_HZ, time: this.clock.now(), scale: this.clock.scale });
    this.sendJson(c, { t: 'doors', s: this.world.interiors.doorStates(), all: true });
    this.sendJson(c, { t: 'interiors', on: this.world.interiors.enabled });
  }

  get full(): boolean { return this.clients.size >= this.opt.maxPlayers; }

  // ---------- połączenia ----------
  join(conn: Conn, name: string, at?: { x: number; y: number; z: number; yaw: number; money?: number }): number | null {
    if (this.full) { this.sendJson(conn, { t: 'error', text: 'Sesja jest pełna' }); conn.close(); return null; }
    let nick = clean(name, 20) || 'Gracz', k = 2;
    const taken = new Set([...this.sim.players.values()].map(p => p.name));
    while (taken.has(nick)) nick = `${clean(name, 17) || 'Gracz'}#${k++}`;
    const p = this.sim.addPlayer(nick, at); if (at?.money != null && Number.isFinite(at.money)) p.money = at.money;
    this.clients.set(p.id, { conn, player: p, meSig: '', inputs: [], ack: 0, credit: 1, sent: new Map(), bytes: 0, chat: [] });
    this.welcome(conn, p.id);
    if (!this.opt.local) this.broadcast({ t: 'chat', from: '', color: p.color, text: `${nick} dołącza do gry`, sys: true });
    this.playersSig = '';
    return p.id;
  }

  leave(pid: number): void {
    const c = this.clients.get(pid); if (!c) return;
    const w = this.sim.entity(c.player.walker); this.onLeave(c.player, { x: w.x, y: w.y, z: w.z, yaw: w.yaw, money: c.player.money });
    this.clients.delete(pid); this.sim.removePlayer(pid);
    if (!this.opt.local) this.broadcast({ t: 'chat', from: '', color: c.player.color, text: `${c.player.name} opuszcza grę`, sys: true });
    this.playersSig = '';
  }

  message(pid: number, data: ArrayBuffer | string): void {
    const c = this.clients.get(pid); if (!c) return;
    if (typeof data !== 'string') {
      if (data.byteLength === 13 && new DataView(data).getUint8(0) === MSG_INPUT) {
        const m = decodeInput(data); if (m.seq > c.ack) { c.inputs.push(m); if (c.inputs.length > MAX_QUEUE) c.inputs.shift(); }
      }
      return;
    }
    let m: ClientMsg; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'cmd' && m.c && typeof m.c === 'object') this.command(c, m.c);
    else if (m.t === 'chat' && typeof m.text === 'string') this.chat(c, m.text);
    else if (m.t === 'pm' && Number.isInteger(m.to)) this.pm(c, m);
    else if (m.t === 'job' && Number.isInteger(m.id) && (m.act === 'accept' || m.act === 'decline')) this.jobs.answer(c.player.id, m.id, m.act);
    else if (m.t === 'save' && this.opt.local) this.sendJson(c.conn, { t: 'saved', data: this.sim.serialize() });
    else if (m.t === 'load' && this.opt.local) this.loadState(c, m.data);
    else if (m.t === 'setTime' && this.opt.local) this.setTime(m.sec, m.scale);
    else if (m.t === 'setInteriors' && (this.opt.local || this.opt.dev)) { // serwer testowy: świat z wnętrzami albo bez (pomiar wydajności)
      const on = !!m.on; this.sim.setInteriors(on);
      if (!this.opt.local) { this.broadcast({ t: 'interiors', on }); this.broadcast({ t: 'chat', from: '', color: c.player.color, text: `${c.player.name} ${on ? 'włącza' : 'wyłącza'} wnętrza budynków`, sys: true }); }
    }
    else if (m.t === 'setTraffic' && (this.opt.local || this.opt.dev)) { // serwer testowy: limity ruchu z suwaków (pomiar wydajności)
      this.sim.setTrafficLimits(+m.cars, +m.peds);
      if (!this.opt.local) { const t = this.sim.traffic?.maxPerPlayer ?? Math.max(0, Math.min(500, Math.round(+m.cars))), q = this.sim.peds?.max ?? Math.max(0, Math.min(400, Math.round(+m.peds))); this.broadcast({ t: 'chat', from: '', color: c.player.color, text: `${c.player.name} ustawia ruch: auta ${t}, piesi ${q} na gracza`, sys: true }); }
    }
  }

  private command(c: Client, cmd: Command): void {
    let msg: string | undefined;
    if (cmd.type === 'mode' && ['walk', 'car', 'heli'].includes(cmd.mode)) msg = this.sim.command(c.player.id, cmd);
    else if (cmd.type === 'enter' || cmd.type === 'alight' || cmd.type === 'kick') msg = this.sim.command(c.player.id, { type: cmd.type });
    else if (cmd.type === 'buyCar') msg = this.sim.command(c.player.id, { type: 'buyCar', v: Number(cmd.v) });
    else if (cmd.type === 'shopBuy') msg = this.sim.command(c.player.id, { type: 'shopBuy', poi: Number(cmd.poi), item: Number(cmd.item) });
    else if (cmd.type === 'marketBuy') msg = this.sim.command(c.player.id, { type: 'marketBuy', id: String(cmd.id).slice(0, 40) });
    else if (cmd.type === 'rereg') msg = this.sim.command(c.player.id, { type: 'rereg' });
    else if (cmd.type === 'cab') msg = this.sim.command(c.player.id, { type: 'cab', on: !!cmd.on });
    else if (cmd.type === 'taxi') msg = this.sim.command(c.player.id, cmd.cancel ? { type: 'taxi', cancel: true } : { type: 'taxi', x: Number(cmd.x), z: Number(cmd.z) });
    else if (cmd.type === 'teleport' && (this.opt.local || this.opt.dev) && Number.isFinite(cmd.x) && Number.isFinite(cmd.z)) msg = this.sim.command(c.player.id, { type: 'teleport', x: cmd.x, z: cmd.z });
    else if (cmd.type === 'spawnAt' && Number.isInteger(cmd.i)) msg = this.sim.command(c.player.id, { type: 'spawnAt', i: cmd.i });
    else if (cmd.type === 'goStation' && Number.isInteger(cmd.station)) msg = this.sim.command(c.player.id, { type: 'goStation', station: cmd.station, street: !!cmd.street });
    if (msg) this.sendJson(c.conn, { t: 'chat', from: '', color: '#ffcc33', text: msg, sys: true });
  }

  /** Zegar gry: godzina lokalna (sekundy od północy, dziś) i skala czasu. */
  setTime(sec: number | null, scale: number): void {
    const sc = Math.max(0, Math.min(3600, scale || 1)); let now = this.clock.now();
    if (sec != null && this.transit) { const lt = this.transit.local(now); now += (sec - lt.sec) * 1000; }
    this.clock.set(now, sc); this.broadcast({ t: 'time', time: this.clock.now(), scale: sc });
  }

  private chat(c: Client, text: string): void {
    const t = clean(text, 200); if (!t) return;
    const now = this.now(); c.chat = c.chat.filter(x => now - x < 5000);
    if (c.chat.length >= 5) { this.sendJson(c.conn, { t: 'chat', from: '', color: '#ff6b6b', text: 'Za dużo wiadomości, zwolnij.', sys: true }); return; }
    c.chat.push(now); this.broadcast({ t: 'chat', from: c.player.name, color: c.player.color, text: t });
  }

  /** Telefon: wiadomość do gracza, do wszystkich albo do NPC (zlecenia); limit jak na czacie, zdjęcie do ok. 60 kB. */
  private pm(c: Client, m: { to: number; text?: string; loc?: [number, number]; img?: string }): void {
    const now = this.now(); c.chat = c.chat.filter(x => now - x < 5000);
    if (c.chat.length >= 6) return; c.chat.push(now);
    const text = typeof m.text === 'string' ? clean(m.text, 500) : undefined;
    const loc = Array.isArray(m.loc) && m.loc.length === 2 && m.loc.every(Number.isFinite) ? [Math.round(m.loc[0] * 10) / 10, Math.round(m.loc[1] * 10) / 10] as [number, number] : undefined;
    const img = typeof m.img === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.img) && m.img.length < 62_000 ? m.img : undefined;
    if (!text && !loc && !img) return;
    if (m.to < 0) { if (text) this.jobs.reply(c.player.id, m.to, text); return; }
    const out: ServerMsg = { t: 'pm', from: c.player.id, name: c.player.name, color: c.player.color, to: m.to, at: now, ...(text ? { text } : {}), ...(loc ? { loc } : {}), ...(img ? { img } : {}) };
    if (m.to === 0) { for (const o of this.clients.values()) if (o !== c) this.sendJson(o.conn, out); return; }
    const o = this.clients.get(m.to); if (o && o !== c) this.sendJson(o.conn, out);
  }

  private loadState(c: Client, s: SaveState): void {
    try {
      this.sim.load(s);
      // gracz lokalny przejmuje pierwszego gracza z zapisu
      const p = [...this.sim.players.values()][0]; if (!p) return;
      this.clients.delete(c.player.id); c.player = p; c.inputs = []; c.sent.clear(); this.clients.set(p.id, c);
      this.welcome(c.conn, p.id);
      this.playersSig = '';
    } catch (e) { this.sendJson(c.conn, { t: 'error', text: (e as Error).message }); }
  }

  // ---------- krok ----------
  tick(): void {
    const t0 = this.now();
    // jeden krok gracza na jedno jego wejście (przewidywanie klienta zgadza się co do kroku);
    // brak wejścia = brak kroku; spóźnione wejścia nadrabiane, ale średnio nie szybciej niż serwer
    for (const c of this.clients.values()) {
      c.credit = Math.min(MAX_CREDIT, c.credit + 1);
      while (c.inputs.length && c.credit >= 1) { const m = c.inputs.shift()!; c.credit--; c.ack = m.seq; this.sim.stepPlayer(c.player.id, m.cmd); }
    }
    this.sim.endStep();
    if (this.sim.traffic) { const now = this.clock.now(), lt = localTime(now, CITY_TZ[this.world.key] ?? 'UTC'); this.sim.stepTraffic(now / 1000, lt.sec / 3600); }
    if (this.sim.tick % 15 === 0) this.streamTiles();
    if (this.sim.tick % SIM_HZ === 0) this.jobs.step([...this.clients.keys()]);
    this.sendPlayers();
    this.sendMe();
    if (this.sim.tick % (SIM_HZ * 10) === 0) this.broadcast({ t: 'time', time: this.clock.now(), scale: this.clock.scale });
    if (this.sim.tick % this.opt.snapEvery === 0) this.sendSnapshots();
    const dt = this.now() - t0, T = this.timing;
    T.sum += dt; T.n++; T.max = Math.max(T.max, dt);
    if (t0 - T.since >= 2000) {
      const sec = (t0 - T.since) / 1000 || 1;
      this.stats = {
        players: this.clients.size, entities: this.sim.entities.size, tiles: this.world.tiles.size, tick: this.sim.tick,
        tickMs: T.sum / Math.max(1, T.n), tickMsMax: T.max, bytesPerClientPerSec: T.bytes / sec / Math.max(1, this.clients.size),
      };
      this.timing = { sum: 0, n: 0, max: 0, bytes: 0, since: t0 };
      // gra jednoosobowa: statystyki symulacji do licznika wydajności
      if (this.opt.local || this.opt.dev) this.broadcast({ t: 'stats', tickMs: this.stats.tickMs, tickMsMax: this.stats.tickMsMax, entities: this.sim.entities.size,
        cars: (this.sim.traffic?.cars.size ?? 0) + (this.sim.traffic?.parked.size ?? 0), peds: this.sim.peds?.peds.size ?? 0, police: this.sim.rules?.police.units.length ?? 0, interiors: this.world.interiors.live.size });
    }
  }

  /** Kafelki (kolizje) wokół graczy: ładowanie w promieniu 700 m, zwalnianie poza 1500 m. */
  private streamTiles(): void {
    if (!this.tiles) return;
    const pts = [...this.clients.values()].map(c => this.sim.entity(c.player.walker));
    const near = (k: string, r: number) => { const [x, y] = k.split('_').map(Number); return pts.some(p => {
      const dx = Math.max(0, Math.abs((x + .5) * TILE_SIZE - p.x) - TILE_SIZE / 2), dz = Math.max(0, Math.abs((y + .5) * TILE_SIZE - p.z) - TILE_SIZE / 2); return Math.hypot(dx, dz) <= r; }); };
    for (const p of pts) {
      const R = 2, cx = Math.floor(p.x / TILE_SIZE), cz = Math.floor(p.z / TILE_SIZE);
      for (let i = cx - R; i <= cx + R; i++) for (let j = cz - R; j <= cz + R; j++) {
        const k = tileKey(i, j);
        if (this.world.tiles.has(k) || this.loadingTiles.has(k) || this.loadingTiles.size >= 4 || !this.tiles.has(i, j) || !near(k, 700)) continue;
        this.loadingTiles.add(k);
        this.tiles.load(i, j).then(t => { this.loadingTiles.delete(k); if (t && near(k, 1500)) this.world.addTile(t); }, () => this.loadingTiles.delete(k));
      }
    }
    for (const k of [...this.world.tiles.keys()]) if (!near(k, 1500)) this.world.removeTile(k);
  }

  /** Własny stan gracza (tylko przy zmianie) i zdarzenia (przestępstwa, zatrzymania, śmierć). */
  private sendMe(): void {
    const R = this.sim.rules;
    for (const c of this.clients.values()) {
      const p = c.player, tx = this.sim.taxi?.info(p.id) ?? null, cab = this.sim.cab?.info(p.id) ?? null, veh = p.vehicle != null ? this.sim.entities.get(p.vehicle) : undefined;
      const legal = !!veh && veh.kind === 'car' && veh.legal === p.id, owned = p.owned ?? [];
      const sig = `${Math.round(p.hp)}|${p.money.toFixed(2)}|${p.wanted}|${p.dead > 0}|${tx ? `${tx.st}:${tx.id}:${Math.round(tx.eta / 5)}:${tx.fare}` : ''}|${cab ? `${cab.st}:${cab.target}:${cab.pay}:${cab.earned}` : ''}|${legal}|${owned.join(',')}|${veh?.kind ?? ''}|${this.sim.market?.sold.size ?? 0}|${JSON.stringify(p.inv ?? {})}`;
      if (sig !== c.meSig) { c.meSig = sig; this.sendJson(c.conn, { t: 'me', hp: Math.round(p.hp), money: p.money, wanted: p.wanted, dead: p.dead > 0, cur: R?.money.cur ?? 'zł', taxi: tx, cab, legal, owned, sold: [...(this.sim.market?.sold ?? [])].slice(-60), inv: p.inv ?? {} }); }
    }
    if (this.sim.doorEvents.length) this.broadcast({ t: 'doors', s: this.sim.doorEvents.splice(0) });
    if (R) for (const e of R.events.splice(0)) { const c = this.clients.get(e.pid); if (c) this.sendJson(c.conn, { t: 'event', text: e.text, kind: e.kind }); }
  }

  private sendPlayers(): void {
    const list = [...this.sim.players.values()].map(playerInfo), sig = JSON.stringify(list);
    if (sig === this.playersSig) return; this.playersSig = sig;
    this.broadcast({ t: 'players', list });
  }

  private sendSnapshots(): void {
    this.q.clear();
    const Q = (id: number) => { let q = this.q.get(id); if (!q) { q = quantize(this.sim.entity(id)); this.q.set(id, q); } return q; };
    for (const c of this.clients.values()) {
      const me = this.sim.entity(c.player.walker), heli = c.player.vehicle != null && this.sim.entity(c.player.vehicle).kind === 'heli';
      const R = this.opt.interest * (heli ? 2.5 : 1), ents: SnapshotEntity[] = [], seen = new Set<number>();
      for (const e of this.sim.entities.values()) {
        const mine = e.id === c.player.walker || e.id === c.player.vehicle;
        if (!mine && (Math.abs(e.x - me.x) > R || Math.abs(e.z - me.z) > R)) continue;
        seen.add(e.id);
        const q = Q(e.id), prev = c.sent.get(e.id); let mask = 0;
        for (let f = 0; f < NF; f++) if (!prev || prev[f] !== q[f]) mask |= 1 << f;
        if (mask) { ents.push({ id: e.id, mask, q }); c.sent.set(e.id, q); }
      }
      const removed: number[] = []; for (const id of c.sent.keys()) if (!seen.has(id)) removed.push(id);
      for (const id of removed) c.sent.delete(id);
      const buf = encodeSnapshot(this.sim.tick, c.ack, ents, removed);
      c.conn.send(buf); c.bytes += buf.byteLength; this.timing.bytes += buf.byteLength;
    }
  }

  private sendJson(conn: Conn, m: ServerMsg): void { const s = JSON.stringify(m); conn.send(s); this.timing.bytes += s.length; }
  broadcast(m: ServerMsg): void { const s = JSON.stringify(m); for (const c of this.clients.values()) { c.conn.send(s); this.timing.bytes += s.length; } }
}
