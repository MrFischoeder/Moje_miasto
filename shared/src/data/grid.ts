// Współrzędne do testów i orientacji: szerokość/długość geograficzna oraz siatka kratek mapy 500 × 500 m
// (zgodna z kaflami): kolumny literami od zachodu (A, B, … Z, AA, AB, …), wiersze liczbami od północy, np. „K12”.
import type { CityData } from './cities';
import { makeProj } from './projection';

export const GRID = 500;
export interface GridDef { x0: number; z0: number; cols: number; rows: number }

/** punkt gry (x na wschód, z na południe) -> [lat, lon] */
export function unprojPoint(o: [number, number], x: number, z: number): [number, number] {
  const kx = Math.cos(o[0] * Math.PI / 180) * 111320, ky = 110540;
  return [o[0] - z / ky, o[1] + x / kx];
}

/** Siatka miasta: obszar z data/cities.json (pole area) albo sieć metra z zapasem 6 km. */
export function gridOf(city: CityData): GridDef {
  const pr = makeProj(city.o); let x0: number, z0: number, x1: number, z1: number;
  if (city.area) { const [s, w, n, e] = city.area; [x0, z0] = pr(n, w); [x1, z1] = pr(s, e); }
  else {
    const p = city.st.map(s => pr(s[1], s[2])), M = 6000;
    x0 = Math.min(...p.map(q => q[0])) - M; x1 = Math.max(...p.map(q => q[0])) + M; z0 = Math.min(...p.map(q => q[1])) - M; z1 = Math.max(...p.map(q => q[1])) + M;
  }
  x0 = Math.floor(x0 / GRID) * GRID; z0 = Math.floor(z0 / GRID) * GRID;
  return { x0, z0, cols: Math.ceil((x1 - x0) / GRID), rows: Math.ceil((z1 - z0) / GRID) };
}

/** litery kolumny: 0 -> A, 25 -> Z, 26 -> AA */
export function colName(i: number): string { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function colIndex(s: string): number { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

/** nazwa kratki dla punktu (poza siatką: kratki ujemne zapisane z „-”) */
export function cellName(g: GridDef, x: number, z: number): string {
  const c = Math.floor((x - g.x0) / GRID), r = Math.floor((z - g.z0) / GRID);
  return (c >= 0 ? colName(c) : '-' + colName(-c - 1)) + (r + 1);
}

/** środek kratki z nazwy („K12”, wielkość liter dowolna) albo null */
export function cellCenter(g: GridDef, name: string): [number, number] | null {
  const m = name.trim().toUpperCase().match(/^([A-Z]{1,3})\s*(\d{1,3})$/); if (!m) return null;
  return [g.x0 + (colIndex(m[1]) + .5) * GRID, g.z0 + (+m[2] - .5) * GRID];
}

/** Tekst wpisany przez gracza: kratka („K12”) albo współrzędne („51.1097, 17.0328”) -> punkt gry */
export function parsePlace(city: CityData, g: GridDef, text: string): [number, number] | null {
  const c = cellCenter(g, text); if (c) return c;
  const m = text.replace(/[°NEne]/g, ' ').match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/); if (!m) return null;
  const lat = +m[1].replace(',', '.'), lon = +m[2].replace(',', '.'); if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  return makeProj(city.o)(lat, lon);
}

export const fmtLatLon = (ll: [number, number]) => `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
