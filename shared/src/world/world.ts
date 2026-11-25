// Świat statyczny miasta: metro (zawsze całe) i kafelki z OSM (doładowywane wokół graczy).
// Powstaje deterministycznie z danych miasta i plików kafelków, więc serwer i każdy klient
// mają identyczny świat bez przesyłania go przez sieć.
import { CITIES, type CityData, type CityKey } from '../data/cities';
import { makeProj, normName, type Proj } from '../data/projection';
import type { Tags } from '../osm/features';
import { Activity } from './activity';
import { TILE_SIZE, tileKey, type Flat, type TileData } from '../tiles/types';
import { CAR_PTS, PolyIndex, type XZ } from './collision';
import { RegionIndex, type Region, type Support, type Surface } from './regions';
import { buildMetroLayout, type MetroLayout, type Station } from './metro/layout';
import { Terrain } from './terrain';
import { deckY } from './bridges';
import { Interiors } from '../interiors/interiors';

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; reg: Region | null }

export interface WorldOptions {
  /** model terenu (bez niego świat jest płaski) */
  terrain?: Terrain | null;
  /** kafelki dostępne od razu (np. z wczytanego pliku), przed zbudowaniem metra */
  tiles?: Iterable<TileData>;
  /** punkty stacji i wejść z wczytanego pliku OSM (przesuwają stacje i zejścia) */
  osmPoints?: OsmPoint[];
}
export interface OsmPoint { lat: number; lon: number; tags: Tags }

export const toXZ = (f: Flat): XZ[] => { const out: XZ[] = []; for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]); return out; };

export class World implements Surface {
  readonly key: CityKey;
  readonly city: CityData;
  readonly proj: Proj;
  /** budynki stojące na gruncie (przeszkody) */
  readonly buildings = new PolyIndex();
  /** woda (nie da się po niej chodzić ani jeździć) */
  readonly water = new PolyIndex();
  /** pomosty: jezdnie mostów nad wodą */
  readonly decks = new PolyIndex();
  readonly regions = new RegionIndex();
  /** wnętrza budynków (generowane przy graczach) */
  readonly interiors: Interiors = new Interiors(this);
  readonly tiles = new Map<string, TileData>();
  /** ożywienie miejsc (gęstość pieszych i aut NPC) */
  readonly activity = new Activity(this.tiles);
  readonly metro: MetroLayout;
  /** liczba stacji przesuniętych na pozycję z OSM (z pliku) */
  readonly osmStations: number;
  readonly terrain: Terrain | null;

  constructor(key: CityKey, opt: WorldOptions = {}) {
    this.key = key; this.city = CITIES[key]; this.proj = makeProj(this.city.o); this.terrain = opt.terrain ?? null;
    if (opt.tiles) for (const t of opt.tiles) this.addTile(t);
    const { ov, ent } = matchOsmStations(opt.osmPoints ?? null, this.city);
    if (!opt.osmPoints) for (const [i, lat, lon] of this.city.ent || []) { let l = ent.get(i); if (!l) ent.set(i, l = []); l.push(this.proj(lat, lon)); }
    this.osmStations = ov.size;
    this.metro = buildMetroLayout(this.city, ov, ent, this.buildings, this.regions, this.ground);
  }

  get stations(): Station[] { return this.metro.stations; }

  // ---------- teren ----------
  /** Wysokość gruntu (0 bez modelu terenu). */
  readonly ground = (x: number, z: number): number => this.terrain ? this.terrain.height(x, z) : 0;
  /**
   * Poziom parteru budynku: najwyższy punkt terenu wzdłuż ścian (próbki co ~4 m), żeby parter i jego okna zawsze
   * wychodziły ponad grunt. Na stoku budynek stoi wyżej od strony spadku, różnicę wypełnia cokół (lowOf).
   * Ograniczenie 8 m ponad najniższy punkt chroni przed błędami modelu terenu (skarpy przy rzekach).
   */
  baseOf(pts: XZ[]): number { const [lo, hi] = this.footing(pts); return Math.min(hi, lo + 8); }
  /** Najniższy punkt terenu wzdłuż ścian (spód cokołu). */
  lowOf(pts: XZ[]): number { return this.footing(pts)[0]; }
  private footing(pts: XZ[]): [number, number] {
    if (!this.terrain || !pts.length) return [0, 0];
    let lo = Infinity, hi = -Infinity;
    const at = (x: number, z: number) => { const y = this.ground(x, z); if (y < lo) lo = y; if (y > hi) hi = y; };
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length], n = Math.min(40, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4));
      for (let k = 0; k < n; k++) at(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n);
    }
    return [lo, hi];
  }

  // ---------- kafelki ----------
  addTile(t: TileData): void {
    const k = tileKey(t.x, t.y); if (this.tiles.has(k)) return; this.tiles.set(k, t); this.activity.changed(k);
    if (t.dem && this.terrain) this.terrain.addFine(t.dem); // dokładny teren przed budynkami i mostami
    for (const b of t.b) if (b.mh < 2) { const o = toXZ(b.o); this.buildings.add(o, this.baseOf(o) + b.h, b.i?.map(toXZ), k); }
    for (const a of t.a) if (a.k === 'water') this.water.add(toXZ(a.o), 0, a.i?.map(toXZ), k);
    const deck = (pts: XZ[], hw: number, bw: number[] | undefined) => {
      let arc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [X0, Z0] = pts[i], [X1, Z1] = pts[i + 1], L = Math.hypot(X1 - X0, Z1 - Z0) || 1, nx = -(Z1 - Z0) / L * hw, nz = (X1 - X0) / L * hw;
        // kawałki co ok. 6 m, wysokość ze środka kawałka (zgodna z rysowanym spadkiem pomostu)
        const m = Math.max(1, Math.ceil(L / 6));
        for (let q = 0; q < m; q++) {
          const t0 = q / m, t1 = (q + 1) / m, x0 = X0 + (X1 - X0) * t0, z0 = Z0 + (Z1 - Z0) * t0, x1 = X0 + (X1 - X0) * t1, z1 = Z0 + (Z1 - Z0) * t1;
          const ex = (X1 - X0) / L * .3, ez = (Z1 - Z0) / L * .3, y = deckY(bw, arc + L * (t0 + t1) / 2, this.ground);
          this.decks.add([[x0 - ex + nx, z0 - ez + nz], [x1 + ex + nx, z1 + ez + nz], [x1 + ex - nx, z1 + ez - nz], [x0 - ex - nx, z0 - ez - nz]], y, undefined, k);
        }
        arc += L;
      }
    };
    for (const r of t.r) if (r.br) deck(toXZ(r.p), r.w / 2 + (r.sw ? 2.5 : .6), r.bw);
    for (const l of t.l) if (l.br) deck(toXZ(l.p), 2.4, l.bw);
    this.addPassages(t, k); this.addFences(t, k); this.deckVersion++;
    this.interiors.addTile(t);
  }
  removeTile(k: string): void {
    for (const [key, l] of this.passages) { const f = l.filter(q => q.k !== k); if (f.length) this.passages.set(key, f); else this.passages.delete(key); }
    for (const [key, l] of this.fences) { const f = l.filter(q => q.k !== k); if (f.length) this.fences.set(key, f); else this.fences.delete(key); }
    if (!this.tiles.delete(k)) return; this.activity.changed(k);
    this.deckVersion++;
    this.terrain?.removeFine(k);
    this.buildings.removeTile(k); this.water.removeTile(k); this.decks.removeTile(k); this.interiors.removeTile(k);
  }

  // ---------- zapytania fizyki ----------
  /** Punkt zablokowany: budynek albo woda poza mostem (y: wysokość sprawdzającego, do wyboru poziomu). */
  /** rośnie przy dodaniu / usunięciu kafla (pomosty mostów): profile wysokości tras komunikacji do przeliczenia */
  deckVersion = 0;
  // ---------- płoty posesji ----------
  private fences = new Map<string, { x0: number; z0: number; x1: number; z1: number; k: string }[]>();
  private addFences(t: TileData, k: string): void {
    for (const f of t.fe ?? []) for (let i = 0; i + 3 < f.s.length; i += 4) {
      const s = { x0: f.s[i], z0: f.s[i + 1], x1: f.s[i + 2], z1: f.s[i + 3], k };
      for (let gx = Math.floor((Math.min(s.x0, s.x1) - .5) / 16); gx <= Math.floor((Math.max(s.x0, s.x1) + .5) / 16); gx++) for (let gz = Math.floor((Math.min(s.z0, s.z1) - .5) / 16); gz <= Math.floor((Math.max(s.z0, s.z1) + .5) / 16); gz++) {
        const key = gx + ',' + gz; let l = this.fences.get(key); if (!l) this.fences.set(key, l = []); l.push(s); }
    }
  }
  /** Punkt na płocie (pas 0,6 m: krok biegnącego pieszego go nie przeskoczy; bramy są otworami). */
  onFence(x: number, z: number): boolean {
    const l = this.fences.get(Math.floor(x / 16) + ',' + Math.floor(z / 16)); if (!l) return false;
    for (const s of l) { const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / L2)); if ((s.x0 + dx * t - x) ** 2 + (s.z0 + dz * t - z) ** 2 < .09) return true; }
    return false;
  }
  // ---------- bramy przejazdowe ----------
  private passages = new Map<string, { a: XZ; b: XZ; hw: number; k: string }[]>();
  /** Punkt w bramie przejazdowej (droga przez budynek): przejście mimo obrysu budynku. */
  inPassage(x: number, z: number): boolean {
    const l = this.passages.get(Math.floor(x / 16) + ',' + Math.floor(z / 16)); if (!l) return false;
    for (const s of l) { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2)); if (Math.hypot(s.a[0] + dx * u - x, s.a[1] + dz * u - z) < s.hw) return true; }
    return false;
  }
  private addPassages(t: TileData, k: string): void {
    for (const r of t.r) if (r.bp) { const p = toXZ(r.p), hw = r.w / 2 + (r.sw ? 1.6 : .4);
      for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1], s = { a, b, hw, k };
        for (let gx = Math.floor((Math.min(a[0], b[0]) - hw) / 16); gx <= Math.floor((Math.max(a[0], b[0]) + hw) / 16); gx++) for (let gz = Math.floor((Math.min(a[1], b[1]) - hw) / 16); gz <= Math.floor((Math.max(a[1], b[1]) + hw) / 16); gz++) {
          const key = gx + ',' + gz; let l = this.passages.get(key); if (!l) this.passages.set(key, l = []); l.push(s); } } }
  }
  /** Punkt w obrysie budynku (bez wody). */
  inBuilding(x: number, z: number): boolean { return this.buildings.hit(x, z); }
  blocked(x: number, z: number, y?: number): boolean {
    if (this.buildings.hit(x, z) && !this.inPassage(x, z)) return true;
    if (this.fences.size && this.onFence(x, z) && (y == null || y < this.ground(x, z) + 1.4)) return true;
    if (!this.water.hit(x, z)) return false;
    return !this.decks.containing(x, z).some(d => y == null || Math.abs(d.h - y) < 3);
  }
  /** Wysokość powierzchni najbliższa y: grunt albo pomost mostu (nie wyżej niż 1,2 m nad y). */
  surfaceAt(x: number, z: number, y: number): number {
    let best = this.ground(x, z);
    for (const d of this.decks.containing(x, z)) if (d.h <= y + 1.2 && Math.abs(d.h - y) < Math.abs(best - y)) best = d.h;
    return best;
  }
  /** Podłoże dla pieszego (region podziemny albo powierzchnia). */
  support(x: number, z: number, y: number): Support | null {
    if (this.inPassage(x, z)) { const g = this.surfaceAt(x, z, y); if (Math.abs(y - g) < 1.2) return { h: g, r: null }; } // brama: po gruncie
    const s = this.regions.support(x, z, y, this);
    if (s && s.r && s.r.info.b != null && this.interiors.blocked(x, z, s.h)) return null; // mebel
    return s;
  }
  /** Najwyższa powierzchnia w punkcie: dach albo grunt (dla helikoptera i kamery). */
  roofTop(x: number, z: number): number { return this.buildings.top(x, z, this.ground(x, z)); }
  /** Czy punkt jest pod ziemią. */
  underground(x: number, z: number, y: number): boolean { return y < this.ground(x, z) - 1; }

  /** Kolizja auta: 6 punktów prostokąta. */
  carHit(x: number, z: number, yaw: number, y?: number): boolean {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (const [a, b] of CAR_PTS) if (this.blocked(x + rx * a + fx * b, z + rz * a + fz * b, y)) return true;
    return false;
  }

  /** Najbliższe wolne miejsce na auto (albo na pieszego, gdy point = true). */
  freeSpot(x: number, z: number, yaw: number, point = false): XZ {
    const ok = (a: number, b: number) => point ? !this.blocked(a, b) : !this.carHit(a, b, yaw);
    if (ok(x, z)) return [x, z];
    for (let r = 2; r < 300; r += 2) for (let a = 0; a < 6.28; a += .4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return [px, pz]; }
    return [x, z];
  }

  // ---------- stacje i start ----------
  nearestStation(x: number, z: number): Station {
    let b = this.stations[0], bd = Infinity;
    for (const s of this.stations) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; b = s; } }
    return b;
  }

  /** Pozycja na peronie stacji (teleport). */
  /** Nazwa miejsca do HUD: stacja metra (do 1,5 km) albo najbliższa ulica z nazwą (miasta bez metra). */
  placeName(x: number, z: number): string {
    const s = this.stations.length ? this.nearestStation(x, z) : null;
    if (s && (this.city.lines.length && (s.x - x) ** 2 + (s.z - z) ** 2 < 1500 ** 2)) return s.name;
    let best = '', bd = 300 ** 2;
    const tx = Math.floor(x / TILE_SIZE), tz = Math.floor(z / TILE_SIZE);
    for (let i = tx - 1; i <= tx + 1; i++) for (let j = tz - 1; j <= tz + 1; j++) {
      const t = this.tiles.get(tileKey(i, j)); if (!t) continue;
      for (const r of t.r) { if (!r.n) continue; for (let q = 0; q < r.p.length; q += 2) { const d = (r.p[q] - x) ** 2 + (r.p[q + 1] - z) ** 2; if (d < bd) { bd = d; best = r.n; } } }
    }
    return best || s?.name || '—';
  }

  platformPose(s: Station): Pose {
    if (!s) { // miasto bez metra: stały punkt startu (np. płyta Rynku), przodem na zachód
      const [x, z] = this.city.sp ? makeProj(this.city.o)(this.city.sp[0], this.city.sp[1]) : [0, 0];
      return { x, z, y: this.ground(x, z), yaw: Math.PI / 2, pitch: 0, reg: null };
    }
    const h = s.halls[0]; const off = h.island ? (h.W - 7 > 1.2 ? 0 : 2) : -(h.W - 2);
    return { x: s.x - h.uz * off + h.ux * 3, z: s.z + h.ux * off + h.uz * 3, y: h.y, yaw: Math.atan2(-h.ux, -h.uz), pitch: 0, reg: h.reg };
  }

  /** Pozycja na ulicy przy pierwszym wyjściu stacji. */
  streetPose(s: Station): Pose {
    const [x, z, d] = s.tops[0];
    const px = x + d[0] * 2.5, pz = z + d[1] * 2.5;
    return { x: px, z: pz, y: this.ground(px, pz), yaw: Math.atan2(-d[0], -d[1]), pitch: 0, reg: null };
  }

  /** Start: na ulicy przy budynkach z pliku albo na peronie stacji startowej. */
  spawnPose(): Pose {
    const bp = this.buildings.polys;
    if (this.tiles.size && bp.length) {
      let cx = 0, cz = 0; bp.forEach(p => { cx += p.a; cz += p.c; }); cx /= bp.length; cz /= bp.length;
      let best: XZ | null = null, bd = Infinity;
      for (const t of this.tiles.values()) for (const r of t.r) for (let i = 0; i < r.p.length; i += 2) {
        const x = r.p[i], z = r.p[i + 1], d = (x - cx) ** 2 + (z - cz) ** 2; if (d < bd && !this.blocked(x, z)) { bd = d; best = [x, z]; }
      }
      if (best) return { x: best[0], z: best[1], y: this.ground(best[0], best[1]), yaw: 0, pitch: 0, reg: null };
      return this.platformPose(this.stations.find(s => s.real) || this.stations[0]);
    }
    return this.platformPose(this.stations.find(s => s.name === this.city.spawn) || this.stations[0]);
  }
}

/**
 * Stacje i wejścia z pliku OSM: stacja przesuwa się na prawdziwe miejsce (do 900 m),
 * wejścia w promieniu 260 m od stacji stają się prawdziwymi zejściami.
 */
export function matchOsmStations(pts: OsmPoint[] | null, city: CityData): { ov: Map<number, XZ>; ent: Map<number, XZ[]> } {
  const ov = new Map<number, XZ>(), ent = new Map<number, XZ[]>(); if (!pts) return { ov, ent };
  const proj = makeProj(city.o), idx = new Map(city.st.map((s, i) => [normName(s[0]), i]));
  for (const f of pts) {
    const t = f.tags, isSt = (t.railway === 'station' && t.station === 'subway') || (t.public_transport === 'station' && t.subway === 'yes');
    if (isSt && t.name) {
      const i = idx.get(normName(t.name));
      if (i != null) { const p = proj(f.lat, f.lon), q = proj(city.st[i][1], city.st[i][2]); if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 900) ov.set(i, p); }
    }
  }
  for (const f of pts) if (f.tags.railway === 'subway_entrance') {
    const p = proj(f.lat, f.lon); let best = -1, bd = 260;
    city.st.forEach((s, i) => { const q = ov.get(i) || proj(s[1], s[2]); const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { let l = ent.get(best); if (!l) ent.set(best, l = []); l.push(p); }
  }
  return { ov, ent };
}
