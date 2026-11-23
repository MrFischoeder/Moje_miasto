// Doładowywanie kafelków wokół gracza (dalej dla helikoptera) i zwalnianie dalekich.
// Kolizje trafiają do World (shared), bryły do sceny; jeden kafelek budowany na klatkę.
import * as THREE from 'three';
import { TILE_SIZE, tileKey, type TileData, type TileIndex } from '@miasto/shared/tiles/types';
import type { World } from '@miasto/shared/world/world';
import { toXZ } from '@miasto/shared/world/world';
import type { GroundGrid } from '../ground';
import type { TileSource } from './source';
import type { StopPoint } from './props';
import { buildTileView, TileMaterials, type TileView } from './tileView';

export interface StreamStats { indexed: number; loaded: number; visible: number; pending: number; lastBuildMs: number; maxBuildMs: number }

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
    // jeden kafelek na klatkę: kolizje + bryły
    const t = this.ready.shift();
    if (t) {
      const k = tileKey(t.x, t.y); this.data.set(k, t); this.world.addTile(t);
      const v = buildTileView(t, this.mats, this.world.terrain ? this.world : null, this.world, this.stopsFor(t.x, t.y)); this.views.set(k, v); this.group.add(v.group);
      this.stats.lastBuildMs = v.ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, v.ms);
      const water = t.a.filter(a => a.k === 'water');
      if (water.length) this.ground.setWater(t.x, t.y, water.flatMap(a => [toXZ(a.o)]));
      this.onChange();
    }
    // zwalnianie: poza promieniem + 600 m
    for (const [k, v] of this.views) {
      const [i, j] = k.split('_').map(Number);
      const dx = Math.max(0, Math.abs((i + .5) * TILE_SIZE - x) - TILE_SIZE / 2), dz = Math.max(0, Math.abs((j + .5) * TILE_SIZE - z) - TILE_SIZE / 2);
      if (Math.hypot(dx, dz) <= radius + 600) continue;
      this.group.remove(v.group); v.dispose(); this.views.delete(k); this.data.delete(k); this.world.removeTile(k);
      const tt = { x: i, y: j }; this.ground.setWater(tt.x, tt.y, null); this.onChange();
    }
    this.stats.loaded = this.data.size; this.stats.visible = this.views.size; this.stats.pending = this.loading.size + this.ready.length;
  }

  loadedTiles(): Iterable<TileData> { return this.data.values(); }
  get hasTiles(): boolean { return this.available.size > 0; }
  get buildingCount(): number { let n = 0; for (const t of this.data.values()) n += t.b.length; return n; }

  setXray(on: boolean): void { this.mats.setXray(on); }
  dispose(): void {
    this.disposed = true;
    for (const v of this.views.values()) v.dispose(); this.views.clear(); this.mats.dispose();
  }
}
