// Graf pasów ruchu z kafli OSM: krawędź = odcinek jezdni między węzłami grafu (skrzyżowania, końce),
// w jednym kierunku, z liczbą pasów, prędkością dopuszczalną i informacją o sygnalizacji na końcu.
import { isVehicleRoad } from '../tiles/build';
import type { RoadClass } from '../tiles/types';
import type { XZ } from '../world/collision';
import { toXZ, type World } from '../world/world';

export interface Edge {
  id: number; from: number; to: number;
  pts: XZ[]; cum: number[]; len: number;
  lanes: number; speed: number; cls: RoadClass;
  /** sygnalizacja na końcu krawędzi */
  sig: boolean;
  /** kierunek przy wjeździe do węzła końcowego [rad] */
  endHeading: number;
}

/** Prędkość [m/s] wg klasy drogi (typowe limity w mieście). */
const SPEED: Partial<Record<RoadClass, number>> = { motorway: 27.8, trunk: 22.2, primary: 16.7, secondary: 13.9, tertiary: 13.9, residential: 8.3, service: 5.5, living: 4.2 };
export const LANE_W = 3.1;

export class RoadGraph {
  edges: Edge[] = [];
  out = new Map<number, Edge[]>();
  /** węzeł -> kierunek osi głównej (do faz sygnalizacji) */
  axis = new Map<number, number>();
  private byTile = new Map<string, Edge[]>();
  private sigNodes = new Set<number>();
  private nextId = 0;

  /** Dołożenie / usunięcie kafli tak, by graf odpowiadał kaflom świata (przyrostowo). */
  sync(world: World): { added: number; removed: string[] } {
    const removed: string[] = []; let added = 0;
    for (const k of [...this.byTile.keys()]) if (!world.tiles.has(k)) { this.removeTile(k); removed.push(k); }
    for (const [k, t] of world.tiles) if (!this.byTile.has(k)) {
      for (const g of t.g) if (g.sig) this.sigNodes.add(g.id);
      const list: Edge[] = [];
      const add = (from: number, to: number, pts: XZ[], lanes: number, cls: RoadClass) => {
        if (pts.length < 2 || from === to) return;
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const len = cum[cum.length - 1]; if (len < 1) return;
        const a = pts[pts.length - 2], b = pts[pts.length - 1];
        const e: Edge = { id: this.nextId++, from, to, pts, cum, len, lanes: Math.max(1, lanes), speed: SPEED[cls] ?? 8.3, cls, sig: false, endHeading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
        list.push(e); let l = this.out.get(from); if (!l) this.out.set(from, l = []); l.push(e);
        if (!this.axis.has(to)) this.axis.set(to, e.endHeading);
      };
      for (const r of t.r) {
        if (!isVehicleRoad(r.k) || r.tu || r.j.length < 4) continue;
        const P = toXZ(r.p), fwd = r.ow ? r.ln : Math.max(1, Math.ceil(r.ln / 2)), back = r.ow ? r.ln : Math.max(1, r.ln - fwd);
        for (let i = 0; i + 3 < r.j.length; i += 2) {
          const ia = r.j[i], na = r.j[i + 1], ib = r.j[i + 2], nb = r.j[i + 3], seg = P.slice(ia, ib + 1);
          if (r.ow !== -1) add(na, nb, seg, fwd, r.k);
          if (r.ow !== 1) add(nb, na, seg.slice().reverse(), back, r.k);
        }
      }
      this.byTile.set(k, list); added += list.length;
    }
    if (added || removed.length) {
      this.edges = [...this.byTile.values()].flat();
      for (const e of this.edges) e.sig = this.sigNodes.has(e.to);
    }
    return { added, removed };
  }

  private removeTile(k: string): void {
    const list = this.byTile.get(k) || []; this.byTile.delete(k);
    const gone = new Set(list);
    for (const e of list) { const l = this.out.get(e.from); if (l) { const f = l.filter(x => !gone.has(x)); if (f.length) this.out.set(e.from, f); else this.out.delete(e.from); } }
  }

  /** Czy krawędź nadal istnieje (po usunięciu kafla). */
  has(e: Edge): boolean { const l = this.out.get(e.from); return !!l && l.includes(e); }

  /** Punkt na krawędzi w odległości s z przesunięciem w bok (dodatnie = w prawo). */
  pose(e: Edge, s: number, off: number, out: { x: number; z: number; yaw: number }): void {
    const c = e.cum, P = e.pts; s = Math.max(0, Math.min(e.len, s));
    let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++;
    const L = c[i + 1] - c[i] || 1e-9, t = (s - c[i]) / L, dx = (P[i + 1][0] - P[i][0]) / L, dz = (P[i + 1][1] - P[i][1]) / L;
    out.x = P[i][0] + (P[i + 1][0] - P[i][0]) * t - dz * off; out.z = P[i][1] + (P[i + 1][1] - P[i][1]) * t + dx * off;
    out.yaw = Math.atan2(-dx, -dz);
  }
}
