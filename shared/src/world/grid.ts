// Siatka przestrzenna dla kolizji i regionów chodzenia.
export const CELL = 40;
export const cellKey = (x: number, z: number): string => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
