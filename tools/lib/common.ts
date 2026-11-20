// Wspólne narzędzia skryptów: argumenty, projekcja odwrotna, zapis kafelków, Overpass z ponawianiem.
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CITIES, type CityKey } from '@miasto/shared/data/cities';
import { TILE_SIZE, TILE_VERSION, type TileData, type TileIndex } from '@miasto/shared/tiles/types';

export const ROOT = new URL('../..', import.meta.url).pathname;

/** Node 22 nie używa HTTPS_PROXY w fetch bez NODE_USE_ENV_PROXY=1: uruchom się ponownie z tą zmienną. */
export function ensureProxyEnv(): void {
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
    process.exit(r.status ?? 1);
  }
}

export function args(): Record<string, string> {
  const out: Record<string, string> = {}; const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); out[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; }
  return out;
}

export function cityArg(a: Record<string, string>): CityKey {
  const k = (a.city || 'warszawa') as CityKey; if (!CITIES[k]) throw new Error(`Nieznane miasto: ${a.city}`); return k;
}

/** Odwrotność projekcji miasta: metry -> [lat, lon]. */
export function unproj(o: [number, number], x: number, z: number): [number, number] {
  const kx = Math.cos(o[0] * Math.PI / 180) * 111320, ky = 110540;
  return [o[0] - z / ky, o[1] + x / kx];
}

/** Zapisuje kafelki (gzip) i index.json; usuwa stare kafelki z katalogu. */
export function writeTiles(city: string, tiles: Map<string, TileData>, outDir: string, source: string): TileIndex {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.endsWith('.json.gz')) rmSync(join(outDir, f));
  const index: TileIndex = { v: TILE_VERSION, city, size: TILE_SIZE, tiles: [], generated: new Date().toISOString(), source };
  for (const t of [...tiles.values()].sort((a, b) => a.x - b.x || a.y - b.y)) {
    if (!t.b.length && !t.r.length && !t.a.length && !t.l.length) continue;
    const gz = gzipSync(JSON.stringify(t), { level: 9 });
    writeFileSync(join(outDir, `${t.x}_${t.y}.json.gz`), gz);
    index.tiles.push([t.x, t.y, gz.length]);
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
  return index;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const DEFAULT_SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/**
 * Zapytanie Overpass z poszanowaniem limitów: ponawianie z rosnącą pauzą przy 429/504/błędach sieci,
 * przechodzenie na kolejny serwer. Zwraca sparsowany JSON.
 */
export async function overpass(query: string, servers: string[], log = console.log): Promise<unknown> {
  let wait = 10_000;
  for (let attempt = 0; attempt < servers.length * 3; attempt++) {
    const url = servers[attempt % servers.length];
    try {
      const res = await fetch(url, {
        method: 'POST', body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': 'moje-miasto-tools/0.1 (gra; skrypt do jednorazowego pobrania)', Accept: 'application/json' },
        signal: AbortSignal.timeout(300_000),
      });
      if (res.ok) return await res.json();
      log(`  ${new URL(url).host}: HTTP ${res.status}${res.status === 429 || res.status === 504 ? ' (serwer zajęty)' : ''}`);
    } catch (e) { log(`  ${new URL(url).host}: ${(e as Error).message}`); }
    log(`  ponowię za ${wait / 1000} s`); await sleep(wait); wait = Math.min(wait * 2, 120_000);
  }
  throw new Error('Overpass nie odpowiada (wszystkie serwery)');
}
