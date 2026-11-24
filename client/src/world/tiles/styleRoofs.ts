// Dachy i detale dachów według stylu budynku (shared/world/style.ts):
//  - strome dachy z dachówki (kamienice, domy, powojenne niskie bloki): dwu- i czterospadowe na prostokątach,
//    dach „kopertowy” wzdłuż obrysu na kwartałach z podwórzami, kominy, lukarny,
//  - płaskie dachy (bloki, zabudowa współczesna, biura, hale): attyka, maszynownie wind albo wyjścia na dach
//    z drzwiami, wywiewki, klimatyzatory, świetliki,
//  - bloki z wielkiej płyty: balkony / loggie na elewacji od strony słonecznej.
// Wszystko trafia do bufora budynków kafla (jedno wywołanie rysowania).
import * as THREE from 'three';
import { obb, type Frame } from '@miasto/shared/interiors/geom';
import type { BStyle } from '@miasto/shared/world/style';
import type { XZ } from '@miasto/shared/world/collision';
import type { RGB } from '@miasto/shared/util/rng';
import { addRoof, type TriSink } from './roofs';

const area2 = (r: XZ[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const pip = (o: XZ[], x: number, z: number) => { let s = false; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, zi] = o[i], [xj, zj] = o[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; } return s; };
const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
/** deterministyczna liczba 0..1 */
const hash = (s: number, i: number) => { const x = Math.sin(s * 9301.7 + i * 49297.3) * 43758.5453; return x - Math.floor(x); };

export const ROOF_COL: Record<string, RGB[]> = {
  tiles: [[.6, .27, .18], [.52, .24, .17], [.44, .22, .17], [.64, .32, .2]],
  pow: [[.5, .25, .18], [.42, .24, .2], [.46, .46, .45], [.55, .28, .2]],
  flat: [[.3, .3, .32], [.34, .34, .35], [.28, .29, .3]],
  light: [[.56, .56, .57], [.62, .62, .62], [.5, .51, .52]],
};
/** kolory elewacji wg stylu (gdy OSM nie podaje koloru ani materiału) */
export const WALL_COL: Partial<Record<BStyle, RGB[]>> = {
  // wielka płyta po termomodernizacji: szarości i pastele
  blok: [[.8, .8, .78], [.88, .85, .74], [.86, .78, .68], [.76, .82, .76], [.76, .8, .86], [.9, .86, .8], [.72, .72, .72], [.86, .82, .62]],
  wsp: [[.93, .93, .91], [.88, .88, .86], [.52, .53, .55], [.86, .8, .7], [.9, .88, .84], [.8, .74, .66]],
  pow: [[.84, .8, .7], [.78, .76, .7], [.82, .75, .62], [.74, .72, .68], [.86, .82, .74]],
};
const CHIMNEY: RGB = [.52, .27, .2], CHIMNEY_P: RGB = [.62, .6, .57], DOOR: RGB = [.2, .2, .22], WIN: RGB = [.16, .22, .3];
const HOUSING: RGB = [.66, .66, .64], VENT: RGB = [.58, .58, .56], HVAC: RGB = [.74, .75, .76], SKY: RGB = [.55, .68, .76];

/** sink: trójkąty z normalną (Buf.tri ustawia kolejność wierzchołków zgodnie z normalną) */
type S = TriSink;
const nrm = (a: number[], b: number[], c: number[]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]], m = Math.hypot(n[0], n[1], n[2]) || 1;
  return n.map(v => v / m);
};
const quadN = (s: S, a: number[], b: number[], c: number[], d: number[], col: RGB, n: number[]) => { s.tri(a, b, c, col, n); s.tri(a, c, d, col, n); };
/** skrzynka (bez spodu) o środku podstawy (x, z), osi u, wymiarach du × dv, od y0 do y1 */
function box(s: S, x: number, z: number, ux: number, uz: number, du: number, dv: number, y0: number, y1: number, col: RGB, skip = -1): void {
  const vx = -uz, vz = ux, hu = du / 2, hv = dv / 2;
  const P = (a: number, b: number, y: number) => [x + ux * a + vx * b, y, z + uz * a + vz * b];
  quadN(s, P(-hu, -hv, y1), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y1), shade(col, 1.06), [0, 1, 0]);
  const faces: [number, number, number, number, number[]][] = [[-hu, -hv, hu, -hv, [-vx, 0, -vz]], [hu, -hv, hu, hv, [ux, 0, uz]], [hu, hv, -hu, hv, [vx, 0, vz]], [-hu, hv, -hu, -hv, [-ux, 0, -uz]]];
  faces.forEach(([a0, b0, a1, b1, n], i) => { if (i === skip) return; quadN(s, P(a0, b0, y0), P(a1, b1, y0), P(a1, b1, y1), P(a0, b0, y1), shade(col, i % 2 ? .88 : .96), n); });
}
/** prostokąt na pionowej ścianie: środek (x, z), kierunek na zewnątrz (nx, nz), szerokość w, od y0 do y1 */
function panel(s: S, x: number, z: number, nx: number, nz: number, w: number, y0: number, y1: number, col: RGB): void {
  const tx = -nz * w / 2, tz = nx * w / 2, ox = x + nx * .03, oz = z + nz * .03;
  quadN(s, [ox - tx, y0, oz - tz], [ox + tx, y0, oz + tz], [ox + tx, y1, oz + tz], [ox - tx, y1, oz - tz], col, [nx, 0, nz]);
}
/** wyjście na dach / maszynownia: skrzynka z drzwiami od strony -v (dz) */
function housing(s: S, x: number, z: number, ux: number, uz: number, du: number, dv: number, y0: number, hh: number, col: RGB): void {
  box(s, x, z, ux, uz, du, dv, y0, y0 + hh, col);
  const nx = uz, nz = -ux; // strona -v
  panel(s, x + nx * dv / 2, z + nz * dv / 2, nx, nz, .95, y0, y0 + Math.min(2.05, hh - .25), DOOR);
}

/** Obrys przesunięty do wnętrza bryły o d (z ucięciem ostrych narożników); dziury: na zewnątrz dziury. */
function insetRing(r: XZ[], d: number, hole: boolean): XZ[] {
  const sg = (area2(r) > 0 ? 1 : -1) * (hole ? -1 : 1), n = r.length, out: XZ[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], q = r[i], t = r[(i + 1) % n];
    const e1 = [q[0] - p[0], q[1] - p[1]], e2 = [t[0] - q[0], t[1] - q[1]], l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    const n1 = [-e1[1] / l1 * sg, e1[0] / l1 * sg], n2 = [-e2[1] / l2 * sg, e2[0] / l2 * sg];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { mx = n1[0]; mz = n1[1]; } else { mx /= ml; mz /= ml; }
    const cos = Math.max(.4, mx * n1[0] + mz * n1[1]);
    out.push([q[0] + mx * d / cos, q[1] + mz * d / cos]);
  }
  return out;
}

/** Dach „kopertowy” wzdłuż całego obrysu (kwartały kamienic, nieregularne bryły): połacie o szerokości d, płaski szczyt. */
function insetRoof(s: S, outer: XZ[], holes: XZ[][], y0: number, d: number, rh: number, col: RGB, chim: RGB, seed: number): void {
  const rings = [outer, ...holes], ins = rings.map((r, k) => insetRing(r, d, k > 0)), y1 = y0 + rh;
  rings.forEach((r, k) => {
    const I = ins[k];
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length, a = [r[i][0], y0, r[i][1]], b = [r[j][0], y0, r[j][1]], c = [I[j][0], y1, I[j][1]], e = [I[i][0], y1, I[i][1]];
      let n = nrm(a, b, c); if (n[1] < 0) n = n.map(v => -v);
      quadN(s, a, b, c, e, col, n);
    }
  });
  let tris: number[][]; const v2 = (r: XZ[]) => r.map(([x, z]) => new THREE.Vector2(x, z));
  try { tris = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2)); } catch { tris = []; }
  const all = ins.flat(), top = shade(col, .92);
  for (const [a, b, c] of tris) s.tri([all[a][0], y1, all[a][1]], [all[b][0], y1, all[b][1]], [all[c][0], y1, all[c][1]], top, [0, 1, 0]);
  // kominy na grzbiecie co ~13 m
  let acc = 6 + hash(seed, 1) * 6;
  ins.forEach(I => { for (let i = 0; i < I.length; i++) {
    const p = I[i], q = I[(i + 1) % I.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < .1) continue;
    let t = acc; while (t < L) { const x = p[0] + (q[0] - p[0]) * t / L, z = p[1] + (q[1] - p[1]) * t / L; if (pip(outer, x, z) && !holes.some(h => pip(h, x, z))) box(s, x, z, (q[0] - p[0]) / L, (q[1] - p[1]) / L, .7, 1.1, y1 - .3, y1 + 1.1, chim); t += 13; }
    acc = t - L;
  } });
}

/** Lukarna na połaci: front w punkcie (x, z) zwrócony na zewnątrz (nx, nz), podstawa y, oś wzdłuż kalenicy (ux, uz). */
function dormer(s: S, x: number, z: number, nx: number, nz: number, ux: number, uz: number, y: number, col: RGB, wall: RGB): void {
  const cx = x - nx * .8, cz = z - nz * .8;
  box(s, cx, cz, ux, uz, 1.7, 1.6, y - .2, y + 1.45, wall);
  // daszek dwuspadowy nad lukarną
  const P = (a: number, b: number, yy: number) => [cx + ux * a - nx * b, yy, cz + uz * a - nz * b];
  const r0 = y + 1.45, r1 = y + 2.05;
  quadN(s, P(-1, -.9, r0), P(0, -.9, r1), P(0, .9, r1), P(-1, .9, r0), col, nrm(P(-1, -.9, r0), P(0, -.9, r1), P(0, .9, r1)).map((v, i, a) => (a[1] < 0 ? -v : v)));
  quadN(s, P(1, -.9, r0), P(0, -.9, r1), P(0, .9, r1), P(1, .9, r0), col, nrm(P(1, -.9, r0), P(0, -.9, r1), P(0, .9, r1)).map((v, i, a) => (a[1] < 0 ? -v : v)));
  s.tri(P(-.85, -.81, r0), P(.85, -.81, r0), P(0, -.81, r1 - .05), wall, [nx, 0, nz]);
  panel(s, x, z, nx, nz, .85, y + .25, y + 1.2, WIN);
}

export interface StyleRoofIn {
  st: BStyle; outer: XZ[]; holes: XZ[][];
  /** górna krawędź ścian (okap / poziom dachu płaskiego), wysokość terenu */
  top: number; base: number;
  lv: number; levelH: number; seed: number;
  /** kolor ścian (szczyty, lukarny), kolor dachu z OSM */
  wall: RGB; roof?: RGB;
  /** dach płaski z OSM (roof:shape=flat) */
  flat: boolean;
}

/** Dach według stylu. Zwraca wysokość górnej krawędzi ścian (attyka podnosi ściany ponad poziom dachu). */
export function styledRoof(s: S, fillFlat: (y: number, col: RGB) => void, q: StyleRoofIn): number {
  const { st, outer, holes, top, seed } = q, k = Math.floor(seed * 9973);
  const pitched = (st === 'kam' || st === 'dom' || st === 'pow') && !q.flat;
  const f = obb(outer), A = Math.abs(area2(outer)) / 2, rect = !holes.length && A >= .86 * f.W * f.D;
  if (pitched) {
    const col = q.roof ?? (st === 'pow' ? ROOF_COL.pow : ROOF_COL.tiles)[k % 4], chim = st === 'pow' ? CHIMNEY_P : CHIMNEY;
    if (rect && f.D <= 22) {
      const shape = st === 'dom' ? (hash(seed, 2) < .5 ? 'hipped' : 'gabled') : st === 'kam' ? (hash(seed, 2) < .3 ? 'hipped' : 'gabled') : 'gabled';
      const rh = st === 'dom' ? Math.min(f.D * .48, 5.5) : st === 'pow' ? Math.min(f.D * .36, 4.5) : Math.min(f.D * .45, 6.5);
      addRoof(s, outer, top, rh, shape, false, col, q.wall);
      ridgeDetails(s, f, top, rh, shape, st, col, q.wall, chim, seed);
    } else insetRoof(s, outer, holes, top, st === 'kam' ? Math.min(5.5, f.D * .3) : 4, (st === 'kam' ? 5.2 : 3.6), col, chim, seed);
    return top;
  }
  // dach płaski: pokrycie, attyka, urządzenia
  const col = q.roof ?? (st === 'blok' ? ROOF_COL.flat : ROOF_COL.light)[k % 3];
  const par = st === 'blok' ? .9 : st === 'wsp' ? 1.1 : st === 'przem' ? .6 : st === 'dom' || st === 'kam' || st === 'pow' ? .5 : .8;
  fillFlat(top, col);
  const cap = shade(q.wall, .9);
  [outer, ...holes].forEach((r, kk) => { // wewnętrzna strona attyki i jej korona
    const I = insetRing(r, .3, kk > 0);
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length;
      const a = [I[i][0], top, I[i][1]], b = [I[j][0], top, I[j][1]], c = [I[j][0], top + par, I[j][1]], d = [I[i][0], top + par, I[i][1]];
      const ex = r[j][0] - r[i][0], ez = r[j][1] - r[i][1], el = Math.hypot(ex, ez) || 1, mx = (r[i][0] + r[j][0]) / 2, mz = (r[i][1] + r[j][1]) / 2;
      let nx = -ez / el, nz = ex / el; const ix = (I[i][0] + I[j][0]) / 2, iz = (I[i][1] + I[j][1]) / 2; if (nx * (ix - mx) + nz * (iz - mz) < 0) { nx = -nx; nz = -nz; } // do wnętrza dachu
      quadN(s, a, b, c, d, shade(q.wall, .8), [nx, 0, nz]);
      quadN(s, [r[i][0], top + par, r[i][1]], [r[j][0], top + par, r[j][1]], c, d, cap, [0, 1, 0]);
    }
  });
  flatDetails(s, q, f, rect, top, seed);
  return top + par;
}

/** Kominy i lukarny na prostokątnym dachu stromym (kalenica wzdłuż U ramki). */
function ridgeDetails(s: S, f: Frame, y0: number, rh: number, shape: string, st: BStyle, col: RGB, wall: RGB, chim: RGB, seed: number): void {
  const { ox, oz, ux, uz, W, D } = f, vx = -uz, vz = ux, P = (u: number, v: number): XZ => [ox + ux * u + vx * v, oz + uz * u + vz * v];
  const hip = shape === 'hipped' ? D / 2 : 0, y1 = y0 + rh;
  // kominy: przy kalenicy, rozstaw ~8–10 m (dom: jeden)
  const n = st === 'dom' ? 1 : Math.max(1, Math.round(W / (st === 'pow' ? 8 : 10)));
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? W * (.35 + hash(seed, 5) * .3) : W * (i + .5) / n; if (u < hip * .8 || u > W - hip * .8) continue;
    const v = D / 2 + (hash(seed, 10 + i) < .5 ? -1 : 1) * Math.min(1.2, D * .1), [x, z] = P(u, v);
    box(s, x, z, ux, uz, .75, 1.05, y1 - .9, y1 + .9, chim);
  }
  // lukarny: kamienice i część domów (nie w powojennych)
  if (st === 'pow' || (st === 'dom' && hash(seed, 3) < .5) || rh < 3.2 || D < 8) return;
  const step = st === 'dom' ? W : 4.6, u0 = Math.max(hip + 1.4, 2.4), u1 = W - u0;
  if (u1 < u0) return;
  const cnt = Math.max(1, Math.floor((u1 - u0) / step) + 1);
  for (let i = 0; i < cnt; i++) {
    const u = cnt === 1 ? W / 2 : u0 + (u1 - u0) * i / (cnt - 1);
    for (const side of [-1, 1]) {
      const vf = side < 0 ? D * .2 : D * .8, yf = y0 + rh * (vf < D / 2 ? vf : D - vf) / (D / 2), [x, z] = P(u, vf);
      dormer(s, x, z, vx * side, vz * side, ux, uz, yf, col, wall);
    }
  }
}

/** Urządzenia na dachu płaskim według stylu. */
function flatDetails(s: S, q: StyleRoofIn, f: Frame, rect: boolean, y: number, seed: number): void {
  const { ox, oz, ux, uz, W, D } = f, vx = -uz, vz = ux, P = (u: number, v: number): XZ => [ox + ux * u + vx * v, oz + uz * u + vz * v];
  const inside = (u: number, v: number, m = 1) => { const [x, z] = P(u, v); if (!pip(q.outer, x, z) || q.holes.some(h => pip(h, x, z))) return false; for (const [a, b] of [[m, 0], [-m, 0], [0, m], [0, -m]]) { const [x2, z2] = P(u + a, v + b); if (!pip(q.outer, x2, z2)) return false; } return true; };
  const put = (u: number, v: number, m: number, fn: (x: number, z: number) => void) => { if (inside(u, v, m)) { const [x, z] = P(u, v); fn(x, z); } };
  if (q.st === 'blok') {
    // klatki schodowe co ~18 m (wysokie: co ~24 m); nad klatką maszynownia windy (≥ 9 kondygnacji) albo wyjście na dach
    const tall = q.lv >= 9, n = Math.max(1, Math.round(W / (tall ? 24 : 18)));
    for (let i = 0; i < n; i++) {
      const u = W * (i + .5) / n, v = D / 2;
      if (tall) put(u, v, 2.5, (x, z) => housing(s, x, z, ux, uz, 4.6, 3.4, y, 2.9, HOUSING));
      else put(u, v, 1.5, (x, z) => housing(s, x, z, ux, uz, 1.8, 2.4, y, 2.3, HOUSING));
      // wywiewki wentylacyjne po obu stronach klatki
      for (const du of [-5, 5]) for (const dv of [-2.2, 2.2]) put(u + du, v + dv, .6, (x, z) => box(s, x, z, ux, uz, 1.3, .55, y, y + 1.1, VENT));
    }
    if (W > 30 && hash(seed, 7) < .6) put(W * .5 + 3, D * .5 - 2.6, .4, (x, z) => { box(s, x, z, ux, uz, .12, .12, y, y + 3.2, [.4, .4, .42]); box(s, x, z, ux, uz, 1.6, .08, y + 2.6, y + 2.7, [.4, .4, .42]); });
    return;
  }
  if (q.st === 'przem') {
    // świetliki pasmowe
    if (W > 20 && D > 14) for (let v = 6; v < D - 5; v += 9) for (let u = 4; u < W - 4; u += 10) put(u + 4, v, 1, (x, z) => box(s, x, z, ux, uz, 8, 2.2, y, y + .55, SKY));
    put(W * .2, D * .3, 1, (x, z) => housing(s, x, z, ux, uz, 2, 2.6, y, 2.4, HOUSING));
    return;
  }
  // zabudowa współczesna, biura, budynki publiczne i pozostałe: wyjście na dach z drzwiami, klimatyzatory
  const hx = W * (.25 + hash(seed, 8) * .2), hv = D * .5;
  put(hx, hv, 1.6, (x, z) => housing(s, x, z, ux, uz, 2.6, 3.2, y, 2.6, HOUSING));
  const nh = q.st === 'wsp' ? 1 : Math.min(4, Math.max(1, Math.round(W * D / 400)));
  for (let i = 0; i < nh; i++) put(W * (.55 + .35 * hash(seed, 20 + i)), D * (.25 + .5 * hash(seed, 30 + i)), 1.2, (x, z) => box(s, x, z, ux, uz, 2.2, 1.4, y, y + 1.3, HVAC));
  if (!rect) return;
}

/** Balkony bloku na ścianie a→c (normalna na zewnątrz nx, nz): co drugą–trzecią kolumnę okien, od 1. piętra. */
export function balconies(s: S, a: XZ, c: XZ, nx: number, nz: number, base: number, raise: number, levelH: number, levels: number, slots: [number, number][], col: RGB, seed: number): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 12 || !slots.length) return;
  const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, back = -uz * nx + ux * nz > 0 ? 0 : 2, every = hash(seed, 40) < .5 ? 2 : 3, ph = Math.floor(hash(seed, 41) * every);
  for (let i = 0; i < slots.length; i++) {
    if ((i + ph) % every) continue;
    const m = (slots[i][0] + slots[i][1]) / 2, x = a[0] + ux * m + nx * .6, z = a[1] + uz * m + nz * .6;
    for (let k = 1; k < levels; k++) {
      const y = base + raise + k * levelH;
      box(s, x, z, ux, uz, 2.9, 1.2, y - .15, y + 1.05, col, back);
    }
  }
}
