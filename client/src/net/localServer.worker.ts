// Gra jednoosobowa: lokalny serwer (ten sam pokój co serwer sieciowy) w Web Workerze.
import { Room } from '@miasto/shared/server/room';
import { World, type OsmPoint } from '@miasto/shared/world/world';
import { Terrain } from '@miasto/shared/world/terrain';
import { SIM_DT } from '@miasto/shared/sim/loop';
import { tileKey, type TileData } from '@miasto/shared/tiles/types';
import type { CityKey } from '@miasto/shared/data/cities';
import type { WorkerIn } from './transport';
import type { TransitData } from '@miasto/shared/transit/timetable';

export interface LocalInit {
  city: CityKey; name: string;
  /** dane terenu (już pobrane przez grę) */
  terrain: ArrayBuffer | null;
  /** kafelki z pliku OSM albo adres katalogu kafelków */
  tiles: TileData[] | null; tilesBase: string | null; osmPoints: OsmPoint[] | null;
  /** rozkłady jazdy (już wczytane przez grę) */
  transit: TransitData | null;
}

let room: Room | null = null, pid: number | null = null;
const send = (d: ArrayBuffer | string) => { if (typeof d === 'string') postMessage(d); else postMessage(d, { transfer: [d] }); };

async function gunzip(b: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(b); if (u[0] !== 0x1f || u[1] !== 0x8b) return b;
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function init(o: LocalInit): Promise<void> {
  const terrain = o.terrain ? Terrain.parse(o.terrain) : null;
  const world = new World(o.city, { terrain, tiles: o.tiles ?? undefined, osmPoints: o.osmPoints ?? undefined });
  let avail = new Set<string>();
  if (o.tiles) avail = new Set(o.tiles.map(t => tileKey(t.x, t.y)));
  else if (o.tilesBase) try { const r = await fetch(o.tilesBase + 'index.json'); if (r.ok) { const ix = await r.json(); for (const [x, y] of ix.tiles) avail.add(tileKey(x, y)); } } catch { /* brak kafelków */ }
  const mem = new Map((o.tiles || []).map(t => [tileKey(t.x, t.y), t]));
  room = new Room('local', world, {
    has: (x, y) => avail.has(tileKey(x, y)),
    load: async (x, y) => {
      const m = mem.get(tileKey(x, y)); if (m) return m;
      const r = await fetch(`${o.tilesBase}${tileKey(x, y)}.json.gz`); if (!r.ok) return null;
      return JSON.parse(new TextDecoder().decode(await gunzip(await r.arrayBuffer()))) as TileData;
    },
  }, { local: true, maxPlayers: 1 }, () => performance.now());
  if (o.transit) room.setTransit(o.transit);
  room.enableTraffic();
  pid = room.join({ send, close: () => close() }, o.name);
  let last = performance.now(), acc = 0;
  setInterval(() => {
    const now = performance.now(); acc += Math.min(.25, (now - last) / 1000); last = now;
    while (acc >= SIM_DT) { acc -= SIM_DT; room!.tick(); }
  }, 1000 / 60);
}

onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.t === 'init') init(m.init as LocalInit);
  else if (m.t === 'msg' && room && pid != null) room.message(pid, m.d);
};
