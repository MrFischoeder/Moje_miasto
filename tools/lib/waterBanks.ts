// Nabrzeża i tafla wody (teren z NMT + obrysy wody z OSM):
//  - poziom tafli wody w kaflu (mediana NMT w głębi wody, wygładzona między kaflami): woda płaska, nie „wspina się” na skarpy,
//  - dno pod wodą obniżone (teren nie przebija tafli), przy nabrzeżach głęboko (stroma ściana koryta za murem),
//  - nabrzeża miejskie (zabudowa lub ulice w pobliżu, brzeg co najmniej 0,8 m nad wodą): korona nabrzeża w wierzchołkach
//    obrysu (mediana terenu 6–14 m od brzegu, wygładzona wzdłuż brzegu); teren 1,2–7 m od brzegu wyrównany do korony.
//    Mur i bruk rysuje client/src/world/tiles/tileView.ts po gładkim obrysie z OSM; fizyka: pas bruku jako pomost (world.ts).
// Oryginalny NMT: kopia w .cache/terrain-orig/<miasto> (narzędzie można uruchamiać wielokrotnie).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DemTile, Terrain } from '../../shared/src/world/terrain';
import { LANE_W } from '../../shared/src/tiles/build';
import { TILE_SIZE, type TileData } from '../../shared/src/tiles/types';

type XZ = [number, number];
const ring = (f: number[]): XZ[] => { const o: XZ[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const pip = (r: XZ[], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const median = (a: number[]) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function bakeWaterBanks(root: string, city: string, tiles: Map<string, TileData>): { tiles: number; quayVerts: number; demTiles: number } | null {
  const dir = join(root, 'client/public/terrain', city), orig = join(root, '.cache/terrain-orig', city), tf = join(root, 'client/public/terrain', `${city}.bin.gz`);
  if (!existsSync(dir) || !existsSync(tf)) return null;
  const marker = join(dir, '.nabrzeza');
  if (!existsSync(orig)) {
    if (existsSync(marker)) { console.warn(`nabrzeża: brak kopii oryginalnego NMT w ${orig} (teren już przetworzony) — pomijam`); return null; }
    mkdirSync(join(root, '.cache/terrain-orig'), { recursive: true }); cpSync(dir, orig, { recursive: true });
  }
  const tb = gunzipSync(readFileSync(tf)), coarse = Terrain.parse(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const dem = new Map<string, DemTile>();
  for (const f of readdirSync(orig)) if (f.endsWith('.bin.gz')) { const b = gunzipSync(readFileSync(join(orig, f))); const t = DemTile.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); dem.set(t.tx + '_' + t.ty, t); }
  /** wysokość w układzie gry z oryginalnego NMT */
  // LiDAR jako ogólny wzór: teren wygładzony (średnia 5×5 punktów siatki 4 m, dwa razy ≈ okno 20 m), z sąsiednimi kaflami na brzegach
  {
    const raw = (x: number, z: number) => { const t = dem.get(Math.floor(x / TILE_SIZE) + '_' + Math.floor(z / TILE_SIZE)); if (t) { const v = t.sample(x, z); if (!Number.isNaN(v)) return v + t.ref - coarse.ref; } return coarse.coarse(x, z); };
    const R = 2, sm = new Map<string, Float32Array>();
    for (const [k, t] of dem) {
      const n = t.n, s = t.step, N = n + 2 * R, off = t.ref - coarse.ref, A = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ii = i - R, jj = j - R; A[j * N + i] = ii >= 0 && jj >= 0 && ii < n && jj < n && !Number.isNaN(t.h[jj * n + ii]) ? t.h[jj * n + ii] + off : raw(t.x0 + ii * s, t.z0 + jj * s); }
      const B = new Float32Array(N * N);
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let a = 0, c = 0; for (let d = -R; d <= R; d++) { const q = i + d; if (q >= 0 && q < N) { a += A[j * N + q]; c++; } } B[j * N + i] = a / c; }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let a = 0, c = 0; for (let d = -R; d <= R; d++) { const q = j + d; if (q >= 0 && q < N) { a += B[q * N + i]; c++; } } A[j * N + i] = a / c; }
      }
      const h = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = A[(j + R) * N + i + R] - off;
      sm.set(k, h);
    }
    for (const [k, h] of sm) { const t = dem.get(k)!; dem.set(k, new DemTile(t.tx, t.ty, t.step, t.n, t.ref, h)); }
  }
  const H = (x: number, z: number) => { const t = dem.get(Math.floor(x / TILE_SIZE) + '_' + Math.floor(z / TILE_SIZE)); if (t) { const v = t.sample(x, z); if (!Number.isNaN(v)) return v + t.ref - coarse.ref; } return coarse.coarse(x, z); };

  // --- woda: wielokąty w kaflach, krawędzie brzegu (bez krawędzi cięcia kafli) ---
  interface Edge { a: XZ; b: XZ; tile: string; area: number; ring: number; i: number }
  const C = 16, eg = new Map<string, Edge[]>(), isBox = (t: TileData, p: XZ, q: XZ) => {
    const x0 = t.x * TILE_SIZE, z0 = t.y * TILE_SIZE, x1 = x0 + TILE_SIZE, z1 = z0 + TILE_SIZE, e = .05;
    return (Math.abs(p[0] - q[0]) < e && (Math.abs(p[0] - x0) < e || Math.abs(p[0] - x1) < e)) || (Math.abs(p[1] - q[1]) < e && (Math.abs(p[1] - z0) < e || Math.abs(p[1] - z1) < e));
  };
  /** małe zbiorniki (fontanny, oczka wodne): bez obróbki terenu i poziomu wody – rysowane jako niecki fontann */
  const areaOf = (f: number[]) => { let s = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; s += f[i] * f[j + 1] - f[j] * f[i + 1]; } return Math.abs(s) / 2; };
  const small = (a: { o: number[] }) => areaOf(a.o) < 1500;
  const inWater = (x: number, z: number) => { const t = tiles.get(Math.floor(x / TILE_SIZE) + '_' + Math.floor(z / TILE_SIZE)); if (!t) return false; for (const a of t.a) if (a.k === 'water' && !small(a) && pip(ring(a.o), x, z) && !(a.i ?? []).some(h => pip(ring(h), x, z))) return true; return false; };
  for (const [k, t] of tiles) t.a.forEach((a, ai) => {
    if (a.k !== 'water' || small(a)) return;
    [a.o, ...(a.i ?? [])].forEach((f, ri) => { const R = ring(f); for (let i = 0; i < R.length; i++) {
      const p = R[i], q = R[(i + 1) % R.length]; if (isBox(t, p, q)) continue;
      const e: Edge = { a: p, b: q, tile: k, area: ai, ring: ri, i };
      for (let gx = Math.floor(Math.min(p[0], q[0]) / C) - 1; gx <= Math.floor(Math.max(p[0], q[0]) / C) + 1; gx++) for (let gz = Math.floor(Math.min(p[1], q[1]) / C) - 1; gz <= Math.floor(Math.max(p[1], q[1]) / C) + 1; gz++) { const kk = gx + ',' + gz; let l = eg.get(kk); if (!l) eg.set(kk, l = []); l.push(e); }
    } });
  });
  /** najbliższa krawędź brzegu do 12 m: odległość, krawędź i parametr t */
  const nearEdge = (x: number, z: number) => {
    let best: { d: number; e: Edge; u: number } | null = null;
    for (const e of eg.get(Math.floor(x / C) + ',' + Math.floor(z / C)) ?? []) {
      const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - e.a[0]) * dx + (z - e.a[1]) * dz) / L2)), d = Math.hypot(e.a[0] + dx * u - x, e.a[1] + dz * u - z);
      if (d < 12 && (!best || d < best.d)) best = { d, e, u };
    }
    return best;
  };
  // --- poziom wody w kaflu: mediana NMT w głębi wody (> 8 m od brzegu), potem mediana z sąsiadów ---
  const raw = new Map<string, number>();
  for (const [k, t] of tiles) {
    if (!t.a.some(a => a.k === 'water')) continue; const v: number[] = [], all: number[] = [];
    const x0 = t.x * TILE_SIZE, z0 = t.y * TILE_SIZE;
    for (let x = x0 + 2; x < x0 + TILE_SIZE; x += 6) for (let z = z0 + 2; z < z0 + TILE_SIZE; z += 6) {
      if (!inWater(x, z)) continue; const h = H(x, z); all.push(h); const ne = nearEdge(x, z); if (!ne || ne.d > 8) v.push(h);
    }
    const m = v.length >= 12 ? median(v) : all.length ? Math.min(...all) : NaN; if (!Number.isNaN(m)) raw.set(k, m);
  }
  const level = new Map<string, number>();
  for (const [k] of raw) { const [x, y] = k.split('_').map(Number), n: number[] = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const v = raw.get((x + i) + '_' + (y + j)); if (v != null) n.push(v); } level.set(k, median(n)); }

  // --- miejskość brzegu: budynki i jezdnie w pobliżu (siatka 32 m) ---
  const urban = new Set<string>(); const U = 32, mark = (x: number, z: number) => { for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) urban.add((Math.floor(x / U) + i) + ',' + (Math.floor(z / U) + j)); };
  for (const t of tiles.values()) { for (const b of t.b) mark(b.o[0], b.o[1]); for (const r of t.r) if (LANE_W[r.k]) for (let i = 0; i < r.p.length; i += 2) mark(r.p[i], r.p[i + 1]); }
  const isUrban = (x: number, z: number) => urban.has(Math.floor(x / U) + ',' + Math.floor(z / U));

  // --- korona nabrzeża w wierzchołkach obrysu ---
  let quayVerts = 0;
  for (const [k, t] of tiles) {
    const wl = level.get(k);
    for (const a of t.a) {
      if (a.k !== 'water') continue;
      if (wl == null || small(a)) { delete a.wl; delete a.qt; delete a.qk; continue; }
      a.wl = r2(wl);
      const rings = [a.o, ...(a.i ?? [])].map(ring);
      const inThis = (x: number, z: number) => pip(rings[0], x, z) && !rings.slice(1).some(h => pip(h, x, z));
      const kinds: number[][] = [];
      a.qt = rings.map(R => {
        const raw = R.map((p, i): [number, boolean] | null => {
          const pr = R[(i - 1 + R.length) % R.length], nx_ = R[(i + 1) % R.length];
          let nx = -(nx_[1] - pr[1]), nz = nx_[0] - pr[0]; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
          if (inThis(p[0] + nx * 1.5, p[1] + nz * 1.5)) { nx = -nx; nz = -nz; } // normalna w stronę lądu
          if (inWater(p[0] + nx * 3, p[1] + nz * 3)) return null;
          const hs: number[] = []; for (let d = 6; d <= 14; d += 2) hs.push(H(p[0] + nx * d, p[1] + nz * d));
          const top = Math.max(median(hs), wl + .6); // niski brzeg: też gładki (skarpa albo mur), nie po siatce terenu
          return [top, isUrban(p[0] + nx * 8, p[1] + nz * 8)]; // miasto: mur z brukiem; poza miastem: skarpa
        });
        // wygładzenie wzdłuż brzegu (±3 wierzchołki z koroną); pojedyncze wierzchołki bez korony między nabrzeżami: uzupełnione
        const kk: number[] = [];
        const out = raw.map((v, i) => {
          const n: number[] = []; let walls = 0; for (let d = -3; d <= 3; d++) { const q = raw[(i + d + raw.length) % raw.length]; if (q) { n.push(q[0]); if (q[1]) walls++; } }
          if (!v && n.length < 4) { kk.push(0); return 0; }
          quayVerts++; kk.push(walls * 2 >= n.length ? 1 : 2); return r2(n.reduce((s, q) => s + q, 0) / n.length);
        });
        kinds.push(kk); return out;
      });
      a.qk = kinds;
      if (!a.qk.some(r => r.some(v => v))) { delete a.qt; delete a.qk; }
    }
  }
  // korona na krawędzi (interpolacja między wierzchołkami)
  /** czy krawędź to mur (miasto), a nie skarpa */
  const isWall = (e: Edge) => { const q = tiles.get(e.tile)!.a[e.area].qk?.[e.ring]; return !!q && (q[e.i] === 1 || q[(e.i + 1) % q.length] === 1); };
  const crown = (e: Edge, u: number): number | null => { const a = tiles.get(e.tile)!.a[e.area], q = a.qt?.[e.ring], k = a.qk?.[e.ring]; if (!q || !k) return null; const j = (e.i + 1) % q.length; return k[e.i] && k[j] ? q[e.i] + (q[j] - q[e.i]) * u : null; };

  // --- mosty: ląd pod pomostem i przy końcach mostów zostaje bez zmian (wysokość pomostu liczy się z gruntu
  //     na końcach mostu: obniżenie terenu przy murze robiło dziurę przed wjazdem) ---
  const BG = 16, bgrid = new Map<string, { a: XZ; b: XZ; r: number; end?: boolean }[]>();
  const addB = (a: XZ, b: XZ, r: number, end = false) => { const s = { a, b, r, end }; for (let gx = Math.floor((Math.min(a[0], b[0]) - r) / BG); gx <= Math.floor((Math.max(a[0], b[0]) + r) / BG); gx++) for (let gz = Math.floor((Math.min(a[1], b[1]) - r) / BG); gz <= Math.floor((Math.max(a[1], b[1]) + r) / BG); gz++) { const k = gx + ',' + gz; let l = bgrid.get(k); if (!l) bgrid.set(k, l = []); l.push(s); } };
  for (const t of tiles.values()) {
    for (const r of t.r) if (r.br) { const p = ring(r.p); for (let i = 0; i + 1 < p.length; i++) addB(p[i], p[i + 1], r.w / 2 + 8); if (r.bw) { addB([r.bw[0], r.bw[1]], [r.bw[0], r.bw[1]], 18, true); addB([r.bw[2], r.bw[3]], [r.bw[2], r.bw[3]], 18, true); } }
    for (const l of t.l) if (l.br) { const p = ring(l.p); for (let i = 0; i + 1 < p.length; i++) addB(p[i], p[i + 1], 9); if (l.bw) { addB([l.bw[0], l.bw[1]], [l.bw[0], l.bw[1]], 18, true); addB([l.bw[2], l.bw[3]], [l.bw[2], l.bw[3]], 18, true); } }
  }
  const nearBridge = (x: number, z: number, endOnly = false) => (bgrid.get(Math.floor(x / BG) + ',' + Math.floor(z / BG)) ?? []).some(s => { if (endOnly && !s.end) return false; const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, u = L2 ? Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2)) : 0; return Math.hypot(s.a[0] + dx * u - x, s.a[1] + dz * u - z) < s.r; });

  // --- nasypy przy końcach mostów: koniec mostu na wysokości drogi dojazdowej (15 m dalej), łagodny wjazd ---
  interface Emb { E: XZ; u: XZ; hw: number; hEnd: number; hApp: number }
  const embs: Emb[] = [], embSeen = new Set<string>();
  for (const t of tiles.values()) for (const q of [...t.r.map(r => ({ bw: r.bw, hw: r.w / 2 + (r.sw ? 2.5 : 0) + 1.5 })), ...t.l.map(l => ({ bw: l.bw, hw: 3.5 }))]) {
    const bw = q.bw; if (!bw) continue;
    for (const [ex, ez, ox, oz] of [[bw[0], bw[1], bw[2], bw[3]], [bw[2], bw[3], bw[0], bw[1]]]) {
      const key = Math.round(ex) + ',' + Math.round(ez) + ',' + Math.round(q.hw); if (embSeen.has(key)) continue; embSeen.add(key);
      const L = Math.hypot(ex - ox, ez - oz); if (L < 8) continue; const u: XZ = [(ex - ox) / L, (ez - oz) / L];
      const hApp = H(ex + u[0] * 15, ez + u[1] * 15), hEnd = Math.max(H(ex, ez), hApp);
      embs.push({ E: [ex, ez], u, hw: q.hw, hEnd, hApp });
    }
  }
  /** wysokość nasypu w punkcie (NaN poza nasypem): od końca mostu (−6 m w głąb mostu) do 15 m na zewnątrz */
  const embAt = (x: number, z: number) => { let best = NaN; for (const e of embs) { if (Math.abs(x - e.E[0]) > 30 || Math.abs(z - e.E[1]) > 30) continue;
    const dx = x - e.E[0], dz = z - e.E[1], tt = dx * e.u[0] + dz * e.u[1], lat = Math.abs(dx * e.u[1] - dz * e.u[0]); if (tt < -6 || tt > 15 || lat > e.hw) continue;
    const h = tt <= 0 ? e.hEnd : e.hEnd + (e.hApp - e.hEnd) * tt / 15; if (!(h <= best)) best = h; } return best; };

  // --- przetworzenie NMT ---
  let demTiles = 0, nan = 0; const done = new Map<string, DemTile>(); // teren po obróbce (wysokości końców mostów)
  for (const [k, t] of dem) {
    const [tx, ty] = k.split('_').map(Number); let touched = false;
    const has = [-1, 0, 1].some(i => [-1, 0, 1].some(j => level.has((tx + i) + '_' + (ty + j))));
    if (!has) { writeFileSync(join(dir, `${k}.bin.gz`), gzipSync(Buffer.from(t.encode()))); done.set(k, t); continue; } // bez wody: wygładzony teren
    const h = t.h.slice(), n = t.n, s = t.step, off = t.ref - coarse.ref;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = t.x0 + i * s, z = t.z0 + j * s, idx = j * n + i;
      const ne = nearEdge(x, z), wet = inWater(x, z);
      if (Number.isNaN(h[idx])) { if (!wet && !ne) continue; h[idx] = coarse.coarse(x, z) - off; nan++; } // brak danych NMT (często nad wodą): bez tego gra bierze teren zgrubny, wyższy od tafli
      const wl = level.get(Math.floor(x / TILE_SIZE) + '_' + Math.floor(z / TILE_SIZE)) ?? (ne ? level.get(ne.e.tile) : undefined); if (wl == null) continue;
      const top = ne ? crown(ne.e, ne.u) : null, cur = h[idx] + off;
      let v = cur;
      const wall = top != null && isWall(ne!.e);
      const emb = embAt(x, z);
      if (!Number.isNaN(emb)) { if (emb > cur) { h[idx] = emb - off; touched = true; } continue; } // nasyp wjazdu na most
      if (nearBridge(x, z, wet)) continue; // przy moście (ląd) i przy jego końcach (także w wodzie): oryginalny teren
      if (wet) v = Math.min(cur, wl - (wall && ne!.d < 7 ? 12 : ne && ne.d < 6 ? 4 : 1.6)); // dno: przy brzegu głęboko (stromy skos tuż przy linii brzegu)
      else if (wall && ne!.d < 1.2) v = Math.min(cur, wl - 12);    // tuż przy murze (pod brukiem, który ma własną fizykę): bez skosu nad wodę
      else if (top != null && ne!.d < 4 && !wall) v = wl - .4 + (top - wl + .4) * Math.min(1, (ne!.d + .3) / 4.3); // skarpa: teren wzdłuż jej spadku
      else if (top != null && ne!.d < 7) v = top;                          // pas nabrzeża / korona skarpy: równo z koroną
      else if (ne && ne.d < 4) v = Math.max(cur, wl + .15);        // brzeg naturalny: ląd przy wodzie nie niżej niż tafla (bez „dziur”)
      if (v !== cur) { h[idx] = v - off; touched = true; }
    }
    if (touched || nan) { const nt = new DemTile(t.tx, t.ty, t.step, t.n, t.ref, h); writeFileSync(join(dir, `${k}.bin.gz`), gzipSync(Buffer.from(nt.encode()))); done.set(k, nt); demTiles++; }
    else { writeFileSync(join(dir, `${k}.bin.gz`), gzipSync(Buffer.from(t.encode()))); done.set(k, t); } // wygładzony teren
  }
  // wysokości końców mostów zapisane w danych (bw[7], bw[8]): pomost liczony tak samo u klienta i na serwerze,
  // niezależnie od kolejności wczytywania kafli (koniec mostu bywa w sąsiednim kaflu)
  const HF = (x: number, z: number) => { const t = done.get(Math.floor(x / TILE_SIZE) + '_' + Math.floor(z / TILE_SIZE)); if (t) { const v = t.sample(x, z); if (!Number.isNaN(v)) return v + t.ref - coarse.ref; } return coarse.coarse(x, z); };
  for (const t of tiles.values()) for (const q of [...t.r, ...t.l]) if (q.bw && q.bw.length >= 7) { q.bw.length = 7; q.bw.push(r2(HF(q.bw[0], q.bw[1])), r2(HF(q.bw[2], q.bw[3]))); }
  // nabrzeża (mur, bruk) nie wchodzą pod most i na jego wjazd
  for (const t of tiles.values()) for (const a of t.a) if (a.qk) a.qk = a.qk.map((K, ri) => { const f = ri ? a.i![ri - 1] : a.o; return K.map((k, i) => k && nearBridge(f[2 * i], f[2 * i + 1]) ? 0 : k); });
  console.log(`nabrzeża: uzupełnione punkty bez danych NMT przy wodzie: ${nan}`);
  writeFileSync(marker, 'teren przetworzony przez tools/lib/waterBanks.ts; oryginał w .cache/terrain-orig\n');
  return { tiles: level.size, quayVerts, demTiles };
}
