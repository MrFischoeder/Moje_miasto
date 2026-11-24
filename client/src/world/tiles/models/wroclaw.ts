// Własne modele landmarków Wrocławia (low-poly): Archikatedra na Ostrowie Tumskim, Hala Stulecia z Iglicą,
// kościół NMP na Piasku, Gmach Główny Uniwersytetu z Wieżą Matematyczną, Sky Tower.
// Każdy model w układzie prostokąta opisanego na obrysie z OSM (u wzdłuż, v w poprzek), wysokości od gruntu.
import type { RGB } from '@miasto/shared/util/rng';
import { addRoof } from '../roofs';
import type { Fac, Frame, ModelSink } from './sink';

type XZ = [number, number];
const BRICK: RGB = [.55, .27, .18], BRICK2: RGB = [.5, .25, .17], COPPER: RGB = [.42, .62, .52], TILE: RGB = [.55, .24, .15];
const CONCRETE: RGB = [.74, .72, .67], CONCRETE2: RGB = [.66, .64, .6], STEEL: RGB = [.78, .8, .83], GLASS: RGB = [.5, .62, .72];
const OCHRE: RGB = [.88, .8, .6], WHITE: RGB = [.92, .9, .84], DARK: RGB = [.2, .2, .22], GOLD: RGB = [.85, .7, .3];

/** rama z osią u skierowaną na wschód (obrót o 180°, gdy obrys z OSM wskazuje na zachód) */
function east(f: Frame): Frame {
  if (f.ux >= 0) return f;
  return { ox: f.ox + f.ux * f.W - f.uz * f.D, oz: f.oz + f.uz * f.W + f.ux * f.D, ux: -f.ux, uz: -f.uz, W: f.W, D: f.D };
}
const at = (f: Frame) => (u: number, v: number): XZ => [f.ox + f.ux * u - f.uz * v, f.oz + f.uz * u + f.ux * v];
/** wielokąt foremny (n boków) wokół c, obrócony o rot */
const ngon = (c: XZ, r: number, n: number, rot = 0): XZ[] => Array.from({ length: n }, (_, i) => { const a = rot + (i + .5) / n * Math.PI * 2; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as XZ; });
/** łuk: punkty od kąta a0 do a1 (n odcinków) */
const arc = (c: XZ, r: number, a0: number, a1: number, n: number): XZ[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as XZ; });
const center = (r: XZ[]): XZ => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
/** ściany wzdłuż wielokąta */
function walls(S: ModelSink, ring: XZ[], y0: number, y1: number, col: RGB, fac: Fac | null): void {
  const c = center(ring); for (let i = 0; i < ring.length; i++) S.wall(ring[i], ring[(i + 1) % ring.length], y0, y1, col, fac, c);
}
/** prostokąt w układzie ramy: u0..u1 × v0..v1 */
const rect = (P: (u: number, v: number) => XZ, u0: number, v0: number, u1: number, v1: number): XZ[] => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
/** płaski pierścień między dwoma wielokątami (ten sam podział) na wysokości y */
function annulus(S: ModelSink, a: XZ[], b: XZ[], y: number, col: RGB): void {
  const Y = S.base + y, up = [0, 1, 0];
  for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; S.tri([a[i][0], Y, a[i][1]], [a[j][0], Y, a[j][1]], [b[j][0], Y, b[j][1]], col, up); S.tri([a[i][0], Y, a[i][1]], [b[j][0], Y, b[j][1]], [b[i][0], Y, b[i][1]], col, up); }
}
const gothic = (lh: number, sp = 4.2, ww = 1.8): Fac => ({ levelH: lh, spacing: sp, ww, wh: lh * .62, sill: lh * .2, raise: 0, levels: 1, mat: 1, arch: true });

// ---------------- Archikatedra św. Jana Chrzciciela (Ostrów Tumski) ----------------
export function buildKatedra(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, vm = D / 2;
  // nawa główna, nawy boczne, prezbiterium z zamknięciem wielobocznym, kaplica mariacka
  const nave = rect(P, W * .2, vm - 7.5, W * .78, vm + 7.5);
  walls(S, nave, 0, 26, BRICK, gothic(24, 4.5, 2)); addRoof(S, nave, S.base + 26, 17, 'gabled', false, COPPER, BRICK);
  for (const s of [-1, 1]) {
    const a = rect(P, W * .2, vm + s * 7.5, W * .78, vm + s * 15);
    walls(S, a, 0, 15, BRICK2, gothic(14, 4.5, 1.8)); addRoof(S, a, S.base + 15, 5, 'skillion', false, COPPER, BRICK2);
  }
  const choir = rect(P, W * .78, vm - 7, W * .9, vm + 7);
  walls(S, choir, 0, 24, BRICK, gothic(22, 3.6, 1.8)); addRoof(S, choir, S.base + 24, 14, 'gabled', false, COPPER, BRICK);
  const ro = Math.atan2(f.uz, f.ux), apseC = P(W * .9, vm), ap = arc(apseC, 7, ro - Math.PI / 2, ro + Math.PI / 2, 5);
  for (let i = 0; i + 1 < ap.length; i++) S.wall(ap[i], ap[i + 1], 0, 24, BRICK, gothic(22, 3, 1.5), apseC);
  addRoof(S, ngon(apseC, 6.8, 8, Math.atan2(f.uz, f.ux)), S.base + 24, 12, 'cone', false, COPPER, BRICK);
  const lady = rect(P, W * .93, vm - 5, W * .995, vm + 5); // kaplica Mariacka
  walls(S, lady, 0, 14, BRICK2, gothic(13, 3, 1.4)); addRoof(S, lady, S.base + 14, 7, 'hipped', false, COPPER, BRICK2);
  // dwie wieże zachodnie z miedzianymi iglicami (98 m)
  for (const s of [-1, 1]) {
    const tc = P(W * .11, vm + s * 10.5), t = rect((u, v) => [tc[0] + f.ux * u - f.uz * v, tc[1] + f.uz * u + f.ux * v], -5.5, -5.5, 5.5, 5.5);
    walls(S, t, 0, 60, BRICK, { levelH: 12, spacing: 2.8, ww: 1.3, wh: 6, sill: 4, raise: 0, levels: 5, mat: 1, arch: true });
    for (const c of t) S.spire(c, 60, .7, 6, BRICK2); // narożne sterczyny
    const o = ngon(tc, 4.8, 8, Math.atan2(f.uz, f.ux) + Math.PI / 8);
    walls(S, o, 60, 63, BRICK2, null);
    addRoof(S, o, S.base + 63, 35, 'pyramidal', false, COPPER, BRICK);
    S.spire(tc, 98, .15, 2.5, GOLD); // krzyż/kula
  }
  // fasada zachodnia między wieżami: szczyt z wielkim oknem
  S.box(P(W * .09, vm - 5), P(W * .2, vm - 5), P(W * .2, vm + 5), P(W * .09, vm + 5), 0, 30, BRICK, { levelH: 28, spacing: 9, ww: 4.5, wh: 15, sill: 9, raise: 0, levels: 1, mat: 1, arch: true });
  S.spire(P(W * .1, vm), 30, 2.5, 8, BRICK2);
}

// ---------------- Hala Stulecia (z kopułą schodkową) ----------------
export function buildHala(S: ModelSink, f: Frame): void {
  const P = at(f), c = P(f.W / 2, f.D / 2), rot = Math.atan2(f.uz, f.ux), N = 24, R0 = Math.min(f.W, f.D) * .33;
  // cztery absydy (półkola) na osiach
  for (let k = 0; k < 4; k++) {
    const a = rot + k * Math.PI / 2, ac: XZ = [c[0] + Math.cos(a) * R0 * .95, c[1] + Math.sin(a) * R0 * .95];
    const sorted = arc(ac, R0 * .55, a - Math.PI / 2, a + Math.PI / 2, 8);
    for (let i = 0; i + 1 < sorted.length; i++) S.wall(sorted[i], sorted[i + 1], 0, 19.5, CONCRETE, { levelH: 19.5, spacing: 2.6, ww: 1.8, wh: 9, sill: 8, raise: 0, levels: 1, mat: 0, arch: false }, ac);
    addRoof(S, ngon(ac, R0 * .55, 16, a), S.base + 19.5, 3, 'dome', false, CONCRETE2, CONCRETE);
  }
  // bęben i cztery schodkowe pierścienie z pasami okien
  const tiers: [number, number, number][] = [[1, 0, 19.5], [.86, 19.5, 26], [.72, 26, 31.5], [.58, 31.5, 36.5], [.44, 36.5, 40]];
  let prev: XZ[] | null = null;
  for (const [k, y0, y1] of tiers) {
    const ring = ngon(c, R0 * k, N, rot);
    if (prev) annulus(S, prev, ring, y0, CONCRETE2);
    walls(S, ring, y0, y1, CONCRETE, { levelH: y1 - y0, spacing: 1.6, ww: 1.2, wh: (y1 - y0) * .62, sill: (y1 - y0) * .2, raise: y0, levels: 1, mat: 0, arch: false });
    prev = ring;
  }
  const top = ngon(c, R0 * .44, N, rot), lan = ngon(c, R0 * .2, N, rot);
  annulus(S, top, lan, 40, CONCRETE2);
  walls(S, lan, 40, 43, CONCRETE, { levelH: 3, spacing: 1.2, ww: .8, wh: 2, sill: .5, raise: 40, levels: 1, mat: 0, arch: false });
  addRoof(S, lan, S.base + 43, 2.5, 'dome', false, CONCRETE2, CONCRETE);
}

/** Iglica: stalowa igła (90 m) na trzech nogach */
export function buildIglica(S: ModelSink, f: Frame): void {
  const c: XZ = [f.ox + f.W / 2, f.oz + f.D / 2], J = 14, Y = S.base;
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2, foot: XZ = [c[0] + Math.cos(a) * 7, c[1] + Math.sin(a) * 7];
    const b = ngon(foot, .45, 3, a), top = [c[0], Y + J, c[1]], C = [foot[0] * .5 + c[0] * .5, Y + J * .4, foot[1] * .5 + c[1] * .5];
    for (let i = 0; i < 3; i++) { const p = b[i], q = b[(i + 1) % 3]; tri(S, [p[0], Y, p[1]], [q[0], Y, q[1]], top, STEEL, C); }
  }
  addRoof(S, ngon(c, .9, 8), Y + J - 1, 90.3 - J + 1, 'cone', false, STEEL, STEEL);
}
function tri(S: ModelSink, a: number[], b: number[], c: number[], col: RGB, C: number[]): void {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const m = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => v / m);
  if (n[0] * ((a[0] + b[0] + c[0]) / 3 - C[0]) + n[1] * ((a[1] + b[1] + c[1]) / 3 - C[1]) + n[2] * ((a[2] + b[2] + c[2]) / 3 - C[2]) < 0) n = n.map(v => -v);
  S.tri(a, b, c, col, n);
}

// ---------------- Kościół NMP na Piasku ----------------
export function buildPiasek(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, vm = D / 2;
  const hall = rect(P, W * .16, vm - D * .4, W * .86, vm + D * .4);
  walls(S, hall, 0, 22, BRICK, gothic(20, 4.6, 2.2));
  addRoof(S, hall, S.base + 22, 24, 'gabled', false, TILE, BRICK); // bardzo wysoki dach halowy
  // prezbiterium z zamknięciem wielobocznym
  const ch = rect(P, W * .86, vm - D * .3, W * .93, vm + D * .3);
  walls(S, ch, 0, 21, BRICK, gothic(19, 3.6, 1.8)); addRoof(S, ch, S.base + 21, 18, 'gabled', false, TILE, BRICK);
  const ac = P(W * .93, vm), apse = ngon(ac, D * .3, 8, Math.atan2(f.uz, f.ux));
  walls(S, apse, 0, 21, BRICK, gothic(19, 2.8, 1.5)); addRoof(S, apse, S.base + 21, 14, 'cone', false, TILE, BRICK);
  // masywna wieża zachodnia z niskim hełmem
  const tc = P(W * .085, vm), t = rect((u, v) => [tc[0] + f.ux * u - f.uz * v, tc[1] + f.uz * u + f.ux * v], -6.5, -6.5, 6.5, 6.5);
  walls(S, t, 0, 52, BRICK2, { levelH: 13, spacing: 3.2, ww: 1.6, wh: 7, sill: 3.5, raise: 0, levels: 4, mat: 1, arch: true });
  addRoof(S, t, S.base + 52, 6, 'pyramidal', false, TILE, BRICK2);
  S.spire(tc, 58, .12, 2.2, GOLD);
}

// ---------------- Uniwersytet Wrocławski: Gmach Główny z Wieżą Matematyczną ----------------
export function buildUniwersytet(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, d0 = D * .3, d1 = D * .72;
  const baroque: Fac = { levelH: 5.2, spacing: 3.4, ww: 1.5, wh: 2.6, sill: 1.2, raise: .8, levels: 4, mat: 0, arch: false };
  const body = rect(P, W * .02, d0, W * .98, d1);
  walls(S, body, 0, 22, OCHRE, baroque);
  addRoof(S, body, S.base + 22, 9, 'hipped', false, TILE, OCHRE);
  // pilastry (jasne pionowe pasy) od strony Odry i placu
  for (let u = W * .04; u < W * .97; u += 6.8) for (const [v, s] of [[d0, -1], [d1, 1]] as [number, number][])
    S.box(P(u - .45, v), P(u + .45, v), P(u + .45, v + s * .35), P(u - .45, v + s * .35), .8, 21.5, WHITE, null);
  S.slab(rect(P, W * .02 - .4, d0 - .5, W * .98 + .4, d1 + .5), 21.6, 22.3, WHITE); // gzyms
  // ryzalit środkowy z frontonem (Aula Leopoldina)
  const rz = rect(P, W * .42, d1 - 1, W * .58, d1 + 1.6);
  walls(S, rz, 0, 24, OCHRE, { ...baroque, spacing: 3, ww: 1.6, wh: 3.4 }); S.slab(rz, 24, 24.6, WHITE);
  addRoof(S, rz, S.base + 24.6, 5, 'gabled', true, TILE, WHITE);
  // Wieża Matematyczna: kwadrat, galeria, hełm z latarnią
  const tc = P(W * .5, (d0 + d1) / 2), t = rect((u, v) => [tc[0] + f.ux * u - f.uz * v, tc[1] + f.uz * u + f.ux * v], -5, -5, 5, 5);
  walls(S, t, 22, 33, OCHRE, { levelH: 11, spacing: 2.6, ww: 1.3, wh: 4, sill: 4, raise: 22, levels: 1, mat: 0, arch: false });
  S.slab(rect((u, v) => [tc[0] + f.ux * u - f.uz * v, tc[1] + f.uz * u + f.ux * v], -5.8, -5.8, 5.8, 5.8), 33, 33.6, WHITE);
  for (const c of t) S.spire(c, 33.6, .35, 2.4, WHITE); // figury/wazony na narożach galerii
  addRoof(S, ngon(tc, 4.2, 8), S.base + 33.6, 5, 'onion', false, COPPER, OCHRE);
  walls(S, ngon(tc, 1.4, 8), 38.6, 41, OCHRE, null);
  addRoof(S, ngon(tc, 1.5, 8), S.base + 41, 3.5, 'onion', false, COPPER, OCHRE);
  S.spire(tc, 44.5, .1, 1.5, GOLD);
}

// ---------------- Sky Tower (212 m) ----------------
export function buildSkyTower(S: ModelSink, f: Frame, ring?: XZ[]): void {
  const P = at(f), { W, D } = f;
  const r = ring && ring.length >= 3 ? ring : rect(P, 0, 0, W, D), c = center(r);
  const glass: Fac = { levelH: 3.4, spacing: 1.5, ww: 1.4, wh: 2.7, sill: .35, raise: 9.6, levels: 58, mat: 0, arch: false };
  walls(S, r, 9.6, 200, GLASS, glass);
  // białe pasy co kilka kondygnacji (gzymsy)
  for (let y = 30; y < 200; y += 34) S.slab(r.map(([x, z]) => [c[0] + (x - c[0]) * 1.012, c[1] + (z - c[1]) * 1.012] as XZ), y, y + .8, WHITE);
  S.slab(r, 200, 200.4, DARK);
  // korona: skośne zwieńczenie (pulpit) na prostokącie opisanym, z żebrami
  const inner = rect(P, W * .08, D * .08, W * .92, D * .92);
  walls(S, inner, 200.4, 203, GLASS, null);
  addRoof(S, inner, S.base + 203, 9, 'skillion', true, WHITE, GLASS);
  for (let k = 0; k < 6; k++) { const u = W * (.12 + k * .15); S.box(P(u - .3, D * .05), P(u + .3, D * .05), P(u + .3, D * .1), P(u - .3, D * .1), 195, 212, WHITE, null); }
}

// ======================= partia 2 =======================
const CREAM: RGB = [.9, .84, .68], CREAM2: RGB = [.84, .78, .62], SLATE: RGB = [.32, .34, .38], WOOD: RGB = [.28, .22, .18];

/** blanki (krenelaż) wzdłuż wielokąta na wysokości y */
function battlements(S: ModelSink, ring: XZ[], y: number, col: RGB, step = 2.4): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(L / step)), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (let k = 0; k < n; k += 2) {
      const t0 = k * L / n, t1 = (k + 1) * L / n, p0: XZ = [a[0] + ux * t0, a[1] + uz * t0], p1: XZ = [a[0] + ux * t1, a[1] + uz * t1];
      S.box(p0, p1, [p1[0] - uz * .6, p1[1] + ux * .6], [p0[0] - uz * .6, p0[1] + ux * .6], y, y + 1.2, col, null);
    }
  }
}
const local = (c: XZ, f: Frame) => (u: number, v: number): XZ => [c[0] + f.ux * u - f.uz * v, c[1] + f.uz * u + f.ux * v];

/** Dworzec Wrocław Główny: neogotycki, jasny tynk, krenelaż, wieżyczki przy hali głównej i wieże narożne */
export function buildDworzec(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, v0 = D * .2, v1 = D * .8;
  const tudor: Fac = { levelH: 6.5, spacing: 3.6, ww: 1.8, wh: 3.6, sill: 1.4, raise: 0, levels: 2, mat: 0, arch: true };
  const body = rect(P, W * .04, v0, W * .96, v1);
  walls(S, body, 0, 13, CREAM, tudor); S.slab(body, 13, 13.3, CREAM2); battlements(S, body, 13.3, CREAM2);
  const hall = rect(P, W * .4, v0 - 2, W * .6, v1 + 2); // hala główna, wyższa, z wielkimi oknami
  walls(S, hall, 0, 22, CREAM, { levelH: 20, spacing: 5, ww: 3.2, wh: 12, sill: 5, raise: 0, levels: 1, mat: 0, arch: true });
  addRoof(S, hall, S.base + 22, 6, 'gabled', true, SLATE, CREAM); battlements(S, hall, 22, CREAM2);
  for (const u of [W * .4, W * .6]) for (const v of [v0 - 2, v1 + 2]) { // ośmioboczne wieżyczki
    const o = ngon(P(u, v), 2.6, 8); walls(S, o, 0, 30, CREAM2, { levelH: 7, spacing: 1.2, ww: .6, wh: 2.5, sill: 3, raise: 0, levels: 4, mat: 0, arch: true });
    battlements(S, ngon(P(u, v), 2.9, 8), 30, CREAM2, 1.6); addRoof(S, o, S.base + 30.5, 4, 'pyramidal', false, SLATE, CREAM2);
  }
  for (const u of [W * .04, W * .96 - 9]) { // wieże narożne
    const t = rect(P, u, v1 - 9, u + 9, v1 + 1); walls(S, t, 0, 20, CREAM2, tudor); battlements(S, t, 20, CREAM2); S.slab(t, 19.8, 20, CREAM2);
  }
}

/** Hala Targowa: ceglana, szczyty schodkowe na krótkich bokach, wysoki dach z świetlikiem na kalenicy, wieżyczki */
export function buildHalaTargowa(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, vm = D / 2;
  const body = rect(P, W * .03, D * .06, W * .97, D * .94);
  walls(S, body, 0, 13, BRICK, gothic(12, 4.2, 2.4));
  addRoof(S, body, S.base + 13, 15, 'gabled', false, SLATE, BRICK);
  S.box(P(W * .1, vm - 2), P(W * .9, vm - 2), P(W * .9, vm + 2), P(W * .1, vm + 2), 26, 29, [.6, .7, .75], null); // świetlik
  for (const [u, s] of [[W * .03, -1], [W * .97, 1]] as [number, number][]) { // szczyty schodkowe
    const hw = D * .44;
    for (let k = 0; k < 5; k++) { const w = hw * (1 - k / 5), y0 = 13 + k * 3.2; S.box(P(u - s * .4, vm - w), P(u + s * .3, vm - w), P(u + s * .3, vm + w), P(u - s * .4, vm + w), y0, y0 + 3.2, BRICK2, gothic(3.2, 2.4, 1)); S.spire(P(u + s * .1, vm - w + .5), y0 + 3.2, .35, 2, BRICK2); S.spire(P(u + s * .1, vm + w - .5), y0 + 3.2, .35, 2, BRICK2); }
  }
  for (const c of body) { const o = ngon(c, 1.6, 8); walls(S, o, 0, 17, BRICK2, null); addRoof(S, o, S.base + 17, 5, 'pyramidal', false, SLATE, BRICK2); }
}

/** Kolegiata św. Krzyża: ceglana, wysoki dach, transept, wieża z miedzianą iglicą */
export function buildKolegiata(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, vm = D / 2;
  const nave = rect(P, W * .05, vm - D * .26, W * .78, vm + D * .26);
  walls(S, nave, 0, 24, BRICK, gothic(22, 4, 2)); addRoof(S, nave, S.base + 24, 18, 'gabled', false, TILE, BRICK);
  const tr = rect(P, W * .42, D * .04, W * .6, D * .96);
  walls(S, tr, 0, 24, BRICK, gothic(22, 3.6, 2)); addRoof(S, tr, S.base + 24, 16, 'gabled', true, TILE, BRICK);
  const ch = rect(P, W * .78, vm - D * .22, W * .9, vm + D * .22);
  walls(S, ch, 0, 22, BRICK, gothic(20, 3.4, 1.8)); addRoof(S, ch, S.base + 22, 14, 'gabled', false, TILE, BRICK);
  const ac = P(W * .9, vm); walls(S, ngon(ac, D * .22, 8, Math.atan2(f.uz, f.ux)), 0, 22, BRICK, gothic(20, 2.6, 1.4)); addRoof(S, ngon(ac, D * .22, 8, Math.atan2(f.uz, f.ux)), S.base + 22, 11, 'cone', false, TILE, BRICK);
  const tc = P(W * .51, D * .94 + 4.5), t = rect(local(tc, f), -4.5, -4.5, 4.5, 4.5);
  walls(S, t, 0, 44, BRICK2, { levelH: 11, spacing: 2.4, ww: 1.1, wh: 5, sill: 3, raise: 0, levels: 4, mat: 1, arch: true });
  addRoof(S, ngon(tc, 4.4, 8, Math.PI / 8), S.base + 44, 26, 'pyramidal', false, COPPER, BRICK2); S.spire(tc, 70, .12, 2, GOLD);
}

/** Opera Wrocławska: klasycystyczna, jasna, portyk kolumnowy z frontonem, wieża sceniczna */
export function buildOpera(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f;
  const classic: Fac = { levelH: 6.2, spacing: 3.4, ww: 1.6, wh: 3.6, sill: 1.2, raise: .8, levels: 3, mat: 2, arch: false };
  const body = rect(P, W * .04, D * .12, W * .96, D * .88);
  walls(S, body, 0, 20, CREAM, classic); S.slab(body.map(p => p), 20, 20.6, WHITE); addRoof(S, body, S.base + 20.6, 6, 'hipped', false, SLATE, CREAM);
  const stage = rect(P, W * .6, D * .25, W * .9, D * .75); walls(S, stage, 20, 29, CREAM2, null); addRoof(S, stage, S.base + 29, 3, 'gabled', false, SLATE, CREAM2);
  // portyk od strony placu (v = D * .88): 6 kolumn, belkowanie, fronton
  const pv = D * .88, u0 = W * .36, u1 = W * .64;
  S.box(P(u0, pv), P(u1, pv), P(u1, pv + 5), P(u0, pv + 5), 0, 1.2, WHITE, null);
  for (let k = 0; k < 6; k++) { const u = u0 + 1 + (u1 - u0 - 2) * k / 5; const c = ngon(P(u, pv + 3.6), .55, 8); walls(S, c, 1.2, 14, WHITE, null); }
  S.box(P(u0, pv), P(u1, pv), P(u1, pv + 5), P(u0, pv + 5), 14, 15.8, WHITE, null);
  addRoof(S, rect(P, u0, pv, u1, pv + 5), S.base + 15.8, 4, 'gabled', true, SLATE, WHITE);
}

/** Bazylika św. Elżbiety: gotycka bazylika z wieżą 91,5 m (renesansowy hełm) */
export function buildElzbieta(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f, vm = D / 2;
  const nave = rect(P, W * .2, vm - D * .2, W * .92, vm + D * .2);
  walls(S, nave, 0, 30, BRICK, gothic(28, 4.4, 2.1)); addRoof(S, nave, S.base + 30, 17, 'gabled', false, TILE, BRICK);
  for (const s of [-1, 1]) { const a = rect(P, W * .2, vm + s * D * .2, W * .9, vm + s * D * .46); walls(S, a, 0, 16, BRICK2, gothic(15, 4.4, 1.9)); addRoof(S, a, S.base + 16, 6, 'skillion', false, TILE, BRICK2); }
  const ac = P(W * .92, vm), apse = ngon(ac, D * .2, 8, Math.atan2(f.uz, f.ux)); walls(S, apse, 0, 28, BRICK, gothic(26, 2.8, 1.5)); addRoof(S, apse, S.base + 28, 12, 'cone', false, TILE, BRICK);
  const tc = P(W * .11, vm), t = rect(local(tc, f), -6.5, -6.5, 6.5, 6.5);
  walls(S, t, 0, 66, BRICK, { levelH: 13, spacing: 3, ww: 1.4, wh: 7, sill: 3.5, raise: 0, levels: 5, mat: 1, arch: true });
  for (const c of t) S.spire(c, 66, .6, 4, BRICK2);
  S.slab(ngon(tc, 6.2, 8, Math.PI / 8), 66, 66.6, DARK);
  const o1 = ngon(tc, 5, 8, Math.PI / 8); walls(S, o1, 66.6, 71, COPPER, null);
  addRoof(S, o1, S.base + 71, 7, 'onion', false, COPPER, COPPER);
  walls(S, ngon(tc, 1.8, 8, Math.PI / 8), 78, 81.5, COPPER, null);
  addRoof(S, ngon(tc, 2, 8, Math.PI / 8), S.base + 81.5, 4, 'onion', false, COPPER, COPPER);
  addRoof(S, ngon(tc, .3, 6), S.base + 85.5, 6, 'cone', false, GOLD, GOLD);
}

/** Narodowe Forum Muzyki: ciemna bryła z rytmem pionowych żeber, ścięta, nadwieszona */
export function buildNFM(S: ModelSink, f0: Frame): void {
  const f = east(f0), P = at(f), { W, D } = f;
  const body = rect(P, W * .05, D * .08, W * .95, D * .92);
  walls(S, body, 0, 28, WOOD, { levelH: 7, spacing: 2, ww: .5, wh: 6, sill: .5, raise: 0, levels: 4, mat: 0, arch: false });
  addRoof(S, body, S.base + 28, 6, 'skillion', false, DARK, WOOD);
  for (let u = W * .07; u < W * .94; u += 3.1) for (const v of [D * .08, D * .92]) { const s = v < D / 2 ? -1 : 1; S.box(P(u - .25, v), P(u + .25, v), P(u + .25, v + s * .7), P(u - .25, v + s * .7), 0, 26 + Math.sin(u * .2) * 4, [.62, .5, .32], null); }
  S.box(P(W * .3, D * .92), P(W * .7, D * .92), P(W * .7, D + 4), P(W * .3, D + 4), 8, 10, WOOD, null); // daszek nad wejściem
}
