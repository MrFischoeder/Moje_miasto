// Szczegółowe modele pojazdów (przełącznik „Pojazdy: szczegółowe” w menu Wydajność; proste modele: vehicles.ts).
// Nadwozie osobówek jako „loft”: przekroje poprzeczne (ścięte narożniki, lekko zwężone ku górze boki) rozpięte wzdłuż
// auta według profilu bocznego (opadająca maska, linia okien, bagażnik) i rzutu z góry (zwężony przód i tył).
// Kabina z szybami tym samym sposobem (pochylona przednia i tylna szyba), dach, słupki, nadkola, koła z felgami
// ze szprychami, kształtne światła, atrapa, lusterka, klamki i linie drzwi. Gładkie cieniowanie (normalne z loftu).
import * as THREE from 'three';
import { BLACK, bx, CHROME, DARK, DASH, HEAD, RIM, SEAT, TAIL, TIRE, type C, type Part, type Spec } from './vehicles';

/** profil osobówki: długość, szerokość, promień koła, wysokości (próg, linia okien, dach), kabina od c0 do c1 (z: przód = -),
 *  maska: wysokość przodu (nose), bagażnik: wysokość tyłu (tail), szyby: przesunięcie górnej krawędzi przedniej (ws) i tylnej (rs) szyby */
interface HP { L: number; W: number; r: number; y0: number; y1: number; roof: number; c0: number; c1: number; nose: number; tail: number; ws: number; rs: number; seats: number; flat?: boolean }

const shade = (c: C, k: number): C => { const col = new THREE.Color(c); col.multiplyScalar(k); return col.getHex(); };

/** Loft: lista przekrojów (każdy: tablica [x, y]) w kolejnych z; zamknięte końce. Normalne gładkie. */
function loft(sections: [number, number][][], zs: number[], col: C, capEnds = true): Part {
  const n = sections[0].length, pos: number[] = [], idx: number[] = [];
  sections.forEach((sec, k) => { for (const [x, y] of sec) pos.push(x, y, zs[k]); });
  for (let k = 0; k + 1 < sections.length; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + (i + 1) % n, c = (k + 1) * n + (i + 1) % n, d = (k + 1) * n + i;
    idx.push(a, b, d, b, c, d);
  }
  if (capEnds) for (const k of [0, sections.length - 1]) {
    const c0 = pos.length / 3; let cx = 0, cy = 0; for (const [x, y] of sections[k]) { cx += x / n; cy += y / n; } pos.push(cx, cy, zs[k]);
    for (let i = 0; i < n; i++) { const a = k * n + i, b = k * n + (i + 1) % n; if (k === 0) idx.push(c0, b, a); else idx.push(c0, a, b); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { g: g.toNonIndexed(), col };
}

/** przekrój nadwozia: ścięte narożniki, boki lekko pochylone do środka ku górze */
function bodySection(w: number, yb: number, yt: number): [number, number][] {
  const h = yt - yb, hw = w / 2, ch = Math.min(.12, h * .25), tu = Math.min(.06, hw * .05);
  return [[-hw + ch * .7, yb], [hw - ch * .7, yb], [hw, yb + ch], [hw - tu * .3, yb + h * .55], [hw - tu, yt - ch * .8], [hw - tu - ch, yt],
    [-hw + tu + ch, yt], [-hw + tu, yt - ch * .8], [-hw + tu * .3, yb + h * .55], [-hw, yb + ch]];
}

/** koło: opona (16 segmentów, zaokrąglona), felga ze szprychami, piasta */
function wheelHQ(r: number, wdt: number, x: number, y: number, z: number, side: number): Part[] {
  const out: Part[] = [];
  const tire = new THREE.CylinderGeometry(r, r, wdt * .86, 18).toNonIndexed(); tire.rotateZ(Math.PI / 2); tire.translate(x, y, z); out.push({ g: tire, col: TIRE });
  const wall = new THREE.CylinderGeometry(r * .93, r * .93, wdt, 18).toNonIndexed(); wall.rotateZ(Math.PI / 2); wall.translate(x, y, z); out.push({ g: wall, col: 0x222224 });
  const rim = new THREE.CylinderGeometry(r * .62, r * .62, .02, 18).toNonIndexed(); rim.rotateZ(Math.PI / 2); rim.translate(x + side * (wdt / 2 + .005), y, z); out.push({ g: rim, col: 0x3a3c40 });
  for (let i = 0; i < 5; i++) { // szprychy
    const a = i / 5 * Math.PI * 2, s = new THREE.BoxGeometry(.03, r * .56, .07).toNonIndexed();
    s.translate(0, r * .3, 0); s.rotateX(a); s.translate(x + side * (wdt / 2 + .015), y, z); out.push({ g: s, col: RIM });
  }
  const hub = new THREE.CylinderGeometry(r * .16, r * .16, .04, 10).toNonIndexed(); hub.rotateZ(Math.PI / 2); hub.translate(x + side * (wdt / 2 + .02), y, z); out.push({ g: hub, col: CHROME });
  const ring = new THREE.TorusGeometry(r * .6, .025, 4, 18).toNonIndexed(); ring.rotateY(Math.PI / 2); ring.translate(x + side * (wdt / 2 + .015), y, z); out.push({ g: ring, col: RIM });
  return out;
}

/** nadkole: ciemny łuk na boku nadwozia nad kołem */
function arch(r: number, x: number, y: number, z: number, side: number): Part {
  const g = new THREE.RingGeometry(r * 1.02, r * 1.2, 12, 1, 0, Math.PI).toNonIndexed(); g.rotateY(side * Math.PI / 2); g.translate(x + side * .012, y, z);
  return { g, col: 0x141416 };
}

function carHQ(p: HP, col: C, extra: (o: Part[], g: Part[]) => void = () => {}): Spec {
  const o: Part[] = [], g: Part[] = [], hl = p.L / 2, hw = p.W / 2;
  // --- nadwozie dolne: profil boczny i rzut ---
  const zs: number[] = [], secs: [number, number][][] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = -hl + t * p.L;
    // szerokość: zaokrąglone narożniki w rzucie (przód i tył)
    const e = Math.min(z + hl, hl - z), wk = e < .5 ? .84 + .16 * Math.sqrt(Math.max(0, e / .5)) : 1;
    // górna linia: przód (nose) wznosi się do maski, maska do szyby, tył: bagażnik (tail)
    let yt: number;
    if (z < p.c0) { const u = (z + hl) / (p.c0 + hl); yt = p.nose + (p.y1 - p.nose) * Math.sin(Math.min(1, u * 1.25) * Math.PI / 2); }
    else if (z > p.c1) { const u = (hl - z) / (hl - p.c1); yt = p.tail + (p.y1 - p.tail) * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2); }
    else yt = p.y1;
    const yb = p.y0 + (e < .35 ? (.35 - e) * .35 : 0); // zderzaki lekko podniesione na końcach
    zs.push(z); secs.push(bodySection(p.W * wk, yb, yt));
  }
  o.push(loft(secs, zs, col));
  // --- kabina: szyby (loft) ---
  const gw0 = p.W - .14, gw1 = gw0 * (p.flat ? .94 : .84), zf = p.c0 + p.ws, zr = p.c1 - p.rs;
  const gsec = (w0: number, w1: number, y0: number, y1: number): [number, number][] => [[-w0 / 2, y0], [w0 / 2, y0], [w1 / 2, y1], [-w1 / 2, y1]];
  const gz = [p.c0, zf, (zf + zr) / 2, zr, p.c1], gy = [p.y1 - .01, p.roof, p.roof + .02, p.roof, p.y1 - .01];
  const glassSecs = gz.map((_, i) => i === 0 || i === 4 ? gsec(gw0, gw0 * .96, gy[i], gy[i] + .01) : gsec(gw0, gw1, p.y1 - .01, gy[i]));
  g.push(loft(glassSecs, gz, 0));
  // dach: cienka płyta nad szybami, od górnej krawędzi przedniej do tylnej szyby
  const rw = gw1 + .04;
  o.push(loft([bodySection(rw * .96, p.roof - .02, p.roof + .04), bodySection(rw, p.roof - .02, p.roof + .07), bodySection(rw, p.roof - .02, p.roof + .07), bodySection(rw * .96, p.roof - .02, p.roof + .04)],
    [zf - .05, zf + .25, zr - .25, zr + .05], col));
  // słupki A, B, C i ramki okien
  for (const s of [-1, 1]) {
    const pil = (za: number, ya: number, zb: number, yb: number, wa: number, wb: number) => {
      const q = new THREE.BufferGeometry(), a = .045, xa = s * wa / 2, xb = s * wb / 2;
      const P = [[xa, ya, za - a], [xa, ya, za + a], [xb, yb, zb + a], [xb, yb, zb - a]];
      q.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3)); q.computeVertexNormals(); o.push({ g: q, col: BLACK });
    };
    pil(p.c0 + .03, p.y1, zf, p.roof, gw0 + .01, gw1 + .01);
    pil(p.c1 - .03, p.y1, zr, p.roof, gw0 + .01, gw1 + .01);
    if (p.c1 - p.c0 > 1.9) { const zb = p.c0 + (p.c1 - p.c0) * .48; pil(zb, p.y1, zb + .05, p.roof, gw0 + .015, gw1 + .015); }
    o.push(bx(.02, .05, p.c1 - p.c0, s * (gw0 / 2 + .02), p.y1 + .01, (p.c0 + p.c1) / 2, CHROME)); // listwa pod oknami
  }
  // --- wnętrze ---
  const sy = p.y1 - .42, seats: [number, number, number][] = [], cd = p.c1 - p.c0;
  const fz = p.c0 + Math.min(.95, cd * .42), rz = Math.min(p.c1 - .45, fz + .95);
  for (const x of [-.4, .4]) { o.push(bx(.48, .14, .5, x, sy, fz, SEAT), bx(.46, .6, .12, x, sy + .38, fz + .28, SEAT), bx(.26, .16, .1, x, sy + .76, fz + .3, SEAT)); seats.push([x, sy + .07, fz]); }
  if (p.seats > 2 && rz > fz + .7) { o.push(bx(p.W - .35, .14, .5, 0, sy, rz, SEAT), bx(p.W - .35, .55, .12, 0, sy + .35, rz + .28, SEAT)); seats.push([-.4, sy + .07, rz], [.4, sy + .07, rz]); }
  o.push(bx(p.W - .3, .16, .3, 0, p.y1 - .02, p.c0 + p.ws * .75 + .15, DASH)); // deska pod szybą (za jej pochyleniem)
  const sw = new THREE.TorusGeometry(.17, .025, 4, 12).toNonIndexed(); sw.rotateX(-.35); sw.translate(-.4, p.y1 + .16, p.c0 + p.ws * .75 + .4); o.push({ g: sw, col: DARK });
  // --- koła i nadkola ---
  const wz = [-hl + Math.max(.75, p.L * .17), hl - Math.max(.78, p.L * .18)];
  for (const z of wz) for (const s of [-1, 1]) { o.push(...wheelHQ(p.r, .23, s * (hw - .12), p.r, z, s)); o.push(arch(p.r, s * hw * .985, p.r, z, s)); }
  // --- przód: atrapa, reflektory, zderzak; tył: lampy, tablica ---
  const nz = -hl - .01, tz = hl + .01;
  o.push(bx(p.W * .5, Math.max(.08, (p.nose - p.y0) * .3), .04, 0, p.y0 + (p.nose - p.y0) * .55, nz + .02, 0x1a1a1c)); // atrapa
  for (const s of [-1, 1]) {
    o.push(bx(.36, .1, .06, s * (hw - .32), p.nose - .1, nz + .06, HEAD, 0x7a7460), bx(.12, .05, .07, s * (hw - .15), p.nose - .14, nz + .1, 0xffa020, 0x6a4010)); // reflektor, kierunkowskaz
    o.push(bx(.34, .1, .05, s * (hw - .26), p.tail - .12, tz - .04, TAIL, 0x601010), bx(.1, .1, .055, s * (hw - .06), p.tail - .12, tz - .06, TAIL, 0x601010));
    o.push(bx(.06, .08, .16, s * (hw + .06), p.y1 + .06, p.c0 + .2, col), bx(.015, .07, .13, s * (hw + .09), p.y1 + .06, p.c0 + .2, 0x8aa0b0)); // lusterko
    const dz = [p.c0 + cd * .35, p.c0 + cd * .82]; for (const z of dz) o.push(bx(.02, .03, .14, s * (hw - .02), p.y1 - .15, z, shade(col, .7))); // klamki
    o.push(bx(.015, (p.y1 - p.y0) * .7, .012, s * (hw - .005), (p.y0 + p.y1) / 2 + .03, p.c0 + cd * .48, shade(col, .55))); // linia drzwi
  }
  o.push(bx(.52, .11, .02, 0, p.y0 + .18, tz, 0xe8e8e8), bx(.52, .11, .02, 0, p.y0 + .18, nz, 0xe8e8e8)); // tablice rejestracyjne
  o.push(bx(p.W * .96, .12, .14, 0, p.y0 + .06, nz + .07, 0x202022), bx(p.W * .96, .12, .14, 0, p.y0 + .06, tz - .07, 0x202022)); // dolne zderzaki
  extra(o, g);
  return { o, g, seats };
}

/** zaokrąglony prostopadłościan (loft z przekrojów o ściętych narożnikach) */
function rbox(w: number, h: number, d: number, x: number, y: number, z: number, col: C, taper = 1): Part {
  const secs: [number, number][][] = [], zs: number[] = [];
  for (const [t, k] of [[0, .96], [.04, 1], [.96, 1], [1, .96]] as [number, number][]) { const ww = w * k * (t > .5 ? taper : 1); secs.push(bodySection(ww, y - h / 2 + (1 - k) * h * .5, y + h / 2 - (1 - k) * h * .5)); zs.push(z - d / 2 + d * t); }
  return loft(secs, zs, col);
}

export function buildHQ(v: number, col: C): Spec | null {
  switch (v) {
    case 0: return carHQ({ L: 4.3, W: 1.8, r: .32, y0: .3, y1: .95, roof: 1.48, c0: -.55, c1: 1.95, nose: .72, tail: .92, ws: .7, rs: .25, seats: 4 }, col); // hatchback
    case 1: return carHQ({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, roof: 1.45, c0: -.75, c1: 1.25, nose: .7, tail: .88, ws: .7, rs: .55, seats: 4 }, col); // sedan
    case 2: return carHQ({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, roof: 1.5, c0: -.75, c1: 2.2, nose: .7, tail: .94, ws: .7, rs: .18, seats: 4 }, col,
      o => { for (const s of [-1, 1]) o.push(bx(.05, .05, 2.3, s * .62, 1.58, .75, CHROME)); }); // kombi z relingami
    case 3: return carHQ({ L: 4.6, W: 1.9, r: .4, y0: .4, y1: 1.12, roof: 1.76, c0: -.65, c1: 2.05, nose: .92, tail: 1.08, ws: .6, rs: .2, seats: 4, flat: true }, col,
      o => { o.push(bx(1.96, .16, 3.2, 0, .5, .1, 0x2a2a2c)); for (const s of [-1, 1]) o.push(bx(.05, .06, 2.2, s * .66, 1.84, .7, BLACK)); }); // SUV: osłony progów, relingi
    case 4: return carHQ({ L: 3.6, W: 1.66, r: .3, y0: .28, y1: .92, roof: 1.52, c0: -.45, c1: 1.6, nose: .72, tail: .9, ws: .55, rs: .15, seats: 3 }, col); // miejskie
    case 5: return carHQ({ L: 4.8, W: 1.88, r: .34, y0: .3, y1: 1.0, roof: 1.86, c0: -1.45, c1: 2.25, nose: .8, tail: .98, ws: 1.1, rs: .15, seats: 4, flat: true }, col); // minivan
    case 6: return carHQ({ L: 4.7, W: 1.82, r: .33, y0: .3, y1: .95, roof: 1.45, c0: -.75, c1: 1.25, nose: .7, tail: .88, ws: .7, rs: .55, seats: 4 }, 0xf2f2f0,
      o => { o.push(bx(.7, .2, .32, 0, 1.6, .25, 0xffd23a, 0x6a5a10)); for (const s of [-1, 1]) o.push(bx(.02, .1, 2.6, s * .915, .7, 0, 0x202020)); }); // taksówka
    case 7: return carHQ({ L: 4.6, W: 1.92, r: .34, y0: .22, y1: .78, roof: 1.18, c0: -.25, c1: 1.5, nose: .5, tail: .74, ws: .9, rs: .45, seats: 2 }, col,
      o => { o.push(bx(1.6, .04, .28, 0, .96, 2.12, BLACK), bx(.06, .18, .06, -.6, .87, 2.12, BLACK), bx(.06, .18, .06, .6, .87, 2.12, BLACK)); }); // sportowe ze spojlerem
    case 8: { // dostawczak: zaokrąglona kabina z opadającą maską i zabudowa
      const o: Part[] = [], g: Part[] = [], L = 5.9, hl = L / 2, W = 2.0;
      o.push(rbox(W, .9, 1.0, 0, .85, -hl + .5, col), rbox(W, 2.15, L - .9, 0, 1.45, .45, col));
      const gl = (z0: number, z1: number, y0: number, y1: number) => loft([[[-W / 2 + .06, y0], [W / 2 - .06, y0], [W / 2 - .1, y1], [-W / 2 + .1, y1]], [[-W / 2 + .06, y0], [W / 2 - .06, y0], [W / 2 - .1, y1], [-W / 2 + .1, y1]]], [z0, z1], 0);
      g.push(gl(-hl + .95, -hl + 1.5, 1.3, 2.3));
      for (const x of [-.45, .45]) o.push(bx(.5, .14, .5, x, 1.0, -hl + 1.6, SEAT), bx(.5, .6, .12, x, 1.35, -hl + 1.88, SEAT));
      for (const [x, z] of [[-.88, -hl + .95], [.88, -hl + .95], [-.88, hl - 1.0], [.88, hl - 1.0]]) { o.push(...wheelHQ(.36, .24, x, .36, z, Math.sign(x))); o.push(arch(.36, Math.sign(x) * .99, .36, z, Math.sign(x))); }
      for (const s of [-1, 1]) o.push(bx(.34, .14, .05, s * .66, 1.0, -hl - .01, HEAD, 0x7a7460), bx(.16, .5, .05, s * .86, 1.0, hl + .01, TAIL, 0x601010), bx(.06, .2, .2, s * 1.06, 1.85, -hl + 1.0, BLACK));
      o.push(bx(1.0, .2, .04, 0, .75, -hl - .01, 0x1a1a1c), bx(W * .98, .14, .14, 0, .38, -hl + .05, 0x202022), bx(.02, 1.9, .02, 0, 1.45, hl + .01, 0x333336));
      return { o, g, seats: [[-.45, 1.07, -hl + 1.6], [.45, 1.07, -hl + 1.6]] };
    }
    case 9: { // ciężarówka: kabina z zaokrąglonymi krawędziami, osłona, kontener z ramą
      const o: Part[] = [], g: Part[] = [], L = 8.5, hl = L / 2, W = 2.45;
      o.push(rbox(W, 1.3, 2.0, 0, 1.0, -hl + 1.0, col), rbox(W, .3, 2.0, 0, 3.0, -hl + 1.05, col, .96), bx(1.2, .25, L - 1, 0, .75, .5, BLACK));
      g.push(loft([[[-W / 2 + .05, 1.66], [W / 2 - .05, 1.66], [W / 2 - .07, 2.86], [-W / 2 + .07, 2.86]], [[-W / 2 + .05, 1.66], [W / 2 - .05, 1.66], [W / 2 - .07, 2.86], [-W / 2 + .07, 2.86]]], [-hl + .05, -hl + 1.95], 0));
      o.push(rbox(W + .1, 2.9, L - 2.3, 0, 2.38, hl - (L - 2.3) / 2, 0xeeeeea), bx(W + .14, .1, L - 2.3, 0, 3.85, hl - (L - 2.3) / 2, 0xd0d0cc));
      for (let z = -hl + 2.6; z < hl - .2; z += 1.2) o.push(bx(W + .13, 2.8, .05, 0, 2.38, z, 0xd8d8d4)); // żebra kontenera
      for (const x of [-.5, .5]) o.push(bx(.55, .15, .55, x, 1.7, -hl + 1.1, SEAT), bx(.55, .65, .12, x, 2.05, -hl + 1.45, SEAT));
      for (const [x, z] of [[-1.08, -hl + 1.2], [1.08, -hl + 1.2], [-1.08, hl - 1.8], [1.08, hl - 1.8], [-1.08, hl - .8], [1.08, hl - .8]]) o.push(...wheelHQ(.5, .32, x, .5, z, Math.sign(x)));
      for (const s of [-1, 1]) o.push(bx(.36, .2, .05, s * .85, .9, -hl - .01, HEAD, 0x7a7460), bx(.3, .2, .05, s * .85, .9, hl + .01, TAIL, 0x601010), bx(.08, .5, .25, s * 1.32, 2.2, -hl + .2, BLACK));
      o.push(bx(1.4, .5, .04, 0, 1.15, -hl - .01, 0x1a1a1c), bx(W, .22, .2, 0, .55, -hl + .05, 0x2a2a2c));
      return { o, g, seats: [[-.5, 1.78, -hl + 1.1]] };
    }
    case 10: { // ciągnik siodłowy z naczepą
      const o: Part[] = [], g: Part[] = [], L = 16, hl = L / 2, W = 2.5, cz = -hl + 1.3;
      o.push(rbox(W, 1.45, 2.6, 0, 1.15, cz, col), rbox(W, .55, 2.6, 0, 3.58, cz, col, .97), rbox(W - .2, .7, 1.5, 0, 4.15, cz + .4, col, .9), bx(1.2, .3, 4.5, 0, .85, cz + 2.3, BLACK));
      g.push(loft([[[-W / 2 + .05, 1.88], [W / 2 - .05, 1.88], [W / 2 - .07, 3.3], [-W / 2 + .07, 3.3]], [[-W / 2 + .05, 1.88], [W / 2 - .05, 1.88], [W / 2 - .07, 3.3], [-W / 2 + .07, 3.3]]], [cz - 1.25, cz + 1.25], 0));
      for (const x of [-.5, .5]) o.push(bx(.55, .15, .55, x, 2.0, cz - .1, SEAT), bx(.55, .65, .12, x, 2.35, cz + .25, SEAT));
      o.push(rbox(W + .06, 2.9, 13, 0, 2.78, hl - 6.5, 0xd8dade), bx(1, .3, 12.5, 0, 1.15, hl - 6.5, BLACK));
      for (const [x, z] of [[-1.08, cz - .2], [1.08, cz - .2], [-1.08, cz + 2.8], [1.08, cz + 2.8], [-1.08, hl - 3.2], [1.08, hl - 3.2], [-1.08, hl - 2.1], [1.08, hl - 2.1], [-1.08, hl - 1.0], [1.08, hl - 1.0]]) o.push(...wheelHQ(.52, .32, x, .52, z, Math.sign(x)));
      for (const s of [-1, 1]) o.push(bx(.36, .2, .05, s * .9, 1.0, -hl - .01, HEAD, 0x7a7460), bx(.3, .2, .05, s * .9, 1.2, hl + .01, TAIL, 0x601010), bx(.08, .55, .28, s * 1.34, 2.5, cz - 1.1, BLACK));
      o.push(bx(1.5, .7, .04, 0, 1.25, -hl - .01, 0x1a1a1c));
      return { o, g, seats: [[-.5, 2.08, cz - .1]] };
    }
    default: return null; // jednoślady: modele proste
  }
}
