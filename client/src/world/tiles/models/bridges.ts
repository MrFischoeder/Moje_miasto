// Mosty Wrocławia (własne modele): rama = oś mostu z jezdni w OSM (ox, oz = początek, u = kierunek, W = długość, D = szerokość).
// Pomost rysuje jezdnia z kafla (wysokość z brzegów, jak shared/world/bridges.ts); model dokłada konstrukcję.
import type { RGB } from '@miasto/shared/util/rng';
import { addRoof } from '../roofs';
import type { Frame, ModelSink } from './sink';

type XZ = [number, number];
const GRANITE: RGB = [.74, .71, .64], GRANITE2: RGB = [.66, .63, .57], STEEL: RGB = [.42, .5, .49], STEEL_D: RGB = [.3, .35, .35], DECK: RGB = [.36, .36, .38];

/** wysokość pomostu wzdłuż mostu (t = 0..1): brzegi = wyższa z (koniec, 12 m dalej na lądzie) */
function deck(S: ModelSink, f: Frame): (t: number) => number {
  const A: XZ = [f.ox, f.oz], B: XZ = [f.ox + f.ux * f.W, f.oz + f.uz * f.W];
  const ha = Math.max(S.ground(A[0], A[1]), S.ground(A[0] - f.ux * 12, A[1] - f.uz * 12)), hb = Math.max(S.ground(B[0], B[1]), S.ground(B[0] + f.ux * 12, B[1] + f.uz * 12));
  return t => ha + (hb - ha) * Math.max(0, Math.min(1, t)) + .15;
}

/**
 * Most Grunwaldzki (1910): wiszący, przęsło ok. 112 m; cztery kamienne pylony (po dwa na brzegach) z gzymsem
 * i zwieńczeniem, łańcuchy z płaskowników zwisające po paraboli i zakotwione za pylonami, pionowe wieszaki,
 * dźwigary boczne, stalowe barwy szarozielonej.
 */
export function buildGrunwaldzki(S: ModelSink, f: Frame): void {
  const { W, D } = f, Y = deck(S, f), nx = -f.uz, nz = f.ux;
  const P = (t: number, s: number, y: number) => [f.ox + f.ux * W * t + nx * s, y, f.oz + f.uz * W * t + nz * s];
  const xz = (t: number, s: number): XZ => [f.ox + f.ux * W * t + nx * s, f.oz + f.uz * W * t + nz * s];
  const off = D / 2 + .8, tp = [.035, .965], top = 16.5, low = 1.3;
  // spód pomostu i dźwigary boczne
  S.beam(P(.03, 0, Y(.03) - .85), P(.97, 0, Y(.97) - .85), D - 1, .9, DECK);
  for (const s of [-off, off]) S.beam(P(0, s, Y(0) - .2), P(1, s, Y(1) - .2), .6, 1.2, STEEL_D);
  // pylony
  for (const t of tp) for (const s of [-off, off]) {
    const c = xz(t, s), y0 = Y(t) - 6 - S.base, y1 = Y(t) + 14 - S.base, r = 2.3, q = (a: number, b: number): XZ => [c[0] + f.ux * a + nx * b, c[1] + f.uz * a + nz * b];
    S.box(q(-r, -r), q(r, -r), q(r, r), q(-r, r), y0, y1, GRANITE, { levelH: 20, spacing: 3.2, ww: 1.1, wh: 3.2, sill: 13, raise: y0, levels: 1, mat: 2, arch: true });
    S.slab([q(-r - .4, -r - .4), q(r + .4, -r - .4), q(r + .4, r + .4), q(-r - .4, r + .4)], y1, y1 + .8, GRANITE2);
    const r2 = 1.8; S.box(q(-r2, -r2), q(r2, -r2), q(r2, r2), q(-r2, r2), y1 + .8, y1 + 5, GRANITE, null);
    S.slab([q(-r2 - .3, -r2 - .3), q(r2 + .3, -r2 - .3), q(r2 + .3, r2 + .3), q(-r2 - .3, r2 + .3)], y1 + 5, y1 + 5.5, GRANITE2);
    addRoof(S, [q(-r2, -r2), q(r2, -r2), q(r2, r2), q(-r2, r2)], S.base + y1 + 5.5, 3.2, 'pyramidal', false, STEEL_D, GRANITE);
    S.spire(c, y1 + 8.7, .18, 1.4, [.8, .65, .3]);
  }
  // łańcuchy: kotwa za pylonem -> wierzch pylonu -> parabola nad przęsłem -> wierzch pylonu -> kotwa
  const chainY = (t: number) => {
    if (t <= tp[0]) return Y(t) + .6 + (top - .6) * (t + .06) / (tp[0] + .06);
    if (t >= tp[1]) return Y(t) + .6 + (top - .6) * (1.06 - t) / (1.06 - tp[1]);
    const m = (tp[0] + tp[1]) / 2, k = (t - m) / (m - tp[0]); return Y(t) + low + (top - low) * k * k;
  };
  const ts: number[] = [-.06, tp[0]]; for (let i = 1; i < 24; i++) ts.push(tp[0] + (tp[1] - tp[0]) * i / 24); ts.push(tp[1], 1.06);
  for (const s of [-off, off]) {
    for (let i = 0; i + 1 < ts.length; i++) S.beam(P(ts[i], s, chainY(ts[i])), P(ts[i + 1], s, chainY(ts[i + 1])), .55, 1.1, STEEL);
    // wieszaki co ok. 4,5 m
    const n = Math.round(W * (tp[1] - tp[0]) / 4.5);
    for (let i = 1; i < n; i++) { const t = tp[0] + (tp[1] - tp[0]) * i / n; S.beam(P(t, s, Y(t) + .3), P(t, s, chainY(t) - .5), .16, .16, STEEL); }
    // bloki kotwiące
    for (const t of [-.06, 1.06]) { const c = xz(t, s), q = (a: number, b: number): XZ => [c[0] + f.ux * a + nx * b, c[1] + f.uz * a + nz * b]; S.box(q(-2, -1.5), q(2, -1.5), q(2, 1.5), q(-2, 1.5), Y(t) - S.base - 1, Y(t) - S.base + 1.2, GRANITE2, null); }
  }
}
