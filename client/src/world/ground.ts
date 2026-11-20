// Grunt: siatka komórek 500 m (zgodna z kafelkami) z otworami nad zejściami do metra i nad wodą.
// Komórki bez otworów to 2 trójkąty; całość to jeden mesh przebudowywany po zmianie komórki.
import * as THREE from 'three';
import { clipRing } from '@miasto/shared/tiles/clip';
import { TILE_SIZE, tileKey } from '@miasto/shared/tiles/types';
import type { XZ } from '@miasto/shared/world/collision';

export class GroundGrid {
  readonly mat: THREE.MeshBasicMaterial;
  readonly mesh: THREE.Mesh;
  private cells = new Map<string, Float32Array>();
  private holes = new Map<string, XZ[][]>();
  private water = new Map<string, XZ[][]>();
  private dirty = true;

  constructor(private x0: number, private y0: number, private x1: number, private y1: number, kioskHoles: XZ[][], xray: boolean) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x020604, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); this.mesh.position.y = -.03; this.mesh.frustumCulled = false;
    for (const h of kioskHoles) for (const k of this.cellsOf(h)) { let l = this.holes.get(k); if (!l) this.holes.set(k, l = []); l.push(h); }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.buildCell(x, y);
    this.setXray(xray); this.update();
  }

  /** Komórki obejmujące wielokąt. */
  private cellsOf(p: XZ[]): string[] {
    const xs = p.map(q => Math.floor(q[0] / TILE_SIZE)), ys = p.map(q => Math.floor(q[1] / TILE_SIZE)), out: string[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(tileKey(x, y));
    return out;
  }

  /** Woda w komórce (otwory w gruncie); null usuwa. */
  setWater(x: number, y: number, polys: XZ[][] | null): void {
    const k = tileKey(x, y);
    if (polys && polys.length) this.water.set(k, polys); else if (!this.water.delete(k)) return;
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1) { this.x0 = Math.min(this.x0, x); this.x1 = Math.max(this.x1, x); this.y0 = Math.min(this.y0, y); this.y1 = Math.max(this.y1, y); for (let a = this.x0; a <= this.x1; a++) for (let b = this.y0; b <= this.y1; b++) if (!this.cells.has(tileKey(a, b))) this.buildCell(a, b); }
    this.buildCell(x, y);
  }

  private buildCell(x: number, y: number): void {
    const k = tileKey(x, y), bx = x * TILE_SIZE, bz = y * TILE_SIZE, e = .02;
    const hs = [...(this.holes.get(k) || []), ...(this.water.get(k) || [])]
      .map(h => clipRing(h, bx + e, bz + e, bx + TILE_SIZE - e, bz + TILE_SIZE - e)).filter(h => h.length >= 3);
    const out: number[] = [];
    // komórka dzielona na 25 kwadratów po 100 m (bez długich trójkątów)
    if (!hs.length) {
      const S = 100;
      for (let i = 0; i < TILE_SIZE; i += S) for (let j = 0; j < TILE_SIZE; j += S) {
        const a = bx + i, b = bz + j; out.push(a, 0, b, a, 0, b + S, a + S, 0, b + S, a, 0, b, a + S, 0, b + S, a + S, 0, b);
      }
    } else {
      const outer: XZ[] = [[bx, bz], [bx, bz + TILE_SIZE], [bx + TILE_SIZE, bz + TILE_SIZE], [bx + TILE_SIZE, bz]];
      const v = (r: XZ[]) => r.map(([px, pz]) => new THREE.Vector2(px, pz));
      const all = [...outer, ...hs.flat()];
      try { for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(v(outer), hs.map(v))) out.push(all[a][0], 0, all[a][1], all[b][0], 0, all[b][1], all[c][0], 0, all[c][1]); } catch { /* zostaw pustą */ }
    }
    this.cells.set(k, new Float32Array(out)); this.dirty = true;
  }

  /** Przebudowa scalonego mesha (raz na klatkę, jeśli coś się zmieniło). */
  update(): void {
    if (!this.dirty) return; this.dirty = false;
    let n = 0; for (const c of this.cells.values()) n += c.length;
    const pos = new Float32Array(n); let o = 0; for (const c of this.cells.values()) { pos.set(c, o); o += c.length; }
    this.mesh.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.mesh.geometry = g;
  }

  setXray(xray: boolean): void { const m = this.mat; m.opacity = xray ? .12 : 1; m.transparent = xray; m.depthWrite = !xray; m.needsUpdate = true; }
  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
