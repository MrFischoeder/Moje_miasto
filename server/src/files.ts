// Dane miasta z dysku (te same pliki, które pobiera klient): teren i kafelki z client/public.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { CityKey } from '@miasto/shared/data/cities';
import { DemTile, Terrain } from '@miasto/shared/world/terrain';
import { tileKey, type TileData, type TileIndex } from '@miasto/shared/tiles/types';
import type { TileLoader } from '@miasto/shared/server/room';
import type { TransitData } from '@miasto/shared/transit/timetable';

export const ROOT = new URL('../..', import.meta.url).pathname;
const PUB = join(ROOT, 'client/public');

export function loadTerrain(city: CityKey): Terrain | null {
  const f = join(PUB, 'terrain', `${city}.bin.gz`); if (!existsSync(f)) return null;
  const b = gunzipSync(readFileSync(f)); return Terrain.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function tileLoader(city: CityKey): TileLoader | null {
  const dir = join(PUB, 'tiles', city), ix = join(dir, 'index.json'); if (!existsSync(ix)) return null;
  const idx = JSON.parse(readFileSync(ix, 'utf8')) as TileIndex, have = new Set(idx.tiles.map(([x, y]) => tileKey(x, y)));
  return {
    has: (x, y) => have.has(tileKey(x, y)),
    load: async (x, y) => {
      const t = JSON.parse(gunzipSync(await readFile(join(dir, `${tileKey(x, y)}.json.gz`))).toString('utf8')) as TileData;
      const df = join(PUB, 'terrain', city, `${tileKey(x, y)}.bin.gz`); // dokładny teren (tools/nmt-import.ts)
      if (existsSync(df)) { const b = gunzipSync(await readFile(df)); t.dem = DemTile.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
      return t;
    },
  };
}

/** Rozkłady jazdy (tools/gtfs-build.py). */
export function loadTransit(city: CityKey): TransitData | null {
  const f = join(PUB, 'transit', `${city}.json.gz`); if (!existsSync(f)) return null;
  return JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) as TransitData;
}
