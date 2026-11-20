// Widok miasta: podziemia (zawsze całe), grunt i kafelki doładowywane wokół gracza.
import * as THREE from 'three';
import { TILE_SIZE } from '@miasto/shared/tiles/types';
import type { World } from '@miasto/shared/world/world';
import { buildMetroObjects } from './metro';
import { GroundGrid } from './ground';
import { Signs } from './signs';
import type { TileSource } from './tiles/source';
import { TileStreamer } from './tiles/streamer';

export class CityView {
  readonly group = new THREE.Group();
  readonly ground: GroundGrid;
  readonly streamer: TileStreamer;
  readonly signs = new Signs();

  constructor(readonly world: World, source: TileSource, xray: boolean) {
    for (const o of buildMetroObjects(world.metro, world.city)) this.group.add(o);
    // grunt: wokół stacji (+800 m), poszerzany o kafelki
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const s of world.stations) { a = Math.min(a, s.x); b = Math.max(b, s.x); c = Math.min(c, s.z); d = Math.max(d, s.z); }
    for (const t of world.tiles.values()) { a = Math.min(a, t.x * TILE_SIZE); b = Math.max(b, (t.x + 1) * TILE_SIZE); c = Math.min(c, t.y * TILE_SIZE); d = Math.max(d, (t.y + 1) * TILE_SIZE); }
    const f = (v: number) => Math.floor(v / TILE_SIZE);
    this.ground = new GroundGrid(f(a - 800), f(c - 800), f(b + 800), f(d + 800), world.metro.holes, xray);
    this.group.add(this.ground.mesh);
    this.streamer = new TileStreamer(world, source, this.ground);
    this.streamer.onChange = () => this.signs.rebuild(this.streamer.loadedTiles());
    this.group.add(this.streamer.group, this.signs.group);
    this.setXray(xray);
  }

  /** Co klatkę: kafelki wokół gracza, grunt. */
  update(x: number, z: number, radius: number): void { this.streamer.update(x, z, radius); this.ground.update(); }
  /** Rzadziej: podpisy w pobliżu. */
  slowUpdate(x: number, z: number): void { this.signs.update(x, z); }

  get buildingCount(): number { return this.streamer.buildingCount; }

  setXray(xray: boolean): void { this.ground.setXray(xray); this.streamer.setXray(xray); }

  dispose(): void {
    this.signs.clear(); this.streamer.dispose(); this.ground.dispose();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
    });
  }
}
