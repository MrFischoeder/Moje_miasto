// Styl low-poly: paleta kolorów i oświetlenie zależne od pory dnia (niebo, słońce, światło otoczenia).
// Kolory w przestrzeni liniowej (zarządzanie kolorami wyłączone, jak w całej grze).
import * as THREE from 'three';
import type { RGB } from '@miasto/shared/util/rng';

export const PAL = {
  grass: [.34, .46, .24] as RGB, ground: [.38, .42, .32] as RGB,
  asphalt: [.2, .21, .22] as RGB, asphaltTunnel: [.12, .12, .13] as RGB, sidewalk: [.62, .61, .58] as RGB, curb: [.72, .71, .68] as RGB,
  path: [.56, .52, .44] as RGB, marking: [.92, .92, .88] as RGB, markingY: [.95, .78, .25] as RGB, zebra: [.93, .93, .9] as RGB,
  ballast: [.42, .38, .34] as RGB, sleeper: [.3, .22, .16] as RGB, rail: [.55, .56, .58] as RGB, tramBed: [.3, .44, .22] as RGB,
  water: [.22, .45, .65] as RGB, bank: [.45, .43, .4] as RGB, deck: [.45, .45, .46] as RGB, railing: [.75, .75, .78] as RGB,
  park: [.3, .46, .22] as RGB, forest: [.19, .34, .16] as RGB, cemetery: [.28, .38, .24] as RGB, pitch: [.27, .48, .26] as RGB,
  parking: [.4, .41, .42] as RGB, square: [.6, .58, .54] as RGB, roof: [.36, .36, .38] as RGB, roofDark: [.3, .3, .33] as RGB, tiles: [.6, .27, .18] as RGB, copper: [.42, .62, .52] as RGB, pole: [.3, .32, .34] as RGB,
};

/** Kolory elewacji wg typu budynku (warianty losowane z ziarna budynku). */
export const FACADE: Record<string, RGB[]> = {
  blok: [[.86, .84, .78], [.8, .82, .78], [.86, .8, .66], [.72, .8, .82], [.84, .76, .7], [.9, .88, .82]],
  kamienica: [[.86, .74, .56], [.82, .66, .52], [.9, .84, .7], [.76, .62, .5], [.84, .78, .64]],
  korytarz: [[.88, .88, .86], [.74, .76, .78], [.82, .8, .76], [.66, .7, .74]],
  szereg: [[.62, .36, .28], [.7, .44, .32], [.9, .88, .82], [.56, .34, .28]],
  sklep: [[.8, .8, .8], [.74, .76, .78], [.86, .84, .8]],
  office: [[.56, .66, .74], [.62, .7, .76], [.7, .74, .78]],
  house: [[.92, .9, .84], [.88, .84, .74], [.8, .76, .7]],
  industrial: [[.58, .56, .52], [.62, .6, .56], [.5, .52, .54]],
  inne: [[.78, .76, .72], [.72, .72, .7], [.84, .82, .76], [.7, .68, .64]],
};

/** Barwa nieba wg godziny: noc, świt/zmierzch, dzień. */
export function skyColor(hour: number, out = new THREE.Color()): THREE.Color {
  const night = new THREE.Color(0x0b1220), dusk = new THREE.Color(0xd99a6c), day = new THREE.Color(0x9fc6e6);
  const h = ((hour % 24) + 24) % 24;
  const sun = Math.sin((h - 6) / 12 * Math.PI); // 6:00 → 0, 12:00 → 1, 18:00 → 0
  if (sun <= -.15) return out.copy(night);
  if (sun < .25) { const t = (sun + .15) / .4; return t < .5 ? out.copy(night).lerp(dusk, t * 2) : out.copy(dusk).lerp(day, (t - .5) * 2); }
  return out.copy(day);
}

/** Jasność dnia 0 (noc) .. 1 (południe). */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24, s = Math.sin((h - 6) / 12 * Math.PI);
  return Math.max(0, Math.min(1, (s + .15) / .6));
}
