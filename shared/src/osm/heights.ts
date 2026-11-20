// Wysokość budynków z tagów OSM.
import type { Tags } from './features';

export const num = (v: string | undefined | null): number | null => {
  if (v == null) return null; const s = String(v); const f = parseFloat(s.replace(',', '.'));
  if (!isFinite(f)) return null; return /'|ft/.test(s) ? f * .3048 : f;
};
export const LOW: Record<string, number> = { house: 6, detached: 6, semidetached_house: 7, terrace: 8, bungalow: 4, garage: 3, garages: 3, shed: 3, hut: 3, roof: 4, carport: 3, kiosk: 3, service: 4 };
export const MID: Record<string, number> = { apartments: 15, office: 20, commercial: 14, retail: 8, church: 20, cathedral: 35, hotel: 22, university: 16, hospital: 18, school: 10, industrial: 10, warehouse: 9 };
export const LEVEL_H = 3.2, ROOF_LEVEL_H = 2.5;

/** h = wysokość dachu, mh = wysokość dolnej krawędzi bryły (min_height). */
export function heightOf(t: Tags): { h: number; mh: number } {
  const lv = num(t['building:levels']); let h = num(t.height) ?? num(t['building:height']);
  if (h == null && lv != null) h = lv * LEVEL_H + (num(t['roof:levels']) || 0) * ROOF_LEVEL_H;
  if (h == null) h = LOW[t.building] ?? MID[t.building] ?? 9;
  let mh = num(t.min_height); const ml = num(t['building:min_level']);
  if (mh == null && ml != null) mh = ml * LEVEL_H; mh = mh || 0; if (h <= mh) h = mh + 3;
  return { h, mh };
}
