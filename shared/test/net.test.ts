import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Room, type Conn } from '../src/server/room';
import { decodeInput, decodeSnapshot, encodeInput, applyQ, emptyEntity, MSG_SNAPSHOT, quantizeInput, type QState, type ServerMsg } from '../src/net/protocol';
import { NO_INPUT } from '../src/sim/types';

const world = new World('warszawa');

class Fake implements Conn {
  json: ServerMsg[] = []; snaps: ArrayBuffer[] = []; bytes = 0; closed = false;
  send(d: ArrayBuffer | string): void { if (typeof d === 'string') { this.json.push(JSON.parse(d)); this.bytes += d.length; } else { this.snaps.push(d); this.bytes += d.byteLength; } }
  close(): void { this.closed = true; }
}

describe('protokół', () => {
  it('wejście: 13 bajtów, kwantyzacja odwracalna', () => {
    const c = { f: .5, s: -1, run: true, brake: false, lift: 1, yaw: -2.5, pitch: .3 }, b = encodeInput(77, c);
    expect(b.byteLength).toBe(13);
    const m = decodeInput(b); expect(m.seq).toBe(77); expect(m.cmd.run).toBe(true);
    expect(m.cmd.f).toBeCloseTo(.5, 2); expect(m.cmd.yaw).toBeCloseTo(-2.5, 3); expect(m.cmd.pitch).toBeCloseTo(.3, 3);
    expect(quantizeInput(quantizeInput(c))).toEqual(quantizeInput(c));
  });
});

describe('pokój gry', () => {
  it('migawki: pełny stan na początku, potem tylko zmiany; potwierdzenie wejść', () => {
    const room = new Room('t', world, null, { snapEvery: 1 }), a = new Fake();
    const pid = room.join(a, 'Ala')!;
    expect(a.json[0]).toMatchObject({ t: 'welcome', you: pid, city: 'warszawa' });
    room.tick();
    const prev = new Map<number, QState>();
    const s1 = decodeSnapshot(a.snaps[0], prev);
    expect(new DataView(a.snaps[0]).getUint8(0)).toBe(MSG_SNAPSHOT);
    expect(s1.ents.length).toBe(1); expect(s1.ents[0].mask).toBe(0x1ffff); // 17 pól (z wariantem pojazdu)
    room.tick(); const s2 = decodeSnapshot(a.snaps[1], prev);
    expect(s2.ents.length).toBe(0); // nic się nie zmieniło
    room.message(pid, encodeInput(1, { ...NO_INPUT, f: 1, yaw: 0 })); room.tick();
    const s3 = decodeSnapshot(a.snaps[2], prev);
    expect(s3.ack).toBe(1); expect(s3.ents[0].mask & 0b1110).toBeTruthy(); // zmiana pozycji
    const e = emptyEntity(pid); applyQ(e, prev.get(pid)!);
    const w = room.sim.entity(pid); expect(e.x).toBeCloseTo(w.x, 1); expect(e.z).toBeCloseTo(w.z, 1);
  });

  it('zarządzanie zainteresowaniem: daleki gracz nie jest wysyłany', () => {
    const room = new Room('t', world, null, { snapEvery: 1, interest: 500 }), a = new Fake(), b = new Fake();
    const pa = room.join(a, 'A')!, pb = room.join(b, 'B')!;
    room.message(pb, JSON.stringify({ t: 'cmd', c: { type: 'goStation', station: 0, street: true } })); // Kabaty, ~12 km
    room.tick();
    const seen = decodeSnapshot(a.snaps[a.snaps.length - 1], new Map()).ents.map(e => e.id);
    expect(seen).toContain(pa); expect(seen).not.toContain(pb);
    expect(a.json.some(m => m.t === 'players' && m.list.length === 2)).toBe(true);
  });

  it('czat z limitem i sprzątaniem znaków sterujących; pełna sesja odrzuca', () => {
    const room = new Room('t', world, null, { maxPlayers: 1 }), a = new Fake(), b = new Fake();
    const pa = room.join(a, 'A')!;
    room.message(pa, JSON.stringify({ t: 'chat', text: 'cześć\u0007!' }));
    expect(a.json.find(m => m.t === 'chat' && !m.sys)).toMatchObject({ from: 'A', text: 'cześć!' });
    for (let i = 0; i < 8; i++) room.message(pa, JSON.stringify({ t: 'chat', text: 'x' + i }));
    expect(a.json.filter(m => m.t === 'chat' && !m.sys).length).toBe(5);
    expect(room.join(b, 'B')).toBeNull(); expect(b.closed).toBe(true);
    // zapis/wczytanie tylko w grze lokalnej
    room.message(pa, JSON.stringify({ t: 'save' })); expect(a.json.some(m => m.t === 'saved')).toBe(false);
  });
  it('telefon: wiadomość do gracza i do wszystkich, lokalizacja, zdjęcie z limitem, bez echa do nadawcy', () => {
    const room = new Room('t', world, null), a = new Fake(), b = new Fake(), c = new Fake();
    const pa = room.join(a, 'A')!, pb = room.join(b, 'B')!; room.join(c, 'C');
    room.message(pa, JSON.stringify({ t: 'pm', to: pb, text: 'hej', loc: [10.04, -5] }));
    const got = b.json.find(m => m.t === 'pm');
    expect(got).toMatchObject({ from: pa, name: 'A', to: pb, text: 'hej', loc: [10, -5] });
    expect(c.json.some(m => m.t === 'pm')).toBe(false); expect(a.json.some(m => m.t === 'pm')).toBe(false);
    room.message(pb, JSON.stringify({ t: 'pm', to: 0, text: 'do wszystkich' }));
    expect(a.json.filter(m => m.t === 'pm').length).toBe(1); expect(c.json.filter(m => m.t === 'pm').length).toBe(1);
    room.message(pa, JSON.stringify({ t: 'pm', to: pb, img: 'data:image/jpeg;base64,' + 'A'.repeat(70_000) })); // za duże: odrzucone
    room.message(pa, JSON.stringify({ t: 'pm', to: pb, img: 'javascript:alert(1)' }));
    expect(b.json.filter(m => m.t === 'pm').length).toBe(1);
  });
});

import { cellCenter, cellName, colName, gridOf, parsePlace, unprojPoint } from '../src/data/grid';
import { CITIES } from '../src/data/cities';
import { makeProj } from '../src/data/projection';
describe('współrzędne i siatka mapy', () => {
  it('kratki, litery kolumn, odwrotna projekcja, wpisane miejsca', () => {
    expect([colName(0), colName(25), colName(26), colName(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
    const c = CITIES.wroclaw, g = gridOf(c), pr = makeProj(c.o);
    const [x, z] = pr(51.1097, 17.0328), ll = unprojPoint(c.o, x, z);
    expect(Math.abs(ll[0] - 51.1097) + Math.abs(ll[1] - 17.0328)).toBeLessThan(1e-9);
    const n = cellName(g, x, z), cc = cellCenter(g, n)!;
    expect(Math.abs(cc[0] - x)).toBeLessThanOrEqual(250); expect(Math.abs(cc[1] - z)).toBeLessThanOrEqual(250);
    expect(cellName(g, g.x0 + 1, g.z0 + 1)).toBe('A1');
    expect(parsePlace(c, g, n.toLowerCase())).toEqual(cc);
    const p2 = parsePlace(c, g, '51,1097; 17,0328')!; expect(Math.hypot(p2[0] - x, p2[1] - z)).toBeLessThan(.01);
    expect(parsePlace(c, g, 'coś')).toBeNull();
  });
});
