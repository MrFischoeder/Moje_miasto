// Wnętrza budynków: jeden scalony mesh i jedne linie na piętro budynku. Ściany z otworami drzwi i okien
// (przez okno widać miasto, bo ściana zewnętrzna od środka nie jest rysowana), schody, meble.
import * as THREE from 'three';
import type { World } from '@miasto/shared/world/world';
import type { Box, Level, Plan, Slab } from '@miasto/shared/interiors/plan';
import { toWorld } from '@miasto/shared/interiors/geom';
import { hex, mix, type RGB } from '@miasto/shared/util/rng';
import { GeoBuilder, type V3 } from './geometry';
import type { WindowUniforms } from './tiles/windows';
import { MAX_DOORS } from './tiles/windows';

const WALL = .06;
/** Kolory ścian (wypełnienie) wg rodzaju pomieszczenia; krawędzie fosforowe. */
const FILL: Record<string, RGB> = {
  core: [.05, .07, .08], corridor: [.05, .07, .08], lobby: [.06, .08, .09], hall: [.06, .07, .06], kitchen: [.07, .08, .05],
  bath: [.05, .08, .1], wc: [.05, .08, .1], living: [.07, .06, .05], bedroom: [.07, .05, .07], room: [.06, .06, .07], study: [.07, .06, .04],
  maid: [.06, .06, .05], storage: [.05, .05, .05], office: [.05, .06, .07], staff: [.05, .06, .05], sala: [.08, .09, .09], open: [.07, .07, .05], stair: [.05, .07, .08],
};
const FLOOR: Record<string, RGB> = { bath: [.08, .1, .12], wc: [.08, .1, .12], kitchen: [.09, .09, .07], sala: [.1, .11, .11] };
const EDGE: RGB = [.49, 1, .69], EDGE_DIM: RGB = [.25, .55, .4], STEP: RGB = [.6, .85, .75];
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
    if (doors) {
      const ds = I.doors().map(d => ({ d, dist: Math.hypot(d.c[0] - x, d.c[1] - z) })).sort((a, b) => a.dist - b.dist).slice(0, MAX_DOORS);
      ds.forEach(({ d }, i) => { doors.uDoorA.value[i].set(d.c[0], d.c[1], d.u[0], d.u[1]); doors.uDoorB.value[i].set(d.y0, d.y1, d.w / 2, .9); });
      doors.uDoorN.value = ds.length;
    }
  }

  dispose(): void { for (const objs of this.levels.values()) for (const o of objs) { this.group.remove(o); dispose(o); } this.levels.clear(); }
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
    const r = bx.r, fill = mix(FILL[bx.kind] ?? FILL.room, 1.6), edge = bx.accent ? hex(bx.accent) : EDGE, top = bx.y + bx.h;
    const x0 = r.x0 + WALL, x1 = r.x1 - WALL, y0 = r.y0 + WALL, y1 = r.y1 - WALL;
    if (bx.floor) G.quad(P(x0, y0, bx.y + .01), P(x1, y0, bx.y + .01), P(x1, y1, bx.y + .01), P(x0, y1, bx.y + .01), FLOOR[bx.kind] ?? mix(fill, .8), up);
    if (bx.ceil) G.quad(P(x0, y0, top), P(x1, y0, top), P(x1, y1, top), P(x0, y1, top), mix(fill, .7), down);
    // ściany: [bok, punkt początku, kierunek wzdłuż, normalna do środka, długość, współrzędna początku]
    const sides: [0 | 1 | 2 | 3, number, number, number, number][] = [[0, x0, y0, x1, y0], [1, x1, y0, x1, y1], [2, x0, y1, x1, y1], [3, x0, y0, x0, y1]];
    for (const [s, ax, ay, ex, ey] of sides) {
      const along = s === 0 || s === 2, lo = along ? ax : ay, hi = along ? ex : ey;
      const at = (t: number, h: number) => along ? P(t, ay, h) : P(ax, t, h);
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
      for (const h of holes) {
        const a = Math.max(lo, h.a), b = Math.min(hi, h.b), h0 = Math.max(bx.y, h.y0), h1 = Math.min(top, h.y1);
        const c: RGB = h.kind === 'win' ? [.4, .8, 1] : edge;
        G.line(at(a, h0), at(a, h1), c); G.line(at(b, h0), at(b, h1), c); G.line(at(a, h1), at(b, h1), c); if (h.kind === 'win') G.line(at(a, h0), at(b, h0), c);
      }
    }
  }
  // podesty i biegi schodów
  for (const s of L.slabs) slab(G, P, s);
  // meble
  for (const it of L.items) {
    const c = ITEM[it.k] ?? [.7, .7, .7], r = it.r, y = it.y, h = it.h, fill = mix(c, .28), e = it.c ? c : mix(c, .7);
    const pts = [P(r.x0, r.y0, 0), P(r.x1, r.y0, 0), P(r.x1, r.y1, 0), P(r.x0, r.y1, 0)];
    const at = (i: number, hh: number): V3 => [pts[i][0], hh, pts[i][2]];
    G.quad(at(0, y + h), at(1, y + h), at(2, y + h), at(3, y + h), fill, up);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mx = (pts[i][0] + pts[j][0]) / 2, mz = (pts[i][2] + pts[j][2]) / 2, cx = (pts[0][0] + pts[2][0]) / 2, cz = (pts[0][2] + pts[2][2]) / 2;
      G.quad(at(i, y), at(j, y), at(j, y + h), at(i, y + h), fill, [mx - cx, 0, mz - cz]);
      G.line(at(i, y + h), at(j, y + h), e); G.line(at(i, y), at(i, y + h), e);
    }
  }
  // ramki drzwi wejściowych na fasadzie (widoczne z ulicy)
  if (L.k === 0) for (const e of p.ext) {
    const a = P(e.x - e.w / 2, -.02, e.yIn), b = P(e.x + e.w / 2, -.02, e.yIn), h = e.yIn + 2.15;
    G.line(a, [a[0], h, a[2]], [1, .85, .4]); G.line(b, [b[0], h, b[2]], [1, .85, .4]); G.line([a[0], h, a[2]], [b[0], h, b[2]], [1, .85, .4]);
  }
  const objs = G.build(); for (const o of objs) o.name = `wnętrze ${p.id}/${L.k}`;
  return objs;
}

function slab(G: GeoBuilder, P: (x: number, y: number, h: number) => V3, s: Slab): void {
  const r = s.r, hAt = (x: number, y: number) => s.axis === 'x' ? s.ya + (s.yb - s.ya) * (x - r.x0) / (r.x1 - r.x0 || 1) : s.ya + (s.yb - s.ya) * (y - r.y0) / (r.y1 - r.y0 || 1);
  const c: RGB = [.06, .08, .08];
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
