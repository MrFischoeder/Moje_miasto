// Dane metra miast (źródło: data/cities.json, budowane przez data/prep.py).
import raw from '../../../data/cities.json';

export interface MetroLine { n: string; c: string; d: [number, number] }
/** [nazwa, szerokość, długość] */
export type StationRow = [string, number, number];
/** [indeks stacji A, indeks stacji B, indeks linii] */
export type EdgeRow = [number, number, number];

export interface CityData {
  name: string;
  /** środek projekcji [lat, lon] */
  o: [number, number];
  spawn: string;
  note: string;
  lines: MetroLine[];
  st: StationRow[];
  ed: EdgeRow[];
  /** wejścia do metra z OSM: [indeks stacji, lat, lon] (tools/update-stations.ts) */
  ent?: [number, number, number][];
  /** stacje z prawdziwą pozycją z OSM */
  osm?: number[];
}

export type CityKey = 'warszawa' | 'londyn';
export const CITIES = raw as unknown as Record<CityKey, CityData>;
export const CITY_KEYS = Object.keys(CITIES) as CityKey[];

/** Rozpoznaje miasto po środku danych (do 60 km od środka). */
export function cityAt(lat: number, lon: number): CityKey | null {
  let best: CityKey | null = null, bd = 60;
  for (const k of CITY_KEYS) {
    const o = CITIES[k].o, d = Math.hypot((lat - o[0]) * 111, (lon - o[1]) * 111 * Math.cos(lat * Math.PI / 180));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
