// Wygląd budynku z tagów OSM (Simple 3D Buildings): kształt i wysokość dachu, kolory, materiał ścian.
// Wynik trafia do kafla (pola rs, rh, ro, rc, bc, bm), a gra buduje z tego bryłę dachu i kolor ścian.
import type { Tags } from './features';
import { num, ROOF_LEVEL_H } from './heights';

const SHAPES = new Set(['gabled', 'hipped', 'half-hipped', 'pyramidal', 'dome', 'onion', 'cone', 'skillion', 'mansard', 'gambrel', 'round', 'saltbox']);
const MATERIAL: Record<string, string> = {
  brick: 'brick', bricks: 'brick', stone: 'stone', sandstone: 'stone', limestone: 'stone', granite: 'stone', marble: 'stone',
  plaster: 'plaster', concrete: 'concrete', glass: 'glass', metal: 'metal', steel: 'metal', copper: 'copper', wood: 'wood', timber_framing: 'wood',
};
/** nazwy kolorów spotykane w OSM -> hex */
const NAMED: Record<string, string> = {
  red: '#a8432e', darkred: '#7a2a1e', brown: '#7a4a32', maroon: '#6e2a22', orange: '#c8713a', yellow: '#e0c060', beige: '#d8c8a0', tan: '#c8a878',
  white: '#e8e6e0', ivory: '#ece6d4', grey: '#8a8a88', gray: '#8a8a88', lightgrey: '#b8b8b4', lightgray: '#b8b8b4', darkgrey: '#555555', darkgray: '#555555',
  silver: '#b0b4b8', black: '#2a2a2a', green: '#5f8a5a', darkgreen: '#3d5e3a', lightgreen: '#9cc48c', blue: '#4a6a9a', lightblue: '#9ab8d8', navy: '#2a3a5a',
  pink: '#d8a0a0', salmon: '#d89078', gold: '#c8a848', olive: '#7a7a4a', teal: '#4a8a88', turquoise: '#5ab0a8', cream: '#ece0c0',
};

export function colorHex(v?: string): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('');
  return NAMED[s];
}

export interface Look { rs?: string; rh?: number; ro?: 'across'; rc?: string; bc?: string; bm?: string; wd?: string; hist?: 1 }

export function lookOf(t: Tags, h: number, mh: number): Look {
  const out: Look = {};
  const shape = t['roof:shape']; if (shape && SHAPES.has(shape)) out.rs = shape;
  if (out.rs) {
    let rh = num(t['roof:height']); if (rh == null && t['roof:levels'] != null) rh = (num(t['roof:levels']) || 0) * ROOF_LEVEL_H;
    if (rh != null && rh > 0) out.rh = Math.round(Math.min(rh, (h - mh) * .9) * 10) / 10;
    if (t['roof:orientation'] === 'across') out.ro = 'across';
  }
  const rc = colorHex(t['roof:colour'] || t['roof:color']); if (rc) out.rc = rc;
  const bc = colorHex(t['building:colour'] || t['building:color'] || t.colour); if (bc) out.bc = bc;
  const bm = MATERIAL[(t['building:material'] || '').toLowerCase()]; if (bm) out.bm = bm;
  if (t.wikidata) out.wd = t.wikidata;
  if (t.historic || t.heritage || t['building:architecture'] === 'gothic') out.hist = 1;
  return out;
}

/** Pomnik / rzeźba z tagów punktu: rodzaj albo null (tablice pamiątkowe i drobne obiekty pomijane). */
export function monumentKind(t: Tags): string | null {
  if (t.historic === 'monument') return 'monument';
  if (t.historic === 'memorial') {
    const m = t.memorial || '';
    if (['plaque', 'blue_plaque', 'stolperstein', 'grave', 'ghost_bike', 'tree', 'bench', 'war_grave'].includes(m)) return null;
    return m || 'memorial';
  }
  if (t.tourism === 'artwork') {
    const a = t.artwork_type || '';
    if (['statue', 'sculpture', 'bust', 'installation', 'fountain', 'dwarf'].includes(a)) return a; // dwarf: wrocławskie krasnale
    return null;
  }
  return null;
}
