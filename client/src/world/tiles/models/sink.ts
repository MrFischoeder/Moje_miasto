// Wspólne „ujście” geometrii własnych modeli landmarków: ściany z oknami z shadera (te same atrybuty fasady co budynki),
// bryły, pinakle, tarcze. Wszystko trafia do bufora budynków kafla (bez dodatkowych wywołań rysowania).
import type { RGB } from '@miasto/shared/util/rng';
import type { TriSink } from '../roofs';

/** prostokąt opisany na obrysie (shared/interiors/geom.ts obb) */
export interface Frame { ox: number; oz: number; ux: number; uz: number; W: number; D: number }
/** okna w ścianie (jak atrybuty aFacA/B/C): wysokości względem gruntu budynku */
export interface Fac { levelH: number; spacing: number; ww: number; wh: number; sill: number; raise: number; levels: number; mat: number; arch: boolean }
type XZ = [number, number];

export interface ModelSink extends TriSink {
  /** wysokość gruntu pod modelem */
  base: number;
  /** ściana a→c od y0 do y1 (względem gruntu), zwrócona na zewnątrz od punktu ctr */
  wall(a: XZ, c: XZ, y0: number, y1: number, col: RGB, fac: Fac | null, ctr: XZ): void;
  /** prostopadłościan o podstawie p0..p3 (wypukły czworokąt) */
  box(p0: XZ, p1: XZ, p2: XZ, p3: XZ, y0: number, y1: number, col: RGB, fac: Fac | null): void;
  /** płyta (gzyms, galeria): wielokąt wypukły od y0 do y1 */
  slab(ring: XZ[], y0: number, y1: number, col: RGB): void;
  /** pinakiel: ostrosłup o podstawie kwadratu (pół-bok r) i wysokości h, od y */
  spire(c: XZ, y: number, r: number, h: number, col: RGB): void;
  /** tarcza (zegar) w płaszczyźnie pionowej, zwrócona w kierunku dir */
  disc(c: XZ, y: number, r: number, dir: XZ, col: RGB, rim: RGB): void;
}

export interface FacadeArrays { P: number[]; FA: number[]; FB: number[]; FC: number[]; pad(): void }

export function makeSink(B: TriSink & FacadeArrays, base: number, seed: number): ModelSink {
  const tri = (a: number[], b: number[], c: number[], col: RGB, n?: number[]) => B.tri(a, b, c, col, n);
  /** trójkąt zwrócony od punktu wewnętrznego C */
  const T = (a: number[], b: number[], c: number[], col: RGB, C: number[]) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const m = Math.hypot(n[0], n[1], n[2]); if (m < 1e-9) return; n = n.map(v => v / m);
    const g = [(a[0] + b[0] + c[0]) / 3 - C[0], (a[1] + b[1] + c[1]) / 3 - C[1], (a[2] + b[2] + c[2]) / 3 - C[2]];
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) n = n.map(v => -v);
    B.pad(); B.tri(a, b, c, col, n); B.pad();
  };
  const S: ModelSink = {
    base, tri: (a, b, c, col, n) => { B.pad(); tri(a, b, c, col, n); B.pad(); },
    wall(a, c, y0, y1, col, fac, ctr) {
      const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < .01) return;
      let nx = dz / L, nz = -dx / L; const mx = (a[0] + c[0]) / 2 - ctr[0], mz = (a[1] + c[1]) / 2 - ctr[1]; if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      B.pad(); const n0 = B.P.length / 3, Y0 = base + y0, Y1 = base + y1;
      B.tri([a[0], Y0, a[1]], [c[0], Y0, c[1]], [c[0], Y1, c[1]], col, [nx, 0, nz]); B.tri([a[0], Y0, a[1]], [c[0], Y1, c[1]], [a[0], Y1, a[1]], col, [nx, 0, nz]);
      for (let k = n0; k < B.P.length / 3; k++) {
        const px = B.P[k * 3], py = B.P[k * 3 + 1], pz = B.P[k * 3 + 2];
        if (fac) { B.FA.push(((px - a[0]) * dx + (pz - a[1]) * dz) / L, py - base, L, fac.levelH); B.FB.push(fac.spacing, fac.ww, fac.wh, fac.raise); B.FC.push(fac.sill, fac.levels, seed, fac.mat + (fac.arch ? 4 : 0)); }
        else { B.FA.push(0, 0, 0, 0); B.FB.push(0, 0, 0, 0); B.FC.push(0, 0, 0, 0); }
      }
    },
    box(p0, p1, p2, p3, y0, y1, col, fac) {
      const r = [p0, p1, p2, p3], c: XZ = [(p0[0] + p1[0] + p2[0] + p3[0]) / 4, (p0[1] + p1[1] + p2[1] + p3[1]) / 4];
      for (let i = 0; i < 4; i++) S.wall(r[i], r[(i + 1) % 4], y0, y1, col, fac, c);
      const Y = base + y1, C = [c[0], base + (y0 + y1) / 2, c[1]];
      T([p0[0], Y, p0[1]], [p1[0], Y, p1[1]], [p2[0], Y, p2[1]], col, C); T([p0[0], Y, p0[1]], [p2[0], Y, p2[1]], [p3[0], Y, p3[1]], col, C);
    },
    slab(ring, y0, y1, col) {
      const c: XZ = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      for (let i = 0; i < ring.length; i++) S.wall(ring[i], ring[(i + 1) % ring.length], y0, y1, col, null, c);
      const Y = base + y1, C = [c[0], base + (y0 + y1) / 2, c[1]], Y0 = base + y0, C2 = [c[0], base + y1 + 1, c[1]];
      for (let i = 1; i + 1 < ring.length; i++) {
        T([ring[0][0], Y, ring[0][1]], [ring[i][0], Y, ring[i][1]], [ring[i + 1][0], Y, ring[i + 1][1]], col, C);
        T([ring[0][0], Y0, ring[0][1]], [ring[i][0], Y0, ring[i][1]], [ring[i + 1][0], Y0, ring[i + 1][1]], col, C2); // spód (galeria widoczna z dołu)
      }
    },
    spire(c, y, r, h, col) {
      const Y = base + y, top = [c[0], Y + h, c[1]], C = [c[0], Y + h * .3, c[1]];
      const q = [[c[0] - r, Y, c[1] - r], [c[0] + r, Y, c[1] - r], [c[0] + r, Y, c[1] + r], [c[0] - r, Y, c[1] + r]];
      for (let i = 0; i < 4; i++) T(q[i], q[(i + 1) % 4], top, col, C);
    },
    disc(c, y, r, dir, col, rim) {
      const L = Math.hypot(dir[0], dir[1]), dx = dir[0] / L, dz = dir[1] / L, sx = -dz, sz = dx, Y = base + y, n = 16;
      const at = (a: number, rr: number, off: number) => [c[0] + sx * Math.cos(a) * rr + dx * off, Y + Math.sin(a) * rr, c[1] + sz * Math.cos(a) * rr + dz * off];
      const ctr = [c[0] + dx * .06, Y, c[1] + dz * .06], nrm = [dx, 0, dz];
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
        S.tri(ctr, at(a0, r * .82, .06), at(a1, r * .82, .06), col, nrm);
        S.tri(at(a0, r * .82, .05), at(a0, r, .05), at(a1, r, .05), rim, nrm); S.tri(at(a0, r * .82, .05), at(a1, r, .05), at(a1, r * .82, .05), rim, nrm);
      }
      // wskazówki (złote)
      S.tri([ctr[0], Y - .1, ctr[2]], [ctr[0] + dx * .02, Y + r * .7, ctr[2] + dz * .02], [ctr[0] + sx * .15, Y, ctr[2] + sz * .15], rim, nrm);
    },
  };
  return S;
}
