// Doładowywanie kafelków wokół gracza (dalej dla helikoptera) i zwalnianie dalekich.
// Kolizje trafiają do World (shared), bryły do sceny; jeden kafelek budowany na klatkę.
import * as THREE from 'three';
import { TILE_SIZE, tileKey, type TileData, type TileIndex } from '@miasto/shared/tiles/types';
import type { World } from '@miasto/shared/world/world';
import { toXZ } from '@miasto/shared/world/world';
import type { GroundGrid } from '../ground';
import type { TileSource } from './source';
import type { StopPoint } from './props';
import { MAX_LAMPS } from '../lampLight';
import TileBuildWorker from './tileWorker?worker&inline';
import type { TileWorkerIn, TileWorkerOut } from './tileWorker';
import { assembleTile, buildTileView, TileMaterials, type TileView } from './tileView';

export interface StreamStats { indexed: number; loaded: number; visible: number; pending: number; lastBuildMs: number; maxBuildMs: number; lastAssembleMs?: number; maxAssembleMs?: number }

export class TileStreamer {
  readonly group = new THREE.Group();
  readonly mats = new TileMaterials();
  private available = new Set<string>();
  private data = new Map<string, TileData>();
  private views = new Map<string, TileView>();
  private loading = new Set<string>();
  private ready: TileData[] = [];
  private disposed = false;
  readonly stats: StreamStats = { indexed: 0, loaded: 0, visible: 0, pending: 0, lastBuildMs: 0, maxBuildMs: 0 };
  index: TileIndex | null = null;
  /** wywoływane po dołożeniu / usunięciu kafelka (np. odświeżenie podpisów) */
  onChange: () => void = () => {};

  /** przystanki komunikacji w kaflu (wiaty); ustawiane po wczytaniu rozkładów */
  stopsFor: (x: number, y: number) => StopPoint[] = () => [];
  constructor(private world: World, private source: TileSource, private ground: GroundGrid, private maxParallel = 3) {}

  // ---- wątek budowy kafli ----
  private worker: Worker | null = null; private workerFailed = false;
  private building = new Set<string>();
  private tileWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      const w = new TileBuildWorker(); this.worker = w;
      const init: TileWorkerIn = { t: 'init', city: this.world.key, terrain: this.world.terrain ? this.world.terrain.encode() : null }; w.postMessage(init);
      w.onmessage = (e: MessageEvent<TileWorkerOut>) => {
        const d = e.data.d; if (!this.building.delete(d.key) || !this.data.has(d.key) || this.disposed) return; // kafel już zwolniony
        const t0 = performance.now(); this.addView(d.key, assembleTile(d, this.mats));
        const a = performance.now() - t0; this.stats.lastAssembleMs = a; this.stats.maxAssembleMs = Math.max(this.stats.maxAssembleMs ?? 0, a);
      };
      w.onerror = () => { this.workerFailed = true; this.worker = null; };
    } catch { this.workerFailed = true; }
    return this.worker;
  }
  private addView(k: string, v: TileView): void {
    this.views.set(k, v); this.group.add(v.group);
    this.stats.lastBuildMs = v.ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, v.ms);
    this.onChange();
  }

  async init(): Promise<number> {
    this.index = await this.source.index();
    if (this.disposed || !this.index) return 0;
    for (const [x, y] of this.index.tiles) this.available.add(tileKey(x, y));
    this.stats.indexed = this.available.size;
    return this.available.size;
  }

  /** Wywoływane co klatkę z pozycją gracza i promieniem widoczności [m]. */
  update(x: number, z: number, radius: number): void {
    if (!this.available.size) return;
    const R = Math.ceil(radius / TILE_SIZE), cx = Math.floor(x / TILE_SIZE), cz = Math.floor(z / TILE_SIZE);
    const want: [number, string][] = [];
    for (let i = cx - R; i <= cx + R; i++) for (let j = cz - R; j <= cz + R; j++) {
      const k = tileKey(i, j); if (!this.available.has(k)) continue;
      const dx = Math.max(0, Math.abs((i + .5) * TILE_SIZE - x) - TILE_SIZE / 2), dz = Math.max(0, Math.abs((j + .5) * TILE_SIZE - z) - TILE_SIZE / 2);
      const d = Math.hypot(dx, dz); if (d <= radius) want.push([d, k]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, k] of want) {
      if (this.loading.size >= this.maxParallel) break;
      if (this.data.has(k) || this.loading.has(k)) continue;
      const [tx, ty] = k.split('_').map(Number); this.loading.add(k);
      this.source.load(tx, ty).then(t => { this.loading.delete(k); if (!this.disposed && t) this.ready.push(t); else if (!t) this.available.delete(k); });
    }
    // jeden kafelek na klatkę: kolizje od razu, bryły liczone w wątku kafli (albo od razu, gdy wątku brak)
    const t = this.ready.shift();
    if (t) {
      const k = tileKey(t.x, t.y); this.data.set(k, t); this.world.addTile(t);
      if (t.dem) this.ground.refresh(t.x, t.y); // dokładny teren: siatka gruntu od nowa
      const w = this.tileWorker();
      if (w) { this.building.add(k); const msg: TileWorkerIn = { t: 'build', tile: t, stops: this.stopsFor(t.x, t.y) }; w.postMessage(msg); }
      else this.addView(k, buildTileView(t, this.mats, this.world.terrain ? this.world : null, this.world, this.stopsFor(t.x, t.y)));
      const water = t.a.filter(a => a.k === 'water');
      if (water.length) this.ground.setWater(t.x, t.y, water.flatMap(a => [toXZ(a.o)]));
    }
    // zwalnianie: poza promieniem + 600 m
    for (const [k, v] of this.views) {
      const [i, j] = k.split('_').map(Number);
      const dx = Math.max(0, Math.abs((i + .5) * TILE_SIZE - x) - TILE_SIZE / 2), dz = Math.max(0, Math.abs((j + .5) * TILE_SIZE - z) - TILE_SIZE / 2);
      if (Math.hypot(dx, dz) <= radius + 600) continue;
      this.group.remove(v.group); v.dispose(); this.views.delete(k); this.data.delete(k); this.world.removeTile(k); this.worker?.postMessage({ t: 'remove', key: k } as TileWorkerIn);
      const tt = { x: i, y: j }; this.ground.setWater(tt.x, tt.y, null); this.onChange();
    }
    this.stats.loaded = this.data.size; this.stats.visible = this.views.size; this.stats.pending = this.loading.size + this.ready.length;
  }

  loadedTiles(): Iterable<TileData> { return this.data.values(); }
  get hasTiles(): boolean { return this.available.size > 0; }
  get buildingCount(): number { let n = 0; for (const t of this.data.values()) n += t.b.length; return n; }

  setXray(on: boolean): void { this.mats.setXray(on); }

  /** Najbliższe latarnie (do światła na terenie); night: 0 dzień .. 1 noc. */
  updateLamps(x: number, z: number, night: number): void {
    const U = this.mats.lamps, cand: [number, number, number, number][] = [];
    U.uLampNight.value = night; if (night < .01) { U.uLampN.value = 0; return; }
    for (const [k, v] of this.views) {
      const [i, j] = k.split('_').map(Number); if (Math.abs((i + .5) * TILE_SIZE - x) > 500 || Math.abs((j + .5) * TILE_SIZE - z) > 500) continue;
      const L = v.lamps; for (let q = 0; q < L.length; q += 3) { const d = Math.hypot(L[q] - x, L[q + 2] - z); if (d < 220) cand.push([d, L[q], L[q + 1], L[q + 2]]); }
    }
    cand.sort((a, b) => a[0] - b[0]);
    const n = Math.min(MAX_LAMPS, cand.length); for (let q = 0; q < n; q++) U.uLamps.value[q].set(cand[q][1], cand[q][2], cand[q][3], 16);
    U.uLampN.value = n;
  }
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate(); this.worker = null;
    for (const v of this.views.values()) v.dispose(); this.views.clear(); this.mats.dispose();
  }
}
