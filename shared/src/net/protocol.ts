// Protokół sieciowy: binarnie wejście gracza i migawki stanu (tylko zmienione pola),
// JSON dla rzadkich komunikatów (dołączenie, lista graczy, czat, polecenia, zapis).
// Pozycje: liczby całkowite w centymetrach; kąty: int16 (pełny obrót = 65536).
import type { Command, Entity, EntityKind, InputCmd, PlayerState, SaveState } from '../sim/types';

export const PROTOCOL_VERSION = 1;
export const MSG_INPUT = 1, MSG_SNAPSHOT = 2;

// ---------- kwantyzacja ----------
const TAU = Math.PI * 2;
export const qPos = (v: number) => Math.round(v * 100);
export const dPos = (v: number) => v / 100;
export const qAng = (a: number) => { const t = ((a % TAU) + TAU) % TAU; return Math.round(t / TAU * 65536) & 0xffff; };
export const dAng = (q: number) => { const a = q / 65536 * TAU; return a > Math.PI ? a - TAU : a; };
/** małe kąty (przechyły, pochylenie kamery): 1/10000 rad */
export const qSmall = (a: number) => Math.max(-32768, Math.min(32767, Math.round(a * 10000)));
export const dSmall = (q: number) => q / 10000;
export const qVel = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 100)));
const q8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));

// ---------- wejście (klient -> serwer, co krok) ----------
export interface InputMsg { seq: number; cmd: InputCmd }

export function encodeInput(seq: number, c: InputCmd): ArrayBuffer {
  const b = new ArrayBuffer(13), v = new DataView(b);
  v.setUint8(0, MSG_INPUT); v.setUint32(1, seq >>> 0, true);
  v.setInt8(5, q8(c.f)); v.setInt8(6, q8(c.s)); v.setUint8(7, (c.run ? 1 : 0) | (c.brake ? 2 : 0)); v.setInt8(8, q8(c.lift));
  v.setUint16(9, qAng(c.yaw), true); v.setInt16(11, qSmall(c.pitch), true);
  return b;
}
export function decodeInput(b: ArrayBuffer): InputMsg {
  const v = new DataView(b), fl = v.getUint8(7);
  return { seq: v.getUint32(1, true), cmd: { f: v.getInt8(5) / 127, s: v.getInt8(6) / 127, run: !!(fl & 1), brake: !!(fl & 2), lift: v.getInt8(8) / 127, yaw: dAng(v.getUint16(9, true)), pitch: dSmall(v.getInt16(11, true)) } };
}
/** To samo wejście, które zobaczy serwer (klient przewiduje na skwantowanych wartościach). */
export const quantizeInput = (c: InputCmd): InputCmd => decodeInput(encodeInput(0, c)).cmd;

// ---------- stan bytu ----------
const KINDS: EntityKind[] = ['walker', 'car', 'heli'];
/** Pola bytu w kolejności bitów maski. */
export const FIELDS = ['kind', 'x', 'y', 'z', 'yaw', 'pitch', 'speed', 'vx', 'vy', 'vz', 'roll', 'tilt', 'reg', 'lift', 'driver', 'owner'] as const;
export const NF = FIELDS.length;
/** Skwantowany stan bytu (to, co porównujemy i wysyłamy). */
export type QState = Int32Array;

export function quantize(e: Entity, out: QState = new Int32Array(NF + 1)): QState {
  out[0] = KINDS.indexOf(e.kind) | (e.air ? 4 : 0) | (e.hide ? 8 : 0) | (Math.min(3, e.pass.length) << 4) | (e.npc ? 64 : 0) | (e.police ? 128 : 0);
  out[1] = qPos(e.x); out[2] = qPos(e.y); out[3] = qPos(e.z); out[4] = qAng(e.yaw); out[5] = qSmall(e.pitch);
  out[6] = qVel(e.speed); out[7] = qVel(e.vx); out[8] = qVel(e.vy); out[9] = qVel(e.vz); out[10] = qSmall(e.roll); out[11] = qSmall(e.tilt);
  out[12] = e.reg; out[13] = q8(e.lift); out[14] = e.driver ?? 0; out[15] = e.owner ?? 0;
  return out;
}
const SIZE = [1, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2];

/** Byt odtworzony po stronie klienta. */
export function applyQ(e: Entity, q: QState): void {
  e.kind = KINDS[q[0] & 3]; e.air = !!(q[0] & 4); e.hide = !!(q[0] & 8); e.npc = !!(q[0] & 64); e.police = !!(q[0] & 128);
  e.x = dPos(q[1]); e.y = dPos(q[2]); e.z = dPos(q[3]); e.yaw = dAng(q[4]); e.pitch = dSmall(q[5]);
  e.speed = q[6] / 100; e.vx = q[7] / 100; e.vy = q[8] / 100; e.vz = q[9] / 100; e.roll = dSmall(q[10]); e.tilt = dSmall(q[11]);
  e.reg = q[12]; e.lift = q[13] / 127; e.driver = q[14] || null; e.owner = q[15] || null;
}
export function emptyEntity(id: number): Entity {
  return { id, kind: 'walker', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, vx: 0, vy: 0, vz: 0, roll: 0, tilt: 0, reg: -1, air: false, lift: 0, driver: null, pass: [], hide: false, owner: null };
}

// ---------- migawka (serwer -> klient) ----------
export interface SnapshotEntity { id: number; mask: number; q: QState }
export interface Snapshot { tick: number; ack: number; ents: SnapshotEntity[]; removed: number[] }

/** Koduje migawkę: dla każdego bytu maska zmienionych pól względem poprzednio wysłanego stanu. */
export function encodeSnapshot(tick: number, ack: number, ents: SnapshotEntity[], removed: number[]): ArrayBuffer {
  let n = 1 + 4 + 4 + 2 + 2 + removed.length * 2;
  for (const e of ents) { n += 4; for (let f = 0; f < NF; f++) if (e.mask & (1 << f)) n += SIZE[f]; }
  const b = new ArrayBuffer(n), v = new DataView(b); let o = 0;
  v.setUint8(o, MSG_SNAPSHOT); o += 1; v.setUint32(o, tick, true); o += 4; v.setUint32(o, ack >>> 0, true); o += 4; v.setUint16(o, ents.length, true); o += 2;
  for (const e of ents) {
    v.setUint16(o, e.id, true); o += 2; v.setUint16(o, e.mask, true); o += 2;
    for (let f = 0; f < NF; f++) if (e.mask & (1 << f)) {
      const x = e.q[f];
      switch (SIZE[f]) { case 1: if (f === 0) v.setUint8(o, x); else v.setInt8(o, x); break; case 2: if (f === 4 || f === 14 || f === 15) v.setUint16(o, x, true); else v.setInt16(o, x, true); break; case 4: v.setInt32(o, x, true); break; }
      o += SIZE[f];
    }
  }
  v.setUint16(o, removed.length, true); o += 2; for (const id of removed) { v.setUint16(o, id, true); o += 2; }
  return b;
}

/** Dekoduje migawkę; prev = ostatni znany stan bytów (uzupełnia pola bez zmian). */
export function decodeSnapshot(b: ArrayBuffer, prev: Map<number, QState>): Snapshot {
  const v = new DataView(b); let o = 1;
  const tick = v.getUint32(o, true); o += 4; const ack = v.getUint32(o, true); o += 4; const n = v.getUint16(o, true); o += 2;
  const ents: SnapshotEntity[] = [];
  for (let i = 0; i < n; i++) {
    const id = v.getUint16(o, true); o += 2; const mask = v.getUint16(o, true); o += 2;
    const q = new Int32Array(prev.get(id) ?? new Int32Array(NF + 1));
    for (let f = 0; f < NF; f++) if (mask & (1 << f)) {
      switch (SIZE[f]) { case 1: q[f] = f === 0 ? v.getUint8(o) : v.getInt8(o); break; case 2: q[f] = (f === 4 || f === 14 || f === 15) ? v.getUint16(o, true) : v.getInt16(o, true); break; case 4: q[f] = v.getInt32(o, true); break; }
      o += SIZE[f];
    }
    prev.set(id, q); ents.push({ id, mask, q });
  }
  const nr = v.getUint16(o, true); o += 2; const removed: number[] = [];
  for (let i = 0; i < nr; i++) { const id = v.getUint16(o, true); o += 2; removed.push(id); prev.delete(id); }
  return { tick, ack, ents, removed };
}

// ---------- komunikaty JSON ----------
export interface PlayerInfo extends Pick<PlayerState, 'id' | 'name' | 'color' | 'walker' | 'vehicle' | 'passenger' | 'ride' | 'viewSeq' | 'viewYaw' | 'viewPitch' | 'wanted'> {}

export type ServerMsg =
  | { t: 'welcome'; v: number; you: number; city: string; session: string; tick: number; hz: number; time: number; scale: number }
  | { t: 'time'; time: number; scale: number }
  /** stan własnego gracza (wysyłany tylko jemu, przy zmianie) */
  | { t: 'me'; hp: number; money: number; wanted: number; dead: boolean; cur: string }
  /** zdarzenie na środku ekranu */
  | { t: 'event'; text: string; kind: 'crime' | 'arrest' | 'death' | 'info' }
  | { t: 'players'; list: PlayerInfo[] }
  | { t: 'chat'; from: string; color: string; text: string; sys?: boolean }
  | { t: 'saved'; data: SaveState }
  | { t: 'error'; text: string };

export type ClientMsg =
  | { t: 'cmd'; c: Command }
  | { t: 'chat'; text: string }
  | { t: 'save' }
  | { t: 'load'; data: SaveState }
  /** gra jednoosobowa: ustawienie zegara (godzina lokalna w sekundach od północy, skala) */
  | { t: 'setTime'; sec: number | null; scale: number };

export const playerInfo = (p: PlayerState): PlayerInfo => ({ id: p.id, name: p.name, color: p.color, walker: p.walker, vehicle: p.vehicle, passenger: p.passenger, ride: p.ride, wanted: p.wanted, viewSeq: p.viewSeq, viewYaw: p.viewYaw, viewPitch: p.viewPitch });
