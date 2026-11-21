// Wersja jednoplikowa (gra bez serwera, otwierana z dysku): teren, kafle centrum, rozkłady komunikacji i lotniska
// Warszawy (ok. 4 km wokół Świętokrzyskiej) i Londynu (ok. 3 km wokół Oxford Circus), wbudowane jako data URL.
// Kafle wybiera tools/embed-tiles.mjs (client/embedded/<miasto>/).
import warszawa from '../../public/terrain/warszawa.bin.gz?url';
import londyn from '../../public/terrain/londyn.bin.gz?url';
import warszawaTransit from '../../public/transit/warszawa.json.gz?url';
import londynTransit from '../../public/transit/londyn.json.gz?url';
import warszawaAir from '../../public/air/warszawa.json?url';
import londynAir from '../../public/air/londyn.json?url';
export const EMBEDDED_TERRAIN: Record<string, string> = { warszawa, londyn };
const tiles = import.meta.glob('../../embedded/*/*.json.gz', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** miasto -> nazwa kafla (x_y) -> data URL */
export const EMBEDDED_TILES: Record<string, Record<string, string>> = {};
for (const [path, url] of Object.entries(tiles)) {
  const m = path.match(/embedded\/([^/]+)\/(-?\d+_-?\d+)\.json\.gz$/); if (!m) continue;
  (EMBEDDED_TILES[m[1]] ??= {})[m[2]] = url;
}
/** rozkłady jazdy */
export const EMBEDDED_TRANSIT: Record<string, string> = { warszawa: warszawaTransit, londyn: londynTransit };
/** lotniska */
export const EMBEDDED_AIR: Record<string, string> = { warszawa: warszawaAir, londyn: londynAir };
