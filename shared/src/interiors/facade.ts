// Typologia budynku i fasada: liczba i wysokość kondygnacji, podniesiony parter, siatka okien.
// Ta sama funkcja rysuje okna na ścianach (shader klienta) i wycina okna we wnętrzach,
// więc okna z zewnątrz i od środka są w tych samych miejscach.
import { rng } from '../util/rng';
import type { TileBuilding } from '../tiles/types';
import { obb, ringXZ, type Frame } from './geom';

export type Typology = 'blok' | 'kamienica' | 'korytarz' | 'szereg' | 'sklep';

export interface Facade {
  /** liczba kondygnacji z oknami */
  levels: number;
  /** wysokość kondygnacji [m] */
  levelH: number;
  /** podniesienie parteru nad najniższym punktem terenu [m] */
  raise: number;
  /** rozstaw okien, szerokość, wysokość, parapet [m]; spacing 0 = bez okien */
  spacing: number; ww: number; wh: number; sill: number;
  /** ziarno (0..1) do zapalonych okien */
  seed: number;
}

export interface BuildingClass extends Facade { typ: Typology | null; country: 'PL' | 'UK'; box: Frame }

const RES = ['apartments', 'residential', 'yes', 'dormitory', 'flats'];
const HOUSE = ['house', 'terrace', 'semidetached_house', 'detached'];
const SHOP = ['retail', 'commercial', 'supermarket', 'kiosk'];
const NONE = ['garage', 'garages', 'roof', 'shed', 'outbuilding', 'allotment_house', 'farm_auxiliary', 'carport', 'hut', 'cabin', 'container',
  'greenhouse', 'storage_tank', 'silo', 'transformer_tower', 'bunker', 'ruins', 'construction', 'tank', 'water_tower', 'parking', 'barn', 'stable', 'toilets', 'bridge'];
const BIG = ['industrial', 'warehouse', 'service', 'hangar', 'manufacture', 'train_station', 'transportation', 'sports_hall', 'stadium', 'grandstand'];

const cache = new Map<number, BuildingClass>();

/** Klasyfikacja budynku (deterministyczna, z danych kafla). */
export function classify(b: TileBuilding, city: string): BuildingClass {
  const c = cache.get(b.id); if (c) return c;
  const r = rng('fasada' + b.id), country = city === 'londyn' ? 'UK' : 'PL', t = b.t, H = b.h - b.mh;
  const box = obb(ringXZ(b.o)), D = box.D;
  const lv0 = b.lv ?? Math.max(1, Math.round(H / (country === 'UK' && HOUSE.includes(t) ? 2.9 : 3.1)));
  let typ: Typology | null = null;
  if (!b.part && b.mh < 2 && !NONE.includes(t)) {
    const lh = H / lv0;
    if (country === 'PL') {
      if (RES.includes(t) && lv0 >= 2 && D >= 7) typ = lh >= 3.25 && lv0 <= 7 ? 'kamienica' : D > 14.5 ? 'korytarz' : 'blok';
      else if (SHOP.includes(t)) typ = 'sklep';
    } else {
      if ((HOUSE.includes(t) || ((t === 'yes' || t === 'residential') && lv0 <= 3 && D <= 13)) && D >= 5.5 && lv0 <= 4) typ = 'szereg';
      else if (RES.includes(t) && lv0 >= 4 && D >= 9) typ = 'korytarz';
      else if (SHOP.includes(t)) typ = 'sklep';
    }
  }
  const raise = typ === 'blok' ? 1 : typ === 'kamienica' ? .5 : 0;
  const levels = lv0, levelH = Math.max(2.4, Math.min(5, (H - raise) / levels));
  let spacing = 3, ww = 1.2, wh = 1.4, sill = .9;
  const pick = (a: number, b2: number) => a + (b2 - a) * r();
  if (typ === 'blok') { spacing = pick(2.9, 3.3); ww = 1.4; wh = 1.45; }
  else if (typ === 'kamienica') { spacing = pick(3.2, 3.8); ww = 1.2; wh = 2; sill = .8; }
  else if (typ === 'korytarz') { spacing = pick(3, 3.6); ww = 1.6; wh = 1.6; sill = .7; }
  else if (typ === 'szereg') { spacing = pick(2.2, 2.6); ww = 1; wh = 1.5; sill = .8; }
  else if (typ === 'sklep' || SHOP.includes(t)) { spacing = 4; ww = 3.2; wh = 2.2; sill = .4; }
  else if (t === 'office') { spacing = 1.8; ww = 1.5; wh = 1.8; sill = .8; }
  else if (NONE.includes(t) || b.part || H < 2.6) spacing = 0;
  else if (BIG.includes(t)) { spacing = 6; ww = 2.5; wh = 1; sill = Math.max(.9, levelH - 1.6); }
  wh = Math.max(.6, Math.min(wh, levelH - sill - .35));
  const out: BuildingClass = { typ, country, box, levels, levelH, raise, spacing, ww, wh, sill, seed: r() };
  if (cache.size > 60000) cache.clear(); cache.set(b.id, out); return out;
}

/** Okna na ścianie długości L: przedziały [od, do] wzdłuż ściany (te same co w shaderze). */
export function windowSlots(L: number, f: Facade): [number, number][] {
  if (f.spacing <= 0) return [];
  const n = Math.floor((L - .6) / f.spacing); if (n < 1) return [];
  const off = (L - n * f.spacing) / 2, out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const c = off + (i + .5) * f.spacing; out.push([c - f.ww / 2, c + f.ww / 2]); }
  return out;
}

/** Odsetek zapalonych okien o danej godzinie (0..24). */
export function litFraction(hour: number): number {
  const L = [.18, .12, .08, .06, .06, .12, .3, .32, .12, .04, .03, .03, .03, .03, .03, .04, .08, .25, .5, .62, .64, .58, .45, .28];
  const h = ((hour % 24) + 24) % 24, i = Math.floor(h), t = h - i; return L[i] + (L[(i + 1) % 24] - L[i]) * t;
}
