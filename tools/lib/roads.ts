// Ujednolicenie ulic (cała mapa naraz, po uproszczeniu):
//  1. szerokość jezdni z liczby pasów i klasy drogi (bez przypadkowych tagów width z OSM), co 0,5 m,
//  2. ciągi ulic: odcinki tej samej ulicy (nazwa, klasa, jednokierunkowość) połączone końcami, także przez granice kafli;
//     krótkie odcinki (< 80 m) o innej liczbie pasów przejmują ją od sąsiadów,
//  3. prawdziwa zmiana szerokości: na styku obie strony mają szerokość pośrednią (wa / wb), a jezdnia zwęża się
//     stopniowo na ok. 30 m (rysowanie: client/src/world/tiles/tileView.ts).
import { LANE_W } from '../../shared/src/tiles/build';
import type { TileBuilding, TileData, TileRoad } from '../../shared/src/tiles/types';

const len = (p: number[]) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
/**
 * Cztery standardowe szerokości jezdni (bez przypadkowych tagów width z OSM):
 * 1 pas 4,5 m (dojazdy, strefy zamieszkania, jednokierunkowe), 2 pasy 7 m, 3 pasy 10,5 m, 4 i więcej pasów 14 m.
 */
export const STD_W = [4.5, 7, 10.5, 14] as const;
export const stdWidth = (r: TileRoad) => { if (!LANE_W[r.k]) return r.w; const ln = Math.max(1, Math.min(4, r.ln)); return STD_W[ln - 1]; };

export function normalizeRoads(tiles: Map<string, TileData>): { roads: number; absorbed: number; tapers: number } {
  const roads: TileRoad[] = []; for (const t of tiles.values()) for (const r of t.r) if (LANE_W[r.k]) {
    // więcej niż 4 pasy w jednej jezdni: 4 (najszersza standardowa jezdnia)
    if (r.ln > 4) r.ln = 4; r.w = stdWidth(r); delete r.wa; delete r.wb; if (!r.br) roads.push(r);
  }
  // końce odcinków (zaokrąglone do 0,5 m) -> odcinki
  const key = (x: number, z: number) => Math.round(x * 2) + ',' + Math.round(z * 2);
  const ends = new Map<string, { r: TileRoad; e: 0 | 1 }[]>();
  for (const r of roads) for (const e of [0, 1] as const) { const i = e ? r.p.length - 2 : 0, k = key(r.p[i], r.p[i + 1]); let l = ends.get(k); if (!l) ends.set(k, l = []); l.push({ r, e }); }
  const same = (a: TileRoad, b: TileRoad) => a !== b && a.k === b.k && (a.n ?? '') === (b.n ?? '') && !!a.ow === !!b.ow;
  /** kontynuacja ulicy na końcu e odcinka r (dokładnie jeden pasujący odcinek) */
  const next = (r: TileRoad, e: 0 | 1) => { const i = e ? r.p.length - 2 : 0, l = (ends.get(key(r.p[i], r.p[i + 1])) ?? []).filter(q => same(r, q.r)); return l.length === 1 ? l[0] : null; };
  // krótkie odcinki przejmują liczbę pasów od sąsiadów
  let absorbed = 0;
  for (let pass = 0; pass < 3; pass++) for (const r of roads) {
    const L = len(r.p); if (L >= 80) continue;
    const a = next(r, 0), b = next(r, 1);
    const pick = a && b ? (a.r.ln === b.r.ln ? a.r.ln : len(a.r.p) >= len(b.r.p) ? a.r.ln : b.r.ln) : a && len(a.r.p) > L ? a.r.ln : b && len(b.r.p) > L ? b.r.ln : null;
    if (pick != null && pick !== r.ln) { r.ln = pick; r.w = stdWidth(r); absorbed++; }
  }
  // płynne przejścia na stykach różnych szerokości
  let tapers = 0;
  for (const r of roads) for (const e of [0, 1] as const) {
    const q = next(r, e); if (!q || Math.abs(q.r.w - r.w) < .3) continue;
    const m = Math.round((r.w + q.r.w) / 2 * 10) / 10;
    if (e) r.wb = m; else r.wa = m;
    tapers++;
  }
  return { roads: roads.length, absorbed, tapers: tapers / 2 };
}

// ---------------------------------------------------------------------------------------------------------------
// Wspólne: siatka budynków całej mapy (obrysy z dziedzińcami) do zapytań punkt-w-budynku.
type XZ = [number, number];
interface Bld { o: XZ[]; holes: XZ[][]; x0: number; z0: number; x1: number; z1: number; tile: string; b: TileBuilding; A: number }
const ringOf = (f: number[]): XZ[] => { const o: XZ[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const pip = (r: XZ[], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const areaOf = (r: XZ[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
class BldGrid {
  private cells = new Map<string, Bld[]>();
  constructor(tiles: Map<string, TileData>, private C = 40) {
    for (const [k, t] of tiles) for (const b of t.b) {
      if (b.part || b.mh >= .5) continue;
      const o = ringOf(b.o); let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const q: Bld = { o, holes: (b.i ?? []).map(ringOf), x0, z0, x1, z1, tile: k, b, A: areaOf(o) };
      for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) { const kk = cx + ',' + cz; let l = this.cells.get(kk); if (!l) this.cells.set(kk, l = []); l.push(q); }
    }
  }
  at(x: number, z: number): Bld | null {
    for (const q of this.cells.get(Math.floor(x / this.C) + ',' + Math.floor(z / this.C)) ?? []) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && pip(q.o, x, z) && !q.holes.some(h => pip(h, x, z))) return q;
    return null;
  }
  near(x: number, z: number, r: number): boolean {
    for (let cx = Math.floor((x - r) / this.C); cx <= Math.floor((x + r) / this.C); cx++) for (let cz = Math.floor((z - r) / this.C); cz <= Math.floor((z + r) / this.C); cz++)
      for (const q of this.cells.get(cx + ',' + cz) ?? []) if (x >= q.x0 - r && x <= q.x1 + r && z >= q.z0 - r && z <= q.z1 + r) return true;
    return false;
  }
}

/** budynek, przez który może prowadzić brama: kamienica, blok, kwartał, biurowiec, gmach (nie dom, garaż ani hala) */
const GATE_ST = new Set(['kam', 'blok', 'wsp', 'biuro', 'pub']);
const gateOk = (q: Bld) => q.b.h >= 6.5 && q.A >= 150 && (!q.b.st || GATE_ST.has(q.b.st)) && !['garage', 'garages', 'shed', 'industrial', 'warehouse', 'hangar', 'roof', 'carport', 'house', 'detached'].includes(q.b.t);
const GATE_ROAD = new Set(['service', 'residential', 'living', 'tertiary', 'pedestrian', 'unclassified']);

/**
 * Bramy przejazdowe: droga, która kończy się na ścianie budynku albo przechodzi przez budynek bez tagu
 * tunnel=building_passage, prowadzi zwykle bramą na podwórko lub na drugą stronę. Dla takich miejsc dodaje odcinek
 * przejazdu bramnego (bp) przez budynek (do wyjścia na podwórko / ulicę za budynkiem); w budynku powstaje otwór
 * z sienią (client/src/world/tiles/tileView.ts), a fizyka przepuszcza przez niego (shared/src/world/world.ts).
 * Odcinek bramy trafia do kafla budynku (tam wycina się otwór); bez węzłów grafu (ruch NPC go nie używa).
 */
export function inferPassages(tiles: Map<string, TileData>): { through: number; deadEnd: number } {
  const G = new BldGrid(tiles);
  const deg = new Map<number, number>();
  for (const t of tiles.values()) for (const r of t.r) for (let i = 1; i < r.j.length; i += 2) deg.set(r.j[i], (deg.get(r.j[i]) ?? 0) + 1);
  const add: { tile: string; r: TileRoad }[] = [];
  let through = 0, deadEnd = 0, nid = -1;
  const piece = (r: TileRoad, q: Bld, pts: XZ[]) => {
    const veh = !!LANE_W[r.k], w = veh ? Math.min(r.w, 3.6) : Math.min(r.w, 3);
    add.push({ tile: q.tile, r: { id: nid--, p: pts.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), k: r.k, w, ln: veh ? 1 : 0, bp: 1, ...(r.n ? { n: r.n } : {}), j: [] } });
  };
  /** od punktu (x, z) w kierunku (ux, uz): długość przejścia przez budynek q do wolnej przestrzeni (podwórko / ulica), null gdy za głęboko */
  const exitAlong = (q: Bld, x: number, z: number, ux: number, uz: number, max = 30): number | null => {
    for (let s = .25; s <= max; s += .25) { const b = G.at(x + ux * s, z + uz * s); if (b === q) continue; if (b) return null; // wprost w inny budynek: nie brama
      // wolne miejsce za budynkiem: 2,5 m bez budynku
      for (let e = .5; e <= 2.5; e += .5) if (G.at(x + ux * (s + e), z + uz * (s + e))) return null;
      return s; }
    return null;
  };
  for (const t of tiles.values()) for (const r of t.r) {
    if (r.bp || r.tu || r.br || !GATE_ROAD.has(r.k)) continue;
    const p = ringOf(r.p); if (p.length < 2) continue;
    // 1) droga przechodzi przez budynek (wejście i wyjście): odcinek bramy
    const step = .5; let inside: Bld | null = null, s0: XZ | null = null, run: XZ[] = [];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .01) continue;
      for (let s = 0; s < L; s += step) {
        const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L, q = G.at(x, z);
        if (q && !inside && s0) { inside = q; run = [s0]; }
        if (inside && q === inside) run.push([x, z]);
        else if (inside && q !== inside) {
          run.push([x, z]);
          let len = 0; for (let k = 1; k < run.length; k++) len += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
          if (len <= 32 && gateOk(inside)) { piece(r, inside, run.length > 2 ? [run[0], ...run.slice(1, -1).filter((_, k) => k % 6 === 0), run[run.length - 1]] : run); through++; }
          inside = null; run = [];
        }
        if (!q) s0 = [x, z];
      }
    }
    // 2) ślepy koniec na ścianie lub tuż przed nią: przedłużenie przez budynek
    for (const e of [0, 1] as const) {
      const i = e ? p.length - 1 : 0, ip = e ? p.length - 2 : 1, jv = e ? r.j[r.j.length - 2] : r.j[0], jn = e ? r.j[r.j.length - 1] : r.j[1];
      if (jv === i && (deg.get(jn) ?? 0) >= 2) continue; // koniec łączy się z inną drogą
      const P = p[i], Q = p[ip], L = Math.hypot(P[0] - Q[0], P[1] - Q[1]); if (L < .5) continue;
      const ux = (P[0] - Q[0]) / L, uz = (P[1] - Q[1]) / L;
      // wejście w ścianę: koniec w budynku (cofnij się do ściany) albo ściana do 5 m przed końcem
      let q: Bld | null = G.at(P[0], P[1]), ent: XZ | null = null;
      if (q) { let s = 0; while (s < 30 && G.at(P[0] - ux * s, P[1] - uz * s) === q) s += .25; if (s >= 30) continue; ent = [P[0] - ux * s, P[1] - uz * s]; }
      else for (let s = .25; s <= 5; s += .25) { const b = G.at(P[0] + ux * s, P[1] + uz * s); if (b) { q = b; ent = [P[0] + ux * (s - .25), P[1] + uz * (s - .25)]; break; } }
      if (!q || !ent || !gateOk(q)) continue;
      const d = exitAlong(q, ent[0], ent[1], ux, uz); if (d == null || d < 3) continue;
      // odcinek: od drogi przed ścianą przez sień na 3 m za budynek
      const back = Math.max(1.5, (ent[0] - P[0]) * ux + (ent[1] - P[1]) * uz + .5); // od końca drogi (bez przerwy w asfalcie)
      piece(r, q, [[ent[0] - ux * back, ent[1] - uz * back], [ent[0] + ux * (d + 3), ent[1] + uz * (d + 3)]]); deadEnd++;
    }
  }
  for (const { tile, r } of add) tiles.get(tile)!.r.push(r);
  return { through, deadEnd };
}

/**
 * Chodniki: w mieście (zabudowa w pobliżu) każda ulica ma chodniki po obu stronach, chyba że wzdłuż tej strony biegnie
 * już osobny chodnik / ścieżka z OSM. Drogi podmiejskie (bez zabudowy obok) zostają jak w OSM (chodnik albo brak).
 * Bez chodników: autostrady, drogi ekspresowe, dojazdy (service), strefy zamieszkania (wspólna nawierzchnia).
 */
const SW_ROAD = new Set(['primary', 'secondary', 'tertiary', 'residential']);
export function cityPavements(tiles: Map<string, TileData>): { urban: number; suburban: number; added: number } {
  const G = new BldGrid(tiles), C = 25, foot = new Map<string, number[][]>();
  for (const t of tiles.values()) for (const r of t.r) if (['footway', 'path', 'cycleway', 'pedestrian'].includes(r.k) && !r.tu) {
    const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) { const s = [p[i], p[i + 1], p[i + 2], p[i + 3]], k = Math.floor((s[0] + s[2]) / 2 / C) + ',' + Math.floor((s[1] + s[3]) / 2 / C); let l = foot.get(k); if (!l) foot.set(k, l = []); l.push(s); }
  }
  /** osobny chodnik równoległy do jezdni w punkcie (x, z) po stronie normalnej (nx, nz), w pasie [d0, d1] od osi */
  const footAt = (x: number, z: number, ux: number, uz: number, nx: number, nz: number, d0: number, d1: number) => {
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) for (const s of foot.get(a + ',' + b) ?? []) {
      const sx = s[2] - s[0], sz = s[3] - s[1], L = Math.hypot(sx, sz); if (L < 1) continue;
      if (Math.abs((sx * ux + sz * uz) / L) < .85) continue; // nie równoległy
      const t = Math.max(0, Math.min(1, ((x - s[0]) * sx + (z - s[1]) * sz) / (L * L))), px = s[0] + sx * t - x, pz = s[1] + sz * t - z;
      const along = Math.abs(px * ux + pz * uz); if (along > 2) continue;
      const d = px * nx + pz * nz; if (d >= d0 && d <= d1) return true;
    }
    return false;
  };
  let urban = 0, suburban = 0, added = 0;
  for (const t of tiles.values()) for (const r of t.r) {
    if (!SW_ROAD.has(r.k) || r.tu || r.bp) continue;
    const p = ringOf(r.p); let n = 0, built = 0; const side = [0, 0], sep = [0, 0];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .5) continue;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux; // normalna: lewa strona = -1 w rysowaniu (offsets)
      for (let s = L / 2 % 10; s < L; s += 10) {
        const x = a[0] + ux * s, z = a[1] + uz * s; n++;
        if (G.near(x, z, 45)) built++;
        for (const [k, sd] of [[0, -1], [1, 1]] as const) if (footAt(x, z, ux, uz, nx * sd, nz * sd, r.w / 2 - .5, r.w / 2 + 9)) sep[k]++;
        side[0]++; side[1]++;
      }
    }
    if (!n) continue;
    if (built / n < .5) { suburban++; continue; } // podmiejska: jak w OSM
    urban++;
    const old = r.sw ?? 0; let sw = 0;
    if (sep[0] / side[0] < .4) sw |= 1; if (sep[1] / side[1] < .4) sw |= 2;
    sw |= old; if (sw !== old) added++;
    if (sw) r.sw = sw; else delete r.sw;
  }
  return { urban, suburban, added };
}

/**
 * Jeden chodnik wzdłuż ulicy: osobne ścieżki (footway / path / cycleway) biegnące równolegle tuż obok jezdni
 * (OSM rysuje chodniki jako osobne linie) są usuwane, a ulica dostaje własny chodnik po tej stronie (sw).
 * Zostają ścieżki przez trawę, parki, podwórka, przejścia przez jezdnię i place. Potem znikają krótkie
 * ślepe resztki (< 40 m), które zostały po usunięciu równoległych odcinków.
 */
const pipXZ = (o: XZ[], x: number, z: number) => { let c = false; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, zi] = o[i], [xj, zj] = o[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
export function pruneSideFootways(tiles: Map<string, TileData>): { removed: number; stubs: number; sides: number } {
  const C = 25, segs = new Map<string, { r: TileRoad; s: number[] }[]>();
  for (const t of tiles.values()) for (const r of t.r) if (SW_ROAD.has(r.k) && !r.tu && !r.bp && !r.br) {
    const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) {
      const s = [p[i], p[i + 1], p[i + 2], p[i + 3]], L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < .5) continue;
      const x0 = Math.floor(Math.min(s[0], s[2]) / C), x1 = Math.floor(Math.max(s[0], s[2]) / C), z0 = Math.floor(Math.min(s[1], s[3]) / C), z1 = Math.floor(Math.max(s[1], s[3]) / C);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a + ',' + b; let l = segs.get(k); if (!l) segs.set(k, l = []); l.push({ r, s }); }
    }
  }
  /** ulica równoległa obok punktu (strona: 1 = lewa (-normalna w rysowaniu), 2 = prawa) */
  const roadBeside = (x: number, z: number, ux: number, uz: number): { r: TileRoad; side: number } | null => {
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) for (const { r, s } of segs.get(a + ',' + b) ?? []) {
      const sx = s[2] - s[0], sz = s[3] - s[1], L = Math.hypot(sx, sz);
      if (Math.abs((sx * ux + sz * uz) / L) < .85) continue;
      const t = ((x - s[0]) * sx + (z - s[1]) * sz) / (L * L); if (t < -.05 || t > 1.05) continue;
      const px = x - (s[0] + sx * t), pz = z - (s[1] + sz * t), nx = -sz / L, nz = sx / L, d = px * nx + pz * nz;
      if (Math.abs(d) >= r.w / 2 - .5 && Math.abs(d) <= r.w / 2 + 9) return { r, side: d < 0 ? 1 : 2 };
    }
    return null;
  };
  let removed = 0, stubs = 0, sides = 0;
  for (const t of tiles.values()) {
    const keep: TileRoad[] = [];
    // utwardzone place i parkingi: cała powierzchnia jest do chodzenia, ścieżki po nich niepotrzebne
    const paved = t.a.filter(a => a.k === 'square' || a.k === 'parking').map(a => ({ o: ringOf(a.o), i: (a.i ?? []).map(ringOf) }));
    const onPaved = (x: number, z: number) => paved.some(a => pipXZ(a.o, x, z) && !a.i.some(h => pipXZ(h, x, z)));
    for (const r of t.r) {
      if (!['footway', 'path', 'cycleway'].includes(r.k) || r.br || r.tu || r.bp) { keep.push(r); continue; }
      const p = ringOf(r.p); let tot = 0, near = 0; const hits: { r: TileRoad; side: number }[] = [];
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .3) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (let s = Math.min(1.5, L / 2); s < L; s += 3) {
          tot++; const x = a[0] + ux * s, z = a[1] + uz * s, h = roadBeside(x, z, ux, uz);
          if (h) { near++; hits.push(h); } else if (paved.length && onPaved(x, z)) near++;
        }
      }
      if (tot && near / tot >= .6) {
        removed++;
        for (const h of hits) { const o = h.r.sw ?? 0; if (!(o & h.side)) { h.r.sw = o | h.side; sides++; } }
      } else keep.push(r);
    }
    t.r = keep;
  }
  // ślepe resztki ścieżek po usunięciu (kilka przebiegów: łańcuchy krótkich odcinków)
  for (let pass = 0; pass < 3; pass++) {
    const deg = new Map<number, number>();
    for (const t of tiles.values()) for (const r of t.r) for (let i = 1; i < r.j.length; i += 2) deg.set(r.j[i], (deg.get(r.j[i]) ?? 0) + 1);
    let n = 0;
    for (const t of tiles.values()) t.r = t.r.filter(r => {
      if (!['footway', 'path', 'cycleway', 'steps'].includes(r.k) || r.br || r.tu || r.bp) return true;
      const p = ringOf(r.p); let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (L >= 40) return true;
      const last = p.length - 1, endIds = [0, last].map(v => { for (let i = 0; i < r.j.length; i += 2) if (r.j[i] === v) return r.j[i + 1]; return -1; });
      const dead = endIds.some(id => id < 0 || (deg.get(id) ?? 0) < 2);
      if (dead) { n++; return false; } return true;
    });
    stubs += n; if (!n) break;
  }
  return { removed, stubs, sides };
}
