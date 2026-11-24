// Własne modele landmarków (data/landmarks/<miasto>.json, budowane przez tools/landmarks.ts):
// budynek z OSM i jego części w obrysie modelu nie są rysowane, w ich miejscu powstaje model.
import wroclaw from '../../../../../data/landmarks/wroclaw.json';
import type { ModelSink, Frame } from './sink';
import { buildRatusz } from './ratusz';

export interface LandmarkModel { model: string; name: string; id: number; frame: Frame; ring: number[] }
export const MODELS: Record<string, LandmarkModel[]> = { wroclaw: (wroclaw as unknown as { models: LandmarkModel[] }).models };
export const BUILDERS: Record<string, (S: ModelSink, f: Frame) => void> = { ratusz: buildRatusz };

export function insideFlat(o: number[], x: number, z: number): boolean {
  let s = false; const n = o.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = o[i * 2], zi = o[i * 2 + 1], xj = o[j * 2], zj = o[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) s = !s; }
  return s;
}
export function centroidFlat(o: number[]): [number, number] { let x = 0, z = 0; for (let i = 0; i < o.length; i += 2) { x += o[i]; z += o[i + 1]; } return [x / (o.length / 2), z / (o.length / 2)]; }
