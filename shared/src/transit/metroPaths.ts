// Kursy metra jeżdżą po naszych tunelach i halach (a nie po kształcie z GTFS): ścieżka 3D od środka hali
// przez koniec hali, tunel, do następnej hali, właściwym torem. Przystanki GTFS -> stacje gry po nazwie.
import { normName } from '../data/projection';
import type { World } from '../world/world';
import type { Station, Hall } from '../world/metro/layout';
import type { Timetable } from './timetable';

/** Ruch prawostronny (Warszawa) albo lewostronny (Londyn) na torach. */
const SIDE: Record<string, number> = { wroclaw: 1, warszawa: 1, londyn: -1 };

export function attachMetroPaths(tt: Timetable, world: World): { ok: number; failed: number } {
  const byName = new Map<string, Station[]>();
  for (const s of world.stations) { const k = normName(s.name); let l = byName.get(k); if (!l) byName.set(k, l = []); l.push(s); }
  // sąsiedztwo stacji (na dowolnej linii) do szukania przejazdu przez stacje pośrednie
  const adj = new Map<number, number[]>();
  for (const [a, b] of world.city.ed) { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
  const side = SIDE[world.key] ?? 1;
  let ok = 0, failed = 0;
  for (const p of tt.patterns) {
    if (p.kind !== 'metro') continue;
    // stacje kolejnych przystanków (najbliższa o tej nazwie do poprzedniej)
    const st: Station[] = []; let bad = false;
    for (const si of p.stops) {
      const [name, x, z] = tt.data.stops[si], c = byName.get(normName(name));
      if (!c) { bad = true; break; }
      st.push(c.reduce((b, s) => Math.hypot(s.x - x, s.z - z) < Math.hypot(b.x - x, b.z - z) ? s : b));
    }
    if (bad || st.length < 2) { p.kind = 'rail'; failed++; continue; } // np. DLR: jedzie po powierzchni po prostej
    // pełna lista stacji (z pośrednimi przez BFS w sieci)
    const seq: { s: Station; stop: boolean }[] = [{ s: st[0], stop: true }];
    for (let i = 1; i < st.length && !bad; i++) {
      const path = bfs(adj, st[i - 1].i, st[i].i); if (!path) { bad = true; break; }
      for (let j = 1; j < path.length; j++) seq.push({ s: world.stations[path[j]], stop: j === path.length - 1 });
    }
    if (bad) { p.kind = 'rail'; failed++; continue; }
    const pts: number[] = [], stopS: number[] = []; let len = 0;
    const push = (x: number, y: number, z: number) => {
      const n = pts.length; if (n) len += Math.hypot(x - pts[n - 3], y - pts[n - 2], z - pts[n - 1]);
      if (n && Math.hypot(x - pts[n - 3], z - pts[n - 1]) < .01) return; pts.push(x, y, z);
    };
    const hallFor = (a: Station, b: Station): Hall | undefined => {
      const e = world.city.ed.find(([x, y]) => (x === a.i && y === b.i) || (x === b.i && y === a.i));
      return e ? a.halls.find(h => h.l === e[2]) : a.halls[0];
    };
    for (let i = 0; i < seq.length; i++) {
      const A = seq[i].s, B = seq[i + 1]?.s, Prev = seq[i - 1]?.s;
      const h = B ? hallFor(A, B) : Prev ? hallFor(A, Prev) : A.halls[0]; if (!h) { bad = true; break; }
      const toward = B ?? A, from = Prev ?? A;
      // kierunek jazdy wzdłuż osi hali
      const dirX = B ? toward.x - A.x : A.x - from.x, dirZ = B ? toward.z - A.z : A.z - from.z;
      const sg = Math.sign(dirX * h.ux + dirZ * h.uz) || 1, dx = h.ux * sg, dz = h.uz * sg;
      // tor: prawy (lewy w Londynie) względem kierunku jazdy
      const off = (h.island ? h.W - 2.6 : 1.9) * side, rx = -dz * off, rz = dx * off;
      if (i > 0) push(A.x - dx * h.L + rx, h.y, A.z - dz * h.L + rz);
      push(A.x + rx, h.y, A.z + rz); if (seq[i].stop) stopS.push(len);
      if (B) push(A.x + dx * h.L + rx, h.y, A.z + dz * h.L + rz);
    }
    if (bad || stopS.length !== p.stops.length) { p.kind = 'rail'; failed++; continue; }
    p.setPath(pts, stopS); ok++;
  }
  return { ok, failed };
}

function bfs(adj: Map<number, number[]>, a: number, b: number): number[] | null {
  if (a === b) return [a];
  const prev = new Map<number, number>([[a, -1]]), q = [a];
  while (q.length) {
    const u = q.shift()!; if (u === b) break;
    for (const v of adj.get(u) || []) if (!prev.has(v)) { prev.set(v, u); q.push(v); }
  }
  if (!prev.has(b)) return null;
  const out = [b]; let u = b; while (prev.get(u)! >= 0) { u = prev.get(u)!; out.push(u); } return out.reverse();
}
