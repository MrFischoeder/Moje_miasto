// Miejsca startu: najważniejsze, rozległe miejsca miasta, w których gracz może zacząć grę (menu → „Zacznij w…”).
// Punkty na otwartej przestrzeni (place, ulice), nie w budynkach.
import { CITIES, type CityKey } from '../data/cities';
import { makeProj } from '../data/projection';

export interface Spawn { name: string; lat: number; lon: number }

export const SPAWNS: Partial<Record<CityKey, Spawn[]>> = {
  wroclaw: [
    { name: 'Rynek (centrum)', lat: 51.11065, lon: 17.0320 },
    { name: 'Dworzec Główny', lat: 51.0990, lon: 17.0352 },
    { name: 'Ostrów Tumski', lat: 51.1139, lon: 17.0441 },
    { name: 'Plac Grunwaldzki', lat: 51.1120, lon: 17.0605 },
    { name: 'Plac Strzegomski (Szczepin)', lat: 51.1129, lon: 17.0059 },
    { name: 'Nadodrze', lat: 51.1240, lon: 17.0360 },
    { name: 'Krzyki (pl. Powstańców Śląskich)', lat: 51.0935, lon: 17.0140 },
    { name: 'Psie Pole', lat: 51.1470, lon: 17.1130 },
  ],
};

/** Miejsca startu miasta we współrzędnych gry (x na wschód, z na południe). */
export function spawnsOf(city: string): { name: string; x: number; z: number }[] {
  const list = SPAWNS[city as CityKey]; if (!list) return [];
  const proj = makeProj(CITIES[city as CityKey].o);
  return list.map(s => { const [x, z] = proj(s.lat, s.lon); return { name: s.name, x: Math.round(x), z: Math.round(z) }; });
}
