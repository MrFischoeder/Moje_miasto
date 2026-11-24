// Ratusz we Wrocławiu: własny model low-poly (gotycka hala z piaskowca, schodkowy szczyt wschodni z pinaklami
// i zegarem astronomicznym, ozdobne szczyty od południa, narożne wieżyczki, wieża 66 m z renesansowym hełmem).
// Układ lokalny: u wzdłuż dłuższego boku obrysu z OSM (na wschód), v w poprzek (na południe), y w górę od gruntu.
import type { RGB } from '@miasto/shared/util/rng';
import { addRoof } from '../roofs';
import type { ModelSink, Frame } from './sink';

const STONE: RGB = [.84, .76, .6], STONE2: RGB = [.78, .7, .55], BRICK: RGB = [.56, .3, .22], ROOF: RGB = [.42, .2, .15];
const COPPER: RGB = [.4, .6, .5], DARK: RGB = [.25, .22, .2], GOLD: RGB = [.85, .7, .3], CLOCK: RGB = [.15, .2, .4];

export function buildRatusz(S: ModelSink, f: Frame): void {
  const { W, D } = f, P = (u: number, v: number): [number, number] => [f.ox + f.ux * u - f.uz * v, f.oz + f.uz * u + f.ux * v];
  const u0 = W * .12, u1 = W * .98, v0 = D * .22, v1 = D * .78, HW = 15, RH = 13, hd = v1 - v0, vm = (v0 + v1) / 2;
  const gothic = { levelH: 7, spacing: 4.2, ww: 1.6, wh: 4.3, sill: 1.5, raise: .6, levels: 2, mat: 2, arch: true };

  // hala: ściany z oknami gotyckimi, dach dwuspadowy
  const hall: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const hc = P((u0 + u1) / 2, vm);
  for (let i = 0; i < 4; i++) S.wall(P(...hall[i]), P(...hall[(i + 1) % 4]), 0, HW, STONE, gothic, hc);
  addRoof(S, hall.map(([u, v]) => P(u, v)), S.base + HW, RH, 'gabled', false, ROOF, STONE);

  // szczyt wschodni: schodkowe pola (lekko przed ścianą) z blendami, pinakle na stopniach, zegar
  const steps = 6, sh = (RH + 4) / steps, ue = u1 + .35;
  for (let k = 0; k < steps; k++) {
    const w = hd * (1 - k / steps) / 2, y0 = HW + k * sh, y1 = y0 + sh;
    S.box(P(u1 - .2, vm - w), P(ue, vm - w), P(ue, vm + w), P(u1 - .2, vm + w), y0, y1, STONE2, { levelH: sh, spacing: 2.2, ww: .8, wh: sh * .6, sill: sh * .2, raise: y0 - HW + HW, levels: 1, mat: 2, arch: true });
    for (const s of [-1, 1]) S.spire(P(ue - .3, vm + s * (w - .3)), y1, .35, 2.6, STONE2);
  }
  S.spire(P(ue - .3, vm), HW + steps * sh, .5, 4, STONE2);
  S.disc(P(ue + .05, vm), HW + 3.4, 2.3, [f.ux, f.uz], CLOCK, GOLD);

  // fasada południowa: dwa ozdobne szczyty z pinaklami
  for (const uc of [u0 + (u1 - u0) * .38, u0 + (u1 - u0) * .7]) {
    const hw = 4.2;
    for (let k = 0; k < 4; k++) {
      const w = hw * (1 - k / 4), y0 = HW + k * 2.2;
      S.box(P(uc - w, v1 - .2), P(uc + w, v1 - .2), P(uc + w, v1 + .3), P(uc - w, v1 + .3), y0, y0 + 2.2, STONE2, null);
      S.spire(P(uc - w + .3, v1 + .05), y0 + 2.2, .3, 2, STONE2); S.spire(P(uc + w - .3, v1 + .05), y0 + 2.2, .3, 2, STONE2);
    }
    S.spire(P(uc, v1 + .05), HW + 8.8, .45, 3.2, STONE2);
  }
  // narożne wieżyczki
  for (const [u, v] of hall) {
    const c = P(u, v), r = 1.1, ring = oct(c, r);
    for (let i = 0; i < 8; i++) S.wall(ring[i], ring[(i + 1) % 8], HW - 4, HW + 3, STONE2, null, c);
    addRoof(S, ring, S.base + HW + 3, 5, 'pyramidal', false, ROOF, STONE2);
  }

  // wieża: ceglany trzon, ośmioboczna nadbudowa, galeria, hełm cebulasty, latarnia, mała cebula, iglica
  const tc = P(W * .3, D * .16), tw = 4.2;
  const sq: [number, number][] = [[-tw, -tw], [tw, -tw], [tw, tw], [-tw, tw]].map(([a, b]) => [tc[0] + f.ux * a - f.uz * b, tc[1] + f.uz * a + f.ux * b]);
  const towerFac = { levelH: 10, spacing: 2.6, ww: 1.2, wh: 4, sill: 4, raise: 0, levels: 4, mat: 1, arch: true };
  for (let i = 0; i < 4; i++) S.wall(sq[i], sq[(i + 1) % 4], 0, 40, BRICK, towerFac, tc);
  S.slab(sq, 40, 40.6, STONE2);
  const o1 = oct(tc, 3.8);
  for (let i = 0; i < 8; i++) S.wall(o1[i], o1[(i + 1) % 8], 40.6, 47, STONE, { levelH: 6.4, spacing: 1.2, ww: .7, wh: 3, sill: 1.6, raise: 40.6, levels: 1, mat: 0, arch: true }, tc);
  S.slab(oct(tc, 4.5), 47, 47.5, DARK); // galeria
  const o2 = oct(tc, 3.6);
  addRoof(S, o2, S.base + 47.5, 7, 'onion', false, COPPER, STONE);
  const o3 = oct(tc, 1.5);
  for (let i = 0; i < 8; i++) S.wall(o3[i], o3[(i + 1) % 8], 54, 57.5, STONE, { levelH: 3.5, spacing: .8, ww: .45, wh: 2, sill: .8, raise: 54, levels: 1, mat: 0, arch: true }, tc);
  addRoof(S, oct(tc, 1.6), S.base + 57.5, 3, 'onion', false, COPPER, STONE);
  addRoof(S, oct(tc, .35), S.base + 60.5, 5.5, 'cone', false, GOLD, GOLD);
}

/** ośmiokąt foremny wokół c (promień r) */
function oct(c: [number, number], r: number): [number, number][] {
  return Array.from({ length: 8 }, (_, i) => { const a = (i + .5) / 8 * Math.PI * 2; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as [number, number]; });
}
