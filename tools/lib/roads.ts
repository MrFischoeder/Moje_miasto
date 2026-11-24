// Ujednolicenie ulic (cała mapa naraz, po uproszczeniu):
//  1. szerokość jezdni z liczby pasów i klasy drogi (bez przypadkowych tagów width z OSM), co 0,5 m,
//  2. ciągi ulic: odcinki tej samej ulicy (nazwa, klasa, jednokierunkowość) połączone końcami, także przez granice kafli;
//     krótkie odcinki (< 80 m) o innej liczbie pasów przejmują ją od sąsiadów,
//  3. prawdziwa zmiana szerokości: na styku obie strony mają szerokość pośrednią (wa / wb), a jezdnia zwęża się
//     stopniowo na ok. 30 m (rysowanie: client/src/world/tiles/tileView.ts).
import { LANE_W } from '../../shared/src/tiles/build';
import type { TileData, TileRoad } from '../../shared/src/tiles/types';

const len = (p: number[]) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
export const stdWidth = (r: TileRoad) => { const lw = LANE_W[r.k]; if (!lw) return r.w; return Math.round(Math.min(40, Math.max(r.ln * lw, r.ow ? 3.5 : 5)) * 2) / 2; };

export function normalizeRoads(tiles: Map<string, TileData>): { roads: number; absorbed: number; tapers: number } {
  const roads: TileRoad[] = []; for (const t of tiles.values()) for (const r of t.r) if (LANE_W[r.k] && !r.br) roads.push(r);
  for (const r of roads) { r.w = stdWidth(r); delete r.wa; delete r.wb; }
  // końce odcinków (zaokrąglone do 0,5 m) -> odcinki
  const key = (x: number, z: number) => Math.round(x * 2) + ',' + Math.round(z * 2);
  const ends = new Map<string, { r: TileRoad; e: 0 | 1 }[]>();
  for (const r of roads) for (const e of [0, 1] as const) { const i = e ? r.p.length - 2 : 0, k = key(r.p[i], r.p[i + 1]); let l = ends.get(k); if (!l) ends.set(k, l = []); l.push({ r, e }); }
  const same = (a: TileRoad, b: TileRoad) => a !== b && a.k === b.k && (a.n ?? '') === (b.n ?? '') && !!a.ow === !!b.ow;
  /** kontynuacja ulicy na końcu e odcinka r (dokładnie jeden pasujący odcinek) */
  const next = (r: TileRoad, e: 0 | 1) => { const i = e ? r.p.length - 2 : 0, l = (ends.get(key(r.p[i], r.p[i + 1])) ?? []).filter(q => same(r, q.r)); return l.length === 1 ? l[0] : null; };
  // krótkie odcinki przejmują liczbę pasów od sąsiadów
  let absorbed = 0;
  for (let pass = 0; pass < 3; pass++) for (const r of roads) {
    const L = len(r.p); if (L >= 80) continue;
    const a = next(r, 0), b = next(r, 1);
    const pick = a && b ? (a.r.ln === b.r.ln ? a.r.ln : len(a.r.p) >= len(b.r.p) ? a.r.ln : b.r.ln) : a && len(a.r.p) > L ? a.r.ln : b && len(b.r.p) > L ? b.r.ln : null;
    if (pick != null && pick !== r.ln) { r.ln = pick; r.w = stdWidth(r); absorbed++; }
  }
  // płynne przejścia na stykach różnych szerokości
  let tapers = 0;
  for (const r of roads) for (const e of [0, 1] as const) {
    const q = next(r, e); if (!q || Math.abs(q.r.w - r.w) < .3) continue;
    const m = Math.round((r.w + q.r.w) / 2 * 10) / 10;
    if (e) r.wb = m; else r.wa = m;
    tapers++;
  }
  return { roads: roads.length, absorbed, tapers: tapers / 2 };
}
