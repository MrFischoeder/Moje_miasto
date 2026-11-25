// Meble i sprzęty jako proste, ale rozpoznawalne modele low-poly (zamiast samych prostopadłościanów):
// łóżko z wezgłowiem, materacem, poduszką i kołdrą, kanapa z oparciem i podłokietnikami, telewizor na szafce,
// szafa z drzwiami i uchwytami, lodówka z zamrażarką, kuchenka z palnikami i piekarnikiem, wanna, sedes, umywalka
// z lustrem, pralka z okrągłymi drzwiczkami, stół na nogach, regały z półkami, w sklepach towar na półkach.
// Układ mebla: u wzdłuż ściany (0..W), v od ściany w stronę pokoju (0..D), h od podłogi (0..H).
import type { Item } from '@miasto/shared/interiors/plan';
import type { RGB } from '@miasto/shared/util/rng';
import type { GeoBuilder, V3 } from './geometry';

type Loc = (x: number, y: number, h: number) => V3;
type Dir = (dx: number, dy: number) => V3;

const WOOD: RGB = [.62, .45, .3], WOOD_D: RGB = [.45, .32, .22], WHITE: RGB = [.93, .93, .91], CERAMIC: RGB = [.96, .97, .98], STEEL: RGB = [.72, .74, .76];
const BLACK: RGB = [.1, .1, .12], DARK: RGB = [.22, .22, .25], HANDLE: RGB = [.78, .78, .8], LINE: RGB = [.3, .26, .22];
const FABRIC: Record<string, RGB> = { kanapa: [.55, .32, .28], fotel: [.62, .4, .3], wersalka: [.38, .45, .58] };
const BLANKET: RGB[] = [[.45, .55, .75], [.75, .5, .45], [.55, .68, .5], [.8, .75, .55]];
const GOODS: RGB[] = [[.85, .3, .25], [.95, .75, .25], [.3, .55, .8], [.35, .7, .4], [.9, .9, .85], [.7, .4, .65]];

export function drawItem(G: GeoBuilder, it: Item, P: Loc, N: Dir, seed: number): void {
  const r = it.r, y = it.y;
  // ściana, przy której stoi mebel: wyznacza osie u (wzdłuż) i v (do pokoju)
  let f = it.f;
  if (f == null) f = (r.x1 - r.x0 >= r.y1 - r.y0 ? 0 : 3);
  const W = f === 0 || f === 2 ? r.x1 - r.x0 : r.y1 - r.y0, D = f === 0 || f === 2 ? r.y1 - r.y0 : r.x1 - r.x0, H = it.h;
  const at = (u: number, v: number, h: number): V3 => {
    switch (f) {
      case 0: return P(r.x0 + u, r.y0 + v, y + h);
      case 2: return P(r.x1 - u, r.y1 - v, y + h);
      case 3: return P(r.x0 + v, r.y1 - u, y + h);
      default: return P(r.x1 - v, r.y0 + u, y + h);
    }
  };
  const dir = (du: number, dv: number): V3 => f === 0 ? N(du, dv) : f === 2 ? N(-du, -dv) : f === 3 ? N(dv, -du) : N(-dv, du);
  const UP: V3 = [0, 1, 0];
  /** prostopadłościan w układzie mebla (bez spodu) */
  const box = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, c: RGB, edges = false) => {
    if (u1 - u0 < .005 || v1 - v0 < .005 || h1 - h0 < .005) return;
    G.quad(at(u0, v0, h1), at(u1, v0, h1), at(u1, v1, h1), at(u0, v1, h1), c, UP);
    const k = .86;
    G.quad(at(u0, v1, h0), at(u1, v1, h0), at(u1, v1, h1), at(u0, v1, h1), c, dir(0, 1)); // front
    G.quad(at(u0, v0, h0), at(u1, v0, h0), at(u1, v0, h1), at(u0, v0, h1), shade(c, k), dir(0, -1));
    G.quad(at(u0, v0, h0), at(u0, v1, h0), at(u0, v1, h1), at(u0, v0, h1), shade(c, k), dir(-1, 0));
    G.quad(at(u1, v0, h0), at(u1, v1, h0), at(u1, v1, h1), at(u1, v0, h1), shade(c, k), dir(1, 0));
    if (edges) { const e = shade(c, .55); G.line(at(u0, v1, h1), at(u1, v1, h1), e); G.line(at(u0, v1, h0), at(u0, v1, h1), e); G.line(at(u1, v1, h0), at(u1, v1, h1), e); }
  };
  /** płaski panel na froncie (v = vf), lekko przed nim */
  const front = (u0: number, u1: number, h0: number, h1: number, vf: number, c: RGB) => G.quad(at(u0, vf + .006, h0), at(u1, vf + .006, h0), at(u1, vf + .006, h1), at(u0, vf + .006, h1), c, dir(0, 1));
  const top = (u0: number, u1: number, v0: number, v1: number, h: number, c: RGB) => G.quad(at(u0, v0, h + .004), at(u1, v0, h + .004), at(u1, v1, h + .004), at(u0, v1, h + .004), c, UP);
  const vline = (u: number, h0: number, h1: number, vf: number, c = LINE) => G.line(at(u, vf + .008, h0), at(u, vf + .008, h1), c);
  const hline = (u0: number, u1: number, h: number, vf: number, c = LINE) => G.line(at(u0, vf + .008, h), at(u1, vf + .008, h), c);
  const handle = (u: number, h0: number, h1: number, vf: number) => box(u - .012, u + .012, vf, vf + .03, h0, h1, HANDLE);
  const legs = (h1: number, c: RGB, t = .045, inset = .04) => { for (const [u, v] of [[inset, inset], [W - inset - t, inset], [inset, D - inset - t], [W - inset - t, D - inset - t]]) box(u, u + t, v, v + t, 0, h1, c); };
  const rnd = (i: number) => { const x = Math.sin(seed * 91.7 + i * 47.3) * 43758.5453; return x - Math.floor(x); };

  switch (it.k) {
    case 'lozko': case 'lozko1': case 'wersalka': {
      if (it.k === 'wersalka') { sofa(FABRIC.wersalka); break; }
      // łóżko: wezgłowie przy ścianie, rama, materac, poduszki, kołdra
      box(0, W, 0, D, .08, .3, WOOD); legs(.08, WOOD_D, .06, .02);
      box(0, W, 0, .07, 0, .95, WOOD_D, true);
      box(.04, W - .04, .07, D - .03, .3, .48, CERAMIC);
      const np = W > 1.1 ? 2 : 1, pw = (W - .12 - (np - 1) * .06) / np;
      for (let i = 0; i < np; i++) box(.06 + i * (pw + .06), .06 + i * (pw + .06) + pw, .12, .48, .48, .6, WHITE);
      const bl = BLANKET[Math.floor(rnd(1) * BLANKET.length)];
      box(.02, W - .02, .55, D - .01, .48, .54, bl); box(.02, W - .02, D - .04, D - .01, .3, .54, bl); // kołdra opada z przodu
      break;
    }
    case 'kanapa': sofa(FABRIC.kanapa); break;
    case 'fotel': sofa(FABRIC.fotel, true); break;
    case 'rtv': {
      // szafka RTV i telewizor płaski
      box(0, W, 0, D, .05, .45, WOOD_D, true); legs(.05, DARK, .04, .03);
      hline(.03, W - .03, .25, D); vline(W / 2, .07, .43, D);
      const tw = Math.min(W * .85, 1.25), u0 = (W - tw) / 2, th = tw * .56;
      box(W / 2 - .12, W / 2 + .12, .1, .3, .45, .48, BLACK); box(W / 2 - .025, W / 2 + .025, .17, .21, .48, .56, BLACK);
      box(u0, u0 + tw, .16, .2, .56, .56 + th, BLACK);
      front(u0 + .02, u0 + tw - .02, .58, .54 + th, .2, [.12, .16, .24]);
      break;
    }
    case 'meblosciana': {
      // meblościanka: szafki dolne, środkowa część otwarta z półkami, szafki górne
      box(0, W, 0, D, 0, .8, WOOD, true); box(0, W, 0, .02, .8, H - .4, WOOD_D); box(0, W, 0, D * .8, H - .4, H, WOOD, true);
      for (const u of [0, W - .03]) box(u, u + .03, 0, D * .8, .8, H - .4, WOOD);
      const n = Math.max(2, Math.round(W / .6));
      for (let i = 1; i < n; i++) { vline(i * W / n, .02, .78, D); vline(i * W / n, H - .38, H - .02, D * .8); }
      for (let i = 0; i < n; i++) { handle((i + .5) * W / n + .1, .55, .65, D); }
      for (const h of [1.25, 1.55]) box(.03, W - .03, .02, D * .8, h, h + .025, WOOD);
      for (let i = 0; i < 6; i++) { const u = .1 + rnd(i + 3) * (W - .3); box(u, u + .04 + rnd(i) * .05, .05, .25, 1.28, 1.28 + .18 + rnd(i + 9) * .07, GOODS[i % GOODS.length]); } // książki
      break;
    }
    case 'szafa': case 'szafki': {
      const c = it.k === 'szafki' ? [.6, .62, .68] as RGB : WOOD;
      box(0, W, 0, D, 0, H, c, true);
      const n = Math.max(2, Math.round(W / (it.k === 'szafki' ? .4 : .55)));
      for (let i = 1; i < n; i++) vline(i * W / n, .05, H - .05, D);
      for (let i = 0; i < n; i++) handle((i + (i % 2 ? .15 : .85)) * W / n, H * .45, H * .58, D);
      box(-.01, W + .01, -.01, D + .02, H - .04, H, shade(c, .85)); // wieniec
      break;
    }
    case 'szafka': case 'komoda': case 'nocna': {
      box(0, W, 0, D, .06, H - .03, WOOD, true); box(-.01, W + .01, -.01, D + .015, H - .03, H, WOOD_D); legs(.06, WOOD_D, .04, .02);
      const nd = Math.max(1, Math.round((H - .1) / .25));
      for (let i = 1; i < nd; i++) hline(.02, W - .02, .06 + i * (H - .09) / nd, D);
      for (let i = 0; i < nd; i++) box(W / 2 - .07, W / 2 + .07, D, D + .025, .06 + (i + .5) * (H - .09) / nd - .012, .06 + (i + .5) * (H - .09) / nd + .012, HANDLE);
      if (it.k === 'nocna') { box(W / 2 - .07, W / 2 + .07, D / 2 - .07, D / 2 + .07, H, H + .03, DARK); box(W / 2 - .015, W / 2 + .015, D / 2 - .015, D / 2 + .015, H + .03, H + .3, DARK); box(W / 2 - .1, W / 2 + .1, D / 2 - .1, D / 2 + .1, H + .3, H + .45, [.95, .88, .7]); } // lampka
      break;
    }
    case 'regal': case 'regal_mag': case 'skrzynki': {
      const c = it.k === 'regal' ? WOOD : it.k === 'skrzynki' ? [.55, .6, .62] as RGB : STEEL;
      if (it.k === 'skrzynki') { box(0, W, 0, D, .6, H, c, true); const nx = Math.max(2, Math.round(W / .3)); for (let i = 1; i < nx; i++) vline(i * W / nx, .62, H - .02, D); for (const h of [.8, .99]) hline(0, W, h, D); break; }
      box(0, W, 0, .02, 0, H, shade(c, .8));
      for (const u of [0, W - .03]) box(u, u + .03, 0, D, 0, H, c);
      const ns = Math.max(3, Math.round(H / .4));
      for (let i = 0; i <= ns; i++) {
        const h = i * (H - .03) / ns; box(.03, W - .03, .02, D, h, h + .03, c);
        if (i < ns) for (let j = 0; j < 5; j++) { const u = .05 + rnd(i * 7 + j) * (W - .22); box(u, u + .05 + rnd(j + i) * .08, .05, D - .04, h + .03, h + .03 + .14 + rnd(i + j * 3) * .12, GOODS[(i + j) % GOODS.length]); }
      }
      break;
    }
    case 'blat': {
      // szafki kuchenne dolne z blatem i zlewem, szafki wiszące nad blatem
      box(0, W, 0, D - .04, .08, .86, WHITE, true); box(0, W, 0, D - .1, 0, .08, DARK);
      box(-.01, W + .01, 0, D + .02, .86, .9, [.5, .42, .35]);
      const n = Math.max(2, Math.round(W / .6));
      for (let i = 1; i < n; i++) vline(i * W / n, .1, .84, D - .04);
      for (let i = 0; i < n; i++) box((i + .5) * W / n - .1, (i + .5) * W / n + .1, D - .04, D - .015, .78, .8, HANDLE);
      const su = W * .35; box(su - .25, su + .25, .12, D - .1, .84, .9, STEEL); top(su - .21, su + .21, .16, D - .14, .87, [.5, .52, .55]); // zlew
      box(su - .02, su + .02, .05, .1, .9, 1.15, STEEL); box(su - .02, su + .02, .05, .25, 1.12, 1.15, STEEL); // bateria
      box(0, W, 0, .35, 1.45, 2.15, WHITE, true);
      for (let i = 1; i < n; i++) vline(i * W / n, 1.47, 2.13, .35);
      for (let i = 0; i < n; i++) box((i + .5) * W / n - .1, (i + .5) * W / n + .1, .35, .375, 1.5, 1.52, HANDLE);
      break;
    }
    case 'kuchenka': {
      box(0, W, 0, D, 0, .9, WHITE, true); top(0, W, 0, D, .9, DARK);
      for (const [u, v, rr] of [[.17, .17, .08], [.43, .17, .1], [.17, .43, .1], [.43, .43, .08]] as [number, number, number][]) burner(u * W / .6, v * D / .6, rr);
      front(.06, W - .06, .12, .62, D, DARK); front(.12, W - .12, .2, .52, D + .002, [.18, .14, .12]); // drzwiczki piekarnika z szybą
      box(.1, W - .1, D, D + .03, .6, .62, HANDLE);
      for (let i = 0; i < 4; i++) box(.08 + i * (W - .16) / 3.5, .12 + i * (W - .16) / 3.5, D, D + .03, .76, .8, DARK); // pokrętła
      break;
    }
    case 'lodowka': case 'lodowka_sklep': {
      if (it.k === 'lodowka_sklep') { box(0, W, 0, D, 0, H, [.85, .87, .9], true); front(.05, W - .05, .1, H - .25, D, [.6, .78, .9]); for (let i = 1; i < 5; i++) { const h = .1 + i * (H - .35) / 5; for (let j = 0; j < 6; j++) box(.08 + j * (W - .16) / 6, .08 + (j + .7) * (W - .16) / 6, D - .45, D - .1, h, h + .22, GOODS[(i + j) % GOODS.length]); } box(0, W, 0, D, H - .25, H, [.2, .45, .75]); break; }
      box(0, W, 0, D, 0, H, WHITE, true);
      const fz = H * .62; hline(.01, W - .01, fz, D);
      box(W - .09, W - .065, D, D + .035, fz + .1, fz + .45, HANDLE); box(W - .09, W - .065, D, D + .035, fz - .45, fz - .1, HANDLE);
      break;
    }
    case 'stol': case 'stolik': case 'biurko': {
      const th = it.k === 'stolik' ? H : H - .03, c = it.k === 'biurko' ? WOOD_D : WOOD;
      box(0, W, 0, D, th - .04, th, c, true); legs(th - .04, shade(c, .8), .05, .05);
      if (it.k === 'biurko') {
        box(W - .45, W - .05, .05, D - .05, .05, th - .04, c, true); for (const h of [.25, .45]) hline(W - .43, W - .07, h, D - .05); // szuflady
        box(W / 2 - .3, W / 2 + .3, .06, .1, th + .12, th + .48, BLACK); box(W / 2 - .03, W / 2 + .03, .08, .14, th, th + .12, BLACK); front(W / 2 - .28, W / 2 + .28, th + .14, th + .46, .1, [.15, .22, .32]); // monitor
        box(W / 2 - .22, W / 2 + .22, .3, .45, th, th + .02, DARK); // klawiatura
        chairAt(W / 2, D + .35, -1);
      } else if (it.k === 'stol') {
        for (const s of [-1, 1]) { const u = W / 2 + s * W * .22; if (it.f == null) chairOn(u, -.35, 1); chairOn(u, D + .35, -1); } // krzesła przy stole (przy ścianie tylko od frontu)
      }
      break;
    }
    case 'wanna': {
      box(0, W, 0, D, 0, H, CERAMIC, true);
      top(.07, W - .07, .07, D - .07, H, [.72, .84, .9]); G.line(at(.07, .07, H + .01), at(W - .07, .07, H + .01), [.6, .6, .62]);
      box(W - .2, W - .16, .02, .06, H, H + .25, STEEL); box(W - .2, W - .16, .02, .2, H + .22, H + .25, STEEL); // bateria
      break;
    }
    case 'umywalka': {
      box(.05, W - .05, 0, D - .05, 0, H - .1, WHITE, true); vline(W / 2, .03, H - .13, D - .05);
      box(0, W, 0, D, H - .1, H, CERAMIC); top(.08, W - .08, .1, D - .08, H, [.75, .85, .9]);
      box(W / 2 - .02, W / 2 + .02, .03, .15, H, H + .2, STEEL);
      if (!it.win) box(.05, W - .05, 0, .02, H + .35, H + 1.0, [.75, .85, .92]); // lustro (nie na oknie)
      break;
    }
    case 'pralka': {
      box(0, W, 0, D, 0, H, WHITE, true); top(.04, W - .04, .04, D * .35, H, [.8, .8, .82]);
      ring(W / 2, H * .45, .2, D, DARK); ring(W / 2, H * .45, .15, D + .003, [.4, .5, .6]);
      break;
    }
    case 'sedes': {
      box(.02, W - .02, 0, .18, .38, .8, CERAMIC, true); // spłuczka
      box(.06, W - .06, .18, D - .04, 0, .3, CERAMIC); box(.03, W - .03, .16, D, .3, .4, CERAMIC); top(.09, W - .09, .24, D - .08, .4, [.75, .85, .9]);
      break;
    }
    case 'sejf': {
      box(0, W, 0, D, 0, H, [.3, .32, .34], true); ring(W / 2, H * .55, .08, D, [.75, .7, .5]); box(W * .75, W * .8, D, D + .03, H * .35, H * .75, HANDLE);
      break;
    }
    case 'kasa': case 'samoobsluga': {
      box(0, W, 0, D, 0, .85, [.85, .85, .82], true);
      if (it.k === 'kasa') { top(.05, W * .65, .1, D - .1, .85, BLACK); box(W * .7, W * .95, .15, D - .15, .85, 1.05, DARK); box(W * .72, W * .93, .2, .25, 1.05, 1.35, BLACK); }
      else { box(W * .2, W * .8, .05, .15, .85, 1.35, BLACK); front(W * .23, W * .77, .9, 1.3, .15, [.2, .4, .7]); }
      break;
    }
    case 'polka': case 'gondola': case 'piekarnia': {
      const c = it.k === 'piekarnia' ? WOOD : [.78, .8, .82] as RGB, twoSided = it.k === 'gondola';
      box(0, W, twoSided ? D / 2 - .02 : 0, twoSided ? D / 2 + .02 : .03, 0, H, shade(c, .9));
      for (const u of [0, W - .03]) box(u, u + .03, 0, D, 0, H, c);
      const ns = 4;
      for (let i = 0; i < ns; i++) {
        const h = .12 + i * (H - .2) / ns; box(.03, W - .03, 0, D, h, h + .025, c);
        const nn = Math.max(2, Math.round(W / .25));
        for (let j = 0; j < nn; j++) { const u0 = .04 + j * (W - .08) / nn, col = GOODS[(Math.floor(rnd(i * 13 + j) * 6) + i) % GOODS.length], hh = .12 + rnd(j + i * 5) * .14;
          if (twoSided) { box(u0, u0 + (W - .08) / nn * .85, .03, D / 2 - .04, h + .025, h + .025 + hh, col); box(u0, u0 + (W - .08) / nn * .85, D / 2 + .04, D - .03, h + .025, h + .025 + hh, GOODS[(j + i + 2) % GOODS.length]); }
          else box(u0, u0 + (W - .08) / nn * .85, .05, D - .03, h + .025, h + .025 + hh, col); }
      }
      break;
    }
    default:
      box(0, W, 0, D, 0, H, [.7, .7, .7], true);
  }

  function sofa(c: RGB, single = false): void {
    const arm = Math.min(.2, W * .18), seatH = .42;
    box(0, W, 0, D, .06, seatH - .1, shade(c, .85)); legs(.06, WOOD_D, .05, .04);
    box(0, W, 0, .24, .06, .85, c, true); // oparcie
    box(0, arm, 0, D, .06, .62, c, true); box(W - arm, W, 0, D, .06, .62, c, true); // podłokietniki
    const n = single ? 1 : Math.max(2, Math.round((W - 2 * arm) / .7)), cw = (W - 2 * arm) / n;
    for (let i = 0; i < n; i++) {
      box(arm + i * cw + .01, arm + (i + 1) * cw - .01, .24, D - .02, seatH - .1, seatH, shade(c, 1.08)); // siedziska
      box(arm + i * cw + .02, arm + (i + 1) * cw - .02, .24, .38, seatH, .8, shade(c, 1.12)); // poduchy oparcia
    }
  }
  function burner(u: number, v: number, rr: number): void { const n = 8; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; G.line(at(u + Math.cos(a0) * rr, v + Math.sin(a0) * rr, .91), at(u + Math.cos(a1) * rr, v + Math.sin(a1) * rr, .91), [.55, .55, .58]); } box(u - rr * .5, u + rr * .5, v - rr * .5, v + rr * .5, .9, .915, BLACK); }
  function ring(u: number, h: number, rr: number, vf: number, c: RGB): void {
    const n = 12, cc = at(u, vf + .008, h);
    for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; G.quad(cc, at(u + Math.cos(a0) * rr, vf + .008, h + Math.sin(a0) * rr), at(u + Math.cos(a1) * rr, vf + .008, h + Math.sin(a1) * rr), cc, c, dir(0, 1)); }
  }
  /** krzesło (siedzisko, nogi, oparcie od strony back: -1 = oparcie od strony v większego) */
  function chairOn(u: number, v: number, face: number): void {
    const s = .21, c = WOOD;
    box(u - s, u + s, v - s, v + s, .43, .47, c);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(u + a * (s - .03) - .02, u + a * (s - .03) + .02, v + b * (s - .03) - .02, v + b * (s - .03) + .02, 0, .43, shade(c, .8));
    const bv = face > 0 ? v - s : v + s - .04; box(u - s, u + s, bv, bv + .04, .47, .9, c);
  }
  function chairAt(u: number, v: number, face: number): void { chairOn(u, v, face); }
}

const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
