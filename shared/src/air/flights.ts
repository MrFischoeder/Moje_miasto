// Ruch lotniczy: starty i lądowania na prawdziwych pasach (z OSM). Rozkład jest powtarzalny (ziarno = lotnisko + data),
// z natężeniem zależnym od lotniska i pory dnia; położenie samolotu to funkcja czasu (jak kursy komunikacji),
// więc wszyscy gracze widzą te same samoloty bez przesyłania czegokolwiek przez sieć.
import { rng } from '../util/rng';

export interface Runway { ref: string; a: [number, number]; b: [number, number]; w: number; len: number }
export interface Airport { name: string; iata: string; icao: string; x: number; z: number; runways: Runway[] }
export interface AirData { v: number; city: string; airports: Airport[] }

export type PlaneSize = 'heavy' | 'medium' | 'regional' | 'light';
export interface Flight { id: string; ap: Airport; arr: boolean; size: PlaneSize; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; onGround: boolean }

/** Operacje na godzinę wg godziny lokalnej (0–23). */
const PROFILE = {
  hub: [1, 0, 0, 0, 0, 2, 30, 40, 42, 40, 38, 38, 38, 38, 38, 40, 40, 42, 42, 40, 38, 34, 24, 8],
  big: [1, 0, 0, 0, 0, 2, 14, 20, 22, 20, 18, 16, 16, 16, 18, 18, 20, 20, 20, 18, 18, 16, 12, 4],
  city: [0, 0, 0, 0, 0, 0, 2, 9, 10, 9, 7, 6, 6, 6, 7, 8, 9, 10, 9, 8, 6, 4, 0, 0],
  light: [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0],
};
const KIND: Record<string, keyof typeof PROFILE> = { LHR: 'hub', WAW: 'big', LCY: 'city' };

const V_APP = 70, TOUCH = 300, GLIDE = Math.tan(3 * Math.PI / 180), DECEL = 2, V_TAXI = 12;
const ACC = 2.2, V_ROT = 80, CLIMB = Math.tan(8 * Math.PI / 180);

interface Leg { ap: Airport; rw: Runway; dir: 1 | -1; arr: boolean; t: number; size: PlaneSize; id: string }

/** Kierunek pracy pasa w danym dniu („wiatr”): 1 = od a do b. */
function flow(ap: Airport, date: string): 1 | -1 { return rng(ap.iata + ap.name + date)() < .65 ? 1 : -1; }

export class AirTraffic {
  constructor(readonly data: AirData) {}

  /** Starty i lądowania w danej godzinie lokalnej danego dnia. */
  private legs(ap: Airport, date: string, hour: number, dayStart: number): Leg[] {
    const kind = KIND[ap.iata] ?? (ap.iata ? 'light' : 'light'), n = PROFILE[kind][(hour + 24) % 24]; if (!n) return [];
    const R = rng(`${ap.iata}${ap.icao}${date}:${hour}`), dir = flow(ap, date), out: Leg[] = [];
    for (let i = 0; i < n; i++) {
      const t = dayStart + hour * 3600 + (i + .5 + (R() - .5) * .7) * 3600 / n, arr = R() < .5;
      // Heathrow: jeden pas do lądowań, drugi do startów (zamiana o 15:00); inne: przyloty na dłuższym
      const rws = [...ap.runways].sort((x, y) => y.len - x.len);
      let rw = rws[0]; if (rws.length > 1) rw = kind === 'hub' ? rws[(arr ? 0 : 1) ^ (hour >= 15 ? 1 : 0)] : arr ? rws[0] : rws[1];
      const s = R(), size: PlaneSize = kind === 'light' ? 'light' : kind === 'city' ? 'regional' : kind === 'hub' ? (s < .3 ? 'heavy' : 'medium') : (s < .1 ? 'heavy' : s < .3 ? 'regional' : 'medium');
      out.push({ ap, rw, dir, arr, t, size, id: `${ap.iata || ap.icao}:${date}:${hour}:${i}` });
    }
    return out;
  }

  /** Samoloty w powietrzu i na pasach w chwili `sec` (sekundy od północy, data lokalna). */
  active(sec: number, date: string, ground: (x: number, z: number) => number): Flight[] {
    const out: Flight[] = [], h = Math.floor(sec / 3600);
    for (const ap of this.data.airports) for (const hh of [h - 1, h, h + 1]) for (const L of this.legs(ap, date, hh, 0)) {
      const f = this.pose(L, sec - L.t, ground); if (f) out.push(f);
    }
    return out;
  }

  private pose(L: Leg, tau: number, ground: (x: number, z: number) => number): Flight | null {
    const [A, B] = L.dir === 1 ? [L.rw.a, L.rw.b] : [L.rw.b, L.rw.a], len = L.rw.len;
    const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len, g0 = ground(A[0], A[1]), g1 = ground(B[0], B[1]);
    let u: number, h: number, v: number, pitch = 0;
    if (L.arr) {
      if (tau < -300) return null;
      if (tau < 0) { u = TOUCH + V_APP * tau; h = Math.max(0, (TOUCH - u) * GLIDE); v = V_APP; pitch = .05; if (h < 15) pitch = .05 + (15 - h) / 15 * .06; }
      else {
        const tb = (V_APP - V_TAXI) / DECEL;
        if (tau < tb) { u = TOUCH + V_APP * tau - DECEL * tau * tau / 2; v = V_APP - DECEL * tau; }
        else { if (tau > tb + 25) return null; u = TOUCH + V_APP * tb - DECEL * tb * tb / 2 + V_TAXI * (tau - tb); v = V_TAXI; }
        h = 0;
      }
    } else {
      if (tau < -40) return null;
      if (tau < 0) { u = 40; h = 0; v = 0; }
      else {
        const tr = V_ROT / ACC, ur = 40 + ACC * tr * tr / 2;
        if (tau < tr) { u = 40 + ACC * tau * tau / 2; v = ACC * tau; h = 0; }
        else { const dt = tau - tr; v = Math.min(130, V_ROT + 1 * dt); u = ur + (V_ROT + v) / 2 * dt; h = (u - ur) * CLIMB; pitch = Math.min(.25, dt * .08); if (h > 2500) return null; }
      }
    }
    const x = A[0] + ux * u, z = A[1] + uz * u, gy = g0 + (g1 - g0) * Math.max(0, Math.min(1, u / len));
    return { id: L.id, ap: L.ap, arr: L.arr, size: L.size, x, y: gy + h, z, yaw: Math.atan2(-ux, -uz), pitch, speed: v, onGround: h <= 0 };
  }
}
