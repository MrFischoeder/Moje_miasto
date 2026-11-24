// Bryły dachów z danych OSM (roof:shape): dwuspadowy, czterospadowy, naczółkowy, pulpitowy, ostrosłupowy (hełmy wież),
// stożek, kopuła, cebula. Dachy prostokątne liczone na prostokącie opisanym (OBB), inne kształty: dach „z wcięciem”.
import { obb } from '@miasto/shared/interiors/geom';
import type { XZ } from '@miasto/shared/world/collision';
import type { RGB } from '@miasto/shared/util/rng';

export interface TriSink { tri(a: number[], b: number[], c: number[], col: RGB, n?: number[]): void }

const area = (r: XZ[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

/** Profile brył obrotowych: [skala obrysu, ułamek wysokości dachu] od okapu do szczytu. */
const PROFILE: Record<string, [number, number][]> = {
  pyramidal: [[1, 0], [0, 1]],
  cone: [[1, 0], [0, 1]],
  dome: [[1, 0], [.92, .38], [.71, .71], [.38, .92], [0, 1]],
  round: [[1, 0], [.92, .38], [.71, .71], [.38, .92], [0, 1]],
  onion: [[1, 0], [1.22, .18], [1.18, .36], [.8, .58], [.3, .78], [.1, .9], [0, 1]],
};

/** Domyślna wysokość dachu, gdy OSM jej nie podaje. */
export function defaultRoofH(shape: string, ring: XZ[], wallH: number): number {
  const f = obb(ring), short = f ? Math.min(f.W, f.D) : 8;
  const k = shape === 'pyramidal' || shape === 'cone' ? 1.1 : shape === 'onion' ? 1.2 : shape === 'dome' || shape === 'round' ? .5 : shape === 'skillion' ? .2 : .42;
  return Math.max(1, Math.min(short * k, wallH * .6));
}

/** Dach na obrysie ring (bez dziedzińców): okap na wysokości y0, szczyt y0 + rh. wallCol: kolor szczytów (ściany trójkątne). */
export function addRoof(S: TriSink, ring: XZ[], y0: number, rh: number, shape: string, across: boolean, col: RGB, wallCol: RGB): void {
  let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
  const C = [cx, y0 - rh * .5, cz];
  // trójkąt zwrócony na zewnątrz bryły (normalna od środka budynku)
  const T = (a: number[], b: number[], c: number[], k: RGB) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const m = Math.hypot(n[0], n[1], n[2]); if (m < 1e-9) return; n = n.map(v => v / m);
    const g = [(a[0] + b[0] + c[0]) / 3 - C[0], (a[1] + b[1] + c[1]) / 3 - C[1], (a[2] + b[2] + c[2]) / 3 - C[2]];
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) n = n.map(v => -v);
    S.tri(a, b, c, k, n);
  };
  const Q = (a: number[], b: number[], c: number[], d: number[], k: RGB) => { T(a, b, c, k); T(a, c, d, k); };

  const prof = PROFILE[shape];
  if (prof) { // bryła obrotowa wokół środka obrysu
    const rings = prof.map(([s, f]) => ring.map(([x, z]) => [cx + (x - cx) * s, y0 + rh * f, cz + (z - cz) * s]));
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1], top = prof[k + 1][0] === 0;
      for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; if (top) T(A[i], A[j], B[0], col); else Q(A[i], A[j], B[j], B[i], col); }
    }
    return;
  }
  const f = obb(ring);
  const rect = f && area(ring) >= .86 * f.W * f.D;
  if (!f || !rect) { // nieregularny obrys: dach czterospadowy „z wcięciem” (obrys zmniejszony ku środkowi) i płaski szczyt
    const s = .45, top = ring.map(([x, z]) => [cx + (x - cx) * s, y0 + rh, cz + (z - cz) * s]);
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; Q([ring[i][0], y0, ring[i][1]], [ring[j][0], y0, ring[j][1]], top[j], top[i], col); }
    for (let i = 1; i + 1 < top.length; i++) T(top[0], top[i], top[i + 1], col);
    return;
  }
  // prostokąt: oś kalenicy wzdłuż dłuższego boku (w poprzek przy roof:orientation=across)
  let { ox, oz, ux, uz, W, D } = f;
  let nx = -uz, nz = ux;
  if (across) { // zamiana osi
    const o2x = ox + ux * W, o2z = oz + uz * W; [ux, uz, nx, nz] = [nx, nz, -ux, -uz]; ox = o2x; oz = o2z; [W, D] = [D, W];
  }
  const P = (u: number, v: number, y: number) => [ox + ux * u + nx * v, y, oz + uz * u + nz * v];
  const y1 = y0 + rh, e00 = P(0, 0, y0), e10 = P(W, 0, y0), e11 = P(W, D, y0), e01 = P(0, D, y0);
  if (shape === 'skillion') {
    const t0 = P(0, D, y1), t1 = P(W, D, y1);
    Q(e00, e10, t1, t0, col); Q(e01, e11, t1, t0, wallCol); T(e00, e01, t0, wallCol); T(e10, e11, t1, wallCol);
    return;
  }
  const hip = shape === 'hipped' || shape === 'mansard' ? Math.min(D / 2, W / 2) : shape === 'half-hipped' ? Math.min(D / 4, W / 4) : 0;
  const r0 = P(hip, D / 2, y1), r1 = P(W - hip, D / 2, y1);
  Q(e00, e10, r1, r0, col); Q(e01, e11, r1, r0, col);
  if (hip > 0) { T(e00, e01, r0, col); T(e10, e11, r1, col); }
  else { T(e00, e01, r0, wallCol); T(e10, e11, r1, wallCol); } // szczyty (ściany)
}
