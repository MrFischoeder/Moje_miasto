// Wersja jednoplikowa: teren Warszawy i kafle centrum (tools/embed-tiles.mjs) wbudowane jako data URL.
// Londyn: płaski i bez kafli (pliki byłyby za duże).
import warszawa from '../../public/terrain/warszawa.bin.gz?url';
import warszawaTransit from '../../public/transit/warszawa.json.gz?url';
import warszawaAir from '../../public/air/warszawa.json?url';
export const EMBEDDED_TERRAIN: Record<string, string> = { warszawa };
const tiles = import.meta.glob('../../embedded/*/*.json.gz', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** miasto -> nazwa kafla (x_y) -> data URL */
export const EMBEDDED_TILES: Record<string, Record<string, string>> = {};
for (const [path, url] of Object.entries(tiles)) {
  const m = path.match(/embedded\/([^/]+)\/(-?\d+_-?\d+)\.json\.gz$/); if (!m) continue;
  (EMBEDDED_TILES[m[1]] ??= {})[m[2]] = url;
}
/** rozkłady jazdy Warszawy */
export const EMBEDDED_TRANSIT: Record<string, string> = { warszawa: warszawaTransit };
/** lotniska Warszawy */
export const EMBEDDED_AIR: Record<string, string> = { warszawa: warszawaAir };
