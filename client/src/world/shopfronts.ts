// Witryny sklepów i lokali na parterach: punkt usługowy z OSM w budynku (sklep, kawiarnia, bar, restauracja, apteka…)
// dostaje na najbliższej ścianie od ulicy duży otwór z szybą (otwór w fasadzie jak drzwi: windows.ts, uDoor*),
// za nią oświetlone wnętrze (półki z towarem albo stoliki z krzesłami i bar) i szyld z nazwą nad witryną.
// Tylko wygląd (bez wchodzenia); budowane w pobliżu gracza (signs.ts).
import * as THREE from 'three';
import { signText } from '@miasto/shared/config/branding';
import type { TileData, TilePoi } from '@miasto/shared/tiles/types';
import type { World } from '@miasto/shared/world/world';
import { pip } from '@miasto/shared/world/collision';
import { insideFlat, MODELS } from './tiles/models/index';

type XZ = [number, number]; type RGB = [number, number, number];
const FONT = '"Chakra Petch", sans-serif';
const FOOD = new Set(['cafe', 'bar', 'pub', 'restaurant', 'fast_food', 'ice_cream', 'biergarten', 'food_court']);
const SHOP_AMEN = new Set(['pharmacy', 'bank', 'post_office', 'bureau_de_change']);
/** wysokość dolnej i górnej krawędzi witryny nad podstawą budynku [m] */
export const SHOP_Y0 = .45, SHOP_Y1 = 3.05;

/** Witryna: środek na licu ściany, kierunek wzdłuż ściany, normalna na zewnątrz, szerokość, poziom podstawy. */
export interface Front { p: TilePoi; c: XZ; u: XZ; n: XZ; w: number; base: number; food: boolean; text: string }

export const isFrontPoi = (p: TilePoi) => p.b != null && (p.c === 'shop' || (p.c === 'amenity' && (FOOD.has(p.t) || SHOP_AMEN.has(p.t))));

/** Witryny w kaflu: ściana od ulicy najbliżej punktu, bez ścian wspólnych z sąsiednim budynkiem. */
export function shopFronts(t: TileData, world: World | null): Front[] {
  const out: Front[] = [], used = new Map<string, [number, number][]>();
  // budynki zastąpione własnym modelem (landmarki): bez witryn (stałyby przed modelem)
  const models = (MODELS[t.city] ?? []).filter(m => !m.model.startsWith('most'));
  const inModel = (o: number[]) => models.some(m => { let x = 0, z = 0; for (let i = 0; i < o.length; i += 2) { x += o[i]; z += o[i + 1]; } return insideFlat(m.ring, x / (o.length / 2), z / (o.length / 2)); });
  const roads = t.r.filter(r => !r.tu && !r.br && r.k !== 'steps');
  const nearRoad = (x: number, z: number, R: number) => roads.some(r => { for (let i = 0; i + 3 < r.p.length; i += 2) { const ax = r.p[i], az = r.p[i + 1], dx = r.p[i + 2] - ax, dz = r.p[i + 3] - az, L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); if (Math.hypot(ax + dx * u - x, az + dz * u - z) < R + r.w / 2) return true; } return false; });
  for (const p of t.poi) {
    if (!isFrontPoi(p)) continue;
    const b = t.b.find(q => q.id === p.b && !q.part && q.mh < .5); if (!b || b.wd || inModel(b.o)) continue;
    const ring: XZ[] = []; for (let i = 0; i < b.o.length; i += 2) ring.push([b.o[i], b.o[i + 1]]);
    let best: { s: number; i: number; L: number; u: XZ; n: XZ; t: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], ex = c[0] - a[0], ez = c[1] - a[1], L = Math.hypot(ex, ez); if (L < 4.5) continue;
      const u: XZ = [ex / L, ez / L]; let n: XZ = [-u[1], u[0]]; const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (pip(ring, mx + n[0] * .5, mz + n[1] * .5)) n = [-n[0], -n[1]];
      if (world && world.buildings.hit(mx + n[0] * 1.2, mz + n[1] * 1.2)) continue; // ściana przylega do sąsiada
      const tt = Math.max(0, Math.min(L, (p.x - a[0]) * u[0] + (p.z - a[1]) * u[1])), d = Math.hypot(a[0] + u[0] * tt - p.x, a[1] + u[1] * tt - p.z);
      const s = d + (nearRoad(mx + n[0] * 6, mz + n[1] * 6, 12) ? 0 : 40);
      if (!best || s < best.s) best = { s, i, L, u, n, t: tt };
    }
    if (!best) continue;
    const W = Math.min(5.5, best.L - 1.6); if (W < 2.4) continue;
    // miejsce na ścianie: blisko punktu, bez nakładania na inne witryny tej ściany
    const key = b.id + ':' + best.i, taken = used.get(key) ?? [];
    let tc = Math.max(W / 2 + .8, Math.min(best.L - W / 2 - .8, best.t)), ok = false;
    for (const off of [0, W + .8, -(W + .8), 2 * (W + .8), -2 * (W + .8)]) { const c2 = tc + off; if (c2 < W / 2 + .8 || c2 > best.L - W / 2 - .8) continue; if (taken.every(([a0, a1]) => c2 + W / 2 + .5 < a0 || c2 - W / 2 - .5 > a1)) { tc = c2; ok = true; break; } }
    if (!ok) continue; taken.push([tc - W / 2, tc + W / 2]); used.set(key, taken);
    const a = ring[best.i], c: XZ = [a[0] + best.u[0] * tc, a[1] + best.u[1] * tc];
    out.push({ p, c, u: best.u, n: best.n, w: W, base: world ? world.baseOf(ring) : 0, food: FOOD.has(p.t), text: signText(p) });
  }
  return out;
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Model witryny w układzie lokalnym: x wzdłuż ściany (środek 0), z na zewnątrz (lico ściany z = 0), y od podstawy. */
export function buildFront(f: Front): THREE.Object3D {
  const P: number[] = [], C: number[] = [], G: number[] = [], GC: number[] = [];
  const quad = (pa: number[][], col: RGB, glass = false) => { const A = glass ? G : P, Cc = glass ? GC : C; for (const i of [0, 1, 2, 0, 2, 3]) { A.push(...pa[i]); Cc.push(...col); } };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB) => {
    const k = (m: number): RGB => [col[0] * m, col[1] * m, col[2] * m];
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col);
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k(.85)); quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], k(.85));
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], k(.7)); quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], k(.7));
  };
  const R = (() => { let h = hash(f.p.id + f.text); return () => { h = Math.imul(h ^ h >>> 15, 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; }; })();
  const w = f.w / 2, D = 3.4, y0 = SHOP_Y0, y1 = SHOP_Y1, Y = 3.4;
  // pomieszczenie za szybą: podłoga, sufit, ściany (jasne, oświetlone)
  const wall: RGB = f.food ? [.86, .74, .58] : [.9, .9, .88], floor: RGB = f.food ? [.45, .3, .2] : [.72, .72, .7];
  quad([[-w, .02, -D], [w, .02, -D], [w, .02, 0], [-w, .02, 0]], floor);
  quad([[-w, Y, 0], [w, Y, 0], [w, Y, -D], [-w, Y, -D]], [.95, .95, .92]);
  quad([[-w, 0, -D], [w, 0, -D], [w, Y, -D], [-w, Y, -D]], wall);
  quad([[-w, 0, 0], [-w, 0, -D], [-w, Y, -D], [-w, Y, 0]], [wall[0] * .9, wall[1] * .9, wall[2] * .9]);
  quad([[w, 0, -D], [w, 0, 0], [w, Y, 0], [w, Y, -D]], [wall[0] * .9, wall[1] * .9, wall[2] * .9]);
  // lampy pod sufitem
  for (let x = -w + .9; x < w - .5; x += 1.8) box(x - .35, x + .35, Y - .06, Y - .02, -D * .6, -D * .4, [1, .97, .85]);
  if (!f.food) {
    // sklep: regały przy ścianach z kolorowym towarem, lada z kasą przy oknie
    const prod: RGB[] = [[.85, .2, .2], [.2, .5, .85], [.95, .8, .2], [.3, .7, .35], [.9, .5, .15], [.6, .3, .7], [.95, .95, .95]];
    const rack = (x0: number, x1: number, z0: number, z1: number) => {
      box(x0, x1, 0, 2.1, z0, z1, [.55, .45, .35]);
      for (const sy of [.35, .8, 1.25, 1.7]) {
        box(x0, x1, sy, sy + .04, z0, z1 + .02, [.8, .78, .74]);
        for (let x = x0 + .06; x < x1 - .1; x += .16 + R() * .12) { const h = .12 + R() * .22; box(x, x + .1 + R() * .06, sy + .04, sy + .04 + h, z0 + .05, z1 - .02, prod[Math.floor(R() * prod.length)]); }
      }
    };
    rack(-w + .2, w - .2, -D + .1, -D + .5);
    if (w > 1.8) { rack(-w + .1, -w + .5, -D + .6, -1.2); }
    box(w - 1.6, w - .3, 0, .95, -1.6, -.9, [.35, .3, .28]); box(w - 1.4, w - 1.0, .95, 1.2, -1.4, -1.1, [.15, .15, .17]); // lada i kasa
    if (f.p.t === 'clothes' || f.p.t === 'shoes') for (let x = -w + .9; x < w - 1.8; x += 1.1) { box(x - .05, x + .05, 0, 1.7, -1.1, -1.0, [.2, .2, .22]); box(x - .22, x + .22, .9, 1.55, -1.15, -.95, prod[Math.floor(R() * prod.length)]); } // manekiny
  } else {
    // lokal: bar z butelkami przy ścianie, stoliki z krzesłami
    box(-w + .3, w - .3, 0, 1.05, -D + .25, -D + .85, [.42, .26, .16]); box(-w + .3, w - .3, 1.05, 1.1, -D + .2, -D + .9, [.25, .16, .1]);
    for (let x = -w + .4; x < w - .4; x += .14) box(x, x + .06, 1.55, 1.8 + R() * .08, -D + .08, -D + .16, [[.2, .45, .2], [.5, .25, .1], [.75, .75, .7]][Math.floor(R() * 3)] as RGB);
    box(-w + .3, w - .3, 1.5, 1.54, -D + .02, -D + .22, [.3, .2, .12]);
    const tab: RGB = f.p.t === 'cafe' || f.p.t === 'ice_cream' ? [.92, .92, .9] : [.35, .22, .14], ch: RGB = [.6, .15, .15];
    for (let x = -w + 1.0; x < w - .6; x += 1.6) for (const z of [-1.0, -2.1]) {
      if (z < -D + 1.3) continue;
      box(x - .4, x + .4, .74, .78, z - .4, z + .4, tab); box(x - .04, x + .04, 0, .74, z - .04, z + .04, [.15, .15, .15]);
      for (const sd of [-1, 1]) { const cx = x + sd * .62; box(cx - .2, cx + .2, .44, .48, z - .2, z + .2, ch); box(cx + sd * .17 - .03, cx + sd * .17 + .03, .48, .95, z - .2, z + .2, ch); box(cx - .03, cx + .03, 0, .44, z - .03, z + .03, [.15, .15, .15]); }
    }
  }
  const grp = new THREE.Group();
  const mk = (pos: number[], col: number[], mat: THREE.Material) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); const m = new THREE.Mesh(g, mat); m.userData.own = true; return m; };
  const room = mk(P, C, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); room.userData.box = true; grp.add(room);
  // szyba (lekko niebieska, półprzezroczysta) i rama witryny
  quad([[-w, y0, -.04], [w, y0, -.04], [w, y1, -.04], [-w, y1, -.04]], [.62, .78, .88], true);
  const glass = mk(G, GC, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })); glass.userData.box = true; grp.add(glass);
  const F: number[] = [], FC: number[] = [], frame: RGB = f.food ? [.2, .14, .1] : [.18, .19, .21];
  const fb = (x0: number, x1: number, a0: number, a1: number) => { for (const i of [0, 1, 2, 0, 2, 3]) { const q = [[x0, a0, .03], [x1, a0, .03], [x1, a1, .03], [x0, a1, .03]][i]; F.push(...q); FC.push(...frame); } };
  fb(-w - .12, w + .12, y0 - .12, y0); fb(-w - .12, w + .12, y1, y1 + .1); fb(-w - .12, -w, y0, y1); fb(w, w + .12, y0, y1);
  for (let x = -w + 1.8; x < w - .4; x += 1.8) fb(x - .04, x + .04, y0, y1); // szprosy
  const fr = mk(F, FC, new THREE.MeshBasicMaterial({ vertexColors: true })); fr.userData.box = true; grp.add(fr);
  // szyld nad witryną
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160; const x = cv.getContext('2d')!;
  const bgs = f.food ? ['#3b1f12', '#14321e', '#5a1414', '#1d1d40'] : ['#0c3a5e', '#5e0c2a', '#1e1e1e', '#0f4d34', '#6a3a00'], bg = bgs[hash(f.text) % bgs.length];
  x.fillStyle = bg; x.fillRect(0, 0, 1024, 160); x.strokeStyle = '#e9d9a8'; x.lineWidth = 6; x.strokeRect(6, 6, 1012, 148);
  x.fillStyle = '#fff7e0'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = 92; x.font = `700 ${fs}px ${FONT}`; while (x.measureText(f.text).width > 960 && fs > 34) { fs -= 4; x.font = `700 ${fs}px ${FONT}`; }
  x.fillText(f.text, 512, 84);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sw = Math.min(f.w + .4, 6.2), sh = sw * 160 / 1024 * 1.25, sy = y1 + .25;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex })); sign.position.set(0, sy + sh / 2, .07); sign.userData.own = true; grp.add(sign);
  // ułożenie: lokalne x = wzdłuż ściany (u), z = na zewnątrz (n)
  // układ prawoskrętny: x × y = z (inaczej odbicie lustrzane i wnętrze wychodzi na ulicę) – w razie potrzeby x odwrócony
  const sx = -f.u[1] * f.n[0] + f.u[0] * f.n[1] >= 0 ? 1 : -1; // (u × up) · n
  const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.u[0] * sx, 0, f.u[1] * sx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n[0], 0, f.n[1]));
  grp.quaternion.setFromRotationMatrix(m4);
  return grp;
}
