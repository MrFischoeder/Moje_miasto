// Test dostępności wnętrza: przeszukanie wszerz po siatce 0,2 m fizyką chodzenia (support świata),
// od drzwi zewnętrznych; zwraca pomieszczenia, do których nie da się dojść. Używane w testach i narzędziach.
import type { World } from '../world/world';
import { inRect, toLocal, toWorld } from './geom';
import type { Live } from './interiors';

export function unreachable(w: World, lv: Live, floors: number[]): string[] {
  const p = lv.plan, f = p.frame, [a, b2, c, d] = lv.box, G = .2;
  const seen = new Set<string>(), q: [number, number, number][] = [];
  const push = (x: number, z: number, y: number) => { const k = Math.round(x / G) + ',' + Math.round(z / G) + ',' + Math.round(y * 2); if (seen.has(k)) return; seen.add(k); q.push([x, z, y]); };
  for (const e of p.ext) { const [x, z] = toWorld(f, e.x, -e.tOut + .15); const s = w.support(x, z, e.g + .3); if (s) push(x, z, s.h); }
  const hits: [number, number, number][] = [];
  while (q.length && seen.size < 3000000) {
    const [x, z, y] = q.pop()!; hits.push([x, z, y]);
    for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G]]) {
      const nx = x + dx, nz = z + dz; if (nx < a - 4 || nx > b2 + 4 || nz < c - 4 || nz > d + 4) continue;
      const s = w.support(nx, nz, y); if (!s) continue;
      push(nx, nz, s.h);
    }
  }
  const out: string[] = [];
  for (const k of floors) {
    const L = lv.levels.get(k); if (!L) continue;
    for (const bx of L.level.boxes) {
      if (bx.kind === 'stair') continue;
      const F = p.f0 + k * p.H;
      const m = Math.min(.3, Math.min(bx.r.x1 - bx.r.x0, bx.r.y1 - bx.r.y0) / 2 - .15);
      const ok = hits.some(([x, z, y]) => { const [lx, ly] = toLocal(f, x, z); return Math.abs(y - F) < .3 && inRect(bx.r, lx, ly, -m); });
      if (!ok) out.push(`${bx.name} (${bx.kind}, ${bx.unit}) p.${k}`);
    }
  }
  return out;
}
