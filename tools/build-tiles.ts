// Buduje kafelki z lokalnego pliku OSM (Overpass JSON lub GeoJSON, np. eksport z overpass-turbo).
//   npm run build-tiles -- --in mapa.json [--city warszawa] [--out katalog]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES, cityAt, type CityKey } from '@miasto/shared/data/cities';
import { parseOsmJson } from '@miasto/shared/osm/raw';
import { buildTiles } from '@miasto/shared/tiles/build';
import { args, ROOT, writeTiles } from './lib/common';

const a = args(); if (!a.in) throw new Error('Podaj plik: --in mapa.json');
const raw = parseOsmJson(JSON.parse(readFileSync(a.in, 'utf8')));
const key = (a.city as CityKey) || cityAt(...raw.center()); if (!key || !CITIES[key]) throw new Error('Plik nie leży w znanym mieście; podaj --city');
const tiles = buildTiles(raw, key, CITIES[key].o);
const out = a.out || join(ROOT, 'client/public/tiles', key), idx = writeTiles(key, tiles, out, a.in);
console.log(`${CITIES[key].name}: kafelki ${idx.tiles.length} -> ${out}`);
