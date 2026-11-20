// Losowość z ziarnem (tekstowym). Ten sam ciąg na kliencie i serwerze.
export type Rng = () => number;

export function rng(str: string): Rng {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export type RGB = [number, number, number];
export const hex = (c: string): RGB => { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
export const mix = (a: RGB, k: number, b: RGB = [0, 0, 0]): RGB => [a[0] * k + b[0], a[1] * k + b[1], a[2] * k + b[2]];
