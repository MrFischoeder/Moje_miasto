// Etykiety z nazwami stacji: sprite z canvasu, tworzone tylko w promieniu 350 m.
import * as THREE from 'three';
import type { World } from '@miasto/shared/world/world';

const FONT = '"Chakra Petch", sans-serif';

function makeLabel(text: string, color: string, w = 9): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,.75)'; x.fillRect(0, 0, 512, 96); x.fillStyle = color; x.fillRect(0, 0, 14, 96);
  x.font = `600 46px ${FONT}`; x.fillStyle = '#fff'; x.textBaseline = 'middle';
  let fs = 46; while (x.measureText(text).width > 470 && fs > 20) { fs -= 2; x.font = `600 ${fs}px ${FONT}`; }
  x.fillText(text, 30, 50);
  const tex = new THREE.CanvasTexture(cv); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sp.scale.set(w, w * 96 / 512, 1); return sp;
}

export class StationLabels {
  readonly group = new THREE.Group();
  private labels = new Map<number, THREE.Group>();

  update(world: World, cx: number, cz: number): void {
    const near = new Set<number>(), city = world.city;
    for (const s of world.stations) {
      if (Math.abs(s.x - cx) > 350 || Math.abs(s.z - cz) > 350) continue; near.add(s.i); if (this.labels.has(s.i)) continue;
      const g = new THREE.Group(), name = s.name;
      s.halls.forEach(h => {
        const c = city.lines[h.l].c;
        for (const t of [-h.L * .5, h.L * .5]) for (const sd of [-1, 1]) {
          const sp = makeLabel(name + ' · ' + city.lines[h.l].n, c, 7);
          sp.position.set(s.x + h.ux * t - h.uz * sd * (h.W - .8), h.y + 3.4, s.z + h.uz * t + h.ux * sd * (h.W - .8)); g.add(sp);
        }
      });
      s.tops.forEach(([x, z], i) => { const sp = makeLabel('M  ' + name, city.lines[s.halls[0].l].c, 8); sp.position.set(x, (s.exitGeoms[i]?.ty ?? 0) + 4.6, z); g.add(sp); });
      this.group.add(g); this.labels.set(s.i, g);
    }
    for (const [i, g] of this.labels) if (!near.has(i)) this.remove(i, g);
  }

  clear(): void { for (const [i, g] of this.labels) this.remove(i, g); }

  private remove(i: number, g: THREE.Group): void {
    g.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } });
    this.group.remove(g); this.labels.delete(i);
  }
}
