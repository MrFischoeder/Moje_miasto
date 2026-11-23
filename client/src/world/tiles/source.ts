// Źródła kafelków: pliki z serwera (public/tiles/<miasto>/) albo pamięć (wczytany plik OSM).
import { tileKey, type TileData, type TileIndex } from '@miasto/shared/tiles/types';
import { DemHttp, gunzipWeb } from '../demLoad';

export interface TileSource {
  /** dostępne kafelki (null = brak danych) */
  index(): Promise<TileIndex | null>;
  load(x: number, y: number): Promise<TileData | null>;
}

/** Rozpakowuje gzip, jeśli serwer nie zrobił tego sam. */
async function readJson(res: Response): Promise<unknown> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

export class HttpTileSource implements TileSource {
  /** dokładny teren (public/terrain/<miasto>/), dołączany do kafla */
  private dem: DemHttp | null;
  constructor(private base: string, demBase: string | null = null) { this.dem = demBase ? new DemHttp(demBase, gunzipWeb) : null; }
  async index(): Promise<TileIndex | null> {
    try { const r = await fetch(this.base + 'index.json'); if (!r.ok) return null; return await r.json() as TileIndex; } catch { return null; }
  }
  async load(x: number, y: number): Promise<TileData | null> {
    try {
      const [r, dem] = await Promise.all([fetch(`${this.base}${tileKey(x, y)}.json.gz`), this.dem?.load(x, y) ?? null]); if (!r.ok) return null;
      const t = await readJson(r) as TileData; if (dem) t.dem = dem; return t;
    } catch { return null; }
  }
}

export class MemoryTileSource implements TileSource {
  constructor(private tiles: Map<string, TileData>, private city: string) {}
  async index(): Promise<TileIndex> {
    return { v: 1, city: this.city, size: 500, tiles: [...this.tiles.values()].map(t => [t.x, t.y, 0]), generated: '', source: 'plik' };
  }
  async load(x: number, y: number): Promise<TileData | null> { return this.tiles.get(tileKey(x, y)) ?? null; }
}

export class NoTiles implements TileSource {
  async index(): Promise<null> { return null; }
  async load(): Promise<null> { return null; }
}

/** Kafel z adresu (także data URL wbudowanej wersji). */
export async function decodeTile(url: string): Promise<TileData> { return await readJson(await fetch(url)) as TileData; }
