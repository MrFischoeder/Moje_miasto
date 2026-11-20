// Pobiera z Overpass API dane miasta (budynki, ulice, tereny, tory, stacje, sklepy) w paczkach 1 × 1 km
// i buduje kafelki 500 × 500 m w client/public/tiles/<miasto>/.
//
//   npm run fetch-osm -- --city warszawa                 # 2 km wokół środka miasta
//   npm run fetch-osm -- --city londyn --radius 3000
//   npm run fetch-osm -- --city warszawa --area metro    # cały obszar sieci metra (+1 km), długo!
//   opcje: --server URL (można kilka po przecinku), --pause 3 (s między zapytaniami), --refresh (bez pamięci podręcznej)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '@miasto/shared/data/cities';
import { makeProj } from '@miasto/shared/data/projection';
import { parseOverpass, RawOsm } from '@miasto/shared/osm/raw';
import { buildTiles } from '@miasto/shared/tiles/build';
import { TILE_SIZE } from '@miasto/shared/tiles/types';
import { args, cityArg, DEFAULT_SERVERS, ensureProxyEnv, overpass, ROOT, sleep, unproj, writeTiles } from './lib/common';

ensureProxyEnv();
const a = args(), key = cityArg(a), city = CITIES[key], proj = makeProj(city.o);
const servers = a.server ? a.server.split(',') : process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : DEFAULT_SERVERS;
const pause = +(a.pause || 3) * 1000, CHUNK = 2 * TILE_SIZE;

// obszar w metrach
let x0: number, z0: number, x1: number, z1: number;
if (a.area === 'metro') {
  const pts = city.st.map(s => proj(s[1], s[2]));
  x0 = Math.min(...pts.map(p => p[0])) - 1000; x1 = Math.max(...pts.map(p => p[0])) + 1000;
  z0 = Math.min(...pts.map(p => p[1])) - 1000; z1 = Math.max(...pts.map(p => p[1])) + 1000;
} else { const r = +(a.radius || 2000); x0 = -r; z0 = -r; x1 = r; z1 = r; }
const c0 = Math.floor(x0 / CHUNK), c1 = Math.floor((x1 - 1) / CHUNK), d0 = Math.floor(z0 / CHUNK), d1 = Math.floor((z1 - 1) / CHUNK);
const total = (c1 - c0 + 1) * (d1 - d0 + 1);
console.log(`${city.name}: obszar ${((x1 - x0) / 1000).toFixed(1)} × ${((z1 - z0) / 1000).toFixed(1)} km, paczek ${total}, serwery: ${servers.join(', ')}`);

const QUERY = (s: number, w: number, n: number, e: number) => `[out:json][timeout:240][bbox:${s},${w},${n},${e}];
(
  way["building"]; way["building:part"]; relation["building"]["type"="multipolygon"];
  way["highway"];
  way["railway"~"^(rail|tram|light_rail|subway|narrow_gauge)$"];
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|reservoir|basin|flowerbed)$"];
  way["leisure"~"^(park|garden|dog_park|pitch|playground|track|sports_centre)$"];
  way["natural"~"^(water|wood|scrub|grassland|heath)$"]; way["waterway"="riverbank"]; way["water"];
  way["amenity"~"^(parking|grave_yard)$"]; way["place"="square"];
  relation["type"="multipolygon"]["landuse"]; relation["type"="multipolygon"]["leisure"];
  relation["type"="multipolygon"]["natural"]; relation["type"="multipolygon"]["water"];
  relation["type"="multipolygon"]["waterway"="riverbank"]; relation["type"="multipolygon"]["place"="square"];
  node["railway"~"^(subway_entrance|station|tram_stop)$"]; node["public_transport"="station"];
  node["highway"~"^(traffic_signals|crossing|stop|give_way|street_lamp)$"]; node["crossing"];
  node["shop"]; node["amenity"]; node["craft"]; node["office"]; way["shop"]; way["amenity"];
  node["addr:housenumber"];
);
out geom qt;`;

const cacheDir = join(ROOT, '.cache/osm', key); mkdirSync(cacheDir, { recursive: true });
const raw = new RawOsm(); let n = 0;
for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
  n++; const file = join(cacheDir, `${cx}_${cz}.json`);
  let j: unknown;
  if (existsSync(file) && !a.refresh) j = JSON.parse(readFileSync(file, 'utf8'));
  else {
    const [n0, w0] = unproj(city.o, cx * CHUNK, cz * CHUNK), [s0, e0] = unproj(city.o, (cx + 1) * CHUNK, (cz + 1) * CHUNK);
    const t0 = Date.now(); console.log(`[${n}/${total}] paczka ${cx},${cz} …`);
    j = await overpass(QUERY(s0, w0, n0, e0), servers);
    writeFileSync(file, JSON.stringify(j));
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(JSON.stringify(j).length / 1e6).toFixed(1)} MB`);
    await sleep(pause);
  }
  raw.merge(parseOverpass(j));
}
console.log(`dane: węzłów ${raw.nodes.size}, dróg ${raw.ways.size}, relacji ${raw.relations.size}`);
const t0 = Date.now();
const tiles = buildTiles(raw, key, city.o, { range: [Math.floor(x0 / TILE_SIZE), Math.floor(z0 / TILE_SIZE), Math.floor((x1 - 1) / TILE_SIZE), Math.floor((z1 - 1) / TILE_SIZE)] });
const out = join(ROOT, 'client/public/tiles', key), idx = writeTiles(key, tiles, out, 'OpenStreetMap (Overpass API), © współtwórcy OpenStreetMap, ODbL');
let b = 0, r = 0, p = 0; for (const t of tiles.values()) { b += t.b.length; r += t.r.length; p += t.poi.length; }
const bytes = idx.tiles.reduce((s, t) => s + t[2], 0);
console.log(`kafelki: ${idx.tiles.length} (${(bytes / 1e6).toFixed(1)} MB gzip) w ${((Date.now() - t0) / 1000).toFixed(1)} s · budynki ${b} · drogi ${r} · punkty ${p} -> ${out}`);
