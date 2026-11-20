// Tabliczki z nazwami ulic na skrzyżowaniach i szyldy sklepów/usług: sprite z canvasu, tylko w pobliżu gracza.
import * as THREE from 'three';
import { signText } from '@miasto/shared/config/branding';
import type { TileData } from '@miasto/shared/tiles/types';

const FONT = '"Chakra Petch", sans-serif';

function sprite(lines: string[], bg: string, fg: string, accent: string, w: number): THREE.Sprite {
  const H = 64 * lines.length + 16, cv = document.createElement('canvas'); cv.width = 512; cv.height = H; const x = cv.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, 512, H); x.fillStyle = accent; x.fillRect(0, 0, 512, 6);
  x.fillStyle = fg; x.textBaseline = 'middle';
  lines.forEach((t, i) => { let fs = 40; x.font = `600 ${fs}px ${FONT}`; while (x.measureText(t).width > 480 && fs > 18) { fs -= 2; x.font = `600 ${fs}px ${FONT}`; } x.fillText(t, 16, 40 + i * 64); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  sp.scale.set(w, w * H / 512, 1); return sp;
}

interface Sign { x: number; z: number; y: number; make(): THREE.Object3D }

export class Signs {
  readonly group = new THREE.Group();
  private list: Sign[] = [];
  private live = new Map<number, THREE.Object3D>();

  /** Przebudowa listy po zmianie kafelków (tylko dane, bez sprite'ów). */
  rebuild(tiles: Iterable<TileData>, ground: (x: number, z: number) => number = () => 0): void {
    this.list = [];
    for (const t of tiles) {
      // skrzyżowania: węzeł wspólny dla dróg o różnych nazwach
      const names = new Map<number, Set<string>>();
      for (const r of t.r) if (r.n) for (let i = 0; i < r.j.length; i += 2) { const id = r.j[i + 1]; let s = names.get(id); if (!s) names.set(id, s = new Set()); s.add(r.n); }
      for (const g of t.g) {
        const s = names.get(g.id); if (!g.jn || !s || s.size < 2) continue;
        const lines = [...s].slice(0, 3);
        this.list.push({ x: g.x, z: g.z, y: ground(g.x, g.z), make: () => { const o = new THREE.Group(); const sp = sprite(lines, 'rgba(8,30,60,.9)', '#e8f4ff', '#7dc4ff', 4.5); sp.position.y = 3.6; o.add(sp); return o; } });
      }
      for (const p of t.poi) {
        const text = signText(p), sub = p.a;
        this.list.push({ x: p.x, z: p.z, y: ground(p.x, p.z), make: () => { const sp = sprite(sub ? [text, sub] : [text], 'rgba(0,0,0,.8)', '#fff', p.c === 'shop' ? '#ffbe5a' : '#7dffb0', 4); sp.position.y = 3.4; return sp; } });
      }
    }
    this.clear();
  }

  update(x: number, z: number, r = 110): void {
    const near = new Set<number>();
    this.list.forEach((s, i) => {
      if (Math.abs(s.x - x) > r || Math.abs(s.z - z) > r) return; near.add(i); if (this.live.has(i)) return;
      const o = s.make(); o.position.x = s.x; o.position.z = s.z; o.position.y += s.y; this.group.add(o); this.live.set(i, o);
    });
    for (const [i, o] of this.live) if (!near.has(i)) this.drop(i, o);
  }

  clear(): void { for (const [i, o] of this.live) this.drop(i, o); }
  private drop(i: number, o: THREE.Object3D): void {
    o.traverse(c => { if (c instanceof THREE.Sprite) { c.material.map?.dispose(); c.material.dispose(); } });
    this.group.remove(o); this.live.delete(i);
  }
}
