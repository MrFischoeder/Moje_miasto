// Wczytywanie kafli terenu w wysokiej rozdzielczości (public/terrain/<miasto>/<x>_<y>.bin.gz + index.json),
// wspólne dla klienta, lokalnego serwera w wątku i serwera sieciowego (każdy dołącza teren do kafla mapy).
import { tileKey } from '@miasto/shared/tiles/types';
import { DemTile } from '@miasto/shared/world/terrain';

export interface DemIndex { v: number; city: string; step: number; source: string; licence: string; generated: string; tiles: [number, number][] }

/** Źródło kafli terenu przez HTTP (fetch); brak indeksu = brak dokładnego terenu. */
export class DemHttp {
  private have: Promise<Set<string>>;
  constructor(private base: string, private gunzip: (b: ArrayBuffer) => Promise<ArrayBuffer>) {
    this.have = fetch(base + 'index.json').then(r => r.ok ? r.json() : null).then((ix: DemIndex | null) => new Set((ix?.tiles ?? []).map(([x, y]) => tileKey(x, y)))).catch(() => new Set<string>());
  }
  async load(x: number, y: number): Promise<DemTile | null> {
    if (!(await this.have).has(tileKey(x, y))) return null;
    try {
      const r = await fetch(`${this.base}${tileKey(x, y)}.bin.gz`); if (!r.ok) return null;
      let b = await r.arrayBuffer(); const u = new Uint8Array(b); if (u[0] === 0x1f && u[1] === 0x8b) b = await this.gunzip(b);
      return DemTile.parse(b);
    } catch { return null; }
  }
}

/** Rozpakowanie gzip w przeglądarce / wątku (DecompressionStream). */
export async function gunzipWeb(b: ArrayBuffer): Promise<ArrayBuffer> {
  return await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
