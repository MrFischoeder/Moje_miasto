// Bryły jednego kafelka: budynki (z dziedzińcami), jezdnie z pasami, chodniki, tereny, woda z nabrzeżami,
// mosty, tory, przejścia dla pieszych i sygnalizacja. Wszystko scalone w kilka meshy i linii na kafelek.
// ZASADA: odcinki i trójkąty do 20 m (długie znikają blisko kamery na niektórych GPU).
import * as THREE from 'three';
import { hex, type RGB } from '@miasto/shared/util/rng';
import { toXZ, type World } from '@miasto/shared/world/world';
import { deckY } from '@miasto/shared/world/bridges';
import type { XZ } from '@miasto/shared/world/collision';
import { isVehicleRoad } from '@miasto/shared/tiles/build';
import type { AreaKind, TileBuilding, TileData, TileRoad } from '@miasto/shared/tiles/types';
import { MAX_SEG } from '../geometry';
import { classify, type BuildingClass } from '@miasto/shared/interiors/facade';
import { TileWindows, WIN_STRIDE, WindowMaterials, wallWindows } from './physWindows';
import { addRoof, defaultRoofH } from './roofs';
import { balconies, styledRoof, WALL_COL } from './styleRoofs';
import { styleOf, type BStyle } from '@miasto/shared/world/style';
import { windowSlots } from '@miasto/shared/interiors/facade';
import { BUILDERS, centroidFlat, insideFlat, MODELS } from './models/index';
import { makeSink } from './models/sink';
import { buildMonument } from './models/monuments';
import { buildGable, frontEdge, KAM_T, kamColors } from './models/kamienica';
import { CITIES, type CityKey } from '@miasto/shared/data/cities';
import { makeProj } from '@miasto/shared/data/projection';
import { obb } from '@miasto/shared/interiors/geom';
import { partsCover } from '@miasto/shared/tiles/parts';
import { installWindows, type WindowUniforms } from './windows';
import { FACADE, PAL } from '../../render/palette';
import { assembleInst, buildProps, PropMaterials, type InstData, type StopPoint } from './props';
import { installLamps, lampUniforms, MAX_LAMPS, type LampUniforms } from '../lampLight';

export const WATER_Y = -4;

/** Materiały wspólne dla wszystkich kafelków (prześwietlenie zmienia je naraz). */
export class TileMaterials {
  readonly build = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true });
  /** okna na ścianach (shader): odsetek zapalonych, otwory drzwi wejściowych */
  readonly windows: WindowUniforms = installWindows(this.build);
  /** drzewa, latarnie, ławki, wiaty */
  readonly props = new PropMaterials();
  /** światło latarni (najbliższe latarnie, natężenie nocą) */
  readonly lamps: LampUniforms = lampUniforms();
  /** fizyczne okna przy graczu */
  readonly physWin = new WindowMaterials();
  xray = false;
  constructor() { for (const m of [this.build, this.flat, this.raised, this.solid]) installLamps(m, this.lamps); this.physWin.useDoors(this.windows); }
  readonly edge = new THREE.LineBasicMaterial({ color: 0x7dffb0, transparent: true });
  /** warstwy płaskie na gruncie: nie zapisują głębi (grunt zasłania za nie), kolejność rysowania = renderOrder */
  readonly flat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false, transparent: false, side: THREE.DoubleSide });
  /** elementy wypukłe: chodniki z krawężnikami, torowiska (podsypka, podkłady, szyny) */
  readonly raised = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  readonly flatLine = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false });
  /** pomosty i woda zapisują głębię (pod nimi nie ma gruntu) */
  readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  readonly line = new THREE.LineBasicMaterial({ vertexColors: true });

  /** Linie (oznakowanie jezdni, szyny) nie są oświetlane przez scenę: przyciemniane wg jasności dnia, żeby nocą nie świeciły. */
  setLight(day: number): void { const k = .16 + .84 * day; this.flatLine.color.setScalar(k); this.line.color.setScalar(k); }

  setXray(on: boolean): void {
    this.xray = on;
    this.build.opacity = on ? .25 : 1; this.edge.opacity = on ? .35 : 1;
    for (const m of [this.flat, this.flatLine, this.raised]) { m.transparent = on; m.opacity = on ? .25 : 1; m.needsUpdate = true; }
  }
  dispose(): void { for (const m of [this.build, this.edge, this.flat, this.flatLine, this.solid, this.line, this.raised]) m.dispose(); this.props.dispose(); this.physWin.dispose(); }
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
const CHURCH = ['church', 'cathedral', 'chapel', 'basilica', 'monastery'];
/** Okna świątyni: w nawie wysokie i rzadkie (jedna „kondygnacja”), w wieży kilka otworów dzwonnicy. */
function isTower(b: TileBuilding): boolean {
  const r = toXZ(b.o); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const s = Math.min(x1 - x0, z1 - z0); return b.h - b.mh > 2.2 * s && s < 22;
}
function churchFacade(fc: BuildingClass, b: TileBuilding): BuildingClass {
  const H = b.h - b.mh, ring = toXZ(b.o); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const short = Math.min(x1 - x0, z1 - z0), tower = H > 2.2 * short && short < 22;
  // ściany wieloboków (wieże, prezbiteria) bywają krótkie: odstęp okien dopasowany do typowej długości ściany
  const edges = ring.map((p, i) => { const q = ring[(i + 1) % ring.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }).sort((a, b) => a - b), med = edges[edges.length >> 1];
  if (tower) { const lh = Math.min(14, Math.max(8, H / 4)), sp = Math.max(1, Math.min(3.2, med - .65)); return { ...fc, levels: Math.max(1, Math.floor(b.h / lh)), levelH: lh, raise: 0, spacing: sp, ww: Math.min(1.1, sp * .6), wh: Math.min(4, lh * .35), sill: lh * .5 }; }
  const lh = Math.max(6, Math.min(22, H * .85)), sp = Math.max(2, Math.min(4.8, med - .65)); return { ...fc, levels: 1, levelH: lh, raise: 0, spacing: sp, ww: Math.min(1.8, sp * .45), wh: lh * .62, sill: lh * .2 };
}
/** balustrady mostów: strona pomostu, strona zewnętrzna, poręcz */
const BAL_IN: RGB = [.55, .55, .53], BAL_OUT: RGB = [.5, .5, .48], BAL_TOP: RGB = [.42, .44, .45];
/** wysokość bramy przejazdowej [m] */
const PASS_H = 3.8;
/** balustrady balkonów bloków */
const BALC: RGB[] = [[.92, .92, .9], [.7, .72, .74], [.86, .62, .42], [.55, .7, .82], [.9, .84, .6], [.62, .78, .62]];
/** styl budynku bez danych z potoku kafli (np. starsze kafle): tylko cechy samego budynku */
function styleLocal(b: TileBuilding, o: XZ[], holes: XZ[][], c: [number, number] | null): BStyle {
  const f = obb(o), A = Math.abs(area2(o)) / 2; let P = 0; for (let i = 0; i < o.length; i++) { const q = o[(i + 1) % o.length]; P += Math.hypot(q[0] - o[i][0], q[1] - o[i][1]); }
  const cx = o.reduce((s, p) => s + p[0], 0) / o.length, cz = o.reduce((s, p) => s + p[1], 0) / o.length;
  return styleOf({ t: b.t, lv: b.lv ?? Math.max(1, Math.round((b.h - b.mh) / 3.2)), lvTag: b.lv != null, A, W: f.W, D: f.D, rect: A / Math.max(1, f.W * f.D), dEff: 2 * A / Math.max(1, P), mE: P / o.length,
    holes: holes.length, members: 1, attached: false, yr: b.yr, hist: !!b.hist, rs: b.rs, dc: c ? Math.hypot(cx - c[0], cz - c[1]) : 99999 }).st;
}
/** kolory ścian wg building:material (kilka odcieni) */
const MAT_COL: Record<string, RGB[]> = {
  brick: [[.62, .3, .22], [.56, .27, .2], [.66, .34, .24]], stone: [[.74, .7, .62], [.68, .64, .56]], plaster: [[.86, .82, .72], [.82, .78, .7]],
  concrete: [[.66, .66, .64]], glass: [[.5, .62, .7]], metal: [[.6, .62, .64]], copper: [[.42, .6, .52]], wood: [[.55, .4, .28]],
};

/** Dane geometrii (zwykłe tablice: liczone w wątku kafli, przesyłane bez kopiowania). */
type Attrs = Record<string, { array: Float32Array; size: number }>;
type MatName = 'build' | 'edge' | 'flat' | 'flatLine' | 'solid' | 'line' | 'raised';
export interface Layer { lines: boolean; mat: MatName; order: number; a: Attrs }
export interface TileBuildData { key: string; layers: Layer[]; inst: InstData[]; lamps: number[]; buildings: number; ms: number; /** fizyczne okna (physWindows.ts) */ win: Float32Array }

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
  attrs(): Attrs { return { position: { array: new Float32Array(this.P), size: 3 }, color: { array: new Float32Array(this.Cc), size: 3 }, ...(this.N.length ? { normal: { array: new Float32Array(this.N), size: 3 } } : {}) }; }
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
  attrs(): Attrs { return { position: { array: new Float32Array(this.P), size: 3 }, color: { array: new Float32Array(this.Cc), size: 3 } }; }
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
/** przesunięcie od osi: stałe albo osobne dla każdego punktu łamanej (zmienna szerokość jezdni) */
type Off = number | number[];
const o = (s: Off, i: number) => typeof s === 'number' ? s : s[i];
const offMap = (s: Off, f: (v: number) => number): Off => typeof s === 'number' ? f(s) : s.map(f);
function strip(buf: Buf, p: XZ[], n: XZ[], s0: Off, s1: Off, ys: Ys, col: RGB, dy = 0): void {
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], ya = yAt(ys, i, dy), yb = yAt(ys, i + 1, dy), a0 = o(s0, i), b0 = o(s0, i + 1), a1 = o(s1, i), b1 = o(s1, i + 1);
    buf.quad([A[0] + na[0] * a0, ya, A[1] + na[1] * a0], [B[0] + nb[0] * b0, yb, B[1] + nb[1] * b0], [B[0] + nb[0] * b1, yb, B[1] + nb[1] * b1], [A[0] + na[0] * a1, ya, A[1] + na[1] * a1], col, [0, 1, 0]);
  }
}
/** Pionowa ściana wzdłuż łamanej na przesunięciu s, od wysokości h0 do h1 nad ys (krawężnik, bok torowiska). */
function wall(buf: Buf, p: XZ[], n: XZ[], s: Off, ys: Ys, h0: number, h1: number, col: RGB): void {
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], ya = yAt(ys, i), yb = yAt(ys, i + 1);
    const ax = A[0] + na[0] * o(s, i), az = A[1] + na[1] * o(s, i), bx = B[0] + nb[0] * o(s, i + 1), bz = B[1] + nb[1] * o(s, i + 1);
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

function offLine(L: Lines, p: XZ[], n: XZ[], s: Off, ys: Ys, col: RGB, dash?: [number, number], skip?: (x: number, z: number) => boolean, dy = 0): void {
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1], na = n[i], nb = n[i + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]), ya = yAt(ys, i, dy), yb = yAt(ys, i + 1, dy);
    const a: XZ = [A[0] + na[0] * o(s, i), A[1] + na[1] * o(s, i)], b: XZ = [B[0] + nb[0] * o(s, i + 1), B[1] + nb[1] * o(s, i + 1)];
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

export interface TileView { group: THREE.Group; buildings: number; ms: number; dispose(): void; /** oprawy latarni: x, y, z, ... */ lamps: number[]; windows: TileWindows }

/** Kafel złożony od razu (bez wątku). */
export function buildTileView(t: TileData, M: TileMaterials, world: World | null = null, phys: World | null = world, stops: StopPoint[] = []): TileView {
  return assembleTile(computeTile(t, world, phys, stops), M);
}

/** Obiekty three.js z danych kafla (szybkie: same bufory; liczenie w computeTile, zwykle w wątku). */
export function assembleTile(d: TileBuildData, M: TileMaterials): TileView {
  const group = new THREE.Group(); group.name = `tile ${d.key}`;
  for (const L of d.layers) {
    const g = new THREE.BufferGeometry(); for (const [k, v] of Object.entries(L.a)) g.setAttribute(k, new THREE.BufferAttribute(v.array, v.size));
    const o = L.lines ? new THREE.LineSegments(g, M[L.mat] as THREE.LineBasicMaterial) : new THREE.Mesh(g, M[L.mat] as THREE.Material); o.renderOrder = L.order; group.add(o);
  }
  for (const im of assembleInst(d.inst, M.props)) group.add(im);
  const windows = new TileWindows(d.win, M.physWin); group.add(windows.group); windows.group.visible = !M.xray;
  return {
    group, buildings: d.buildings, ms: d.ms, lamps: d.lamps, windows,
    dispose: () => { windows.dispose(); group.remove(windows.group); disposeGroup(group); },
  };
}
/** obiekty (instancje) mają wspólne geometrie: zwalniamy tylko bufory instancji */
function disposeGroup(group: THREE.Group): void {
  group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); else { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); } });
}

/** Liczenie kafla: geometria jako tablice liczb (bez obiektów three.js, więc może działać w wątku). */
export function computeTile(t: TileData, world: World | null = null, phys: World | null = world, stops: StopPoint[] = []): TileBuildData {
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
  const facPad = () => { while (FA.length < B.P.length / 3 * 4) { FA.push(0, 0, 0, 0); FB.push(0, 0, 0, 0); FC.push(0, 0, 0, 0); } };
  // obrys budynku złożonego z części (building:part) nie jest rysowany: części go zastępują (inaczej ściany się nakładają i migoczą)
  const insideXZ = (o: XZ[], x: number, z: number) => { let s = false; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, zi] = o[i], [xj, zj] = o[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; } return s; };
  const coveredByParts = (o: XZ[]) => coverF(o.flat());
  // ściany części budynków (building:part): obrys pokrywający się z nimi nie dostaje własnych okien
  const partEdges: [number, number, number, number][] = [];
  for (const q of t.b) if (q.part) for (let i = 0; i < q.o.length; i += 2) { const j = (i + 2) % q.o.length; partEdges.push([q.o[i], q.o[i + 1], q.o[j], q.o[j + 1]]); }
  // bramy przejazdowe (drogi bp): odcinki osi z półszerokością; cięcia ścian i sień przejazdu
  const passSegs: { a: XZ; b: XZ; hw: number }[] = [];
  for (const r of t.r) if (r.bp) { const p = toXZ(r.p), hw = r.w / 2 + (r.sw ? 1.6 : .4); for (let i = 0; i + 1 < p.length; i++) passSegs.push({ a: p[i], b: p[i + 1], hw }); }
  /** przedziały [t0, t1] (ułamek długości ściany a→c), w których ścianę przecina brama */
  const passCuts = (a: XZ, c: XZ, m: number): [number, number][] => {
    if (!passSegs.length) return [];
    const out: [number, number][] = [], dx = c[0] - a[0], dz = c[1] - a[1];
    for (const s of passSegs) {
      const ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const tw = ((s.a[0] - a[0]) * ez - (s.a[1] - a[1]) * ex) / den, ts = ((s.a[0] - a[0]) * dz - (s.a[1] - a[1]) * dx) / den;
      if (tw < 0 || tw > 1 || ts < -.05 || ts > 1.05) continue;
      const sin = Math.abs(den) / (m * Math.hypot(ex, ez)), half = Math.min(m * .45, s.hw / Math.max(.35, sin)) / m;
      out.push([Math.max(0, tw - half), Math.min(1, tw + half)]);
    }
    return out.sort((p, q) => p[0] - q[0]);
  };
  // ściany wspólne z sąsiednim budynkiem (ogniowe): bez okien (inaczej okna wystają przez ścianę sąsiada)
  const EG = 8, edgeGrid = new Map<string, { id: number; e: [number, number, number, number] }[]>();
  for (const q of t.b) for (let i = 0; i < q.o.length; i += 2) {
    const j = (i + 2) % q.o.length, e: [number, number, number, number] = [q.o[i], q.o[i + 1], q.o[j], q.o[j + 1]];
    for (let gx = Math.floor(Math.min(e[0], e[2]) / EG); gx <= Math.floor(Math.max(e[0], e[2]) / EG); gx++) for (let gz = Math.floor(Math.min(e[1], e[3]) / EG); gz <= Math.floor(Math.max(e[1], e[3]) / EG); gz++) {
      const k = gx + ',' + gz; let l = edgeGrid.get(k); if (!l) edgeGrid.set(k, l = []); l.push({ id: q.id, e });
    }
  }
  const sharedWall = (a: XZ, c: XZ, self: number) => {
    for (const tq of [.3, .5, .7]) {
      const x = a[0] + (c[0] - a[0]) * tq, z = a[1] + (c[1] - a[1]) * tq, l = edgeGrid.get(Math.floor(x / EG) + ',' + Math.floor(z / EG));
      if (!l || !l.some(q => q.id !== self && segD(x, z, q.e) < .6)) return false;
    }
    return true;
  };
  const segD = (x: number, z: number, e: [number, number, number, number]) => { const dx = e[2] - e[0], dz = e[3] - e[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - e[0]) * dx + (z - e[1]) * dz) / L2)); return Math.hypot(e[0] + dx * u - x, e[1] + dz * u - z); };
  const onPartWall = (a: XZ, c: XZ) => { for (const tq of [.25, .5, .75]) { const x = a[0] + (c[0] - a[0]) * tq, z = a[1] + (c[1] - a[1]) * tq; if (!partEdges.some(e => segD(x, z, e) < .6)) return false; } return true; };
  const coverF = partsCover(t);
  const WIN: number[] = [];
  // własne modele landmarków: budynki w ich obrysie zastępuje model
  const models = MODELS[t.city] ?? [];
  // mosty nie zastępują budynków (ich prostokąty bywają duże i obejmują sąsiednie bloki)
  const bldModels = models.filter(m => !m.model.startsWith('most') && !['grunwaldzki', 'zwierzyniecki', 'tumski', 'piaskowy', 'pokoju', 'pomorski'].includes(m.model));
  const insideModel = (x: number, z: number) => bldModels.some(m => insideFlat(m.ring, x, z));
  const byModel = (b: TileBuilding) => {
    if (!bldModels.length) return false;
    const [x, z] = centroidFlat(b.o);
    return bldModels.some(m => m.id === b.id || insideFlat(m.ring, x, z) || (() => { for (let i = 0; i < b.o.length; i += 2) if (!insideFlat(m.ring, b.o[i], b.o[i + 1])) return false; return true; })());
  };
  // kościoły: obrysy świątyń; części w ich obrębie (wieże, nawy) dostają okna kościelne i cegłę
  const churchRings = t.b.filter(b => !b.part && CHURCH.includes(b.t)).map(b => toXZ(b.o));
  // Stare Miasto: szablon kamienicy (data/cities.json, pole stare)
  const ST = CITIES[t.city as CityKey]?.stare, stC = ST ? makeProj(CITIES[t.city as CityKey].o)(ST[0], ST[1]) : null;
  const roadPts: number[] = []; if (stC) for (const r of t.r) if (r.k !== 'steps') for (let i = 0; i < r.p.length; i += 2) roadPts.push(r.p[i], r.p[i + 1]);
  const BSK = { tri: (a: number[], b2: number[], c: number[], col: RGB, n?: number[]) => B.tri(a, b2, c, col, n), get P() { return B.P; }, FA, FB, FC, pad: facPad };
  for (const b of t.b) {
    if (!b.part && coveredByParts(toXZ(b.o))) continue;
    if (byModel(b)) continue;
    const outer = toXZ(b.o), holes = (b.i || []).map(toXZ), base = world ? world.baseOf(outer) : 0, h = base + b.h, mh = base + b.mh;
    // cokół: ściany schodzą do najniższego punktu terenu (parter na najwyższym, okna zawsze nad gruntem)
    const wallBot = b.mh < .5 && world ? Math.min(mh, world.lowOf(outer) - .3) : mh;
    const fc0 = classify(b, t.city);
    const isChurch = CHURCH.includes(b.t) || (!!b.part && (b.bm === 'brick' || b.t === 'tower' || b.t === 'church' || (b.lv == null && !!(b.bc || b.rc || b.rs)))) || (!!b.part && churchRings.some(r => { const o = toXZ(b.o); let x = 0, z = 0; for (const p of o) { x += p[0]; z += p[1]; } return insideXZ(r, x / o.length, z / o.length); }));
    // kamienica: w obrębie Starego Miasta, zwykły budynek o rozmiarach kamienicy
    const ctr = stC ? centroidFlat(b.o) : null;
    const kam = !!stC && !!ctr && (!b.part || b.mh < 1) && !isChurch && !b.rs?.match(/pyramidal|dome|onion|cone/) && (KAM_T.includes(b.t) || !!b.part) && Math.hypot(ctr[0] - stC[0], ctr[1] - stC[1]) < ST![2] && Math.abs(area2(toXZ(b.o))) / 2 < 1800 && b.h - b.mh < 32 && !(b.i?.length);
    const kc = kam ? kamColors(fc0.seed) : null;
    const fc = isChurch ? churchFacade(fc0, b) : fc0;
    const cat = fc.typ ?? (b.t === 'office' ? 'office' : HOUSE.includes(b.t) ? 'house' : INDUSTRY.includes(b.t) ? 'industrial' : SHOPS.includes(b.t) ? 'sklep' : 'inne');
    const pal = FACADE[cat] ?? FACADE.inne, base0 = pal[Math.floor(fc.seed * 9973) % pal.length], j = .94 + fc.seed * .1;
    // kolory: z OSM (building:colour, roof:colour), z materiału albo z palety typu budynku
    const mat = b.bm ?? (isChurch && !b.bc ? 'brick' : undefined); // kościół bez opisu: cegła
    // styl budynku (kafle z tools/simplify-tiles.ts; bez niego – rozpoznanie z samego budynku); Londyn: dotychczasowy wygląd
    const pl = t.city !== 'londyn';
    const st: BStyle | undefined = !pl || b.part || isChurch || kam ? undefined : b.st ?? styleLocal(b, outer, holes, stC);
    const stPal = st && WALL_COL[st];
    const wall0 = b.bc ? hex(b.bc) : mat && MAT_COL[mat] ? MAT_COL[mat][Math.floor(fc.seed * 9973) % MAT_COL[mat].length] : stPal ? stPal[Math.floor(fc.seed * 7919) % stPal.length] : base0;
    const col: RGB = kc && !b.bc ? kc.wall : [wall0[0] * j, wall0[1] * j, wall0[2] * j]; // kamienica: kolor z OSM albo pastel
    // wieża kościoła bez opisanego dachu: hełm ostrosłupowy
    const rs = b.rs ?? (isChurch && isTower(b) ? 'pyramidal' : undefined);
    const shaped = !!rs && !holes.length, tower = rs === 'pyramidal' || rs === 'cone' || rs === 'onion' || rs === 'dome' || rs === 'round';
    const roof0 = b.rc ? hex(b.rc) : shaped ? (tower ? (b.hist ? PAL.copper : PAL.roofDark) : (b.hist || b.bm === 'brick' || HOUSE.includes(b.t) ? PAL.tiles : PAL.roofDark)) : PAL.roof;
    const roof: RGB = [roof0[0] * j, roof0[1] * j, roof0[2] * j];
    let wallTop = h;
    let stLevels: { lv: number; lh: number } | null = null;
    let kfc = fc, gable: { a: XZ; c: XZ; n: [number, number]; y0: number; rh: number } | null = null;
    if (kam && kc) { // dach szczytem do frontu, okna kamienicy, ozdobny szczyt
      const fi = frontEdge(outer, roadPts, { c: stC!, inner: 58, outer: 145 }), a = outer[fi], c = outer[(fi + 1) % outer.length], fw = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const ccw0 = area2(outer) > 0, dx = (c[0] - a[0]) / fw, dz = (c[1] - a[1]) / fw, n: [number, number] = ccw0 ? [dz, -dx] : [-dz, dx];
      const fr = obb(outer), across = !!fr && Math.abs(dx * fr.ux + dz * fr.uz) > .7;
      const rh = Math.max(3.5, Math.min(9, fw * .55, (h - mh) * .45)); wallTop = fc.typ ? h : h - rh * .35; // z wnętrzem: dach ponad wszystkimi piętrami (okna ostatniego piętra całe)
      const roofK: RGB = b.rc ? hex(b.rc) : kc.roof;
      addRoof(B, outer, wallTop, rh, 'gabled', across, roofK, col);
      const lvl = Math.max(2, Math.min(7, b.lv ?? Math.round((wallTop - mh) / 3.6))), lh = (wallTop - mh - .4) / lvl;
      // budynki z wnętrzem: siatka okien z typologii (ta sama co okna mieszkań); pozostałe: okna kamienicy z szablonu
      kfc = fc.typ ? fc : { ...fc, levels: lvl, levelH: lh, raise: .4, spacing: 2.7, ww: 1.15, wh: Math.min(2.3, lh * .56), sill: lh * .26 };
      gable = { a, c, n, y0: wallTop - base, rh };
    } else if (st && (!rs || rs === 'flat')) {
      const lv = b.lv ?? Math.max(1, Math.round((b.h - b.mh) / 3.1)), lh = (b.h - b.mh) / lv, fr = obb(outer);
      const setback = st === 'wsp' && lv >= 5 && !holes.length && fr.D > 12 && Math.abs(area2(outer)) / 2 > .9 * fr.W * fr.D && fc.seed > .45;
      const fillTop = (y: number, k: RGB) => fillPoly(B, outer, holes, y, k);
      const top = setback ? h - lh : h;
      wallTop = styledRoof(B, fillTop, { st, outer, holes, top, base, lv, levelH: lh, seed: fc.seed, wall: col, roof: b.rc ? hex(b.rc) : undefined, flat: rs === 'flat' });
      if (setback) { // cofnięte ostatnie piętro (taras dookoła)
        const sk = makeSink(BSK, base, fc.seed), m = 1.8, { ox, oz, ux, uz, W, D } = fr, P = (u: number, v: number): XZ => [ox + ux * u - uz * v, oz + uz * u + ux * v];
        const ring: XZ[] = [P(m, m), P(W - m, m), P(W - m, D - m), P(m, D - m)];
        facPad(); sk.box(ring[0], ring[1], ring[2], ring[3], top - base, h - base - .05, col, { levelH: lh, spacing: 2.2, ww: 1.8, wh: Math.min(2.2, lh - .5), sill: .3, raise: top - base, levels: 1, mat: 0, arch: false }); facPad();
        styledRoof(B, (y, k) => fillPoly(B, ring, [], y, k), { st, outer: ring, holes: [], top: h, base, lv, levelH: lh, seed: fc.seed, wall: col, flat: true });
      }
      stLevels = { lv, lh };
    } else if (shaped) {
      let rh = b.rh ?? defaultRoofH(rs!, outer, b.h - b.mh); rh = Math.min(rh, Math.max(.5, h - mh - .5)); wallTop = h - rh;
      addRoof(B, outer, wallTop, rh, rs!, b.ro === 'across', roof, col);
    } else fillPoly(B, outer, holes, h, roof);
    // okna tylko na kondygnacjach mieszczących się pod okapem (bez okien przeciętych dachem)
    if (kfc.levelH > 0) { const fit = Math.floor((wallTop - base - kfc.raise - kfc.sill - kfc.wh + .02) / kfc.levelH) + 1; if (fit < kfc.levels) kfc = { ...kfc, levels: Math.max(0, fit) }; }
    facPad();
    const matId = st === 'blok' && !mat ? 3 : mat === 'brick' || (!mat && !b.bc && b.hist && fc.typ === null && b.t !== 'house') ? 1 : mat === 'stone' ? 2 : 0;
    const balc: [XZ, XZ, number, number, number][] = [];
    const hasParts = !b.part && partEdges.length > 0 && partEdges.some(e => insideXZ(outer, (e[0] + e[2]) / 2, (e[1] + e[3]) / 2));
    for (const [ring, isHole] of [[outer, false], ...holes.map(r => [r, true])] as [XZ[], boolean][]) {
      const ccw = area2(ring) > 0 !== isHole, n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], c = ring[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], m = Math.hypot(dx, dz) || 1;
        const nrm = ccw ? [dz / m, 0, -dx / m] : [-dz / m, 0, dx / m];
        const n0 = B.P.length / 3;
        // kolejność wierzchołków zgodna z normalną na zewnątrz (obrysy bywają w obu kierunkach)
        const piece = (t0: number, t1: number, y0: number, y1: number) => {
          const p0: XZ = [a[0] + dx * t0, a[1] + dz * t0], p1: XZ = [a[0] + dx * t1, a[1] + dz * t1];
          if (ccw) B.quad([p1[0], y0, p1[1]], [p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], col, nrm);
          else B.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], col, nrm);
        };
        // bramy przejazdowe: otwór w ścianie, nad nim nadproże (wyższe piętra z oknami)
        const cuts = b.mh < .5 ? passCuts(a, c, m) : [];
        // wysokość otworu: grunt w osi bramy + PASS_H (to samo co sklepienie sieni)
        const cutTop = (c0: number, c1: number) => { const tm = (c0 + c1) / 2, x = a[0] + dx * tm, z = a[1] + dz * tm; return Math.min(wallTop, (g ? g(x, z) : 0) + PASS_H); };
        const passTop = cuts.length ? Math.max(...cuts.map(([c0, c1]) => cutTop(c0, c1))) : 0;
        if (!cuts.length) piece(0, 1, wallBot, wallTop);
        else { let t = 0; for (const [c0, c1] of cuts) { if (c0 > t) piece(t, c0, wallBot, wallTop); piece(c0, c1, cutTop(c0, c1), wallTop); t = c1; } if (t < 1) piece(t, 1, wallBot, wallTop); }
        // ściana zakryta: obrys na ścianie części budynku albo wewnątrz własnego modelu landmarku – bez własnych okien
        const hidden = (!b.part && hasParts && onPartWall(a, c)) || insideModel((a[0] + c[0]) / 2, (a[1] + c[1]) / 2) || sharedWall(a, c, b.id);
        const sp = hidden ? 0 : kfc.spacing;
        const w0 = WIN.length;
        if (!isChurch && !hidden) wallWindows(WIN, a, c, nrm, base, mh, wallTop, kfc.levelH, kfc.spacing, kfc.ww, kfc.wh, kfc.raise, kfc.sill, kfc.levels, kfc.seed);
        if (cuts.length) for (let q = WIN.length - WIN_STRIDE; q >= w0; q -= WIN_STRIDE) { // okna fizyczne w otworze bramy: usunięte
          const tq = ((WIN[q] - a[0]) * dx + (WIN[q + 2] - a[1]) * dz) / (m * m), ylo = WIN[q + 1] - WIN[q + 5] / 2;
          if (ylo < passTop + .05 && cuts.some(([c0, c1]) => tq > c0 - .08 && tq < c1 + .08)) WIN.splice(q, WIN_STRIDE);
        }
        if (st === 'blok' && !isHole && stLevels && stLevels.lv >= 4 && nrm[2] > -.25) balc.push([a, c, nrm[0], nrm[2], m]);
        for (let k = n0; k < B.P.length / 3; k++) {
          const px = B.P[k * 3], py = B.P[k * 3 + 1], pz = B.P[k * 3 + 2];
          FA.push(((px - a[0]) * dx + (pz - a[1]) * dz) / m, py - base, m, kfc.levelH); FB.push(sp, kfc.ww, kfc.wh, kfc.raise); FC.push(kfc.sill, kfc.levels, kfc.seed, matId + (isChurch ? 4 : 0));
        }
      }
    }
    if (balc.length) { // balkony bloku na ścianach od strony słonecznej (nie od północy)
      const bc = BALC[Math.floor(fc.seed * 6151) % BALC.length];
      for (const [a, c, nx, nz, m] of balc) balconies(B, a, c, nx, nz, base, kfc.raise, kfc.levelH, Math.min(kfc.levels, stLevels!.lv), windowSlots(m, kfc), bc, fc.seed);
    }
    if (gable && kc) { facPad(); buildGable(makeSink(BSK, base, kfc.seed), gable.a, gable.c, gable.n, gable.y0, gable.rh, kc.style, kc.wall, kfc.seed); facPad(); }
  }

  // sień bramy przejazdowej: ściany boczne i sklepienie na odcinkach drogi bp wewnątrz budynków
  if (passSegs.length) {
    facPad();
    const inB = (x: number, z: number) => t.b.some(q => !q.part && q.mh < .5 && insideFlat(q.o, x, z));
    const PC: RGB = [.62, .6, .56], CC: RGB = [.55, .53, .5];
    for (const s of passSegs) {
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); if (L < .2) continue;
      const ux = (s.b[0] - s.a[0]) / L, uz = (s.b[1] - s.a[1]) / L, nx = -uz * s.hw, nz = ux * s.hw, n = Math.max(1, Math.ceil(L / 1.5));
      for (let i = 0; i < n; i++) {
        const t0 = i / n * L, t1 = (i + 1) / n * L, mx = s.a[0] + ux * (t0 + t1) / 2, mz = s.a[1] + uz * (t0 + t1) / 2; if (!inB(mx, mz)) continue;
        const P0: XZ = [s.a[0] + ux * t0, s.a[1] + uz * t0], P1: XZ = [s.a[0] + ux * t1, s.a[1] + uz * t1];
        const gy = (x: number, z: number) => g ? g(x, z) : 0, top = (x: number, z: number) => gy(x, z) + PASS_H;
        for (const sd of [-1, 1]) {
          const A: XZ = [P0[0] + nx * sd, P0[1] + nz * sd], C2: XZ = [P1[0] + nx * sd, P1[1] + nz * sd];
          B.quad([A[0], gy(A[0], A[1]) - .3, A[1]], [C2[0], gy(C2[0], C2[1]) - .3, C2[1]], [C2[0], top(C2[0], C2[1]), C2[1]], [A[0], top(A[0], A[1]), A[1]], PC, [-nx * sd / s.hw, 0, -nz * sd / s.hw]);
        }
        const tA: XZ = [P0[0] - nx, P0[1] - nz], tB: XZ = [P1[0] - nx, P1[1] - nz], tC: XZ = [P1[0] + nx, P1[1] + nz], tD: XZ = [P0[0] + nx, P0[1] + nz];
        B.quad([tA[0], top(tA[0], tA[1]), tA[1]], [tB[0], top(tB[0], tB[1]), tB[1]], [tC[0], top(tC[0], tC[1]), tC[1]], [tD[0], top(tD[0], tD[1]), tD[1]], CC, [0, -1, 0]);
      }
    }
    facPad();
  }

  for (const m of models) {
    const [x, z] = centroidFlat(m.ring); if (Math.floor(x / t.size) !== t.x || Math.floor(z / t.size) !== t.y) continue;
    const ring = toXZ(m.ring), base = world ? world.lowOf(ring) : 0; facPad(); // własne modele: dopasowane do najniższego punktu (mają własne cokoły i schody)
    const sink = makeSink({ tri: (a, b2, c, col, n) => B.tri(a, b2, c, col, n), get P() { return B.P; }, FA, FB, FC, pad: facPad }, base, .37); sink.ground = (x, z) => (g ? g(x, z) : 0);
    BUILDERS[m.model]?.(sink, m.frame, ring); facPad();
  }
  // pomniki, rzeźby, krasnale (własne modele z punktów OSM)
  const BS = { tri: (a: number[], b2: number[], c: number[], col: RGB, n?: number[]) => B.tri(a, b2, c, col, n), get P() { return B.P; }, FA, FB, FC, pad: facPad };
  for (const p of t.poi) if (p.c === 'pomnik') { buildMonument(makeSink(BS, g ? g(p.x, p.z) : 0, .5), p.x, p.z, p.t, p.n ?? ''); }
  facPad();

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

  // --- cieki: wstęga wody na osi koryta (wysokość z osi, brzegi wyższe w modelu terenu zasłaniają jej krawędzie) ---
  for (const q of t.w ?? []) {
    const pts = toXZ(q.p), hw = q.wd / 2; if (pts.length < 2) continue;
    const yAt = (x: number, z: number) => (g ? g(x, z) : 0) + LIFT + .04;
    const off: XZ[] = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [-dz / L * hw, dx / L * hw]; });
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], r = pts[i + 1], o0 = off[i], o1 = off[i + 1], y0 = yAt(p[0], p[1]), y1 = yAt(r[0], r[1]);
      F[0].quad([p[0] - o0[0], y0, p[1] - o0[1]], [r[0] - o1[0], y1, r[1] - o1[1]], [r[0] + o1[0], y1, r[1] + o1[1]], [p[0] + o0[0], y0, p[1] + o0[1]], C.waterTop, [0, 1, 0]);
    }
  }

  // --- drogi ---
  const junctions: XZ[] = t.g.filter(g => g.jn).map(g => [g.x, g.z]);
  const roadW = new Map<number, number>(); // id węzła -> szerokość drogi
  const near = (r: number) => (x: number, z: number) => junctions.some(j => (j[0] - x) ** 2 + (j[1] - z) ** 2 < r * r);
  // odcinki jezdni i torów na mostach (do balustrad: tylko zewnętrzne krawędzie mostu)
  const brSegs: { id: number; a: XZ; b: XZ; hw: number }[] = [];
  for (const q of t.r) if (q.br) { const pp = toXZ(q.p); for (let i = 0; i + 1 < pp.length; i++) brSegs.push({ id: q.id, a: pp[i], b: pp[i + 1], hw: q.w / 2 + (q.sw ? 2.5 : 0) + .3 }); }
  for (const q of t.l) if (q.br) { const pp = toXZ(q.p); for (let i = 0; i + 1 < pp.length; i++) brSegs.push({ id: q.id, a: pp[i], b: pp[i + 1], hw: 2.2 }); }
  const otherBridge = (x: number, z: number, self: number) => brSegs.some(sg => sg.id !== self && (() => { const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - sg.a[0]) * dx + (z - sg.a[1]) * dz) / L2)); return Math.hypot(sg.a[0] + dx * u - x, sg.a[1] + dz * u - z) < sg.hw + 1; })());
  const drawRoad = (r: TileRoad) => {
    const p = densify(toXZ(r.p), SEG), n = offsets(p), hw = r.w / 2, veh = isVehicleRoad(r.k), ys = r.br ? deckYs(p, r.bw) : gys(p);
    for (let i = 0; i < r.j.length; i += 2) roadW.set(r.j[i + 1], Math.max(roadW.get(r.j[i + 1]) || 0, r.w));
    if (r.br) {
      const ext = hw + (r.sw ? 2.5 : 0);
      strip(S, p, n, -ext, ext, ys, C.deck, -.02);
      // balustrada: niski murek z poręczą (bryła, bez linii unoszących się nad pomostem)
      for (const sd of [-1, 1]) { const s0 = sd * ext, s1 = sd * (ext + .25);
        // obok (na zewnątrz tej krawędzi) inna jezdnia albo tory na moście: bez balustrady pośrodku mostu
        const mi = Math.floor(p.length / 2), mp = p[mi], mn = n[mi];
        if (otherBridge(mp[0] + mn[0] * sd * (ext + 1.5), mp[1] + mn[1] * sd * (ext + 1.5), r.id)) continue;
        wall(S, p, n, s0, ys, -.02, .95, BAL_IN); wall(S, p, n, s1, ys, -.6, .95, BAL_OUT); strip(S, p, n, Math.min(s0, s1), Math.max(s0, s1), ys, BAL_TOP, .97); }
    }
    if (!veh) { strip(F[2], p, n, -hw, hw, ys, C.path); return; }
    // zmienna szerokość: płynne zwężenie na ok. 30 m przy końcach z wa / wb (tools/lib/roads.ts)
    let H: Off = hw;
    if (r.wa != null || r.wb != null) {
      const arc = [0]; for (let i = 1; i < p.length; i++) arc.push(arc[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      const L = arc[arc.length - 1], T = Math.min(30, L / 2.2), sm = (x: number) => x * x * (3 - 2 * x);
      H = arc.map(s => { let w = r.w; if (r.wa != null && s < T) w = r.wa + (r.w - r.wa) * sm(s / T); if (r.wb != null && s > L - T) w = r.wb + (w - r.wb) * sm((L - s) / T); return w / 2; });
    }
    const nH = offMap(H, v => -v);
    strip(F[3], p, n, nH, H, ys, r.tu ? [.03, .04, .045] : C.road);
    const skip = near(hw + 4);
    if (r.sw) for (const side of [-1, 1]) {
      if (!((side < 0 && r.sw & 1) || (side > 0 && r.sw & 2))) continue;
      // chodnik podniesiony o krawężnik: nawierzchnia, ściana krawężnika od jezdni, zewnętrzna krawędź
      const e0 = offMap(H, v => side * v), e1 = offMap(H, v => side * (v + 2.5));
      strip(RB, p, n, e0, e1, ys, PAL.sidewalk, CURB); wall(RB, p, n, e0, ys, 0, CURB, PAL.curb); wall(RB, p, n, e1, ys, 0, CURB, PAL.sidewalk);
    }
    // pasy ruchu
    const ln = r.ln, lane = (k: number, d = 0): Off => offMap(H, v => -v + k * 2 * v / Math.max(1, ln) + d); // k-ta linia pasów od lewej krawędzi
    // oznakowanie poziome tylko na głównych ulicach (uproszczenie)
    if (ln >= 2 && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(r.k)) {
      if (r.ow) { for (let k = 1; k < ln; k++) offLine(FL[4], p, n, lane(k), ys, C.mark, [3, 6], skip); }
      else {
        const fwd = Math.ceil(ln / 2), back = ln - fwd;
        if (ln >= 4) { offLine(FL[4], p, n, lane(back, -.15), ys, C.mark, undefined, skip); offLine(FL[4], p, n, lane(back, .15), ys, C.mark, undefined, skip); }
        else offLine(FL[4], p, n, lane(back), ys, C.mark, [4, 4], skip);
        for (let k = 1; k < back; k++) offLine(FL[4], p, n, lane(k), ys, C.mark, [3, 6], skip);
        for (let k = 1; k < fwd; k++) offLine(FL[4], p, n, lane(back + k), ys, C.mark, [3, 6], skip);
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
    if (l.br) {
      strip(S, p, n, -2.2, 2.2, ys, C.deck, -.02);
      const mi = Math.floor(p.length / 2), mp = p[mi], mn = n[mi];
      for (const sd of [-1, 1]) { if (otherBridge(mp[0] + mn[0] * sd * 3.7, mp[1] + mn[1] * sd * 3.7, l.id)) continue;
        wall(S, p, n, sd * 2.2, ys, -.02, .95, BAL_IN); wall(S, p, n, sd * 2.45, ys, -.6, .95, BAL_OUT); strip(S, p, n, Math.min(sd * 2.2, sd * 2.45), Math.max(sd * 2.2, sd * 2.45), ys, BAL_TOP, .97); }
    }
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

  // --- złożenie (dane) ---
  const layers: Layer[] = [];
  const add = (lines: boolean, mat: MatName, order: number, a: Attrs) => layers.push({ lines, mat, order, a });
  if (!B.empty) {
    facPad(); const a = B.attrs();
    a.aFacA = { array: new Float32Array(FA), size: 4 }; a.aFacB = { array: new Float32Array(FB), size: 4 }; a.aFacC = { array: new Float32Array(FC), size: 4 };
    add(false, 'build', 0, a);
  }
  if (!BE.empty) { const a = BE.attrs(); delete a.color; add(true, 'edge', 0, a); }
  F.forEach((f, i) => { if (!f.empty) add(false, 'flat', 1 + i * 2, f.attrs()); });
  FL.forEach((f, i) => { if (!f.empty) add(true, 'flatLine', 2 + i * 2, f.attrs()); });
  if (!S.empty) add(false, 'solid', 0, S.attrs());
  if (!RB.empty) add(false, 'raised', 0, RB.attrs());
  if (!SL.empty) add(true, 'line', 0, SL.attrs());
  const props = buildProps(t, phys, g, stops);
  return { key: `${t.x}_${t.y}`, layers, inst: props.inst, lamps: props.lamps, buildings: t.b.length, ms: performance.now() - t0, win: new Float32Array(WIN) };
}
