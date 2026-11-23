// Bryły jednego kafelka: budynki (z dziedzińcami), jezdnie z pasami, chodniki, tereny, woda z nabrzeżami,
// mosty, tory, przejścia dla pieszych i sygnalizacja. Wszystko scalone w kilka meshy i linii na kafelek.
// ZASADA: odcinki i trójkąty do 20 m (długie znikają blisko kamery na niektórych GPU).
import * as THREE from 'three';
import type { RGB } from '@miasto/shared/util/rng';
import { toXZ, type World } from '@miasto/shared/world/world';
import { deckY } from '@miasto/shared/world/bridges';
import type { XZ } from '@miasto/shared/world/collision';
import { isVehicleRoad } from '@miasto/shared/tiles/build';
import type { AreaKind, TileData, TileRoad } from '@miasto/shared/tiles/types';
import { MAX_SEG } from '../geometry';
import { classify } from '@miasto/shared/interiors/facade';
import { installWindows, type WindowUniforms } from './windows';
import { FACADE, PAL } from '../../render/palette';
import { buildProps, PropMaterials, type StopPoint } from './props';

export const WATER_Y = -4;

/** Materiały wspólne dla wszystkich kafelków (prześwietlenie zmienia je naraz). */
export class TileMaterials {
  readonly build = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true });
  /** okna na ścianach (shader): odsetek zapalonych, otwory drzwi wejściowych */
  readonly windows: WindowUniforms = installWindows(this.build);
  /** drzewa, latarnie, ławki, wiaty */
  readonly props = new PropMaterials();
  readonly edge = new THREE.LineBasicMaterial({ color: 0x7dffb0, transparent: true });
  /** warstwy płaskie na gruncie: nie zapisują głębi (grunt zasłania za nie), kolejność rysowania = renderOrder */
  readonly flat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false, transparent: false, side: THREE.DoubleSide });
  /** elementy wypukłe: chodniki z krawężnikami, torowiska (podsypka, podkłady, szyny) */
  readonly raised = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  readonly flatLine = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false });
  /** pomosty i woda zapisują głębię (pod nimi nie ma gruntu) */
  readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  readonly line = new THREE.LineBasicMaterial({ vertexColors: true });

  setXray(on: boolean): void {
    this.build.opacity = on ? .25 : 1; this.edge.opacity = on ? .35 : 1;
    for (const m of [this.flat, this.flatLine, this.raised]) { m.transparent = on; m.opacity = on ? .25 : 1; m.needsUpdate = true; }
  }
  dispose(): void { for (const m of [this.build, this.edge, this.flat, this.flatLine, this.solid, this.line, this.raised]) m.dispose(); this.props.dispose(); }
}

// kolory low-poly (render/palette.ts)
const C = {
  road: PAL.asphalt, mark: PAL.marking, center: PAL.markingY, path: PAL.path, zebra: PAL.zebra, pole: PAL.pole,
  waterTop: PAL.water, bank: PAL.bank, deck: PAL.deck, railing: PAL.railing,
};
const AREA: Record<AreaKind, { fill: RGB; order: number }> = {
  park: { fill: PAL.park, order: 1 }, forest: { fill: PAL.forest, order: 1 }, cemetery: { fill: PAL.cemetery, order: 1 },
  pitch: { fill: PAL.pitch, order: 2 }, parking: { fill: PAL.parking, order: 2 }, square: { fill: PAL.square, order: 2 }, water: { fill: PAL.water, order: 0 },
};
/** wysokość chodnika nad jezdnią (krawężnik) i torowisk [m] */
const CURB = .15;
const HOUSE = ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm'];
const INDUSTRY = ['industrial', 'warehouse', 'service', 'garage', 'garages', 'hangar', 'manufacture', 'shed', 'roof', 'carport'];
const SHOPS = ['retail', 'commercial', 'supermarket', 'kiosk'];

class Buf {
  P: number[] = []; Cc: number[] = []; N: number[] = [];
  tri(a: number[], b: number[], c: number[], col: RGB, n?: number[]): void {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (n) { // orientacja zgodna z normalną
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) [b, c] = [c, b];
      for (let i = 0; i < 3; i++) this.N.push(n[0], n[1], n[2]);
    } else { const m = Math.hypot(cr[0], cr[1], cr[2]) || 1; for (let i = 0; i < 3; i++) this.N.push(cr[0] / m, cr[1] / m, cr[2] / m); } // płaskie cieniowanie
    this.P.push(...a, ...b, ...c); this.Cc.push(...col, ...col, ...col);
  }
  quad(a: number[], b: number[], c: number[], d: number[], col: RGB, n?: number[]): void { this.tri(a, b, c, col, n); this.tri(a, c, d, col, n); }
  get empty(): boolean { return !this.P.length; }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.Cc, 3));
    if (this.N.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    return g;
  }
}
class Lines {
  P: number[] = []; Cc: number[] = [];
  seg(a: number[], b: number[], col: RGB): void {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / MAX_SEG));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      this.P.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1);
      this.Cc.push(...col, ...col);
    }
  }
  poly(pts: XZ[], y: number, col: RGB, closed = false): void {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.seg([a[0], y, a[1]], [b[0], y, b[1]], col); }
  }
  get empty(): boolean { return !this.P.length; }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.Cc, 3));
    return g;
  }
}

const area2 = (r: XZ[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const v2 = (r: XZ[]) => r.map(([x, z]) => new THREE.Vector2(x, z));

type Ground = ((x: number, z: number) => number) | null;
/** najdłuższa krawędź trójkąta terenu kładzionego na gruncie [m] (mniej przy dokładnym terenie) */
let FILL_MAX = 30;

/** Wypełnienie wielokąta (z dziurami) na wysokości y; z terenem trójkąty dzielone i kładzione na gruncie. */
function fillPoly(buf: Buf, outer: XZ[], holes: XZ[][], y: number, col: RGB, g: Ground = null): void {
  const all = [...outer, ...holes.flat()];
  let tris: number[][];
  try { tris = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2)); } catch { return; }
  const put = (a: XZ, b: XZ, c: XZ, depth: number): void => {
    if (g) {
      const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]), m = Math.max(ab, bc, ca);
      if (m > FILL_MAX && depth < 16) { // podział najdłuższej krawędzi
        if (m === ab) { const d: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; put(a, d, c, depth + 1); put(d, b, c, depth + 1); }
        else if (m === bc) { const d: XZ = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; put(a, b, d, depth + 1); put(a, d, c, depth + 1); }
        else { const d: XZ = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; put(a, b, d, depth + 1); put(d, b, c, depth + 1); }
        return;
      }
    }
    const Y = (p: XZ) => g ? g(p[0], p[1]) + y : y;
    buf.tri([a[0], Y(a), a[1]], [b[0], Y(b), b[1]], [c[0], Y(c), c[1]], col, [0, 1, 0]);
  };
  for (const [a, b, c] of tris) put(all[a], all[b], all[c], 0);
}

/** Dzieli łamaną tak, by odcinki miały najwyżej max metrów. */
function densify(p: XZ[], max = MAX_SEG): XZ[] {
  const out: XZ[] = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / max));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

/** Normalne wierzchołków łamanej (z ograniczonym ścięciem narożników). */
function offsets(p: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], c = p[i];
    const d0 = i > 0 ? norm2(c[0] - a[0], c[1] - a[1]) : null, d1 = i < p.length - 1 ? norm2(b[0] - c[0], b[1] - c[1]) : null;
    const d = (d0 && d1 ? norm2(d0[0] + d1[0], d0[1] + d1[1]) ?? d1 : d0 || d1) ?? [1, 0] as XZ; // zdublowane punkty drogi
    let nx = -d[1], nz = d[0];
    if (d0 && d1) { const cos = d0[0] * d[0] + d0[1] * d[1], k = 1 / Math.max(.5, cos); nx *= k; nz *= k; }
    out.push([nx, nz]);
  }
  return out;
}
function norm2(x: number, z: number): XZ | null { const m = Math.hypot(x, z); return m < 1e-9 ? null : [x / m, z / m]; }

/** Wysokości wierzchołków łamanej: liczba (stała) albo tablica. */
type Ys = number | number[];
const yAt = (ys: Ys, i: number, dy = 0) => (typeof ys === 'number' ? ys : ys[i]) + dy;

/** Pas wzdłuż łamanej od przesunięcia s0 do s1 (w poprzek). */
function strip(buf: Buf, p: XZ[], n: XZ[], s0: number, s1: number, ys: Ys, col: RGB, dy = 0): void {
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], ya = yAt(ys, i, dy), yb = yAt(ys, i + 1, dy);
    buf.quad([A[0] + na[0] * s0, ya, A[1] + na[1] * s0], [B[0] + nb[0] * s0, yb, B[1] + nb[1] * s0], [B[0] + nb[0] * s1, yb, B[1] + nb[1] * s1], [A[0] + na[0] * s1, ya, A[1] + na[1] * s1], col, [0, 1, 0]);
  }
}
/** Pionowa ściana wzdłuż łamanej na przesunięciu s, od wysokości h0 do h1 nad ys (krawężnik, bok torowiska). */
function wall(buf: Buf, p: XZ[], n: XZ[], s: number, ys: Ys, h0: number, h1: number, col: RGB): void {
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], ya = yAt(ys, i), yb = yAt(ys, i + 1);
    const ax = A[0] + na[0] * s, az = A[1] + na[1] * s, bx = B[0] + nb[0] * s, bz = B[1] + nb[1] * s;
    buf.quad([ax, ya + h0, az], [bx, yb + h0, bz], [bx, yb + h1, bz], [ax, ya + h1, az], col);
  }
}
/** Podkłady kolejowe: poprzeczne płytki co step metrów, półszerokość hw, na wysokości h. */
function sleepers(buf: Buf, p: XZ[], n: XZ[], ys: Ys, h: number, hw: number, step: number, col: RGB): void {
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1e-6) continue;
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L, nx = -uz, nz = ux, ya = yAt(ys, i), yb = yAt(ys, i + 1);
    for (let t = (step - acc % step) % step; t < L; t += step) {
      const cx = A[0] + ux * t, cz = A[1] + uz * t, y = ya + (yb - ya) * t / L + h, w = .12;
      buf.quad([cx - nx * hw - ux * w, y, cz - nz * hw - uz * w], [cx + nx * hw - ux * w, y, cz + nz * hw - uz * w], [cx + nx * hw + ux * w, y, cz + nz * hw + uz * w], [cx - nx * hw + ux * w, y, cz - nz * hw + uz * w], col, [0, 1, 0]);
    }
    acc += L;
  }
}

function offLine(L: Lines, p: XZ[], n: XZ[], s: number, ys: Ys, col: RGB, dash?: [number, number], skip?: (x: number, z: number) => boolean, dy = 0): void {
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]), ya = yAt(ys, i, dy), yb = yAt(ys, i + 1, dy);
    const a: XZ = [A[0] + na[0] * s, A[1] + na[1] * s], b: XZ = [B[0] + nb[0] * s, B[1] + nb[1] * s];
    if (!dash) { if (!skip || (!skip(A[0], A[1]) && !skip(B[0], B[1]))) L.seg([a[0], ya, a[1]], [b[0], yb, b[1]], col); acc += len; continue; }
    const [on, off] = dash, per = on + off;
    for (let t = Math.ceil(acc / per) * per - acc; t < len; t += per) {
      const t1 = Math.min(len, t + on), f0 = t / len, f1 = t1 / len;
      const x0 = a[0] + (b[0] - a[0]) * f0, z0 = a[1] + (b[1] - a[1]) * f0, x1 = a[0] + (b[0] - a[0]) * f1, z1 = a[1] + (b[1] - a[1]) * f1;
      if (skip && (skip(x0, z0) || skip(x1, z1))) continue;
      L.seg([x0, ya + (yb - ya) * f0, z0], [x1, ya + (yb - ya) * f1, z1], col);
    }
    acc += len;
  }
}

export interface TileView { group: THREE.Group; buildings: number; ms: number; dispose(): void }

export function buildTileView(t: TileData, M: TileMaterials, world: World | null = null, phys: World | null = world, stops: StopPoint[] = []): TileView {
  const t0 = performance.now(), g: Ground = world ? world.ground : null;
  // dokładny teren (NMT): drogi i tereny próbkowane gęściej, żeby leżały na gruncie
  const fine = !!world?.terrain?.hasFine(t.x, t.y), SEG = fine ? 4 : MAX_SEG; FILL_MAX = fine ? 6 : 30;
  /** wysokość gruntu w wierzchołkach (+ uniesienie warstw płaskich nad siatką terenu) */
  const LIFT = g ? .15 : 0, gys = (p: XZ[]): Ys => g ? p.map(q => g(q[0], q[1]) + LIFT) : 0;
  /** pomost mostu: interpolacja terenu między końcami ciągu */
  const deckYs = (p: XZ[], bw?: number[]): Ys => {
    if (!g) return 0; const out: number[] = []; let arc = 0;
    for (let i = 0; i < p.length; i++) { if (i) arc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); out.push((bw ? deckY(bw, arc, g) : g(p[i][0], p[i][1])) + LIFT); }
    return out;
  };
  const B = new Buf(), BE = new Lines();
  const F: Buf[] = [new Buf(), new Buf(), new Buf(), new Buf(), new Buf()]; // 0 ziemia/park, 1 place/parkingi, 2 ścieżki, 3 jezdnie, 4 oznakowanie
  const FL: Lines[] = [new Lines(), new Lines(), new Lines(), new Lines(), new Lines()];
  const S = new Buf(), SL = new Lines(); // pomosty, woda, nabrzeża
  const RB = new Buf(); // elementy wypukłe: chodniki z krawężnikami, torowiska

  // --- budynki: ściany, dach, krawędzie (dach, podstawa, narożniki > 25°) ---
  const FA: number[] = [], FB: number[] = [], FC: number[] = [];
  const facPad = () => { while (FA.length < B.P.length / 3 * 4) { FA.push(0, 0, 0, 0); FB.push(0, 0, 0, 0); FC.push(0, 0, 0); } };
  for (const b of t.b) {
    const outer = toXZ(b.o), holes = (b.i || []).map(toXZ), base = world ? world.baseOf(outer) : 0, h = base + b.h, mh = base + b.mh;
    const fc = classify(b, t.city);
    const cat = fc.typ ?? (b.t === 'office' ? 'office' : HOUSE.includes(b.t) ? 'house' : INDUSTRY.includes(b.t) ? 'industrial' : SHOPS.includes(b.t) ? 'sklep' : 'inne');
    const pal = FACADE[cat] ?? FACADE.inne, base0 = pal[Math.floor(fc.seed * 9973) % pal.length], j = .94 + fc.seed * .1;
    const col: RGB = [base0[0] * j, base0[1] * j, base0[2] * j], roof: RGB = [PAL.roof[0] * j, PAL.roof[1] * j, PAL.roof[2] * j];
    fillPoly(B, outer, holes, h, roof); facPad();
    for (const [ring, isHole] of [[outer, false], ...holes.map(r => [r, true])] as [XZ[], boolean][]) {
      const ccw = area2(ring) > 0 !== isHole, n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], c = ring[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], m = Math.hypot(dx, dz) || 1;
        const nrm = ccw ? [dz / m, 0, -dx / m] : [-dz / m, 0, dx / m];
        const n0 = B.P.length / 3;
        B.quad([a[0], mh, a[1]], [c[0], mh, c[1]], [c[0], h, c[1]], [a[0], h, a[1]], col, nrm);
        for (let k = n0; k < B.P.length / 3; k++) {
          const px = B.P[k * 3], py = B.P[k * 3 + 1], pz = B.P[k * 3 + 2];
          FA.push(((px - a[0]) * dx + (pz - a[1]) * dz) / m, py - base, m, fc.levelH); FB.push(fc.spacing, fc.ww, fc.wh, fc.raise); FC.push(fc.sill, fc.levels, fc.seed);
        }
      }
    }
  }

  // --- tereny ---
  const tileBox = (q: XZ, r: XZ) => {
    const x0 = t.x * t.size, z0 = t.y * t.size, x1 = x0 + t.size, z1 = z0 + t.size, e = .05;
    return (Math.abs(q[0] - r[0]) < e && (Math.abs(q[0] - x0) < e || Math.abs(q[0] - x1) < e)) || (Math.abs(q[1] - r[1]) < e && (Math.abs(q[1] - z0) < e || Math.abs(q[1] - z1) < e));
  };
  for (const a of t.a) {
    const outer = toXZ(a.o), holes = (a.i || []).map(toXZ), st = AREA[a.k];
    if (a.k === 'water' && g) { // z terenem: woda leży w dolinie, bez obniżania
      fillPoly(F[0], outer, holes, LIFT, C.waterTop, g);
      continue;
    }
    if (a.k === 'water') {
      fillPoly(S, outer, holes, WATER_Y, C.waterTop);
      for (const ring of [outer, ...holes]) for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]; if (tileBox(p, q)) continue; // brzeg kafelka to nie nabrzeże
        S.quad([p[0], WATER_Y, p[1]], [q[0], WATER_Y, q[1]], [q[0], -.03, q[1]], [p[0], -.03, p[1]], C.bank);
      }
      continue;
    }
    fillPoly(F[st.order >= 2 ? 1 : 0], outer, holes, LIFT, st.fill, g);
  }

  // --- drogi ---
  const junctions: XZ[] = t.g.filter(g => g.jn).map(g => [g.x, g.z]);
  const roadW = new Map<number, number>(); // id węzła -> szerokość drogi
  const near = (r: number) => (x: number, z: number) => junctions.some(j => (j[0] - x) ** 2 + (j[1] - z) ** 2 < r * r);
  const drawRoad = (r: TileRoad) => {
    const p = densify(toXZ(r.p), SEG), n = offsets(p), hw = r.w / 2, veh = isVehicleRoad(r.k), ys = r.br ? deckYs(p, r.bw) : gys(p);
    for (let i = 0; i < r.j.length; i += 2) roadW.set(r.j[i + 1], Math.max(roadW.get(r.j[i + 1]) || 0, r.w));
    if (r.br) {
      const ext = hw + (r.sw ? 2.5 : 0);
      strip(S, p, n, -ext, ext, ys, C.deck, -.02);
      for (const s of [-ext - .2, ext + .2]) { offLine(SL, p, n, s, ys, C.railing, undefined, undefined, 1.05); offLine(SL, p, n, s, ys, C.railing, undefined, undefined, .05); }
    }
    if (!veh) { strip(F[2], p, n, -hw, hw, ys, C.path); return; }
    strip(F[3], p, n, -hw, hw, ys, r.tu ? [.03, .04, .045] : C.road);
    const skip = near(hw + 4);
    if (r.sw) for (const side of [-1, 1]) {
      if (!((side < 0 && r.sw & 1) || (side > 0 && r.sw & 2))) continue;
      // chodnik podniesiony o krawężnik: nawierzchnia, ściana krawężnika od jezdni, zewnętrzna krawędź
      strip(RB, p, n, side * hw, side * (hw + 2.5), ys, PAL.sidewalk, CURB); wall(RB, p, n, side * hw, ys, 0, CURB, PAL.curb); wall(RB, p, n, side * (hw + 2.5), ys, 0, CURB, PAL.sidewalk);
    }
    // pasy ruchu
    const ln = r.ln, lw = r.w / Math.max(1, ln);
    if (ln >= 2) {
      if (r.ow) { for (let k = 1; k < ln; k++) offLine(FL[4], p, n, -hw + k * lw, ys, C.mark, [3, 6], skip); }
      else {
        const fwd = Math.ceil(ln / 2), back = ln - fwd, cs = -hw + back * lw;
        if (ln >= 4) { offLine(FL[4], p, n, cs - .15, ys, C.mark, undefined, skip); offLine(FL[4], p, n, cs + .15, ys, C.mark, undefined, skip); }
        else offLine(FL[4], p, n, cs, ys, C.mark, [4, 4], skip);
        for (let k = 1; k < back; k++) offLine(FL[4], p, n, -hw + k * lw, ys, C.mark, [3, 6], skip);
        for (let k = 1; k < fwd; k++) offLine(FL[4], p, n, cs + k * lw, ys, C.mark, [3, 6], skip);
      }
    }
  };
  for (const r of t.r) if (!isVehicleRoad(r.k)) drawRoad(r);
  for (const r of t.r) if (isVehicleRoad(r.k)) drawRoad(r);

  // --- tory ---
  for (const l of t.l) {
    const p = densify(toXZ(l.p), SEG), n = offsets(p), ys = l.br ? deckYs(p, l.bw) : gys(p), tram = l.k === 'tram';
    // torowisko wyżej niż jezdnia i chodnik: podsypka (tramwaj: trawiaste), podkłady, szyny
    const bw = tram ? 1.35 : 1.6, bh = tram ? .12 : .18;
    strip(RB, p, n, -bw, bw, ys, tram ? PAL.tramBed : PAL.ballast, bh); for (const sd of [-bw, bw]) wall(RB, p, n, sd, ys, 0, bh, tram ? PAL.curb : PAL.ballast);
    if (!tram) sleepers(RB, p, n, ys, bh + .02, 1.25, .9, PAL.sleeper);
    for (const s0 of [-.72, .72]) { strip(RB, p, n, s0 - .035, s0 + .035, ys, PAL.rail, bh + .14); for (const sd of [s0 - .035, s0 + .035]) wall(RB, p, n, sd, ys, bh, bh + .14, PAL.rail); }
    if (l.br) { strip(S, p, n, -2.2, 2.2, ys, C.deck, -.02); for (const s of [-2.4, 2.4]) offLine(SL, p, n, s, ys, C.railing, undefined, undefined, 1); }
  }

  // --- przejścia i sygnalizacja ---
  for (const nd of t.n) {
    const d = nd.d ?? 0, ux = Math.cos(d), uz = Math.sin(d), nx = -uz, nz = ux, gy = g ? g(nd.x, nd.z) + LIFT : 0;
    if (nd.k === 'crossing') {
      const w = (roadW.get(nd.id) || 7) / 2;
      for (let s = -w + .25; s < w - .2; s += 1) {
        const a = (q: number, t2: number): number[] => [nd.x + nx * q + ux * t2, gy, nd.z + nz * q + uz * t2];
        F[4].quad(a(s, -1.5), a(s + .5, -1.5), a(s + .5, 1.5), a(s, 1.5), C.zebra, [0, 1, 0]);
      }
    } else if (nd.k === 'signals') {
      const w = (roadW.get(nd.id) || 8) / 2 + 1;
      for (const side of [-1, 1]) {
        const x = nd.x + nx * w * side, z = nd.z + nz * w * side;
        SL.seg([x, gy, z], [x, gy + 4.2, z], C.pole);
        const light = (y0: number, c: RGB) => { const y = gy + y0; S.quad([x - ux * .15, y, z - uz * .15], [x + ux * .15, y, z + uz * .15], [x + ux * .15, y + .3, z + uz * .15], [x - ux * .15, y + .3, z - uz * .15], c); };
        light(3.9, [.9, .15, .1]); light(3.55, [.9, .7, .1]); light(3.2, [.15, .9, .35]);
      }
    } else if (nd.k === 'tram_stop') {
      SL.seg([nd.x, gy, nd.z], [nd.x, gy + 2.6, nd.z], C.pole); SL.seg([nd.x - .4, gy + 2.6, nd.z], [nd.x + .4, gy + 2.6, nd.z], C.pole);
    }
  }

  // --- złożenie ---
  const group = new THREE.Group(); group.name = `tile ${t.x}_${t.y}`;
  const add = (o: THREE.Object3D, order: number) => { o.renderOrder = order; group.add(o); };
  if (!B.empty) {
    facPad(); const bg = B.geometry();
    bg.setAttribute('aFacA', new THREE.Float32BufferAttribute(FA, 4)); bg.setAttribute('aFacB', new THREE.Float32BufferAttribute(FB, 4)); bg.setAttribute('aFacC', new THREE.Float32BufferAttribute(FC, 3));
    add(new THREE.Mesh(bg, M.build), 0);
  }
  if (!BE.empty) { const g = BE.geometry(); g.deleteAttribute('color'); add(new THREE.LineSegments(g, M.edge), 0); }
  F.forEach((f, i) => { if (!f.empty) add(new THREE.Mesh(f.geometry(), M.flat), 1 + i * 2); });
  FL.forEach((f, i) => { if (!f.empty) add(new THREE.LineSegments(f.geometry(), M.flatLine), 2 + i * 2); });
  if (!S.empty) add(new THREE.Mesh(S.geometry(), M.solid), 0);
  if (!RB.empty) add(new THREE.Mesh(RB.geometry(), M.raised), 0);
  if (!SL.empty) add(new THREE.LineSegments(SL.geometry(), M.line), 0);
  for (const o of buildProps(t, M.props, phys, g, stops)) add(o, 0);
  const ms = performance.now() - t0;
  return {
    group, buildings: t.b.length, ms,
    // obiekty (instancje) mają wspólne geometrie: zwalniamy tylko bufory instancji
    dispose: () => group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); else { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); } }),
  };
}
