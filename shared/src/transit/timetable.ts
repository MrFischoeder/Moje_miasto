// Rozkłady jazdy w czasie gry. Położenie każdego kursu to funkcja czasu (rozkład + zegar), więc wszystkie
// pojazdy komunikacji w całym mieście „istnieją” zawsze, bez kosztu symulacji, i są identyczne na serwerze
// i u każdego klienta (nic nie idzie przez sieć poza zegarem). Szczegóły liczy się tylko przy graczach.
import type { DayType } from './clock';

export type TransitKind = 'bus' | 'tram' | 'metro' | 'rail' | 'ferry' | 'cable';

export interface TransitData {
  v: number; city: string; days: string[]; dates: Record<string, Record<string, string>>;
  routes: { n: string; t: TransitKind; c: string; l: string }[];
  stops: [string, number, number][];
  patterns: { r: number; s: number[]; h: string; sh: number[]; d: number[]; pr: number[][]; tr: number[] }[];
}

/** Postój na przystanku [s] i długość składu [m] wg rodzaju. */
export const DWELL: Record<TransitKind, number> = { bus: 15, tram: 15, metro: 25, rail: 40, ferry: 60, cable: 20 };
export const LENGTH: Record<TransitKind, number> = { bus: 12, tram: 32, metro: 117, rail: 100, ferry: 30, cable: 4 };

export class Pattern {
  /** ścieżka 3D: x, y, z (y = NaN: wysokość z terenu) */
  pts: Float64Array; cum: Float64Array;
  stopS: number[];
  enabled = true;
  x0 = Infinity; x1 = -Infinity; z0 = Infinity; z1 = -Infinity;
  durMax = 0;
  constructor(readonly id: number, readonly route: number, public kind: TransitKind, readonly stops: number[], readonly head: string,
    path: number[], stopS: number[], readonly profiles: Float64Array[], readonly trips: Int32Array) {
    this.pts = new Float64Array(path); this.cum = new Float64Array(path.length / 3); this.stopS = stopS;
    this.setPath(path, stopS);
    for (const p of profiles) this.durMax = Math.max(this.durMax, p[p.length - 1] + DWELL[kind]);
  }
  setPath(path: number[], stopS: number[]): void {
    this.pts = new Float64Array(path); this.cum = new Float64Array(path.length / 3); this.stopS = stopS;
    this.x0 = this.z0 = Infinity; this.x1 = this.z1 = -Infinity;
    for (let i = 0; i < path.length; i += 3) {
      if (i) this.cum[i / 3] = this.cum[i / 3 - 1] + Math.hypot(path[i] - path[i - 3], path[i + 2] - path[i - 1], (path[i + 1] - path[i - 2]) || 0);
      this.x0 = Math.min(this.x0, path[i]); this.x1 = Math.max(this.x1, path[i]); this.z0 = Math.min(this.z0, path[i + 2]); this.z1 = Math.max(this.z1, path[i + 2]);
    }
  }
  get length(): number { return this.cum[this.cum.length - 1]; }

  /** Punkt na ścieżce w odległości s (poza zakresem: przedłużenie wzdłuż końcowego odcinka). */
  pointAt(s: number, out: { x: number; y: number; z: number; yaw: number }): void {
    const c = this.cum, n = c.length, P = this.pts;
    let lo = 0, hi = n - 1;
    if (s <= 0) { lo = 0; hi = 1; } else if (s >= c[n - 1]) { lo = n - 2; hi = n - 1; }
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const L = c[hi] - c[lo] || 1e-9, t = (s - c[lo]) / L, a = lo * 3, b = hi * 3;
    out.x = P[a] + (P[b] - P[a]) * t; out.y = P[a + 1] + (P[b + 1] - P[a + 1]) * t; out.z = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
    out.yaw = Math.atan2(-(P[b] - P[a]), -(P[b + 2] - P[a + 2]));
  }
}

/** Ułamek drogi przy rozruchu, jeździe i hamowaniu (trapezowy profil prędkości). */
const ACC = .2;
const ease = (u: number) => u < ACC ? u * u / (2 * ACC * (1 - ACC)) : u > 1 - ACC ? 1 - (1 - u) * (1 - u) / (2 * ACC * (1 - ACC)) : (u - ACC / 2) / (1 - ACC);

export interface TripState {
  /** odległość wzdłuż ścieżki (środek składu) */
  s: number;
  /** indeks przystanku, na którym stoi (-1 w ruchu) */
  stop: number;
  /** postój przed odjazdem z pierwszego / po przyjeździe na ostatni */
  terminal: boolean;
  speed: number;
}

export interface ActiveTrip { key: string; p: Pattern; k: number; t: number; st: TripState }

export class Timetable {
  readonly patterns: Pattern[];
  constructor(readonly data: TransitData) {
    this.patterns = data.patterns.map((p, i) => {
      const r = data.routes[p.r], path: number[] = [];
      let x = 0, z = 0; for (let j = 0; j < p.sh.length; j += 2) { x += p.sh[j] / 10; z += p.sh[j + 1] / 10; path.push(x, NaN, z); }
      return new Pattern(i, p.r, r.t, p.s, p.h, path, p.d.slice(), p.pr.map(q => new Float64Array(q)), new Int32Array(p.tr));
    });
  }

  /** Stan kursu (wzorzec, nr kursu) w chwili t sekund od jego startu; null = nie jedzie. */
  state(p: Pattern, prof: Float64Array, t: number, out: TripState = { s: 0, stop: -1, terminal: false, speed: 0 }): TripState | null {
    const n = prof.length / 2, D = DWELL[p.kind], S = p.stopS;
    if (t < -D || t > prof[2 * n - 2] + D) return null;
    if (t <= 0) { out.s = S[0]; out.stop = 0; out.terminal = true; out.speed = 0; return out; }
    for (let i = 0; i < n - 1; i++) {
      const arr = prof[2 * i], dep = prof[2 * i + 1], next = prof[2 * i + 2];
      const effDep = i === 0 ? dep : Math.max(dep, Math.min(arr + D, next - .3 * Math.max(1, next - dep)));
      if (t <= effDep) { out.s = S[i]; out.stop = i; out.terminal = i === 0; out.speed = 0; return out; }
      if (t < next) {
        const T = next - effDep, u = (t - effDep) / T, L = S[i + 1] - S[i];
        out.s = S[i] + ease(u) * L; out.stop = -1; out.terminal = false;
        const du = 1e-3; out.speed = (ease(Math.min(1, u + du)) - ease(u)) / du * L / T; return out;
      }
    }
    out.s = S[n - 1]; out.stop = n - 1; out.terminal = true; out.speed = 0; return out;
  }

  /**
   * Kursy aktywne w chwili `sec` (sekundy od północy) w typie dnia `day`, opcjonalnie w prostokącie.
   * Kursy poprzedniego dnia trwające po północy (czasy GTFS > 24:00) też są uwzględnione.
   */
  active(sec: number, day: DayType, prevDay: DayType, cb: (a: ActiveTrip) => void, box?: [number, number, number, number]): void {
    for (const p of this.patterns) {
      if (!p.enabled) continue;
      if (box && (p.x1 < box[0] || p.x0 > box[2] || p.z1 < box[1] || p.z0 > box[3])) continue;
      for (const [d, t0, tag] of [[day, sec, 0], [prevDay, sec + 86400, 1]] as const) {
        const tr = p.trips, n = tr.length / 3;
        // pierwszy kurs ze startem >= t0 - durMax (wyszukiwanie binarne po czasie startu)
        let lo = 0, hi = n; const from = t0 - p.durMax;
        while (lo < hi) { const m = (lo + hi) >> 1; if (tr[m * 3] < from) lo = m + 1; else hi = m; }
        for (let k = lo; k < n && tr[k * 3] <= t0 + DWELL[p.kind]; k++) {
          if (!(tr[k * 3 + 2] & (1 << d))) continue;
          const t = t0 - tr[k * 3], st = this.state(p, p.profiles[tr[k * 3 + 1]], t); if (!st) continue;
          cb({ key: `${p.id}:${k}:${tag}`, p, k, t, st });
        }
      }
    }
  }

  /** Stan konkretnego kursu (po kluczu) w chwili sec. */
  trip(key: string, sec: number, day: DayType, prevDay: DayType): ActiveTrip | null {
    const [pi, k, tag] = key.split(':').map(Number), p = this.patterns[pi]; if (!p) return null;
    const d = tag ? prevDay : day, t0 = tag ? sec + 86400 : sec, tr = p.trips;
    if (!(tr[k * 3 + 2] & (1 << d))) return null;
    const t = t0 - tr[k * 3], st = this.state(p, p.profiles[tr[k * 3 + 1]], t); if (!st) return null;
    return { key, p, k, t, st };
  }

  /** Liczba kursów aktywnych teraz (statystyka). */
  count(sec: number, day: DayType, prevDay: DayType): Record<string, number> {
    const out: Record<string, number> = {}; this.active(sec, day, prevDay, a => { out[a.p.kind] = (out[a.p.kind] || 0) + 1; }); return out;
  }
}
