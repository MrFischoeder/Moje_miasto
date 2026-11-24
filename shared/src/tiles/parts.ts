// Budynki opisane częściami (building:part): obrys całego budynku nie jest rysowany, gdy części pokrywają
// co najmniej połowę jego powierzchni – zastępują go (ściany, dach, wnętrza liczone z części).
import type { TileData } from './types';

const area = (f: number[]) => { let a = 0; for (let i = 0, n = f.length; i < n; i += 2) { const j = (i + 2) % n; a += f[i] * f[j + 1] - f[j] * f[i + 1]; } return Math.abs(a) / 2; };
const inside = (f: number[], x: number, z: number) => { let s = false; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) { const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; } return s; };

/** Funkcja: czy obrys (płaska tablica x, z) jest zastąpiony przez części budynku z tego kafla. */
export function partsCover(t: TileData): (o: number[]) => boolean {
  const parts = t.b.filter(b => b.part).map(b => { let x = 0, z = 0; const n = b.o.length / 2; for (let i = 0; i < b.o.length; i += 2) { x += b.o[i]; z += b.o[i + 1]; } return { x: x / n, z: z / n, A: area(b.o) }; });
  if (!parts.length) return () => false;
  return o => { let A = 0; for (const p of parts) if (inside(o, p.x, p.z)) A += p.A; return A >= .5 * area(o); };
}
