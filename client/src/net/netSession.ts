// Sesja sieciowa klienta: wysyła tylko polecenia wejścia, przewiduje ruch własnego bytu
// (ten sam kod kroku co serwer), koryguje po migawce (powtórka niepotwierdzonych wejść)
// i interpoluje cudze byty ~100 ms w przeszłości. Transport: Worker (gra jednoosobowa) albo WebSocket.
import { SIM_DT, SIM_HZ } from '@miasto/shared/sim/loop';
import { stepEntity } from '@miasto/shared/sim/sim';
import type { Command, Entity, InputCmd, SaveState } from '@miasto/shared/sim/types';
import type { World } from '@miasto/shared/world/world';
import {
  applyQ, decodeSnapshot, emptyEntity, encodeInput, MSG_SNAPSHOT, quantizeInput,
  type ClientMsg, type PlayerInfo, type QState, type ServerMsg,
} from '@miasto/shared/net/protocol';
import type { Transport } from './transport';
import { GameClock } from '@miasto/shared/transit/clock';

type Pose = Pick<Entity, 'x' | 'y' | 'z' | 'yaw'>;
interface Sample { t: number; e: Entity }

const INTERP_TICKS = 3; // ~100 ms przy 30 Hz
const copy = (e: Entity): Entity => ({ ...e, pass: e.pass.slice() });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpA = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export interface ChatLine { from: string; color: string; text: string; sys?: boolean; at: number }

export class NetSession {
  playerId = 0;
  city = '';
  sessionId = '';
  readonly players = new Map<number, PlayerInfo>();
  /** zegar gry zsynchronizowany z serwerem */
  readonly clock = new GameClock();
  /** stan do renderowania (przewidziany albo interpolowany) */
  private view = new Map<number, Entity>();
  private prevPred: Pose | null = null;
  private pred: Entity | null = null;
  private history: { seq: number; cmd: InputCmd }[] = [];
  private seq = 0;
  private acc = 0;
  private input: InputCmd = { f: 0, s: 0, run: false, brake: false, lift: 0, yaw: 0, pitch: 0 };
  private qprev = new Map<number, QState>();
  private samples = new Map<number, Sample[]>();
  private serverTick = 0; private recvAt = 0;
  /** błąd korekty do wygaszenia (płynne poprawki zamiast skoków) */
  private err = { x: 0, y: 0, z: 0 };
  private savedWait: ((s: SaveState) => void) | null = null;
  ready: Promise<void>;
  private readyRes!: () => void;
  /** własny stan z serwera: zdrowie, pieniądze, gwiazdki */
  readonly me = { hp: 100, money: 0, wanted: 0, dead: false, cur: 'zł' };
  onEvent: (text: string, kind: 'crime' | 'arrest' | 'death' | 'info') => void = () => {};
  /** serwer zmienił tryb wnętrz (gra sieciowa) */
  onInteriors: (on: boolean) => void = () => {};
  onChat: (l: ChatLine) => void = () => {};
  /** wiadomości telefonu (gracze, NPC, zlecenia) */
  onPm: (m: Extract<ServerMsg, { t: 'pm' }>) => void = () => {};
  onPlayers: () => void = () => {};
  onError: (text: string) => void = () => {};
  onClose: () => void = () => {};
  /** statystyki: bajty odebrane, korekty */
  readonly net = { bytesIn: 0, bytesOut: 0, corrections: 0, rtt: 0, maxErr: 0, sumErr: 0, nErr: 0 };

  constructor(readonly world: World, private tr: Transport) {
    this.ready = new Promise(r => { this.readyRes = r; });
    tr.onMessage = d => this.receive(d);
    tr.onClose = () => this.onClose();
  }

  // ---------- wysyłanie ----------
  sendInput(cmd: InputCmd): void { this.input = cmd; }
  sendCommand(c: Command): void { this.json({ t: 'cmd', c }); }
  chat(text: string): void { this.json({ t: 'chat', text }); }
  pm(to: number, body: { text?: string; loc?: [number, number]; img?: string }): void { this.json({ t: 'pm', to, ...body }); }
  jobAnswer(id: number, act: 'accept' | 'decline'): void { this.json({ t: 'job', id, act }); }
  private json(m: ClientMsg): void { const s = JSON.stringify(m); this.net.bytesOut += s.length; this.tr.send(s); }

  save(): Promise<SaveState> { return new Promise(res => { this.savedWait = res; this.json({ t: 'save' }); }); }
  load(s: SaveState): void { this.json({ t: 'load', data: s }); }
  close(): void { this.tr.close(); }
  /** gra jednoosobowa: godzina (sekundy od północy) i tempo czasu */
  setTime(sec: number | null, scale: number): void { this.json({ t: 'setTime', sec, scale }); }
  /** gra jednoosobowa: wnętrza budynków włączone / wyłączone */
  setInteriors(on: boolean): void { this.json({ t: 'setInteriors', on }); }
  /** gra jednoosobowa: limity aut i pieszych NPC */
  setTraffic(cars: number, peds: number): void { this.json({ t: 'setTraffic', cars, peds }); }
  /** statystyki lokalnego serwera (gra jednoosobowa), co 2 s */
  serverStats: { tickMs: number; tickMsMax: number; entities: number; cars: number; peds: number; police: number; interiors: number } | null = null;

  // ---------- odbiór ----------
  private receive(d: ArrayBuffer | string): void {
    if (typeof d === 'string') {
      this.net.bytesIn += d.length;
      let m: ServerMsg; try { m = JSON.parse(d); } catch { return; }
      if (m.t === 'welcome') {
        this.clock.set(m.time, m.scale);
        this.playerId = m.you; this.city = m.city; this.sessionId = m.session; this.serverTick = m.tick; this.recvAt = performance.now();
        this.pred = null; this.history = []; this.view.clear(); this.qprev.clear(); this.samples.clear(); this.readyRes();
      } else if (m.t === 'players') { this.players.clear(); for (const p of m.list) this.players.set(p.id, p); this.onPlayers(); }
      else if (m.t === 'chat') this.onChat({ ...m, at: performance.now() });
      else if (m.t === 'pm') this.onPm(m);
      else if (m.t === 'time') this.clock.set(m.time, m.scale);
      else if (m.t === 'me') Object.assign(this.me, { hp: m.hp, money: m.money, wanted: m.wanted, dead: m.dead, cur: m.cur });
      else if (m.t === 'event') this.onEvent(m.text, m.kind);
      else if (m.t === 'interiors') { this.world.interiors.setEnabled(m.on); this.onInteriors(m.on); }
      else if (m.t === 'doors') { const I = this.world.interiors; if (m.all) I.resetDoors(); for (const [id, code] of m.s) I.setDoor(id, typeof code === 'boolean' ? (code ? 1 : 0) : code); }
      else if (m.t === 'stats') { const { t: _t, ...rest } = m; void _t; this.serverStats = rest; }
      else if (m.t === 'saved') { this.savedWait?.(m.data); this.savedWait = null; }
      else if (m.t === 'error') this.onError(m.text);
      return;
    }
    this.net.bytesIn += d.byteLength;
    if (new DataView(d).getUint8(0) !== MSG_SNAPSHOT) return;
    const s = decodeSnapshot(d, this.qprev);
    this.serverTick = s.tick; this.recvAt = performance.now();
    for (const id of s.removed) { this.view.delete(id); this.samples.delete(id); }
    for (const { id, q } of s.ents) {
      const e = emptyEntity(id); applyQ(e, q);
      let l = this.samples.get(id); if (!l) this.samples.set(id, l = []);
      l.push({ t: s.tick, e }); if (l.length > 8) l.shift();
    }
    // byty bez zmian też mają próbkę w tej chwili (stoją)
    for (const [id, l] of this.samples) if (l[l.length - 1].t < s.tick && !s.removed.includes(id)) { const e = l[l.length - 1].e; l.push({ t: s.tick, e }); if (l.length > 8) l.shift(); }
    this.reconcile(s.ack);
  }

  /** Własny byt: stan serwera + powtórka niepotwierdzonych wejść. */
  private reconcile(ack: number): void {
    const me = this.drivenId(); if (me == null) { this.pred = null; return; }
    const l = this.samples.get(me); if (!l) return;
    const server = copy(l[l.length - 1].e);
    this.history = this.history.filter(h => h.seq > ack);
    const before = this.pred && this.pred.id === me ? { x: this.pred.x, y: this.pred.y, z: this.pred.z } : null;
    for (const h of this.history) stepEntity(server, h.cmd, SIM_DT, this.world);
    if (before) {
      const dx = before.x - server.x, dy = before.y - server.y, dz = before.z - server.z, d = Math.hypot(dx, dy, dz);
      if (d < 8) { this.net.maxErr = Math.max(this.net.maxErr, d); this.net.sumErr += d; this.net.nErr++; }
      if (d > .01 && d < 8) { this.err.x += dx; this.err.y += dy; this.err.z += dz; this.net.corrections++; }
      else if (d >= 8) this.err = { x: 0, y: 0, z: 0 }; // skok (teleport) bez wygładzania
    }
    this.pred = server;
  }

  /** Byt, którym gracz steruje (null, gdy pasażer albo przed dołączeniem). */
  private drivenId(): number | null {
    const p = this.players.get(this.playerId); if (!p || p.passenger || p.ride) return null;
    return p.vehicle ?? p.walker;
  }

  /** Posuwa czas: kroki przewidywania (SIM_HZ) i interpolacja cudzych bytów. Zwraca alpha dla własnego bytu. */
  advance(seconds: number): number {
    this.acc += Math.min(seconds, .25);
    const me = this.drivenId();
    if (me != null && this.pred && this.pred.id !== me) this.pred = null;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const cmd = quantizeInput(this.input); this.seq++;
      const buf = encodeInput(this.seq, cmd); this.net.bytesOut += buf.byteLength; this.tr.send(buf);
      if (me != null) {
        this.history.push({ seq: this.seq, cmd }); if (this.history.length > 120) this.history.shift();
        if (this.pred) { this.prevPred = { x: this.pred.x, y: this.pred.y, z: this.pred.z, yaw: this.pred.yaw }; stepEntity(this.pred, cmd, SIM_DT, this.world); }
      }
    }
    // wygaszanie błędu korekty (~150 ms)
    const k = Math.exp(-seconds / .15); this.err.x *= k; this.err.y *= k; this.err.z *= k;
    // interpolacja cudzych bytów
    const rt = this.serverTick + (performance.now() - this.recvAt) / 1000 * SIM_HZ - INTERP_TICKS;
    this.view.clear();
    for (const [id, l] of this.samples) {
      let a = l[0], b = l[l.length - 1];
      for (let i = 0; i < l.length - 1; i++) if (l[i].t <= rt && l[i + 1].t >= rt) { a = l[i]; b = l[i + 1]; break; }
      const t = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1, e = copy(b.e);
      e.x = lerp(a.e.x, b.e.x, t); e.y = lerp(a.e.y, b.e.y, t); e.z = lerp(a.e.z, b.e.z, t); e.yaw = lerpA(a.e.yaw, b.e.yaw, t);
      e.roll = lerp(a.e.roll, b.e.roll, t); e.tilt = lerp(a.e.tilt, b.e.tilt, t);
      this.view.set(id, e);
    }
    if (this.pred && me != null) {
      const p = copy(this.pred); p.x += this.err.x; p.y += this.err.y; p.z += this.err.z;
      this.view.set(me, p);
    }
    return this.acc / SIM_DT;
  }

  // ---------- dla gry ----------
  player(): PlayerInfo | null { return this.players.get(this.playerId) ?? null; }
  entities(): Iterable<Entity> { return this.view.values(); }
  entity(id: number): Entity | undefined { return this.view.get(id); }
  /** Stan sprzed ostatniego kroku przewidywania (tylko własny byt). */
  previous(id: number): Pose | undefined {
    if (!this.pred || id !== this.pred.id || !this.prevPred) return undefined;
    const p = this.prevPred; return { x: p.x + this.err.x, y: p.y + this.err.y, z: p.z + this.err.z, yaw: p.yaw };
  }
  isPredicted(id: number): boolean { return !!this.pred && this.pred.id === id; }
}
