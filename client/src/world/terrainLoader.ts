// Wczytywanie modelu terenu (public/terrain/<miasto>.bin.gz). Brak pliku = świat płaski.
import { Terrain } from '@miasto/shared/world/terrain';
import { EMBEDDED_TERRAIN } from './embedded';

const cache = new Map<string, Promise<Terrain | null>>();

async function fetchTerrain(url: string): Promise<Terrain | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 4)) !== 'MMT1') return null; // np. strona HTML zamiast pliku
    return Terrain.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch { return null; }
}

export function loadTerrain(city: string): Promise<Terrain | null> {
  const emb = EMBEDDED_TERRAIN[city];
  if (!emb && location.protocol === 'file:') return Promise.resolve(null);
  let p = cache.get(city); if (!p) cache.set(city, p = fetchTerrain(emb || `${import.meta.env.BASE_URL}terrain/${city}.bin.gz`));
  return p;
}
