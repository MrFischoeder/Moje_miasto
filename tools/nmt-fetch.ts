// Pobieranie arkuszy NMT (GUGiK, numeryczny model terenu, siatka 1 m) dla obszaru miasta z serwera opendata Geoportalu.
// Lista arkuszy ze skorowidza (WMS GetFeatureInfo w siatce punktów), dla każdego godła najnowszy arkusz ze skaningu
// laserowego (LiDAR) w układzie PL-1992; arkusze przeliczane od razu do siatki 2 m (średnia 2 × 2), żeby nie trzymać
// gigabajtów danych. Wynik: .cache/nmt/<miasto>/<godło>.asc, dalej:
//   npx tsx tools/nmt-fetch.ts --city wroclaw [--par 4]
//   npx tsx tools/nmt-import.ts --city wroclaw --src .cache/nmt/wroclaw --step 4
// Dane: Główny Urząd Geodezji i Kartografii (udostępniane bezpłatnie, ustawa Pgik art. 40a).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITIES } from '../shared/src/data/cities';
import { toPL1992 } from './lib/nmt';
import { ensureProxyEnv } from './lib/common';

ensureProxyEnv();

const ROOT = new URL('..', import.meta.url).pathname, argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const key = (arg('city', 'wroclaw') ?? 'wroclaw') as keyof typeof CITIES, city = CITIES[key] as unknown as { name: string; o: [number, number]; area?: [number, number, number, number] };
const PAR = +(arg('par', '4') ?? 4), out = join(ROOT, '.cache/nmt', key); mkdirSync(out, { recursive: true });
if (!city?.area) { console.error('Miasto bez pola area w data/cities.json'); process.exit(1); }
const WMS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/WMS/SkorowidzeUkladEVRF2007';
const LAYERS = ['SkorowidzeNMT2026', 'SkorowidzeNMT2025', 'SkorowidzeNMT2024', 'SkorowidzeNMT2023iStarsze'];

interface Sheet { url: string; godlo: string; aktualnosc: string; uklad: string; res: string; zr: string }

async function get(url: string, tries = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(240_000) }); if (r.ok) return r; if (i >= tries) throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (i >= tries) throw e; }
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
}
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
  let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const i = k++; await fn(items[i], i); } }));
}

// --- 1. skorowidz: punkty co 1,2 km w prostokącie obszaru (PL-1992) ---
const [s, w, n, e] = city.area, a = toPL1992(s, w), b = toPL1992(n, e), corners = [a, b, toPL1992(s, e), toPL1992(n, w)];
const E0 = Math.min(...corners.map(c => c[0])) - 300, E1 = Math.max(...corners.map(c => c[0])) + 300, N0 = Math.min(...corners.map(c => c[1])) - 300, N1 = Math.max(...corners.map(c => c[1])) + 300;
const pts: [number, number][] = []; for (let x = E0; x <= E1; x += 1200) for (let y = N0; y <= N1; y += 1200) pts.push([x, y]);
const listFile = join(out, 'arkusze.json');
let sheets: Sheet[] = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : [];
if (!sheets.length) {
  console.log(`${city.name}: skorowidz w ${pts.length} punktach…`);
  const all = new Map<string, Sheet>(); let done = 0;
  await pool(pts, 6, async ([x, y]) => {
    // EPSG:2180 w WMS 1.3.0: oś pierwsza = północ (x geodezyjne), druga = wschód
    const bbox = `${y - 50},${x - 50},${y + 50},${x + 50}`;
    for (const L of LAYERS) {
      const u = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${L}&QUERY_LAYERS=${L}&CRS=EPSG:2180&BBOX=${bbox}&WIDTH=10&HEIGHT=10&I=5&J=5&INFO_FORMAT=text/html&FEATURE_COUNT=20`;
      let html = ''; try { html = await (await get(u)).text(); } catch { continue; }
      for (const m of html.matchAll(/push\(\{url:"([^"]+)",godlo:"([^"]+)", aktualnosc:"([^"]+)", format:"[^"]*", charakterystykaPrzestrzenna:"([^"]+)"[^}]*?ukladWspolrzednychPoziomych:"([^"]+)"[^}]*?zrDanych:"([^"]+)"/g))
        all.set(m[1], { url: m[1], godlo: m[2], aktualnosc: m[3], res: m[4], uklad: m[5], zr: m[6] });
    }
    if (++done % 40 === 0) console.log(`  ${done}/${pts.length}, arkuszy ${all.size}`);
  });
  // najlepszy arkusz dla godła: PL-1992 (siatka 1:5000), skaning laserowy, najnowszy
  const best = new Map<string, Sheet>();
  for (const sh of all.values()) {
    if (sh.uklad !== 'PL-1992') continue;
    const cur = best.get(sh.godlo), score = (q: Sheet) => (q.zr.startsWith('Skaning') ? '1' : '0') + q.aktualnosc;
    if (!cur || score(sh) > score(cur)) best.set(sh.godlo, sh);
  }
  sheets = [...best.values()].sort((p, q) => p.godlo.localeCompare(q.godlo));
  writeFileSync(listFile, JSON.stringify(sheets, null, 1));
}
console.log(`arkuszy do pobrania: ${sheets.length} (LiDAR: ${sheets.filter(q => q.zr.startsWith('Skaning')).length}), lat: ${[...new Set(sheets.map(q => q.aktualnosc.slice(0, 4)))].sort().join(', ')}`);

// --- 2. pobieranie i przeliczenie do siatki 2 m ---
let ok = 0, t0 = Date.now();
await pool(sheets, PAR, async sh => {
  const dst = join(out, sh.godlo + '.asc'); if (existsSync(dst)) { ok++; return; }
  let text: string;
  try { text = await (await get(sh.url)).text(); } catch (err) { console.log(`  ${sh.godlo}: błąd pobierania (${(err as Error).message})`); return; }
  const lines = text.split('\n'), hdr: Record<string, number> = {}; let i = 0;
  for (; i < 8; i++) { const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.]+)/); if (!m) break; hdr[m[1].toLowerCase()] = +m[2]; }
  const nc = hdr.ncols, nr = hdr.nrows, cs = hdr.cellsize, nd = hdr.nodata_value ?? -9999;
  const x0 = hdr.xllcenter ?? (hdr.xllcorner + cs / 2), y0 = hdr.yllcenter ?? (hdr.yllcorner + cs / 2);
  const mc = Math.floor(nc / 2), mr = Math.floor(nr / 2), sum = new Float64Array(mc * mr), cnt = new Uint8Array(mc * mr);
  for (let r = 0; r < nr; r++) {
    const row = lines[i + r]; if (!row) break; const vals = row.trim().split(/\s+/), rr = Math.floor(r / 2); if (rr >= mr) continue;
    for (let c = 0; c < nc; c++) { const v = +vals[c], cc = Math.floor(c / 2); if (cc >= mc || !(v > nd + 1)) continue; sum[rr * mc + cc] += v; cnt[rr * mc + cc]++; }
  }
  // wiersze od północy; nowy środek lewej dolnej komórki: średnia z dolnego wiersza par
  const rowsBelow = nr - 2 * mr; // pominięty wiersz u dołu (nieparzysta liczba)
  const o: string[] = [`ncols ${mc}`, `nrows ${mr}`, `xllcenter ${(x0 + cs / 2).toFixed(2)}`, `yllcenter ${(y0 + rowsBelow * cs + cs / 2).toFixed(2)}`, `cellsize ${(2 * cs).toFixed(2)}`, `nodata_value -9999`];
  for (let r = 0; r < mr; r++) { const a2: string[] = []; for (let c = 0; c < mc; c++) { const k = r * mc + c; a2.push(cnt[k] ? (sum[k] / cnt[k]).toFixed(2) : '-9999'); } o.push(a2.join(' ')); }
  writeFileSync(dst, o.join('\n') + '\n'); ok++;
  console.log(`  [${ok}/${sheets.length}] ${sh.godlo} (${sh.aktualnosc}, ${sh.zr}) ${((Date.now() - t0) / 1000).toFixed(0)} s`);
});
console.log(`gotowe: ${ok}/${sheets.length} arkuszy w ${out}`);
