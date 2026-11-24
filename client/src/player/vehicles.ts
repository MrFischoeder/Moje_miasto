// Pojazdy naziemne (warianty VEH z shared/sim/vehicles.ts): 8 osobowych, dostawczak, ciężarówka, ciągnik z naczepą,
// motocykl, skuter, hulajnoga elektryczna. Low-poly, kolory wierzchołków; przezroczyste szyby (widać, kto siedzi
// w środku), wnętrze (fotele, deska, kierownica), siedzące postacie kierowcy i pasażerów.
// Bryła nieprzezroczysta i szyby: jedna geometria na wariant i kolor (wspólna dla wielu aut).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type C = number;
interface Part { g: THREE.BufferGeometry; col: C; emi?: C }
const VC = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** szyby: lekko przyciemnione, półprzezroczyste (bez zapisu głębi: widać wnętrze i ludzi) */
export const GLASS = new THREE.MeshLambertMaterial({ color: 0x9ec4d8, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide, flatShading: true });

const DARK = 0x1c1c1e, TIRE = 0x161616, RIM = 0x9a9ea4, SEAT = 0x2a2c30, DASH = 0x202124, HEAD = 0xfff6d8, TAIL = 0xc81818, CHROME = 0xb8bcc0, BLACK = 0x18181a;

function bx(w: number, h: number, d: number, x: number, y: number, z: number, col: C, emi?: C): Part {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); return { g, col, emi };
}
/** prostopadłościan zwężony ku górze (kabina): dół w × d, góra skalowana (sx, sz) i przesunięta o dz */
function cab(w: number, h: number, d: number, x: number, y: number, z: number, sx: number, sz: number, dz: number, col: C): Part {
  const g = new THREE.BoxGeometry(w, h, d), p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz + dz); }
  const n = g.toNonIndexed(); n.translate(x, y, z); return { g: n, col };
}
function wheel(r: number, wdt: number, x: number, y: number, z: number): Part[] {
  const t = new THREE.CylinderGeometry(r, r, wdt, 10).toNonIndexed(); t.rotateZ(Math.PI / 2); t.translate(x, y, z);
  const h = new THREE.CylinderGeometry(r * .55, r * .55, wdt + .02, 8).toNonIndexed(); h.rotateZ(Math.PI / 2); h.translate(x, y, z);
  return [{ g: t, col: TIRE }, { g: h, col: RIM }];
}
function merge(parts: Part[]): THREE.BufferGeometry {
  const c = new THREE.Color(), e = new THREE.Color();
  return mergeGeometries(parts.map(({ g, col, emi }) => {
    const n = g.getAttribute('position').count, a = new Float32Array(n * 3); c.setHex(col); e.setHex(emi ?? 0);
    for (let i = 0; i < n; i++) { a[i * 3] = Math.min(1, c.r + e.r); a[i * 3 + 1] = Math.min(1, c.g + e.g); a[i * 3 + 2] = Math.min(1, c.b + e.b); }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    g.computeVertexNormals(); return g;
  }))!;
}

// ---------- postacie w pojazdach ----------
const SKIN = [0xf1c8a8, 0xe0b090, 0xc89070, 0x9a6a4a];
/** siedząca postać (tułów, uda, głowa) z przodem w stronę -z; y = poziom siedziska */
function seated(shirt: C, skin: C, x: number, y: number, z: number): Part[] {
  return [bx(.42, .46, .24, x, y + .27, z + .05, shirt), bx(.34, .14, .46, x, y + .05, z - .18, 0x2a3448), bx(.22, .22, .22, x, y + .62, z + .02, skin), bx(.24, .06, .24, x, y + .76, z + .03, 0x3a2a1a)];
}
/** stojąca postać (hulajnoga) */
function standing(shirt: C, skin: C, x: number, y: number, z: number): Part[] {
  return [bx(.16, .82, .2, x - .11, y + .41, z, 0x2a3448), bx(.16, .82, .2, x + .11, y + .41, z, 0x2a3448), bx(.46, .6, .26, x, y + 1.12, z, shirt), bx(.24, .26, .26, x, y + 1.56, z, skin)];
}

// ---------- kształty ----------
interface CarP { L: number; W: number; r: number; y0: number; y1: number; c0: number; c1: number; roof: number; sx: number; sz: number; dz: number; seats: number }
/** samochód osobowy z parametrów: nadwozie, kabina z szybami, dach, słupki, wnętrze, koła, światła */
function carBody(p: CarP, col: C, extra: (o: Part[], g: Part[]) => void = () => {}): { o: Part[]; g: Part[]; seats: [number, number, number][] } {
  const o: Part[] = [], g: Part[] = [], hl = p.L / 2, hw = p.W / 2, ch = p.roof - p.y1, cz = (p.c0 + p.c1) / 2, cd = p.c1 - p.c0;
  o.push(bx(p.W, p.y1 - p.y0, p.L, 0, (p.y0 + p.y1) / 2, 0, col));                        // nadwozie
  o.push(bx(p.W + .04, .14, .25, 0, p.y0 + .12, -hl + .08, DARK), bx(p.W + .04, .14, .25, 0, p.y0 + .12, hl - .08, DARK)); // zderzaki
  g.push(cab(p.W - .1, ch, cd, 0, p.y1 + ch / 2, cz, p.sx, p.sz, p.dz, 0));                  // szyby (kabina)
  o.push(cab(p.W * p.sx - .04, .07, cd * p.sz - .1, 0, p.roof + .035, cz + p.dz, 1, 1, 0, col)); // dach
  // słupki: przednie (A) i tylne (C)
  for (const s of [-1, 1]) for (const [zb, zt] of [[p.c0 + .04, p.c0 + (cd * (1 - p.sz)) / 2 + p.dz + .04], [p.c1 - .04, p.c1 - (cd * (1 - p.sz)) / 2 + p.dz - .04]]) {
    const xb = s * (hw - .07), xt = s * ((p.W - .1) * p.sx / 2 - .02), q = new THREE.BufferGeometry(), a = .05;
    const P = [[xb - a, p.y1, zb - a], [xb + a, p.y1, zb + a], [xt + a, p.roof, zt + a], [xt - a, p.roof, zt - a]];
    q.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3], ...P[1], ...P[0], ...P[3], ...P[1], ...P[3], ...P[2]], 3)); o.push({ g: q, col: BLACK });
  }
  // wnętrze: fotele, deska rozdzielcza, kierownica (lewostronna)
  const sy = p.y1 - .42, seats: [number, number, number][] = [];
  const fz = p.c0 + Math.min(.95, cd * .42), rz = Math.min(p.c1 - .45, fz + .95);
  for (const x of [-.4, .4]) { o.push(bx(.48, .14, .5, x, sy, fz, SEAT), bx(.48, .62, .12, x, sy + .38, fz + .28, SEAT)); seats.push([x, sy + .07, fz]); }
  if (p.seats > 2 && rz > fz + .7) { o.push(bx(p.W - .35, .14, .5, 0, sy, rz, SEAT), bx(p.W - .35, .55, .12, 0, sy + .35, rz + .28, SEAT)); seats.push([-.4, sy + .07, rz], [.4, sy + .07, rz]); }
  o.push(bx(p.W - .25, .22, .35, 0, p.y1 + .02, p.c0 + .2, DASH), bx(.36, .36, .05, -.4, p.y1 + .2, p.c0 + .5, DARK));
  for (const [x, z] of [[-hw + .05, -hl + .78], [hw - .05, -hl + .78], [-hw + .05, hl - .8], [hw - .05, hl - .8]]) o.push(...wheel(p.r, .24, x, p.r, z));
  for (const x of [-hw + .3, hw - .3]) o.push(bx(.34, .13, .05, x, p.y1 - .18, -hl - .005, HEAD, 0x6a6450), bx(.34, .13, .05, x, p.y1 - .15, hl + .005, TAIL, 0x501010));
  extra(o, g);
  return { o, g, seats };
}

interface Spec { o: Part[]; g: Part[]; seats: [number, number, number][]; stand?: boolean }
function build(v: number, col: C): Spec {
  switch (v) {
    case 1: return carBody({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, c0: -.75, c1: 1.15, roof: 1.45, sx: .84, sz: .7, dz: .05, seats: 4 }, col);
    case 2: return carBody({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, c0: -.75, c1: 2.2, roof: 1.5, sx: .86, sz: .84, dz: .12, seats: 4 }, col,
      o => { for (const x of [-.62, .62]) o.push(bx(.05, .06, 2.4, x, 1.56, .75, CHROME)); });
    case 3: return carBody({ L: 4.6, W: 1.9, r: .4, y0: .4, y1: 1.12, c0: -.65, c1: 2.05, roof: 1.76, sx: .88, sz: .84, dz: .1, seats: 4 }, col,
      o => { o.push(bx(1.94, .3, 4.62, 0, .52, 0, 0x2a2a2c)); for (const x of [-.65, .65]) o.push(bx(.05, .06, 2.3, x, 1.82, .7, BLACK)); });
    case 4: return carBody({ L: 3.6, W: 1.66, r: .3, y0: .28, y1: .92, c0: -.45, c1: 1.6, roof: 1.52, sx: .86, sz: .84, dz: .1, seats: 3 }, col);
    case 5: return carBody({ L: 4.8, W: 1.88, r: .34, y0: .3, y1: 1.0, c0: -1.45, c1: 2.25, roof: 1.86, sx: .9, sz: .9, dz: .1, seats: 4 }, col);
    case 6: return carBody({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, c0: -.75, c1: 1.15, roof: 1.45, sx: .84, sz: .7, dz: .05, seats: 4 }, 0xf2f2f0,
      o => { o.push(bx(.7, .2, .32, 0, 1.6, .15, 0xffd23a, 0x6a5a10)); for (const x of [-.92, .92]) o.push(bx(.02, .12, 2.6, x, .7, 0, 0x202020)); });
    case 7: return carBody({ L: 4.6, W: 1.92, r: .34, y0: .22, y1: .78, c0: -.25, c1: 1.5, roof: 1.2, sx: .78, sz: .6, dz: .25, seats: 2 }, col,
      o => { o.push(bx(1.6, .05, .3, 0, .98, 2.15, BLACK), bx(.08, .2, .08, -.6, .88, 2.15, BLACK), bx(.08, .2, .08, .6, .88, 2.15, BLACK)); });
    case 8: { // dostawczak (furgon): kabina z szybami z przodu, zabudowa towarowa
      const o: Part[] = [], g: Part[] = [], L = 5.9, hl = L / 2, W = 2.0;
      o.push(bx(W, .85, .8, 0, .8, -hl + .4, col), bx(W, 2.15, L - .8, 0, 1.43, .4, col), bx(W + .04, .16, .25, 0, .42, -hl + .05, DARK));
      g.push(cab(W - .08, 1.0, 1.1, 0, 1.75, -hl + 1.35, .96, .85, .1, 0)); o.push(bx(W - .1, .1, 1.0, 0, 2.3, -hl + 1.4, col));
      for (const x of [-.45, .45]) o.push(bx(.5, .14, .5, x, 1.0, -hl + 1.5, SEAT), bx(.5, .6, .12, x, 1.35, -hl + 1.78, SEAT));
      o.push(bx(.36, .36, .05, -.45, 1.45, -hl + 1.05, DARK));
      for (const [x, z] of [[-.97, -hl + .9], [.97, -hl + .9], [-.97, hl - 1.0], [.97, hl - 1.0]]) o.push(...wheel(.36, .26, x, .36, z));
      for (const x of [-.7, .7]) o.push(bx(.3, .16, .05, x, .95, -hl - .005, HEAD, 0x6a6450), bx(.2, .4, .05, x * 1.3, 1.0, hl + .3, TAIL, 0x501010));
      return { o, g, seats: [[-.45, 1.07, -hl + 1.5], [.45, 1.07, -hl + 1.5]] };
    }
    case 9: { // ciężarówka skrzyniowa (kontener)
      const o: Part[] = [], g: Part[] = [], L = 8.5, hl = L / 2, W = 2.45;
      o.push(bx(W, 1.25, 2.0, 0, 1.0, -hl + 1.0, col), bx(W, .2, 2.0, 0, 2.95, -hl + 1.0, col), bx(1.2, .25, L - 1, 0, .75, .5, BLACK));
      g.push(cab(W - .06, 1.3, 1.95, 0, 2.27, -hl + 1.0, .98, .97, 0, 0));
      o.push(bx(W + .1, 2.9, L - 2.3, 0, 2.35, hl - (L - 2.3) / 2, 0xeeeeea), bx(W + .14, .12, L - 2.3, 0, 3.86, hl - (L - 2.3) / 2, 0xd0d0cc));
      for (const x of [-.5, .5]) o.push(bx(.55, .15, .55, x, 1.7, -hl + 1.1, SEAT), bx(.55, .65, .12, x, 2.05, -hl + 1.45, SEAT));
      for (const [x, z] of [[-1.1, -hl + 1.2], [1.1, -hl + 1.2], [-1.1, hl - 1.8], [1.1, hl - 1.8], [-1.1, hl - .8], [1.1, hl - .8]]) o.push(...wheel(.5, .34, x, .5, z));
      for (const x of [-.85, .85]) o.push(bx(.35, .2, .05, x, .9, -hl - .005, HEAD, 0x6a6450), bx(.3, .2, .05, x, .9, hl + .005, TAIL, 0x501010));
      return { o, g, seats: [[-.5, 1.78, -hl + 1.1]] };
    }
    case 10: { // ciągnik siodłowy z naczepą
      const o: Part[] = [], g: Part[] = [], L = 16, hl = L / 2, W = 2.5, cz = -hl + 1.3;
      o.push(bx(W, 1.4, 2.6, 0, 1.15, cz, col), bx(W, .5, 2.6, 0, 3.55, cz, col), bx(W - .2, .7, 1.4, 0, 4.1, cz + .4, col), bx(1.2, .3, 4.5, 0, .85, cz + 2.3, BLACK));
      g.push(cab(W - .06, 1.45, 2.55, 0, 2.58, cz, .98, .97, 0, 0));
      for (const x of [-.5, .5]) o.push(bx(.55, .15, .55, x, 2.0, cz - .1, SEAT), bx(.55, .65, .12, x, 2.35, cz + .25, SEAT));
      o.push(bx(W + .06, 2.9, 13, 0, 2.75, hl - 6.5, 0xd8dade), bx(1, .3, 12.5, 0, 1.15, hl - 6.5, BLACK));
      for (const [x, z] of [[-1.1, cz - .2], [1.1, cz - .2], [-1.1, cz + 2.8], [1.1, cz + 2.8], [-1.1, hl - 3.2], [1.1, hl - 3.2], [-1.1, hl - 2.1], [1.1, hl - 2.1], [-1.1, hl - 1.0], [1.1, hl - 1.0]]) o.push(...wheel(.52, .34, x, .52, z));
      for (const x of [-.9, .9]) o.push(bx(.35, .2, .05, x, 1.0, -hl - .005, HEAD, 0x6a6450), bx(.3, .2, .05, x, 1.2, hl + .005, TAIL, 0x501010));
      return { o, g, seats: [[-.5, 2.08, cz - .1]] };
    }
    case 11: { // motocykl
      const o: Part[] = [], g: Part[] = [];
      for (const z of [-.72, .72]) { const t = new THREE.CylinderGeometry(.33, .33, .14, 12).toNonIndexed(); t.rotateZ(Math.PI / 2); t.translate(0, .33, z); o.push({ g: t, col: TIRE }); }
      o.push(bx(.3, .3, .9, 0, .62, -.05, col), bx(.34, .22, .5, 0, .86, -.15, col), bx(.28, .1, .6, 0, .82, .35, BLACK), bx(.7, .05, .05, 0, 1.08, -.58, CHROME), bx(.08, .5, .08, 0, .8, -.62, CHROME));
      o.push(bx(.2, .14, .08, 0, .9, -.75, HEAD, 0x6a6450), bx(.16, .08, .06, 0, .78, .84, TAIL, 0x501010), bx(.12, .12, .5, .12, .4, .45, CHROME));
      return { o, g, seats: [[0, .86, .25]] };
    }
    case 12: { // skuter
      const o: Part[] = [], g: Part[] = [];
      for (const z of [-.62, .62]) { const t = new THREE.CylinderGeometry(.24, .24, .13, 12).toNonIndexed(); t.rotateZ(Math.PI / 2); t.translate(0, .24, z); o.push({ g: t, col: TIRE }); }
      o.push(bx(.42, .75, .14, 0, .62, -.55, col), bx(.36, .08, .6, 0, .32, -.1, col), bx(.42, .4, .7, 0, .52, .45, col), bx(.32, .1, .55, 0, .78, .35, BLACK), bx(.6, .05, .05, 0, 1.05, -.6, CHROME));
      o.push(bx(.16, .12, .06, 0, .9, -.63, HEAD, 0x6a6450), bx(.14, .07, .05, 0, .65, .81, TAIL, 0x501010));
      return { o, g, seats: [[0, .79, .2]] };
    }
    case 13: { // hulajnoga elektryczna (z kierowcą na stojąco)
      const o: Part[] = [], g: Part[] = [];
      for (const z of [-.42, .42]) { const t = new THREE.CylinderGeometry(.1, .1, .06, 10).toNonIndexed(); t.rotateZ(Math.PI / 2); t.translate(0, .1, z); o.push({ g: t, col: TIRE }); }
      o.push(bx(.16, .05, .8, 0, .15, 0, 0x2a2a2c), bx(.05, 1.0, .05, 0, .65, -.45, 0x3a3a3c), bx(.5, .04, .04, 0, 1.15, -.45, BLACK), bx(.1, .06, .05, 0, .95, -.48, HEAD, 0x6a6450));
      return { o, g, seats: [[0, .18, .05]], stand: true };
    }
    default: return carBody({ L: 4.3, W: 1.8, r: .33, y0: .3, y1: .95, c0: -.55, c1: 1.95, roof: 1.48, sx: .84, sz: .82, dz: .1, seats: 4 }, col);
  }
}

export interface Vehicle3D { root: THREE.Group; occupants: THREE.Object3D[]; lights?: THREE.Object3D[] }
const CACHE = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry | null; seats: [number, number, number][]; stand: boolean }>();
const FIG = new Map<string, THREE.BufferGeometry>();

/**
 * Pojazd wariantu v w kolorze col. npc: kierowca NPC wtopiony w bryłę (bez dodatkowych rysowań);
 * inaczej postacie (kierowca + pasażerowie) jako osobne siatki, widoczne zależnie od zajętości (setOccupants).
 */
export function makeVehicle(v: number, col: C, npc: boolean, seed = 0): Vehicle3D {
  const shirt = [0x3a6ea5, 0xb04a3a, 0x3a8a5a, 0x8a5a9a, 0xd0a040, 0x404448][seed % 6], skin = SKIN[seed % SKIN.length];
  const key = `${v}:${col}:${npc ? shirt + ':' + skin : '-'}`;
  let c = CACHE.get(key);
  if (!c) {
    const s = build(v, col);
    if (npc && s.seats.length) { const [x, y, z] = s.seats[0]; s.o.push(...(s.stand ? standing(shirt, skin, x, y, z) : seated(shirt, skin, x, y, z))); }
    c = { body: merge(s.o), glass: s.g.length ? merge(s.g) : null, seats: s.seats, stand: !!s.stand }; CACHE.set(key, c);
  }
  const root = new THREE.Group(); root.add(new THREE.Mesh(c.body, VC));
  if (c.glass) { const gm = new THREE.Mesh(c.glass, GLASS); gm.renderOrder = 2; root.add(gm); }
  const occupants: THREE.Object3D[] = [];
  if (!npc) c.seats.forEach(([x, y, z], i) => {
    const sh = [0xe8b830, 0x3a6ea5, 0xb04a3a, 0x3a8a5a][i % 4], fk = `${c!.stand}:${sh}`;
    let g = FIG.get(fk); if (!g) { g = merge(c!.stand ? standing(sh, SKIN[0], 0, 0, 0) : seated(sh, SKIN[0], 0, 0, 0)); FIG.set(fk, g); }
    const m = new THREE.Mesh(g, VC); m.position.set(x, y, z); m.visible = false; root.add(m); occupants.push(m);
  });
  return { root, occupants };
}

/** Zajętość: kierowca (pierwsze miejsce) i liczba pasażerów. */
export function setOccupants(m: Vehicle3D, driver: boolean, passengers: number): void {
  m.occupants.forEach((o, i) => { o.visible = i === 0 ? driver : i <= passengers; });
}

/** Radiowóz: biały sedan z niebieskim pasem i migającą belką (kierowca-policjant) */
export function makePoliceVehicle(seed = 0): Vehicle3D {
  const m = makeVehicle(1, 0xf0f0f0, true, seed), add = (p: Part) => { const g = merge([p]); const mesh = new THREE.Mesh(g, VC); m.root.add(mesh); return mesh; };
  add(bx(.02, .16, 3.6, -.92, .66, 0, 0x2050c8)); add(bx(.02, .16, 3.6, .92, .66, 0, 0x2050c8)); add(bx(1.2, .12, .3, 0, 1.55, .1, 0x202024));
  const red = add(bx(.5, .14, .32, -.33, 1.62, .1, 0xff2a2a, 0xa01010)), blue = add(bx(.5, .14, .32, .33, 1.62, .1, 0x2a5aff, 0x1030a0));
  m.lights = [red, blue]; return m;
}
