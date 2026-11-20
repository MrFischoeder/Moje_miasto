// Widok miasta: wszystko, co rysujemy dla danego świata (powierzchnia, podziemia, grunt).
import * as THREE from 'three';
import type { Feature } from '@miasto/shared/osm/features';
import type { World } from '@miasto/shared/world/world';
import { buildMetroObjects } from './metro';
import { buildGround, buildSurface } from './surface';

export class CityView {
  readonly group = new THREE.Group();
  readonly buildingCount: number;
  private groundMat: THREE.MeshBasicMaterial;
  private buildMat: THREE.MeshLambertMaterial | null = null;
  private edgeMat: THREE.LineBasicMaterial | null = null;

  constructor(readonly world: World, feats: Feature[] | null, xray: boolean) {
    let nb = 0;
    if (feats) {
      const s = buildSurface(feats, world.proj); nb = s.count; this.buildMat = s.buildMat; this.edgeMat = s.edgeMat;
      for (const o of s.objects) this.group.add(o);
    }
    for (const o of buildMetroObjects(world.metro, world.city)) this.group.add(o);
    const g = buildGround(world, world.metro.holes, xray); this.groundMat = g.mat; this.group.add(g.mesh);
    this.buildingCount = nb;
    this.setXray(xray);
  }

  setXray(xray: boolean): void {
    const gm = this.groundMat;
    gm.opacity = xray ? .12 : 1; gm.transparent = xray; gm.needsUpdate = true; gm.depthWrite = !xray;
    if (this.buildMat) this.buildMat.opacity = xray ? .25 : 1;
    if (this.edgeMat) this.edgeMat.opacity = xray ? .35 : 1;
  }

  dispose(): void {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
    });
  }
}
