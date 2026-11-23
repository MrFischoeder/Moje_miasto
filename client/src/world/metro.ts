// Bryły podziemi na podstawie układu metra (shared/world/metro/layout).
import type * as THREE from 'three';
import type { CityData } from '@miasto/shared/data/cities';
import { hex, mix, type RGB } from '@miasto/shared/util/rng';
import type { MetroLayout } from '@miasto/shared/world/metro/layout';
import { GeoBuilder, V, type V3 } from './geometry';

export function buildMetroObjects(m: MetroLayout, city: CityData): THREE.Object3D[] {
  const G = new GeoBuilder();
  // hale: tory, krawędzie peronów, filary, pasy w kolorze linii
  for (const s of m.stations) s.halls.forEach(h => {
    const lc = hex(city.lines[h.l].c), wallC = mix(lc, .18, [.58, .58, .56]), edgeC = mix(lc, .7, [.06, .06, .06]); // jasne płytki z barwą linii
    const u: [number, number] = [h.ux, h.uz], n: [number, number] = [-h.uz, h.ux], r = h.reg;
    G.shell(r, h.H, wallC, edgeC, { surf: h.surf, left: h.side.left, right: h.side.right, start: h.start as [number, number], end: h.end as [number, number], lights: [-h.W / 3, h.W / 3] });
    const o = r.a, L2 = h.L * 2, tr = h.island ? [-(h.W - 2.6), h.W - 2.6] : [-1.9, 1.9], ed = h.island ? [-(h.W - 4.3), h.W - 4.3] : [-3.6, 3.6];
    for (const ts of tr) for (const g of [-.72, .72]) G.line(V(o, u, n, 0, ts + g, h.y + .02), V(o, u, n, L2, ts + g, h.y + .02), [.45, .5, .5]);
    for (const es of ed) G.line(V(o, u, n, 0, es, h.y + .03), V(o, u, n, L2, es, h.y + .03), [1, .85, .2]);
    for (const sd of [-1, 1]) G.line(V(o, u, n, 0, sd * (h.W - .02), h.y + 2.4), V(o, u, n, L2, sd * (h.W - .02), h.y + 2.4), mix(lc, 1));
    const pr = h.island ? (h.W - 7 > 1.2 ? [-(h.W - 7), h.W - 7] : [0]) : [0], step = h.pillarStep;
    for (let t = step; t < L2 - 4; t += step) for (const ps of pr) { const p = V(o, u, n, t, ps, 0); G.box(p[0], p[2], h.y, .45, .45, h.H, u, mix(wallC, .85), edgeC); }
  });
  // tunele: rura o 8 bokach, cięta co 25 m, pierścienie co 15 m
  for (const tn of m.tunnels) {
    const lc = hex(city.lines[tn.l].c), dx = tn.b[0] - tn.a[0], dz = tn.b[1] - tn.a[1], len = Math.hypot(dx, dz); if (len < 1) continue;
    const u: [number, number] = [dx / len, dz / len], n: [number, number] = [-u[1], u[0]], o = tn.a, yA = tn.ya, yB = tn.yb, yAt = (t: number) => yA + (yB - yA) * t / len;
    const SEG = 8, ring = (t: number, j: number) => { const a = j / SEG * Math.PI * 2; return V(o, u, n, t, Math.cos(a) * 2.8, yAt(t) + 2.2 + Math.sin(a) * 2.8); };
    const wc: RGB = [.4, .4, .42]; // beton
    const nseg = Math.max(1, Math.ceil(len / 25));
    for (let q = 0; q < nseg; q++) {
      const t0 = len * q / nseg, t1 = len * (q + 1) / nseg;
      for (let j = 0; j < SEG; j++) { const a = (j + .5) / SEG * Math.PI * 2; G.quad(ring(t0, j), ring(t1, j), ring(t1, j + 1), ring(t0, j + 1), wc, [-Math.cos(a) * n[0], -Math.sin(a), -Math.cos(a) * n[1]]); }
      G.quad(V(o, u, n, t0, -1.6, yAt(t0)), V(o, u, n, t1, -1.6, yAt(t1)), V(o, u, n, t1, 1.6, yAt(t1)), V(o, u, n, t0, 1.6, yAt(t0)), mix(wc, 1.5), [0, 1, 0]);
    }
    const rc: RGB = [.28, .28, .3];
    for (let t = 0; t <= len; t += 15) for (let j = 0; j < SEG; j++) G.line(ring(t, j), ring(t, j + 1), rc);
    for (const g of [-.72, .72]) G.line(V(o, u, n, 0, g, yA + .02), V(o, u, n, len, g, yB + .02), [.45, .5, .5]);
    G.line(V(o, u, n, 0, -2.6, yA + 2.6), V(o, u, n, len, -2.6, yB + 2.6), mix(lc, .9));
  }
  // przesiadki
  for (const rp of m.ramps) {
    const r = rp.reg, h = m.stations[rp.s].halls[rp.hall], up = m.stations[rp.s].halls[rp.up];
    const lc = hex(city.lines[h.l].c); G.shell(r, 3.2, mix(lc, .15, [.58, .58, .56]), mix(lc, .6), { start: 'open', end: 'open', steps: [.35, .35, .36], surf: m.stations[rp.s].surf });
    const o = r.a, u = r.u, n = r.n, y = up.y + .04; // obrys otworu w posadzce
    for (const [a, b, c, d] of [[0, -1.8, 1.6, -1.8], [1.6, -1.8, 1.6, 1.8], [1.6, 1.8, 0, 1.8], [0, 1.8, 0, -1.8]]) G.line(V(o, u, n, a, b, y), V(o, u, n, c, d, y), [1, .85, .2]);
  }
  // zejścia (korytarz, schody, pawilon) i lokale
  for (const s of m.stations) {
    if (!s.halls[0]) continue;
    const wallC: RGB = [.64, .64, .62], edgeC: RGB = [.3, .32, .32];
    for (const e of s.exitGeoms) {
      if (e.corr) G.shell(e.corr, 3.2, wallC, edgeC, { start: 'open', end: 'open', lights: [0], surf: s.surf });
      G.shell(e.stair, 3.2, wallC, edgeC, { start: 'open', end: 'open', steps: [.35, .35, .36], lights: [0], surf: e.surfMin });
      const P4 = e.P4, kc: RGB = [.25, .27, .3], g = e.ty; // pawilon: słupki i zadaszenie
      for (let i = 0; i < 4; i++) { const a = P4[i], b = P4[(i + 1) % 4]; G.line([a[0], g + 3, a[1]], [b[0], g + 3, b[1]], kc); G.line([a[0], g, a[1]], [a[0], g + 3, a[1]], kc); }
      const at = (i: number, y: number): V3 => [P4[i][0], g + y, P4[i][1]];
      G.quad(at(0, 3.02), at(1, 3.02), at(2, 3.02), at(3, 3.02), [.42, .45, .48], [0, 1, 0]);
      G.quad(at(0, 2.98), at(1, 2.98), at(2, 2.98), at(3, 2.98), [.78, .8, .82], [0, -1, 0]);
    }
    for (const q of s.rooms) {
      G.shell(q.corr!, 3, wallC, [.3, .32, .32], { start: 'open', end: 'open', lights: [0], surf: s.surf });
      G.shell(q.room!, 3.6, [.72, .66, .56], [.35, .3, .2], { start: [3, 2.6], lights: [-q.rw / 2, q.rw / 2], surf: s.surf });
    }
  }
  return G.build();
}
