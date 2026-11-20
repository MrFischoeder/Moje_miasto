// Prymitywy podziemi: zbierają trójkąty i odcinki do jednego scalonego mesha i jednych linii.
// ZASADA: długie linie i trójkąty znikają blisko kamery na niektórych GPU (SwiftShader),
// dlatego line() tnie na odcinki do 20 m, a tunele są cięte co 25 m.
import * as THREE from 'three';
import type { RGB } from '@miasto/shared/util/rng';
import { mix } from '@miasto/shared/util/rng';
import type { Region } from '@miasto/shared/world/regions';

export type V3 = [number, number, number];
type V2 = readonly [number, number];
export const MAX_SEG = 20;

/** Punkt w układzie pasa: początek o, kierunek u, normalna n; t wzdłuż, s w poprzek, h = wysokość. */
export const V = (o: V2, u: V2, n: V2, t: number, s: number, h: number): V3 => [o[0] + u[0] * t + n[0] * s, h, o[1] + u[1] * t + n[1] * s];

export interface ShellOpts {
  left?: [number, number][]; right?: [number, number][];
  start?: [number, number] | 'open'; end?: [number, number] | 'open';
  steps?: RGB; lights?: number[];
  /** wysokość powierzchni nad pomieszczeniem (sufit nie wyżej) */
  surf?: number;
}

export class GeoBuilder {
  SP: number[] = []; SC: number[] = []; LP: number[] = []; LC: number[] = [];

  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, nrm: V3): void {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] < 0) [b, d] = [d, b];
    for (const p of [a, b, c, a, c, d]) { this.SP.push(p[0], p[1], p[2]); this.SC.push(col[0], col[1], col[2]); }
  }

  line(a: V3, b: V3, col: RGB): void {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / MAX_SEG));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      this.LP.push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1);
      this.LC.push(...col, ...col);
    }
  }

  /** Pomieszczenie / korytarz / schody: bryła wokół regionu, otwory w ścianach bocznych i czołowych. */
  shell(r: Region, H: number, wallC: RGB, edgeC: RGB, opt: ShellOpts = {}): void {
    const S0 = opt.surf ?? 0, o = r.a, u = r.u, n = r.n, L = r.len, w = r.hw, h = (t: number) => r.y0 + (r.y1 - r.y0) * t / L, top = (t: number) => Math.min(h(t) + H, S0);
    const floorC = mix(wallC, 1.25, [.05, .05, .05]), ceilC = mix(wallC, .6);
    // podłoga i sufit
    this.quad(V(o, u, n, 0, -w, h(0)), V(o, u, n, L, -w, h(L)), V(o, u, n, L, w, h(L)), V(o, u, n, 0, w, h(0)), floorC, [0, 1, 0]);
    let tc = L; if (h(L) + H > S0 && h(0) + H < S0) tc = L * (S0 - H - r.y0) / (r.y1 - r.y0); else if (h(0) + H >= S0) tc = 0;
    if (tc > 0) this.quad(V(o, u, n, 0, -w, h(0) + H), V(o, u, n, tc, -w, h(tc) + H), V(o, u, n, tc, w, h(tc) + H), V(o, u, n, 0, w, h(0) + H), ceilC, [0, -1, 0]);
    // ściany boczne z otworami
    for (const side of [-1, 1]) {
      const holes = (side < 0 ? opt.left : opt.right) || []; const cuts = [0]; holes.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => cuts.push(a, b)); cuts.push(L);
      const nn: V3 = [-n[0] * side, 0, -n[1] * side];
      const brk = [0, tc, L].filter((v, i, a) => a.indexOf(v) === i);
      for (let i = 0; i < cuts.length; i += 2) {
        const t0 = Math.max(0, cuts[i]), t1 = Math.min(L, cuts[i + 1]); if (t1 - t0 < .05) continue;
        const pts = [t0, ...brk.filter(b => b > t0 && b < t1), t1];
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          this.quad(V(o, u, n, a, w * side, h(a)), V(o, u, n, b, w * side, h(b)), V(o, u, n, b, w * side, top(b)), V(o, u, n, a, w * side, top(a)), wallC, nn);
        }
        this.line(V(o, u, n, t0, w * side, h(t0)), V(o, u, n, t1, w * side, h(t1)), edgeC);
        if (tc > t0) this.line(V(o, u, n, t0, w * side, top(t0)), V(o, u, n, Math.min(t1, tc), w * side, top(Math.min(t1, tc))), edgeC);
        this.line(V(o, u, n, t0, w * side, h(t0)), V(o, u, n, t0, w * side, top(t0)), edgeC);
        this.line(V(o, u, n, t1, w * side, h(t1)), V(o, u, n, t1, w * side, top(t1)), edgeC);
      }
    }
    // ściany czołowe (otwór o szerokości ow i wysokości oh pośrodku)
    for (const [t, dir, op] of [[0, 1, opt.start], [L, -1, opt.end]] as [number, number, ShellOpts['start']][]) {
      if (op === 'open') continue; const y = h(t), yt = top(t), nn: V3 = [u[0] * dir, 0, u[1] * dir];
      if (!op) { this.quad(V(o, u, n, t, -w, y), V(o, u, n, t, w, y), V(o, u, n, t, w, yt), V(o, u, n, t, -w, yt), wallC, nn); this.line(V(o, u, n, t, -w, yt), V(o, u, n, t, w, yt), edgeC); continue; }
      const [ow, oh] = op, a = ow / 2, yo = Math.min(y + oh, yt);
      this.quad(V(o, u, n, t, -w, y), V(o, u, n, t, -a, y), V(o, u, n, t, -a, yt), V(o, u, n, t, -w, yt), wallC, nn);
      this.quad(V(o, u, n, t, a, y), V(o, u, n, t, w, y), V(o, u, n, t, w, yt), V(o, u, n, t, a, yt), wallC, nn);
      if (yt - yo > .05) this.quad(V(o, u, n, t, -a, yo), V(o, u, n, t, a, yo), V(o, u, n, t, a, yt), V(o, u, n, t, -a, yt), wallC, nn);
      this.line(V(o, u, n, t, -a, y), V(o, u, n, t, -a, yo), edgeC); this.line(V(o, u, n, t, a, y), V(o, u, n, t, a, yo), edgeC); this.line(V(o, u, n, t, -a, yo), V(o, u, n, t, a, yo), edgeC);
    }
    // stopnie
    if (opt.steps && r.slope) { const nst = Math.round(Math.abs(r.y1 - r.y0) / .3); for (let i = 1; i < nst; i++) { const t = L * i / nst; this.line(V(o, u, n, t, -w, h(t) + .01), V(o, u, n, t, w, h(t) + .01), opt.steps); } }
    // świetlówki
    if (opt.lights) for (const s of opt.lights) { const t0 = 1, t1 = Math.max(1, tc - 1); if (t1 > t0) this.line(V(o, u, n, t0, s, h(t0) + H - .05), V(o, u, n, t1, s, h(t1) + H - .05), [.85, .95, .9]); }
  }

  box(cx: number, cz: number, y: number, sx: number, sz: number, H: number, u: V2, col: RGB, edge: RGB): void {
    const n: V2 = [-u[1], u[0]], o: V2 = [cx, cz];
    const c = [[-sx, -sz], [sx, -sz], [sx, sz], [-sx, sz]];
    for (let i = 0; i < 4; i++) {
      const [t0, s0] = c[i], [t1, s1] = c[(i + 1) % 4], mt = (t0 + t1) / 2, ms = (s0 + s1) / 2;
      this.quad(V(o, u, n, t0, s0, y), V(o, u, n, t1, s1, y), V(o, u, n, t1, s1, y + H), V(o, u, n, t0, s0, y + H), col, [u[0] * mt + n[0] * ms, 0, u[1] * mt + n[1] * ms]);
      this.line(V(o, u, n, t0, s0, y), V(o, u, n, t0, s0, y + H), edge);
    }
  }

  /** Jeden mesh (kolory wierzchołków) i jedne linie. */
  build(): THREE.Object3D[] {
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(this.SP, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(this.SC, 3));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(this.LP, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(this.LC, 3));
    const out = [
      new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })),
      new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })),
    ];
    this.SP = []; this.SC = []; this.LP = []; this.LC = [];
    return out;
  }
}
