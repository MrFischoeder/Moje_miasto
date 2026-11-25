// Wnętrza budynków: jeden scalony mesh i jedne linie na piętro budynku. Ściany z otworami drzwi i okien
// (przez okno widać miasto, bo ściana zewnętrzna od środka nie jest rysowana), schody, meble.
import * as THREE from 'three';
import type { World } from '@miasto/shared/world/world';
import type { Box, DoorDef, Level, Plan, Slab } from '@miasto/shared/interiors/plan';
import { toWorld } from '@miasto/shared/interiors/geom';
import { hex, mix, type RGB } from '@miasto/shared/util/rng';
import { GeoBuilder, type V3 } from './geometry';
import { drawItem } from './furniture';
import type { WindowUniforms } from './tiles/windows';
import { MAX_DOORS } from './tiles/windows';

const WALL = .06;
/** Kolory ścian (wypełnienie) wg rodzaju pomieszczenia; krawędzie fosforowe. */
const FILL: Record<string, RGB> = {
  core: [.78, .8, .76], corridor: [.82, .82, .78], lobby: [.86, .84, .78], hall: [.86, .82, .74], kitchen: [.9, .9, .82],
  bath: [.78, .86, .9], wc: [.78, .86, .9], living: [.9, .84, .74], bedroom: [.84, .8, .88], room: [.82, .86, .8], study: [.86, .8, .7],
  maid: [.84, .82, .76], storage: [.7, .7, .68], office: [.8, .84, .86], staff: [.82, .86, .8], sala: [.92, .92, .9], open: [.9, .88, .78], stair: [.78, .8, .76],
};
const FLOOR: Record<string, RGB> = { bath: [.7, .74, .78], wc: [.7, .74, .78], kitchen: [.72, .7, .66], sala: [.78, .78, .76], core: [.6, .6, .58], corridor: [.6, .6, .58], lobby: [.62, .6, .56] };
const EDGE: RGB = [.25, .26, .28], EDGE_DIM: RGB = [.4, .4, .42], STEP: RGB = [.35, .35, .36];
const ITEM: Record<string, RGB> = {
  szafa: [.75, .6, .4], szafka: [.75, .6, .4], blat: [.85, .85, .7], kuchenka: [.9, .9, .9], lodowka: [.85, .95, 1], stol: [.75, .6, .4],
  wanna: [.85, .95, 1], umywalka: [.85, .95, 1], pralka: [.85, .95, 1], sedes: [.85, .95, 1], kanapa: [.9, .5, .4], meblosciana: [.75, .6, .4],
  rtv: [.6, .7, .9], fotel: [.9, .5, .4], stolik: [.75, .6, .4], lozko: [.6, .7, 1], lozko1: [.6, .7, 1], komoda: [.75, .6, .4], nocna: [.75, .6, .4],
  wersalka: [.6, .7, 1], biurko: [.75, .6, .4], regal: [.75, .6, .4], regal_mag: [.6, .6, .6], sejf: [.9, .8, .3], skrzynki: [.7, .8, .8],
  kasa: [1, .85, .3], samoobsluga: [1, .85, .3], polka: [.5, .9, .6], gondola: [.5, .9, .6], lodowka_sklep: [.6, .85, 1], piekarnia: [1, .75, .4], szafki: [.6, .6, .7],
};

export class InteriorView {
  readonly group = new THREE.Group();
  private levels = new Map<string, THREE.Object3D[]>();
  private version = -1;
  /** skrzydła drzwi (przebudowa po zmianie stanu drzwi albo zestawu pięter) */
  private doorObjs: THREE.Object3D[] = []; private doorKey = '';
  constructor(private world: World) { this.group.name = 'wnętrza'; }

  /** Przebudowa po zmianie zestawu pięter; wycięcia drzwi w ścianach budynków. */
  update(x: number, z: number, doors: WindowUniforms | null): void {
    const I = this.world.interiors;
    if (I.version !== this.version) {
      this.version = I.version;
      const want = new Map<string, { p: Plan; L: Level }>();
      for (const lv of I.live.values()) for (const [k, L] of lv.levels) want.set(lv.plan.id + '/' + k, { p: lv.plan, L: L.level });
      for (const [key, objs] of this.levels) if (!want.has(key)) { for (const o of objs) { this.group.remove(o); dispose(o); } this.levels.delete(key); }
      for (const [key, { p, L }] of want) if (!this.levels.has(key)) { const objs = buildLevelView(p, L); for (const o of objs) this.group.add(o); this.levels.set(key, objs); }
    }
    const dk = I.version + '/' + I.doorVersion;
    if (dk !== this.doorKey) {
      this.doorKey = dk;
      for (const o of this.doorObjs) { this.group.remove(o); dispose(o); }
      this.doorObjs = buildDoorLeaves(I.liveDoors()); for (const o of this.doorObjs) this.group.add(o);
    }
    if (doors) {
      const ds = I.doors().map(d => ({ d, dist: Math.hypot(d.c[0] - x, d.c[1] - z) })).sort((a, b) => a.dist - b.dist).slice(0, MAX_DOORS);
      ds.forEach(({ d }, i) => { doors.uDoorA.value[i].set(d.c[0], d.c[1], d.u[0], d.u[1]); doors.uDoorB.value[i].set(d.y0, d.y1, d.w / 2, .9); });
      doors.uDoorN.value = ds.length;
    }
  }

  dispose(): void { for (const objs of this.levels.values()) for (const o of objs) { this.group.remove(o); dispose(o); } this.levels.clear(); for (const o of this.doorObjs) { this.group.remove(o); dispose(o); } this.doorObjs = []; }
}

function dispose(o: THREE.Object3D): void {
  const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material)?.dispose();
}

export function buildLevelView(p: Plan, L: Level): THREE.Object3D[] {
  const G = new GeoBuilder(), f = p.frame;
  const P = (x: number, y: number, h: number): V3 => { const [wx, wz] = toWorld(f, x, y); return [wx, h, wz]; };
  const N = (dx: number, dy: number): V3 => { const [ax, az] = toWorld(f, 0, 0), [bx, bz] = toWorld(f, dx, dy); return [bx - ax, 0, bz - az]; };
  const up: V3 = [0, 1, 0], down: V3 = [0, -1, 0];

  for (const bx of L.boxes) {
    const r = bx.r, fill = FILL[bx.kind] ?? FILL.room, edge = bx.accent ? hex(bx.accent) : EDGE, top = bx.y + bx.h;
    const x0 = r.x0 + WALL, x1 = r.x1 - WALL, y0 = r.y0 + WALL, y1 = r.y1 - WALL;
    // podłoga i sufit do granicy pomieszczenia (pod ścianami i w progach drzwi bez przerw między pokojami)
    if (bx.floor) G.quad(P(r.x0, r.y0, bx.y + .01), P(r.x1, r.y0, bx.y + .01), P(r.x1, r.y1, bx.y + .01), P(r.x0, r.y1, bx.y + .01), FLOOR[bx.kind] ?? [.62, .5, .38], up); // domyślnie drewniana podłoga
    if (bx.ceil) G.quad(P(r.x0, r.y0, top), P(r.x1, r.y0, top), P(r.x1, r.y1, top), P(r.x0, r.y1, top), mix(fill, .95), down);
    // ściany: [bok, punkt początku, kierunek wzdłuż, normalna do środka, długość, współrzędna początku]
    const sides: [0 | 1 | 2 | 3, number, number, number, number][] = [[0, x0, y0, x1, y0], [1, x1, y0, x1, y1], [2, x0, y1, x1, y1], [3, x0, y0, x0, y1]];
    for (const [s, ax, ay, ex, ey] of sides) {
      const along = s === 0 || s === 2, lo = along ? ax : ay, hi = along ? ex : ey;
      const at = (t: number, h: number) => along ? P(t, ay, h) : P(ax, t, h);
      // granica pomieszczenia (ściana stoi WALL do środka): ościeża otworów zamykają tę grubość, bez szczelin
      const bnd = s === 0 ? r.y0 : s === 2 ? r.y1 : s === 3 ? r.x0 : r.x1;
      const atB = (t: number, h: number) => along ? P(t, bnd, h) : P(bnd, t, h);
      const nrm = s === 0 ? N(0, 1) : s === 2 ? N(0, -1) : s === 1 ? N(-1, 0) : N(1, 0);
      const holes = bx.holes.filter(h => h.side === s && h.b > lo && h.a < hi);
      const cuts = new Set<number>([lo, hi]); for (const h of holes) { cuts.add(Math.max(lo, h.a)); cuts.add(Math.min(hi, h.b)); }
      const cs = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i], b = cs[i + 1]; if (b - a < .01) continue; const m = (a + b) / 2;
        const hs = holes.filter(h => h.a <= m && h.b >= m).sort((u, v) => u.y0 - v.y0);
        let yc = bx.y;
        for (const h of hs) {
          const h0 = Math.max(bx.y, Math.min(top, h.y0)), h1 = Math.max(bx.y, Math.min(top, h.y1));
          if (h0 - yc > .01) G.quad(at(a, yc), at(b, yc), at(b, h0), at(a, h0), fill, nrm);
          yc = Math.max(yc, h1);
        }
        if (top - yc > .01) G.quad(at(a, yc), at(b, yc), at(b, top), at(a, top), fill, nrm);
      }
      G.line(at(lo, bx.y + .01), at(hi, bx.y + .01), edge); G.line(at(lo, top - .01), at(hi, top - .01), EDGE_DIM);
      G.line(at(lo, bx.y), at(lo, top), edge);
      const tang = along ? N(1, 0) : N(0, 1), jamb = mix(fill, .88);
      for (const h of holes) {
        const a = Math.max(lo, h.a), b = Math.min(hi, h.b), h0 = Math.max(bx.y, h.y0), h1 = Math.min(top, h.y1);
        if (b - a > .02 && h1 - h0 > .02) {
          // boki otworu (normalna do środka otworu), nadproże (w dół), parapet okna (w górę)
          G.quad(at(a, h0), atB(a, h0), atB(a, h1), at(a, h1), jamb, tang);
          G.quad(at(b, h0), atB(b, h0), atB(b, h1), at(b, h1), jamb, [-tang[0], 0, -tang[2]]);
          if (h1 < top - .01) G.quad(at(a, h1), at(b, h1), atB(b, h1), atB(a, h1), jamb, [0, -1, 0]);
          if (h.kind === 'win' && h0 > bx.y + .01) G.quad(at(a, h0), at(b, h0), atB(b, h0), atB(a, h0), jamb, [0, 1, 0]);
        }
        const c: RGB = h.kind === 'win' ? [.95, .95, .92] : edge;
        G.line(at(a, h0), at(a, h1), c); G.line(at(b, h0), at(b, h1), c); G.line(at(a, h1), at(b, h1), c); if (h.kind === 'win') G.line(at(a, h0), at(b, h0), c);
      }
    }
  }
  // podesty i biegi schodów
  for (const s of L.slabs) slab(G, P, s);
  // meble i sprzęty: modele (client/src/world/furniture.ts)
  L.items.forEach((it, i) => drawItem(G, it, P, N, p.id % 997 + i * 7.3));
  // sień bramy: od lica fasady (drzwi) do wnętrza – ściany boczne, sufit, podłoga (bez prześwitów do środka budynku)
  if (L.k === 0) for (const e of p.ext) {
    if (e.fd < .05) continue;
    const xa = e.x - e.w / 2, xb = e.x + e.w / 2, y0 = -e.fd, top = Math.max(e.hf, e.yIn) + 2.3;
    const fh = (y: number) => e.g + (e.yIn - e.g) * (y + e.tOut) / (e.tOut + .45), wallC: RGB = [.8, .78, .72];
    G.quad(P(xa, y0, fh(y0)), P(xa, 0, fh(0)), P(xa, 0, top), P(xa, y0, top), wallC, N(1, 0));
    G.quad(P(xb, y0, fh(y0)), P(xb, 0, fh(0)), P(xb, 0, top), P(xb, y0, top), wallC, N(-1, 0));
    G.quad(P(xa, y0, top), P(xb, y0, top), P(xb, 0, top), P(xa, 0, top), mix(wallC, .9), down);
    G.quad(P(xa, y0, fh(y0) + .01), P(xb, y0, fh(y0) + .01), P(xb, 0, fh(0) + .01), P(xa, 0, fh(0) + .01), [.55, .53, .5], up);
    G.line(P(xa, y0, top), P(xa, 0, top), EDGE_DIM); G.line(P(xb, y0, top), P(xb, 0, top), EDGE_DIM);
  }
  // ramki drzwi wejściowych na fasadzie (widoczne z ulicy)
  if (L.k === 0) for (const e of p.ext) {
    const a = P(e.x - e.w / 2, -e.fd - .02, e.hf), b = P(e.x + e.w / 2, -e.fd - .02, e.hf), h = e.hf + 2.3;
    G.line(a, [a[0], h, a[2]], [.35, .25, .15]); G.line(b, [b[0], h, b[2]], [.35, .25, .15]); G.line([a[0], h, a[2]], [b[0], h, b[2]], [.35, .25, .15]);
  }
  const objs = G.build(); for (const o of objs) o.name = `wnętrze ${p.id}/${L.k}`;
  return objs;
}

/**
 * Skrzydła drzwi: zamknięte – w płaszczyźnie otworu, otwarte – obrócone o 90° na zawiasie (początek otworu)
 * do środka (+x / +y układu budynku; drzwi wejściowe do wnętrza budynku). Klamka po stronie przeciwnej zawiasowi.
 */
function buildDoorLeaves(list: Iterable<{ d: DoorDef; plan: Plan; open: boolean }>): THREE.Object3D[] {
  const G = new GeoBuilder();
  for (const { d, plan, open } of list) {
    const f = plan.frame, P = (x: number, y: number, h: number): V3 => { const [wx, wz] = toWorld(f, x, y); return [wx, h, wz]; };
    const w = d.b - d.a - .01, T = .045;
    // układ skrzydła: zawias H, kierunek skrzydła S, grubość wzdłuż N (wszystko w układzie budynku)
    let H: [number, number], S: [number, number], N: [number, number];
    if (d.axis === 'x') { H = [d.at, d.a + .005]; S = [0, 1]; N = [1, 0]; } else { H = [d.a + .005, d.at + (d.ext ? .06 : 0)]; S = [1, 0]; N = [0, 1]; }
    if (open) { const s = S; S = N; N = [-s[0], -s[1]]; }
    const col: RGB = d.ext ? [.36, .25, .16] : [.88, .86, .8], edge: RGB = d.ext ? [.2, .14, .09] : [.5, .48, .44];
    const y0 = d.y0 + .005, y1 = d.y1 - .005;
    const pt = (s: number, n: number, h: number) => P(H[0] + S[0] * s + N[0] * n, H[1] + S[1] * s + N[1] * n, h);
    const nW = (sx: number, sy: number): V3 => { const [ax, az] = toWorld(f, 0, 0), [bx, bz] = toWorld(f, sx, sy); return [bx - ax, 0, bz - az]; };
    for (const sg of [-1, 1]) G.quad(pt(0, sg * T, y0), pt(w, sg * T, y0), pt(w, sg * T, y1), pt(0, sg * T, y1), col, nW(N[0] * sg, N[1] * sg));
    G.quad(pt(w, -T, y0), pt(w, T, y0), pt(w, T, y1), pt(w, -T, y1), mix(col, .8), nW(S[0], S[1]));
    G.quad(pt(0, -T, y1), pt(w, -T, y1), pt(w, T, y1), pt(0, T, y1), mix(col, .9), [0, 1, 0]);
    G.line(pt(0, T + .005, y0), pt(0, T + .005, y1), edge); G.line(pt(w, T + .005, y0), pt(w, T + .005, y1), edge); G.line(pt(0, T + .005, y1), pt(w, T + .005, y1), edge);
    // klamka (obie strony)
    const hy = d.y0 + 1.02, hs = w - .12;
    for (const sg of [-1, 1]) G.quad(pt(hs - .07, sg * (T + .04), hy - .02), pt(hs + .05, sg * (T + .04), hy - .02), pt(hs + .05, sg * (T + .04), hy + .02), pt(hs - .07, sg * (T + .04), hy + .02), [.75, .72, .6], nW(N[0] * sg, N[1] * sg));
  }
  const objs = G.build(); for (const o of objs) o.name = 'drzwi'; return objs;
}

function slab(G: GeoBuilder, P: (x: number, y: number, h: number) => V3, s: Slab): void {
  const r = s.r, hAt = (x: number, y: number) => s.axis === 'x' ? s.ya + (s.yb - s.ya) * (x - r.x0) / (r.x1 - r.x0 || 1) : s.ya + (s.yb - s.ya) * (y - r.y0) / (r.y1 - r.y0 || 1);
  const c: RGB = [.62, .62, .6];
  G.quad(P(r.x0, r.y0, hAt(r.x0, r.y0) + .01), P(r.x1, r.y0, hAt(r.x1, r.y0) + .01), P(r.x1, r.y1, hAt(r.x1, r.y1) + .01), P(r.x0, r.y1, hAt(r.x0, r.y1) + .01), c, [0, 1, 0]);
  G.quad(P(r.x0, r.y0, hAt(r.x0, r.y0) - .15), P(r.x1, r.y0, hAt(r.x1, r.y0) - .15), P(r.x1, r.y1, hAt(r.x1, r.y1) - .15), P(r.x0, r.y1, hAt(r.x0, r.y1) - .15), mix(c, .6), [0, -1, 0]);
  if (!s.steps) return;
  const len = s.axis === 'x' ? r.x1 - r.x0 : r.y1 - r.y0, n = Math.max(2, Math.round(len / .28));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (s.axis === 'y') { const y = r.y0 + (r.y1 - r.y0) * t; G.line(P(r.x0, y, hAt(0, y) + .02), P(r.x1, y, hAt(0, y) + .02), STEP); }
    else { const x = r.x0 + (r.x1 - r.x0) * t; G.line(P(x, r.y0, hAt(x, 0) + .02), P(x, r.y1, hAt(x, 0) + .02), STEP); }
  }
  // poręcze po bokach biegu
  if (s.axis === 'y') for (const x of [r.x0, r.x1]) G.line(P(x, r.y0, s.ya + .95), P(x, r.y1, s.yb + .95), EDGE_DIM);
  else for (const y of [r.y0, r.y1]) G.line(P(r.x0, y, s.ya + .95), P(r.x1, y, s.yb + .95), EDGE_DIM);
}

export type { Box };
