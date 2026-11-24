// Komunikacja miejska w świecie gry: rozkład + zegar + geometria (teren, mosty, tunele metra).
// Wspólna dla serwera (wsiadanie, wysiadanie, pozycja pasażerów) i klienta (rysowanie, kamera pasażera).
import type { World } from '../world/world';
import { CITY_TZ, GameClock, localTime, type LocalTime } from './clock';
import { attachMetroPaths } from './metroPaths';
import { LENGTH, Timetable, type ActiveTrip, type Pattern, type TransitData, type TransitKind } from './timetable';

export interface VehiclePose { x: number; y: number; z: number; yaw: number }

/** Odległość od boku składu, z której można wsiąść [m]: w metrze z całego peronu. */
export const BOARD_RADIUS: Record<TransitKind, number> = { bus: 3, tram: 3, metro: 8, rail: 4, ferry: 6, cable: 3 };
const HALF_W: Record<TransitKind, number> = { bus: 1.3, tram: 1.2, metro: 1.35, rail: 1.45, ferry: 3.5, cable: 1.25 };

export class TransitSystem {
  readonly tt: Timetable;
  readonly tz: string;
  readonly metro: { ok: number; failed: number };
  private lt: LocalTime | null = null; private ltAt = -1;
  constructor(data: TransitData, readonly world: World, readonly clock: GameClock) {
    this.tt = new Timetable(data); this.tz = CITY_TZ[world.key] ?? 'UTC';
    this.metro = attachMetroPaths(this.tt, world);
  }

  /** Czas lokalny miasta (pamiętany w obrębie tej samej milisekundy). */
  local(epoch = this.clock.now()): LocalTime {
    if (epoch !== this.ltAt || !this.lt) { this.lt = localTime(epoch, this.tz); this.ltAt = epoch; }
    return this.lt;
  }

  /** Punkt ścieżki z wysokością (powierzchnia: teren albo most; metro: z tunelu). */
  pose(p: Pattern, s: number, out: VehiclePose = { x: 0, y: 0, z: 0, yaw: 0 }): VehiclePose {
    const q = { x: 0, y: 0, z: 0, yaw: 0 }; p.pointAt(s, q);
    // autobus jedzie prawym pasem (trasa biegnie osią jezdni z OSM); tramwaje i pociągi: osobne tory w danych
    const lane = p.kind === 'bus' ? 1.7 : 0;
    out.x = q.x + Math.cos(q.yaw) * lane; out.z = q.z - Math.sin(q.yaw) * lane; out.yaw = q.yaw;
    out.y = Number.isNaN(q.y) ? this.world.surfaceAt(out.x, out.z, 1e6) : q.y;
    return out;
  }

  /** Kursy aktywne teraz w prostokącie [x0, z0, x1, z1]. */
  near(box: [number, number, number, number], epoch = this.clock.now()): ActiveTrip[] {
    const lt = this.local(epoch), out: ActiveTrip[] = [], q = { x: 0, y: 0, z: 0, yaw: 0 };
    this.tt.active(lt.sec, lt.day, lt.prevDay, a => {
      // filtr po położeniu pojazdu (z zapasem na długość składu), nie tylko po zasięgu trasy
      a.p.pointAt(a.st.s, q); const m = LENGTH[a.p.kind] / 2;
      if (q.x >= box[0] - m && q.x <= box[2] + m && q.z >= box[1] - m && q.z <= box[3] + m) out.push(a);
    }, box);
    return out;
  }

  trip(key: string, epoch = this.clock.now()): ActiveTrip | null {
    const lt = this.local(epoch); return this.tt.trip(key, lt.sec, lt.day, lt.prevDay);
  }

  /** Pojazd stojący na przystanku najbliżej punktu (do wsiadania); null, gdy żaden w zasięgu. */
  boardable(x: number, y: number, z: number, epoch = this.clock.now()): ActiveTrip | null {
    let best: ActiveTrip | null = null, bd = Infinity;
    for (const a of this.near([x - 150, z - 150, x + 150, z + 150], epoch)) {
      if (a.st.stop < 0) continue;
      const d = this.distance(a, x, y, z) - HALF_W[a.p.kind]; if (d < BOARD_RADIUS[a.p.kind] && d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** Odległość punktu od składu (odcinek środkiem składu) z karą za różnicę wysokości. */
  distance(a: ActiveTrip, x: number, y: number, z: number): number {
    const L = LENGTH[a.p.kind], A = this.pose(a.p, a.st.s - L / 2), B = this.pose(a.p, a.st.s + L / 2);
    const dx = B.x - A.x, dz = B.z - A.z, t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz || 1)));
    const px = A.x + dx * t, pz = A.z + dz * t, py = A.y + (B.y - A.y) * t;
    return Math.hypot(x - px, z - pz) + Math.max(0, Math.abs(y - py) - 1.5) * 3;
  }

  /** Miejsce wysiadania: obok drzwi (prawa strona, w metrze w stronę peronu). */
  alightPose(a: ActiveTrip): VehiclePose {
    const c = this.pose(a.p, a.st.s), right = { x: Math.cos(c.yaw), z: -Math.sin(c.yaw) }; // prawo względem kierunku jazdy (przód = -sin, -cos)
    if (a.p.kind === 'metro') {
      // peron: w stronę osi hali (peron wyspowy) albo na zewnątrz (perony boczne)
      const st = this.world.nearestStation(c.x, c.z), toAxis = { x: st.x - c.x, z: st.z - c.z };
      const h = st.halls.find(hh => Math.abs(hh.y - c.y) < 1) ?? st.halls[0];
      const n = { x: -h.uz, z: h.ux }, side = Math.sign(toAxis.x * n.x + toAxis.z * n.z) || 1, k = h.island ? 2.8 * side : -2.6 * side;
      return { x: c.x + n.x * k, y: c.y, z: c.z + n.z * k, yaw: c.yaw };
    }
    const off = a.p.kind === 'bus' ? 2.6 : a.p.kind === 'tram' ? 2.8 : 3.6;
    const x = c.x + right.x * off, z = c.z + right.z * off;
    return { x, y: this.world.surfaceAt(x, z, c.y), z, yaw: c.yaw };
  }

  /** Opis kursu do HUD: „Autobus 175 → Lotnisko Chopina · następny: Centrum”. */
  describe(a: ActiveTrip): string {
    const r = this.tt.data.routes[a.p.route], kind = { bus: 'Autobus', tram: 'Tramwaj', metro: 'Metro', rail: 'Pociąg', ferry: 'Prom', cable: 'Kolejka' }[a.p.kind];
    const i = a.st.stop >= 0 ? a.st.stop : a.p.stopS.findIndex(s => s > a.st.s), stopName = (j: number) => this.tt.data.stops[a.p.stops[j]]?.[0] ?? '';
    const where = a.st.stop >= 0 ? `przystanek: ${stopName(a.st.stop)}` : i >= 0 ? `następny: ${stopName(i)}` : '';
    return `${kind} ${r.n} → ${a.p.head || stopName(a.p.stops.length - 1)}${where ? ' · ' + where : ''}`;
  }
}
