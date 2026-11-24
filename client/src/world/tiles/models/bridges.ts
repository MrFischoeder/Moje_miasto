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

// ======================= szablony konstrukcji i kolejne mosty =======================
const GREEN: RGB = [.25, .44, .32], GREY_STEEL: RGB = [.5, .54, .56], CONCRETE: RGB = [.62, .61, .58], CONCRETE_D: RGB = [.5, .49, .47], WHITE: RGB = [.9, .9, .88], LAMP: RGB = [.98, .9, .6];
type V3 = number[];
interface BridgeCtx { S: ModelSink; f: Frame; Y: (t: number) => number; P: (t: number, s: number, y: number) => V3; xz: (t: number, s: number) => XZ; W: number; D: number }
function ctx(S: ModelSink, f: Frame): BridgeCtx {
  const nx = -f.uz, nz = f.ux;
  return { S, f, Y: deck(S, f), W: f.W, D: f.D, P: (t, s, y) => [f.ox + f.ux * f.W * t + nx * s, y, f.oz + f.uz * f.W * t + nz * s], xz: (t, s) => [f.ox + f.ux * f.W * t + nx * s, f.oz + f.uz * f.W * t + nz * s] };
}
/** pomost: dźwigar pod jezdnią i balustrady */
function deckGirder(c: BridgeCtx, col: RGB, depth = 1.4, rail: RGB | null = GREY_STEEL): void {
  const { S, P, Y, D } = c;
  S.beam(P(0, 0, Y(0) - .2 - depth / 2), P(1, 0, Y(1) - .2 - depth / 2), D - .4, depth, col);
  if (rail) for (const s of [-(D / 2 - .2), D / 2 - .2]) S.beam(P(0, s, Y(0) + .55), P(1, s, Y(1) + .55), .18, 1.0, rail);
}
/** filary (ściany w poprzek mostu) co ok. step m, gdzie pod pomostem jest wolne miejsce */
function piers(c: BridgeCtx, step: number, col: RGB): void {
  const { S, Y, D, W } = c, n = Math.floor(W / step);
  for (let i = 1; i < n; i++) {
    const t = i / n, g = S.ground(...c.xz(t, 0)), top = Y(t) - 1.6; if (top - g < 1.5) continue;
    const q = (du: number, s: number) => c.xz(t + du / W, s);
    S.box(q(-1.2, -D / 2 + 1), q(1.2, -D / 2 + 1), q(1.2, D / 2 - 1), q(-1.2, D / 2 - 1), g - S.base - 2, top - S.base, col, null);
  }
}
/** latarnie wzdłuż balustrad */
function lamps(c: BridgeCtx, every: number, col: RGB): void {
  const { S, P, Y, D, W } = c, n = Math.max(1, Math.round(W / every));
  for (let i = 0; i <= n; i++) for (const s of [-(D / 2 - .3), D / 2 - .3]) { const t = i / n; S.beam(P(t, s, Y(t)), P(t, s, Y(t) + 4.2), .14, .14, col); S.beam(P(t, s, Y(t) + 4.2), P(t, s, Y(t) + 4.7), .45, .45, LAMP); }
}
/** kamienne słupy-obeliski na końcach mostu (z latarnią) */
function endPillars(c: BridgeCtx, h: number, col: RGB, t0 = .01, t1 = .99): void {
  for (const t of [t0, t1]) for (const s of [-(c.D / 2 + .6), c.D / 2 + .6]) {
    const ctr = c.xz(t, s), y = c.Y(t) - c.S.base, r = .9, q = (a: number, b: number): XZ => [ctr[0] + c.f.ux * a - c.f.uz * b, ctr[1] + c.f.uz * a + c.f.ux * b];
    c.S.box(q(-r, -r), q(r, -r), q(r, r), q(-r, r), y - .5, y + h, col, null);
    c.S.slab([q(-r - .2, -r - .2), q(r + .2, -r - .2), q(r + .2, r + .2), q(-r - .2, r + .2)], y + h, y + h + .3, GRANITE2);
    c.S.beam([ctr[0], c.S.base + y + h + .3, ctr[1]], [ctr[0], c.S.base + y + h + 1.6, ctr[1]], .5, .5, LAMP);
  }
}
/** kratownica po bokach (przy H >= 5 i szerokim moście: poprzecznice górne) */
function truss(c: BridgeCtx, H: number, col: RGB, inset = .3): void {
  const { S, P, Y, D, W } = c, n = Math.max(3, Math.round(W / (H * 1.1))), sides = [-(D / 2 - inset), D / 2 - inset];
  for (const s of sides) {
    S.beam(P(0, s, Y(0) + H), P(1, s, Y(1) + H), .45, .5, col); S.beam(P(0, s, Y(0) + .3), P(1, s, Y(1) + .3), .45, .6, col);
    for (let i = 0; i <= n; i++) { const t = i / n; S.beam(P(t, s, Y(t) + .3), P(t, s, Y(t) + H), .3, .3, col); if (i < n) { const t2 = (i + 1) / n; i % 2 ? S.beam(P(t, s, Y(t) + .3), P(t2, s, Y(t2) + H), .25, .25, col) : S.beam(P(t, s, Y(t) + H), P(t2, s, Y(t2) + .3), .25, .25, col); } }
  }
  if (H >= 5) for (let i = 0; i <= n; i++) { const t = i / n; S.beam(P(t, sides[0], Y(t) + H), P(t, sides[1], Y(t) + H), .3, .35, col); }
}
/** łuki nad jezdnią (most łukowy z jezdnią dołem) z wieszakami */
function archAbove(c: BridgeCtx, rise: number, col: RGB, lattice = false, t0 = .02, t1 = .98): void {
  const { S, P, Y, D } = c, N = 18, sides = [-(D / 2 - .4), D / 2 - .4];
  const ay = (t: number) => { const k = (t - (t0 + t1) / 2) / ((t1 - t0) / 2); return Y(t) + rise * (1 - k * k); };
  for (const s of sides) {
    for (let i = 0; i < N; i++) {
      const a = t0 + (t1 - t0) * i / N, b = t0 + (t1 - t0) * (i + 1) / N;
      S.beam(P(a, s, ay(a)), P(b, s, ay(b)), .6, .8, col);
      if (lattice) { S.beam(P(a, s, ay(a) - 1.6), P(b, s, ay(b) - 1.6), .4, .4, col); S.beam(P(a, s, ay(a)), P(b, s, ay(b) - 1.6), .2, .2, col); }
      if (i > 0) S.beam(P(a, s, Y(a) + .4), P(a, s, ay(a) - (lattice ? 1.6 : 0)), .16, .16, col);
    }
  }
  for (let i = 3; i <= N - 3; i += 3) { const t = t0 + (t1 - t0) * i / N; S.beam(P(t, sides[0], ay(t)), P(t, sides[1], ay(t)), .3, .3, col); }
}
/** łuk pod pomostem (kładki, mosty kamienne i żeliwne) ze słupkami */
function archBelow(c: BridgeCtx, col: RGB): void {
  const { S, P, Y, D, xz } = c, N = 14, g = Math.min(S.ground(...xz(.5, 0)), Y(.5) - 2), rise = Math.max(1.5, Math.min(8, Y(.5) - 1.6 - g));
  const ay = (t: number) => { const k = (t - .5) / .5; return Y(.5) - 1.6 - rise * k * k; };
  for (const s of [-(D / 2 - .5), D / 2 - .5]) for (let i = 0; i < N; i++) {
    const a = i / N, b = (i + 1) / N; S.beam(P(a, s, ay(a)), P(b, s, ay(b)), .7, .9, col);
    if (i) S.beam(P(a, s, ay(a)), P(a, s, Y(a) - .9), .25, .25, col);
  }
}
/** most wiszący (kładki): smukłe stalowe pylony-ramy i liny */
function suspension(c: BridgeCtx, col: RGB): void {
  const { S, P, Y, D, W } = c, H = Math.max(8, Math.min(28, W * .12)), tp = [.06, .94], sides = [-(D / 2 + .2), D / 2 + .2];
  for (const t of tp) { for (const s of sides) S.beam(P(t, s, Y(t) - 1), P(t, s, Y(t) + H), .5, .5, col); S.beam(P(t, sides[0], Y(t) + H), P(t, sides[1], Y(t) + H), .4, .5, col); }
  const cy = (t: number) => { if (t < tp[0]) return Y(t) + H * (t + .04) / (tp[0] + .04); if (t > tp[1]) return Y(t) + H * (1.04 - t) / (1.04 - tp[1]); const k = (t - .5) / (.5 - tp[0]); return Y(t) + 1 + (H - 1) * k * k; };
  const ts = [-.04, tp[0], ...Array.from({ length: 15 }, (_, i) => tp[0] + (tp[1] - tp[0]) * (i + 1) / 16), tp[1], 1.04];
  for (const s of sides) { for (let i = 0; i + 1 < ts.length; i++) S.beam(P(ts[i], s, cy(ts[i])), P(ts[i + 1], s, cy(ts[i + 1])), .15, .15, GREY_STEEL);
    for (let i = 2; i < ts.length - 2; i++) S.beam(P(ts[i], s, Y(ts[i]) + .3), P(ts[i], s, cy(ts[i])), .06, .06, GREY_STEEL); }
}
/** most podwieszany: pylon (na osi) i wachlarze want do krawędzi pomostu */
function cableStayed(c: BridgeCtx, col: RGB, tp = .5): void {
  const { S, P, Y, D, W } = c, span = Math.min(W, 520), H = Math.max(20, Math.min(125, span * .24)), y0 = Y(tp);
  const g = S.ground(...c.xz(tp, 0));
  // pylon w kształcie odwróconego Y: nogi przy krawędziach pomostu, zbiegają się nad osią
  for (const s of [-(D / 2 + .5), D / 2 + .5]) S.beam(P(tp, s, Math.min(g, y0) - 2), P(tp, s * .15, y0 + H * .55), 2.4, 2.4, col);
  S.beam(P(tp, 0, y0 + H * .55), P(tp, 0, y0 + H), 2.6, 2.6, col);
  const n = 10, reach = span / W / 2;
  for (const dir of [-1, 1]) for (let i = 1; i <= n; i++) {
    const t = tp + dir * reach * i / n, a = y0 + H * (.62 + .36 * i / n);
    for (const s of [-(D / 2 - 1), D / 2 - 1]) S.beam(P(tp, 0, a), P(t, s, Y(t) + .3), .12, .12, WHITE);
  }
}

/** Szablon wg bridge:structure z OSM */
export function buildBridgeTemplate(S: ModelSink, f: Frame, kind: string): void {
  const c = ctx(S, f), long = c.W > 45, steel = kind === 'truss' || kind === 'suspension' ? GREY_STEEL : CONCRETE;
  deckGirder(c, kind === 'beam' || !kind ? CONCRETE_D : STEEL_D, c.W > 120 ? 2.2 : 1.3);
  if (long) piers(c, kind === 'cable-stayed' ? 60 : 38, CONCRETE);
  if (kind === 'truss') truss(c, Math.max(2.5, Math.min(9, c.W * .1)), steel);
  else if (kind === 'arch') { if (long && c.D > 8) archAbove(c, Math.min(18, c.W * .17), STEEL); else archBelow(c, c.W > 30 ? STEEL : GRANITE2); }
  else if (kind === 'humpback') archBelow(c, GRANITE2);
  else if (kind === 'suspension') suspension(c, steel);
  else if (kind === 'cable-stayed') cableStayed(c, WHITE);
}

/** Most Zwierzyniecki (1897): stalowe łuki kratowe nad jezdnią, kamienne słupy z latarniami na końcach */
export function buildZwierzyniecki(S: ModelSink, f: Frame): void {
  const c = ctx(S, f); deckGirder(c, STEEL_D, 1.3, STEEL);
  archAbove(c, Math.min(14, c.W * .2), STEEL, true, .06, .94); endPillars(c, 5.5, GRANITE);
}
/** Most Tumski (1889): zielona, niska kratownica (kładka), latarnie, figury świętych na końcach */
export function buildTumski(S: ModelSink, f: Frame): void {
  const c = ctx(S, f); deckGirder(c, GREEN, 1.1, null); truss(c, 2.4, GREEN, .15); piers(c, 27, GRANITE2); lamps(c, 13, GREEN);
  for (const t of [-.02, 1.02]) { // cokoły z figurami (św. Jadwiga i św. Jan Chrzciciel)
    const ctr = c.xz(t, 0), y = c.Y(Math.max(0, Math.min(1, t))) - S.base, q = (a: number, b: number): XZ => [ctr[0] + f.ux * a - f.uz * b, ctr[1] + f.uz * a + f.ux * b];
    for (const s of [-(c.D / 2 + 1.2), c.D / 2 + 1.2]) { const p = (a: number, b: number) => q(a, b + s); S.box(p(-.8, -.8), p(.8, -.8), p(.8, .8), p(-.8, .8), y, y + 2.6, GRANITE, null); S.beam([...((): number[] => { const z = p(0, 0); return [z[0], S.base + y + 2.6, z[1]]; })()], [...((): number[] => { const z = p(0, 0); return [z[0], S.base + y + 4.6, z[1]]; })()], .7, .6, [.85, .84, .8]); }
  }
}
/** Most Piaskowy: niska kratownica z kutą balustradą i latarniami, kamienne przyczółki */
export function buildPiaskowy(S: ModelSink, f: Frame): void {
  const c = ctx(S, f); deckGirder(c, STEEL_D, 1.2, null); truss(c, 1.8, [.3, .33, .32], .2); lamps(c, 10, [.2, .22, .22]); endPillars(c, 2.2, GRANITE);
}
/** Most Pokoju: stalowy dźwigar o zmiennej wysokości (głębszy przy filarach), latarnie */
export function buildPokoju(S: ModelSink, f: Frame): void {
  const c = ctx(S, f); deckGirder(c, STEEL, 1.6); piers(c, 40, CONCRETE); lamps(c, 20, GREY_STEEL);
  for (const s of [-(c.D / 2 - .3), c.D / 2 - .3]) for (let i = 0; i < 12; i++) { // skosy: dźwigar głębszy przy podporach
    const a = i / 12, b = (i + 1) / 12, d = (t: number) => 1.4 + 2.2 * Math.abs(Math.cos(t * Math.PI * 3)); c.S.beam(c.P(a, s, c.Y(a) - d(a)), c.P(b, s, c.Y(b) - d(b)), .5, .7, STEEL);
  }
}
/** Mosty Pomorskie: dźwigar, granitowe słupy-portale z latarniami na końcach, zielone balustrady */
export function buildPomorski(S: ModelSink, f: Frame): void {
  const c = ctx(S, f); deckGirder(c, CONCRETE_D, 1.4, GREEN); if (c.W > 45) piers(c, 30, GRANITE2); endPillars(c, 4.5, GRANITE); lamps(c, 18, GREEN);
}
