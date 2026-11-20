// Wczytywanie rozkładów jazdy (public/transit/<miasto>.json.gz; w wersji jednoplikowej wbudowane).
import type { TransitData } from '@miasto/shared/transit/timetable';
import { EMBEDDED_TRANSIT } from './embedded';

const cache = new Map<string, Promise<TransitData | null>>();

async function fetchTransit(url: string): Promise<TransitData | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if (buf[0] !== 0x7b) return null; // nie JSON (np. strona HTML)
    return JSON.parse(new TextDecoder().decode(buf)) as TransitData;
  } catch { return null; }
}

export function loadTransit(city: string): Promise<TransitData | null> {
  const emb = EMBEDDED_TRANSIT[city];
  if (!emb && location.protocol === 'file:') return Promise.resolve(null);
  let p = cache.get(city); if (!p) cache.set(city, p = fetchTransit(emb || `${import.meta.env.BASE_URL}transit/${city}.json.gz`));
  return p;
}
