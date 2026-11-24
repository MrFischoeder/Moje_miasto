// Kamienice Starego Miasta (szablon): pastelowe fasady, dach szczytem do ulicy, ozdobny szczyt od frontu w jednym
// z czterech stylów (gotycki schodkowy, barokowy z wolutami, klasycystyczny z frontonem, renesansowa attyka), gzyms.
import type { RGB } from '@miasto/shared/util/rng';
import type { ModelSink } from './sink';

type XZ = [number, number];
export const KAM_T = ['yes', 'apartments', 'residential', 'commercial', 'retail', 'house', 'hotel', 'office', 'terrace', 'civic', 'public'];
/** pastelowe fasady wrocławskiego Rynku */
const PASTEL: RGB[] = [[.93, .74, .7], [.96, .86, .56], [.72, .84, .72], [.74, .8, .9], [.93, .72, .52], [.9, .88, .82], [.62, .76, .62],
  [.96, .9, .78], [.82, .56, .46], [.86, .78, .9], [.98, .8, .66], [.7, .86, .84]];
const TRIM: RGB = [.96, .95, .9], ROOF: RGB[] = [[.58, .26, .17], [.5, .22, .15], [.64, .32, .2]];

export function kamColors(seed: number): { wall: RGB; roof: RGB; style: number } {
  const i = Math.floor(seed * 9973);
  return { wall: PASTEL[i % PASTEL.length], roof: ROOF[(i >> 3) % ROOF.length], style: (i >> 5) % 4 };
}

/** Indeks ściany frontowej: najbliższej drogi lub placu (punkty dróg kafla), z długością co najmniej 4 m. */
export function frontEdge(ring: XZ[], roads: number[], square?: { c: XZ; inner: number; outer: number }): number {
  // przy placu rynkowym: pierzeje zwrócone do środka placu, blok śródrynkowy na zewnątrz
  if (square) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length, d = Math.hypot(cx - square.c[0], cz - square.c[1]);
    if (d < square.outer) {
      const sgn = d < square.inner ? -1 : 1, ar = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
      let best = -1, bs = -Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 4) continue;
        const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L, nx = ar > 0 ? dz : -dz, nz = ar > 0 ? -dx : dx;
        const tx = square.c[0] - (a[0] + c[0]) / 2, tz = square.c[1] - (a[1] + c[1]) / 2, tl = Math.hypot(tx, tz) || 1;
        const s = sgn * (nx * tx + nz * tz) / tl + L * .01; if (s > bs) { bs = s; best = i; }
      }
      if (best >= 0 && bs > .5) return best;
    }
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 4) continue;
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2; let d = Infinity;
    for (let k = 0; k < roads.length; k += 2) { const e = (roads[k] - mx) ** 2 + (roads[k + 1] - mz) ** 2; if (e < d) d = e; }
    d -= L * L * .02; // przy podobnej odległości dłuższa ściana
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Ozdobny szczyt na ścianie frontowej a→c (normalna n na zewnątrz), nad okapem y0 (względem gruntu), wysokość rh.
 * Bryły lekko wysunięte przed lico ściany; zasłaniają trójkąt szczytu dachu.
 */
export function buildGable(S: ModelSink, a: XZ, c: XZ, n: [number, number], y0: number, rh: number, style: number, wall: RGB, seed: number): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, m: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const at = (t: number, o: number): XZ => [m[0] + ux * t + n[0] * o, m[1] + uz * t + n[1] * o];
  const panel = (w: number, ya: number, yb: number, col: RGB, win: boolean) => S.box(at(-w / 2, -.4), at(w / 2, -.4), at(w / 2, .25), at(-w / 2, .25), ya, yb, col,
    win && w > 2.4 ? { levelH: yb - ya, spacing: Math.min(2.4, w / 2), ww: .8, wh: (yb - ya) * .5, sill: (yb - ya) * .22, raise: ya, levels: 1, mat: 0, arch: style === 0 } : null);
  S.slab([at(-L / 2 - .1, -.3), at(L / 2 + .1, -.3), at(L / 2 + .1, .45), at(-L / 2 - .1, .45)], y0 - .5, y0, TRIM); // gzyms
  const W = L - .2;
  if (style === 0) { // gotycki schodkowy
    const k = Math.max(3, Math.min(6, Math.round(rh / 1.6))), sh = rh * 1.1 / k;
    for (let i = 0; i < k; i++) { const w = W * (1 - i / k), ya = y0 + i * sh; panel(w, ya, ya + sh, wall, true); S.spire(at(-w / 2 + .3, 0), ya + sh, .22, 1.2, TRIM); S.spire(at(w / 2 - .3, 0), ya + sh, .22, 1.2, TRIM); }
  } else if (style === 1) { // barokowy: zaokrąglone zwężenie, woluty, sterczyna z kulą
    const k = 5, sh = rh * 1.05 / k;
    for (let i = 0; i < k; i++) { const w = W * Math.cos(i / k * Math.PI / 2.3), ya = y0 + i * sh; panel(Math.max(1.6, w), ya, ya + sh, wall, i < 3); }
    for (const s of [-1, 1]) S.box(at(s * W * .42 - .3, 0), at(s * W * .42 + .3, 0), at(s * W * .42 + .3, .5), at(s * W * .42 - .3, .5), y0, y0 + sh * 1.4, TRIM, null);
    S.spire(at(0, 0), y0 + rh * 1.05, .35, 1.6, [.8, .65, .3]);
  } else if (style === 2) { // klasycystyczny: attyka i trójkątny fronton
    panel(W, y0, y0 + 1.2, wall, false);
    const tA = at(-W / 2, .3), tB = at(W / 2, .3), tC = at(0, .3), Y = S.base + y0 + 1.2, nrm = [n[0], 0, n[1]];
    S.tri([tA[0], Y, tA[1]], [tB[0], Y, tB[1]], [tC[0], Y + Math.min(rh * .55, W * .3), tC[1]], TRIM, nrm);
    panel(W, y0 + 1.2, y0 + 1.5, TRIM, false);
  } else { // renesansowa attyka z pinaklami
    panel(W, y0, y0 + 2.6, wall, false); S.slab([at(-W / 2, -.45), at(W / 2, -.45), at(W / 2, .35), at(-W / 2, .35)], y0 + 2.6, y0 + 2.9, TRIM);
    const k = Math.max(2, Math.round(W / 3)); for (let i = 0; i <= k; i++) S.spire(at(-W / 2 + W * i / k, 0), y0 + 2.9, .25, 1.4 + (seed * 3 % 1), TRIM);
  }
}
