// Własne wersje pomników i rzeźb (punkty OSM: historic=monument/memorial, tourism=artwork): postaci na cokołach
// (pozy wg nazwy), popiersia, obeliski, stele, krzyże, głazy, fontanny, rzeźby współczesne, wrocławskie krasnale
// i „Przejście” (Pomnik Anonimowego Przechodnia: przechodnie zapadający się w chodnik i wynurzający się z niego).
import type { RGB } from '@miasto/shared/util/rng';
import type { ModelSink } from './sink';

type XZ = [number, number];
const BRONZE: RGB = [.34, .36, .3], BRONZE_D: RGB = [.28, .26, .2], GRANITE: RGB = [.5, .5, .5], GRANITE_D: RGB = [.38, .38, .4];
const STONE_W: RGB = [.88, .86, .82], SAND: RGB = [.78, .72, .6], WATER: RGB = [.35, .55, .7], GOLD: RGB = [.8, .65, .3];
const ART: RGB[] = [[.75, .2, .15], [.85, .85, .82], [.55, .58, .62], [.2, .3, .5], [.85, .65, .2]];

/** obrócony prostopadłościan: środek (x, z) w układzie pomnika (obrót yaw wokół c) */
function OB(S: ModelSink, c: XZ, yaw: number, lx: number, lz: number, w: number, d: number, y0: number, y1: number, col: RGB): void {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), P = (a: number, b: number): XZ => [c[0] + (lx + a) * cs - (lz + b) * sn, c[1] + (lx + a) * sn + (lz + b) * cs];
  S.box(P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2), y0, y1, col, null);
}

type Pose = 'stoi' | 'reka' | 'plaszcz' | 'otwarte' | 'kula' | 'idzie';
/** postać (wysokość ok. 1,8 m × s) stojąca na wysokości y0, przodem w stronę -z układu */
function figure(S: ModelSink, c: XZ, yaw: number, lx: number, lz: number, s: number, y0: number, col: RGB, pose: Pose, head: RGB = col): void {
  const L = (x: number, z: number, w: number, d: number, a: number, b: number, k: RGB = col) => OB(S, c, yaw, lx + x * s, lz + z * s, w * s, d * s, y0 + a * s, y0 + b * s, k);
  if (pose === 'plaszcz') L(0, 0, .56, .36, 0, 1.4); // płaszcz do ziemi
  else { const st = pose === 'idzie' ? .12 : 0; L(-.12, -st, .18, .2, 0, .86); L(.12, st, .18, .2, 0, .86); }
  L(0, 0, .5, .28, .82, 1.45); L(0, 0, .2, .2, 1.45, 1.52); L(0, 0, .24, .26, 1.52, 1.78, head); // tułów, szyja, głowa
  if (pose === 'reka') { L(-.33, 0, .14, .14, .85, 1.42); L(.33, 0, .14, .14, 1.4, 2.05); L(.33, 0, .05, .05, 2.05, 2.6, GOLD); } // ręka z mieczem w górze
  else if (pose === 'otwarte') { L(-.5, -.1, .4, .14, 1.25, 1.38); L(.5, -.1, .4, .14, 1.25, 1.38); }   // ramiona rozłożone
  else if (pose === 'kula') { L(-.33, 0, .14, .14, .85, 1.42); L(.3, -.25, .14, .3, 1.15, 1.28); L(.3, -.42, .26, .26, 1.24, 1.5, GOLD); } // z globusem
  else { L(-.33, 0, .14, .14, .85, 1.42); L(.33, 0, .14, .14, .85, 1.42); }
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export function buildMonument(S: ModelSink, x: number, z: number, kind: string, name: string): void {
  const c: XZ = [x, z], r = hash(name + kind + Math.round(x) + Math.round(z)), yaw = r * Math.PI * 2, n = name.toLowerCase();
  const ped = (w: number, h: number, col: RGB = GRANITE) => { OB(S, c, yaw, 0, 0, w + .6, w + .6, 0, .35, GRANITE_D); OB(S, c, yaw, 0, 0, w, w, .35, h, col); };

  if (kind === 'dwarf') { // krasnal: ok. 35 cm, brąz, spiczasta czapka
    const k = .2 + r * .05, B = (lx: number, lz: number, w: number, d: number, a: number, b: number, col: RGB) => OB(S, c, yaw, lx, lz, w, d, a, b, col);
    B(-.04, 0, .06, .07, 0, .1, BRONZE_D); B(.04, 0, .06, .07, 0, .1, BRONZE_D); B(0, 0, .17, .13, .1, .22, [.42, .34, .2]);
    B(0, 0, .13, .13, .22, .34, [.52, .4, .26]); B(0, -.07, .1, .03, .2, .29, [.75, .7, .6]); // głowa, broda
    const cs = Math.cos(yaw), sn = Math.sin(yaw); S.spire([c[0] - .01 * sn, c[1] + .01 * cs], .34, .075, k, [.5, .3, .18]);
    return;
  }
  if (kind === 'pillory') { // pręgierz (Wrocław, 1492): piaskowcowa gotycka kolumna na schodkach, na szczycie kat z mieczem
    const ST: RGB = [.74, .66, .52], STD: RGB = [.6, .53, .42];
    for (let k = 0; k < 4; k++) { const w = 4.4 - k * .9; OB(S, c, 0, 0, 0, w, w, k * .28, (k + 1) * .28, k % 2 ? ST : STD); } // schodki
    const y0 = 1.12; OB(S, c, 0, 0, 0, 1.3, 1.3, y0, y0 + .7, STD);                                  // cokół
    OB(S, c, Math.PI / 4, 0, 0, .78, .78, y0 + .7, y0 + 4.6, ST); OB(S, c, 0, 0, 0, .7, .7, y0 + .7, y0 + 4.6, ST); // ośmioboczny trzon
    for (const h of [y0 + 1.9, y0 + 3.2]) OB(S, c, 0, 0, 0, .9, .9, h, h + .12, STD);                // opaski
    OB(S, c, 0, 0, 0, 1.25, 1.25, y0 + 4.6, y0 + 4.85, STD);                                         // głowica
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { OB(S, c, 0, a * .5, b * .5, .16, .16, y0 + 4.85, y0 + 5.9, ST); S.spire([c[0] + a * .5, c[1] + b * .5], y0 + 5.9, .12, .55, STD); } // pinakle
    OB(S, c, 0, 0, 0, 1.0, 1.0, y0 + 5.9, y0 + 6.05, STD);
    figure(S, c, Math.PI, 0, 0, .8, y0 + 6.05, ST, 'reka');                                         // kat z mieczem
    OB(S, c, 0, 0, -.42, .5, .06, y0 + .9, y0 + 1.05, [.25, .25, .27]);                             // obręcz (kuna)
    return;
  }
  if (n.includes('anonimowego przechodnia') || n.includes('przejście')) { // 7 przechodniów schodzących pod chodnik
    for (let k = 0; k < 7; k++) figure(S, c, yaw, 0, -6 + k * 1.6, 1, -k * .26, BRONZE, 'idzie');
    return;
  }
  if (kind === 'statue' || kind === 'monument' && n && /pomnik|^[A-ZŁŚŻ]/.test(name)) {
    const pose: Pose = /chrobr|jagieł|batory|sobiesk|piłsud|kościusz/.test(n) ? 'reka' : /jan paweł|papież|chrystus|jezus/.test(n) ? 'otwarte'
      : /kopernik/.test(n) ? 'kula' : /fredr|słowack|mickiewicz|chopin/.test(n) ? 'plaszcz' : r < .5 ? 'stoi' : 'plaszcz';
    const white = /jan paweł|papież|maryi|matk/.test(n), h = 2.2 + r * 1.2;
    ped(2.1, h, white ? SAND : GRANITE);
    figure(S, c, yaw, 0, 0, 1.55, h, white ? STONE_W : BRONZE, pose);
    return;
  }
  if (kind === 'bust') { ped(.9, 1.7, GRANITE); OB(S, c, yaw, 0, 0, .9, .45, 1.7, 2.1, BRONZE); OB(S, c, yaw, 0, 0, .34, .4, 2.1, 2.55, BRONZE); return; }
  if (kind === 'obelisk' || kind === 'war_memorial' || (kind === 'monument' && r < .5)) {
    ped(1.8, 1, GRANITE_D); OB(S, c, yaw, 0, 0, 1.1, 1.1, 1, 6.5 + r * 3, GRANITE); S.spire(c, 6.5 + r * 3, .55, 1.6, GRANITE);
    return;
  }
  if (kind === 'cross') { OB(S, c, yaw, 0, 0, 1.2, 1.2, 0, .5, GRANITE_D); OB(S, c, yaw, 0, 0, .3, .3, .5, 5.5, GRANITE); OB(S, c, yaw, 0, 0, 2, .3, 3.6, 3.95, GRANITE); return; }
  if (kind === 'stone' || kind === 'stone_slab') { // głaz: dwie skośne bryły
    OB(S, c, yaw, 0, 0, 1.6, 1.2, 0, .9, [.55, .53, .5]); OB(S, c, yaw + .5, .1, 0, 1.1, .9, .9, 1.5, [.6, .58, .55]); return;
  }
  if (kind === 'fountain') {
    const ring: XZ[] = Array.from({ length: 8 }, (_, i) => [x + Math.cos(i / 8 * 6.283) * 3.2, z + Math.sin(i / 8 * 6.283) * 3.2]);
    S.slab(ring, 0, .6, SAND); S.slab(ring.map(([a, b]) => [x + (a - x) * .88, z + (b - z) * .88] as XZ), .6, .62, WATER);
    OB(S, c, yaw, 0, 0, .5, .5, .6, 2.4, SAND); OB(S, c, yaw, 0, 0, 1.2, 1.2, 2.4, 2.6, SAND); return;
  }
  if (kind === 'sculpture' || kind === 'installation') { // rzeźba współczesna: kilka przesuniętych, obróconych brył
    const col = ART[Math.floor(r * ART.length)], col2 = ART[Math.floor(r * 7) % ART.length];
    OB(S, c, yaw, 0, 0, 1.2, 1.2, 0, .3, GRANITE_D);
    OB(S, c, yaw, 0, 0, .5, .5, .3, 2.6 + r * 2, col); OB(S, c, yaw + .8, .3, 0, 1.6, .25, 1.6, 2.1, col2); OB(S, c, yaw - .4, -.2, 0, .9, .9, 2.6 + r * 2, 3.1 + r * 2, col);
    return;
  }
  // tablice i inne upamiętnienia: stela
  OB(S, c, yaw, 0, 0, 1.6, .9, 0, .4, GRANITE_D); OB(S, c, yaw, 0, 0, 1.2, .35, .4, 2.6 + r, GRANITE);
}
