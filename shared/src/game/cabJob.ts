// Praca jako kierowca taksówki (legalnym autem gracza): klient czeka przy ulicy w pobliżu, gracz podjeżdża
// i zatrzymuje się obok (klient wsiada), wiezie go do celu i dostaje zapłatę (stawka za km + napiwek za szybki kurs).
// Kolejne zlecenie po kilku sekundach; praca kończy się po wyjściu z auta albo wyłączeniu w telefonie.
import type { Entity, PlayerState } from '../sim/types';
import { LANE_W, type Edge, type RoadGraph } from '../traffic/graph';
import type { World } from '../world/world';

type XZ = [number, number];
export type CabStage = 'search' | 'pickup' | 'ride';
/** Stan pracy dla klienta: etap, cel (klient albo miejsce docelowe), szacowana zapłata, zarobek w tej zmianie. */
export interface CabInfo { st: CabStage; target: XZ | null; pay: number; earned: number; rides: number }

const NAMES = ['Pan Zbyszek', 'Pani Ania', 'Student Kuba', 'Pani Krysia', 'Pan Marek', 'Turysta z Niemiec', 'Pani Ola', 'Pan Rysiek'];

export interface CabHost {
  readonly world: World;
  graph(): RoadGraph | null;
  car(p: PlayerState): Entity | null; // auto, które prowadzi gracz (legalne, nadające się do kursów); null = koniec pracy
  spawnPed(x: number, y: number, z: number, yaw: number): Entity;
  despawn(id: number): void;
  notify(p: PlayerState, text: string): void;
  pay(p: PlayerState, amount: number): void;
  readonly cur: string; readonly scale: number;
}

interface Shift { p: PlayerState; st: CabStage; pick: XZ | null; drop: XZ | null; ped: number | null; t: number; wait: number; earned: number; rides: number; name: string; dist: number }

export class CabJobs {
  readonly shifts = new Map<number, Shift>();
  constructor(private h: CabHost) {}

  start(p: PlayerState): string {
    if (this.shifts.has(p.id)) return 'Już pracujesz jako kierowca.';
    if (!this.h.car(p)) return 'Potrzebujesz legalnego auta (kupionego w salonie albo przerejestrowanego) i musisz siedzieć za kierownicą.';
    this.shifts.set(p.id, { p, st: 'search', pick: null, drop: null, ped: null, t: 0, wait: 2, earned: 0, rides: 0, name: '', dist: 0 });
    return 'Zaczynasz pracę jako kierowca. Czekaj na zlecenie…';
  }
  stop(p: PlayerState, why = 'Koniec zmiany'): string {
    const s = this.shifts.get(p.id); if (!s) return 'Nie pracujesz teraz jako kierowca.';
    if (s.ped != null) this.h.despawn(s.ped); this.shifts.delete(p.id);
    return `${why}. Zarobek: ${s.earned.toFixed(2)} ${this.h.cur} (kursów: ${s.rides}).`;
  }
  info(pid: number): CabInfo | null {
    const s = this.shifts.get(pid); if (!s) return null;
    return { st: s.st, target: s.st === 'pickup' ? s.pick : s.st === 'ride' ? s.drop : null, pay: s.st === 'search' ? 0 : this.fare(s.dist), earned: s.earned, rides: s.rides };
  }
  private fare(d: number): number { return Math.round((6 + 3.5 * d * 1.3 / 1000) * this.h.scale * 10) / 10; }

  step(dt: number): void {
    const G = this.h.graph();
    for (const s of [...this.shifts.values()]) {
      const car = this.h.car(s.p);
      if (!car || s.p.dead || !G) { this.h.notify(s.p, this.stop(s.p, 'Koniec pracy (wyszedłeś z auta)')); continue; }
      s.t += dt; const here: XZ = [car.x, car.z], slow = Math.abs(car.speed) < 2;
      if (s.st === 'search') {
        s.wait -= dt; if (s.wait > 0) continue;
        const pick = this.roadPoint(G, here, 120, 350, true); if (!pick) { s.wait = 3; continue; }
        s.pick = [pick.x, pick.z]; s.name = NAMES[Math.floor(Math.random() * NAMES.length)];
        const ped = this.h.spawnPed(pick.x, this.h.world.surfaceAt(pick.x, pick.z, 1e6), pick.z, pick.yaw); ped.npc = true; s.ped = ped.id;
        const drop = this.roadPoint(G, s.pick, 400, 1200, false); s.drop = drop ? [drop.x, drop.z] : [s.pick[0] + 600, s.pick[1]];
        s.dist = Math.hypot(s.drop[0] - s.pick[0], s.drop[1] - s.pick[1]);
        s.st = 'pickup'; s.t = 0;
        this.h.notify(s.p, `Zlecenie: ${s.name} czeka ${Math.round(Math.hypot(s.pick[0] - here[0], s.pick[1] - here[1]))} m stąd (żółty znacznik). Kurs ok. ${this.fare(s.dist).toFixed(0)} ${this.h.cur}.`);
      } else if (s.st === 'pickup') {
        if (s.t > 180) { this.h.notify(s.p, `${s.name} zrezygnował(a) – za długo czekał(a).`); this.reset(s); continue; }
        if (slow && Math.hypot(s.pick![0] - here[0], s.pick![1] - here[1]) < 10) {
          if (s.ped != null) { this.h.despawn(s.ped); s.ped = null; }
          s.st = 'ride'; s.t = 0; this.h.notify(s.p, `${s.name} wsiada. Jedź do celu (żółty znacznik), ${Math.round(s.dist)} m.`);
        }
      } else {
        if (slow && Math.hypot(s.drop![0] - here[0], s.drop![1] - here[1]) < 15) {
          const base = this.fare(s.dist), fast = s.t < s.dist * 1.3 / 8, tip = fast ? Math.round(base * .2 * 10) / 10 : 0, all = base + tip;
          this.h.pay(s.p, all); s.earned += all; s.rides++;
          this.h.notify(s.p, `${s.name} płaci ${base.toFixed(2)} ${this.h.cur}${tip ? ` + napiwek ${tip.toFixed(2)}` : ''}. Następne zlecenie za chwilę.`);
          this.reset(s);
        }
      }
    }
  }

  private reset(s: Shift): void { if (s.ped != null) this.h.despawn(s.ped); s.ped = null; s.st = 'search'; s.pick = s.drop = null; s.wait = 5; s.t = 0; }

  /** Punkt przy krawężniku (chodnik dla klienta albo jezdnia dla celu) w odległości [lo, hi] od p. */
  private roadPoint(G: RoadGraph, p: XZ, lo: number, hi: number, curb: boolean): { x: number; z: number; yaw: number } | null {
    const q = { x: 0, z: 0, yaw: 0 }, E = G.edges;
    for (let k = 0; k < 120; k++) {
      const e: Edge = E[Math.floor(Math.random() * E.length)]; if (!['primary', 'secondary', 'tertiary', 'residential', 'living'].includes(e.cls) || e.len < 20 || e.br) continue;
      G.pose(e, e.len * (.2 + Math.random() * .6), curb ? Math.max(e.w / 2 + 1.5, LANE_W * e.lanes + 1.5) : .5 * LANE_W, q);
      const d = Math.hypot(q.x - p[0], q.z - p[1]); if (d < lo || d > hi) continue;
      if (this.h.world.blocked(q.x, q.z)) continue;
      return { ...q };
    }
    return null;
  }
}
