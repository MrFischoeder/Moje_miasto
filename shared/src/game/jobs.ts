// Zlecenia od NPC przez telefon: oferta w wiadomości (przyjmij / odrzuć), cel(e) na mapie, nagroda po dotarciu.
// Działa po stronie serwera (pokój gry), tak samo w grze jedno- i wieloosobowej.
import type { ServerMsg } from '../net/protocol';
import type { World } from '../world/world';

export interface NpcContact { id: number; name: string; color: string }
/** kontakty NPC (identyfikatory ujemne, żeby nie myliły się z graczami) */
export const NPCS: NpcContact[] = [
  { id: -1, name: 'Mietek (spedycja)', color: '#f4a261' },
  { id: -2, name: 'Pani Halina', color: '#e76f51' },
  { id: -3, name: 'Szef', color: '#2a9d8f' },
  { id: -4, name: 'Kurier Expres', color: '#e9c46a' },
];

type XZ = [number, number];
interface Job { id: number; pid: number; npc: NpcContact; kind: 'kurier' | 'dostawa'; pts: XZ[]; names: string[]; stage: number; reward: number; state: 'offer' | 'active'; until: number }

export interface JobsHost {
  world: World;
  pos(pid: number): { x: number; z: number } | null;
  send(pid: number, msg: ServerMsg): void;
  /** wypłata nagrody, zwraca walutę */
  pay(pid: number, amount: number): string;
  now(): number;
}

const R = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(l: T[]) => l[Math.floor(Math.random() * l.length)];

export class Jobs {
  private jobs = new Map<number, Job>();
  private next = new Map<number, number>();
  private seq = 1;
  constructor(private h: JobsHost) {}

  /** co sekundę: nowe oferty, wygasanie ofert, dotarcie do celu */
  step(pids: number[]): void {
    const now = this.h.now();
    for (const pid of pids) {
      const j = [...this.jobs.values()].find(q => q.pid === pid), me = this.h.pos(pid); if (!me) continue;
      if (!this.next.has(pid)) this.next.set(pid, now + 20_000);
      if (!j) { if (now > this.next.get(pid)!) this.offer(pid, me); continue; }
      if (j.state === 'offer') { if (now > j.until) { this.jobs.delete(j.id); this.next.set(pid, now + R(40_000, 80_000)); } continue; }
      const t = j.pts[j.stage];
      if (Math.hypot(me.x - t[0], me.z - t[1]) < 18) {
        j.stage++;
        if (j.stage < j.pts.length) this.msg(j, `Mam info, że paczka odebrana. Teraz wieź ją na: ${j.names[j.stage]}.`, j.pts[j.stage], 'active');
        else {
          const cur = this.h.pay(pid, j.reward);
          this.msg(j, `Dzięki, robota wykonana! Przelałem ${j.reward} ${cur}.`, undefined, 'done');
          this.jobs.delete(j.id); this.next.set(pid, now + R(45_000, 90_000));
        }
      }
    }
    for (const j of [...this.jobs.values()]) if (!pids.includes(j.pid)) this.jobs.delete(j.id);
  }

  /** odpowiedź gracza na zlecenie (przycisk albo wiadomość „tak” / „nie” do NPC) */
  answer(pid: number, id: number | null, act: 'accept' | 'decline', npc?: number): void {
    const j = [...this.jobs.values()].find(q => q.pid === pid && q.state === 'offer' && (id == null || q.id === id) && (npc == null || q.npc.id === npc)); if (!j) return;
    if (act === 'decline') { this.msg(j, 'Szkoda. Odezwę się z czymś innym.', undefined, 'cancel'); this.jobs.delete(j.id); this.next.set(pid, this.h.now() + R(40_000, 80_000)); return; }
    j.state = 'active';
    this.msg(j, j.kind === 'kurier' ? `Super. Odbiór paczki: ${j.names[0]}. Lokalizacja poniżej.` : `Dobra, czekam na: ${j.names[0]}.`, j.pts[0], 'active');
  }

  /** wiadomość tekstowa do NPC: tak / nie albo uprzejma odpowiedź */
  reply(pid: number, npc: number, text: string): void {
    const t = text.trim().toLowerCase(), c = NPCS.find(n => n.id === npc); if (!c) return;
    if (/^(tak|ok|okej|dobra|biorę|biore|przyjmuję|przyjmuje|jasne)/.test(t)) return this.answer(pid, null, 'accept', npc);
    if (/^(nie|odpada|pas)/.test(t)) return this.answer(pid, null, 'decline', npc);
    const j = [...this.jobs.values()].find(q => q.pid === pid && q.npc.id === npc);
    this.h.send(pid, { t: 'pm', from: c.id, name: c.name, color: c.color, to: pid, at: this.h.now(), text: j ? 'Odpisz „tak” albo „nie”, albo użyj przycisków przy ofercie.' : 'Teraz nic nie mam. Odezwę się.' });
  }

  private offer(pid: number, me: { x: number; z: number }): void {
    const kurier = Math.random() < .6, n = kurier ? 2 : 1, pts: XZ[] = [], names: string[] = [];
    let from = me;
    for (let k = 0; k < n; k++) {
      const p = this.target(from, k === 0 ? 250 : 400, k === 0 ? 900 : 1400); if (!p) { this.next.set(pid, this.h.now() + 30_000); return; }
      pts.push([p.x, p.z]); names.push(p.name); from = p;
    }
    const dist = Math.hypot(pts[0][0] - me.x, pts[0][1] - me.z) + (n > 1 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : 0);
    const reward = Math.round((30 + dist * .06) / 5) * 5, npc = pick(kurier ? [NPCS[0], NPCS[3]] : [NPCS[1], NPCS[2]]);
    const j: Job = { id: this.seq++, pid, npc, kind: kurier ? 'kurier' : 'dostawa', pts, names, stage: 0, reward, state: 'offer', until: this.h.now() + 120_000 };
    this.jobs.set(j.id, j);
    const text = kurier ? `Cześć! Mam paczkę do przewiezienia: odbiór ${names[0]}, dostawa ${names[1]}. Płacę ${reward}. Bierzesz?`
      : pick([`Potrzebuję kogoś pilnie na ${names[0]}. ${reward} za fatygę. Pomożesz?`, `Mam sprawę: podjedź na ${names[0]}, tam ktoś na ciebie czeka. ${reward} na rękę. Wchodzisz w to?`]);
    this.msg(j, text, undefined, 'offer');
  }

  /** losowy punkt na ulicy z nazwą w odległości [d0, d1] od punktu (z wczytanych kafli) */
  private target(from: { x: number; z: number }, d0: number, d1: number): { x: number; z: number; name: string } | null {
    const cand: { x: number; z: number; name: string }[] = [];
    for (const t of this.h.world.tiles.values()) for (const r of t.r) {
      if (!r.n || r.br || r.tu || ['footway', 'path', 'steps', 'cycleway'].includes(r.k)) continue;
      const i = 2 * Math.floor(Math.random() * (r.p.length / 2)), x = r.p[i], z = r.p[i + 1], d = Math.hypot(x - from.x, z - from.z);
      if (d >= d0 && d <= d1) cand.push({ x, z, name: r.n });
    }
    return cand.length ? pick(cand) : null;
  }

  private msg(j: Job, text: string, loc: XZ | undefined, state: 'offer' | 'active' | 'done' | 'cancel'): void {
    this.h.send(j.pid, { t: 'pm', from: j.npc.id, name: j.npc.name, color: j.npc.color, to: j.pid, at: this.h.now(), text, ...(loc ? { loc } : {}),
      job: { id: j.id, state, reward: j.reward, ...(state === 'active' && j.stage < j.pts.length ? { target: j.pts[j.stage] } : {}) } });
  }
}
