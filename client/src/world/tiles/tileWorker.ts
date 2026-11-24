// Wątek budowy kafli: liczy geometrię kafla (budynki, drogi, tereny, obiekty) poza wątkiem głównym, więc doczytywanie
// mapy nie przycina obrazu. Ma własny, lekki świat (teren i kafle) do wysokości gruntu i sprawdzania budynków.
import { World } from '@miasto/shared/world/world';
import { DemTile, Terrain } from '@miasto/shared/world/terrain';
import type { CityKey } from '@miasto/shared/data/cities';
import type { TileData } from '@miasto/shared/tiles/types';
import { computeTile, type TileBuildData } from './tileView';
import type { StopPoint } from './props';

export type TileWorkerIn =
  | { t: 'init'; city: CityKey; terrain: ArrayBuffer | null }
  | { t: 'build'; tile: TileData; stops: StopPoint[] }
  | { t: 'remove'; key: string };
export type TileWorkerOut = { t: 'built'; d: TileBuildData };

let world: World | null = null;

onmessage = (e: MessageEvent<TileWorkerIn>) => {
  const m = e.data;
  if (m.t === 'init') { world = new World(m.city, { terrain: m.terrain ? Terrain.parse(m.terrain) : null }); return; }
  if (!world) return;
  if (m.t === 'remove') { world.removeTile(m.key); return; }
  const t = m.tile, dem = t.dem as unknown as DemTile | undefined;
  if (dem) t.dem = new DemTile(dem.tx, dem.ty, dem.step, dem.n, dem.ref, dem.h);
  world.addTile(t);
  const d = computeTile(t, world.terrain ? world : null, world, m.stops);
  const transfer: ArrayBuffer[] = [];
  for (const L of d.layers) for (const v of Object.values(L.a)) transfer.push(v.array.buffer as ArrayBuffer);
  transfer.push(d.win.buffer as ArrayBuffer);
  for (const i of d.inst) { transfer.push(i.m.buffer as ArrayBuffer); if (i.c) transfer.push(i.c.buffer as ArrayBuffer); }
  (postMessage as (m: TileWorkerOut, t: ArrayBuffer[]) => void)({ t: 'built', d }, transfer);
};
