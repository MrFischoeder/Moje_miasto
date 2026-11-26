// Grunt: siatka komórek 500 m (zgodna z kafelkami) z otworami nad zejściami do metra
// (i nad wodą, gdy świat jest płaski). Z modelem terenu komórki są siatką wysokości:
// dokładną (co ~30 m) w promieniu widoczności, zgrubną (co 250 m) dalej.
// Całość to jeden mesh przebudowywany po zmianie komórek.
import * as THREE from 'three';
import { PAL } from '../render/palette';
import { clipRing } from '@miasto/shared/tiles/clip';
import { TILE_SIZE, tileKey } from '@miasto/shared/tiles/types';
import type { XZ } from '@miasto/shared/world/collision';

type Ground = (x: number, z: number) => number;
/** podział komórki 500 m z dokładnym terenem (NMT) blisko gracza: co 5 m */
const DEM_CELLS = 125; // siatka 4 m: zgodna z krokiem kafli NMT (wały, koryta, skarpy)

export class GroundGrid {
  readonly mat: THREE.MeshLambertMaterial;
  readonly mesh: THREE.Mesh;
  private cells = new Map<string, { lod: number; pos: Float32Array; lines: Float32Array }>();
  /** linie terenu (co ~60 m w komórkach wokół gracza) */
  readonly lines: THREE.LineSegments;
  private holes = new Map<string, XZ[][]>();
  private water = new Map<string, XZ[][]>();
  private dirty = true;
  private fine: number;

  constructor(private x0: number, private y0: number, private x1: number, private y1: number, kioskHoles: XZ[][], xray: boolean,
    private ground: Ground | null = null, step = 30, private hasDem: (x: number, y: number) => boolean = () => false) {
    this.mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(...PAL.ground), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); this.mesh.position.y = -.03; this.mesh.frustumCulled = false;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x14402a })); this.lines.frustumCulled = false; this.lines.visible = false; // low-poly: bez linii terenu
    this.fine = ground ? Math.max(2, Math.round(TILE_SIZE / step)) : 5;
    for (const h of kioskHoles) for (const k of this.cellsOf(h)) { let l = this.holes.get(k); if (!l) this.holes.set(k, l = []); l.push(h); }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.buildCell(x, y, this.coarse);
    this.setXray(xray); this.flush();
  }

  /** podział komórki daleko od gracza */
  private get coarse(): number { return this.ground ? 2 : 5; }

  /** Komórki obejmujące wielokąt. */
  private cellsOf(p: XZ[]): string[] {
    const xs = p.map(q => Math.floor(q[0] / TILE_SIZE)), ys = p.map(q => Math.floor(q[1] / TILE_SIZE)), out: string[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(tileKey(x, y));
    return out;
  }

  /** Woda w komórce (otwory w gruncie, tylko w płaskim świecie); null usuwa. */
  setWater(x: number, y: number, polys: XZ[][] | null): void {
    if (this.ground) return;
    const k = tileKey(x, y);
    if (polys && polys.length) this.water.set(k, polys); else if (!this.water.delete(k)) return;
    if (x < this.x0 || x > this.x1 || y < this.y0 || y > this.y1) {
      this.x0 = Math.min(this.x0, x); this.x1 = Math.max(this.x1, x); this.y0 = Math.min(this.y0, y); this.y1 = Math.max(this.y1, y);
      for (let a = this.x0; a <= this.x1; a++) for (let b = this.y0; b <= this.y1; b++) if (!this.cells.has(tileKey(a, b))) this.buildCell(a, b, this.coarse);
    }
    this.buildCell(x, y, this.cells.get(k)?.lod ?? this.coarse);
  }

  private buildCell(x: number, y: number, n: number): void {
    const k = tileKey(x, y), bx = x * TILE_SIZE, bz = y * TILE_SIZE, S = TILE_SIZE / n, e = .02, g = this.ground;
    const all = [...(this.holes.get(k) || []), ...(this.water.get(k) || [])];
    // siatka rzadsza niż teren (daleko): wierzchołek = najniższy punkt otoczenia, żeby skosy między dnem rzeki
    // a brzegiem nie przebijały płaskiej tafli wody (tools/lib/waterBanks.ts)
    const lo = g && n < DEM_CELLS ? S / 2 : 0;
    // krawędź komórki: zawsze dokładna wysokość (taka sama jak u sąsiada o innej gęstości – bez szczelin w gruncie)
    const edge = (px: number, pz: number) => Math.abs(px - bx) < .01 || Math.abs(px - bx - TILE_SIZE) < .01 || Math.abs(pz - bz) < .01 || Math.abs(pz - bz - TILE_SIZE) < .01;
    const out: number[] = [], Y = (px: number, pz: number) => !g ? 0 : !lo || edge(px, pz) ? g(px, pz) : Math.min(g(px, pz), g(px - lo, pz), g(px + lo, pz), g(px, pz - lo), g(px, pz + lo));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = bx + i * S, b = bz + j * S;
      const hs = all.map(h => clipRing(h, a + e, b + e, a + S - e, b + S - e)).filter(h => h.length >= 3);
      if (!hs.length) {
        const y00 = Y(a, b), y01 = Y(a, b + S), y11 = Y(a + S, b + S), y10 = Y(a + S, b);
        out.push(a, y00, b, a, y01, b + S, a + S, y11, b + S, a, y00, b, a + S, y11, b + S, a + S, y10, b);
        continue;
      }
      const outer: XZ[] = [[a, b], [a, b + S], [a + S, b + S], [a + S, b]], v = (r: XZ[]) => r.map(([px, pz]) => new THREE.Vector2(px, pz));
      const pts = [...outer, ...hs.flat()];
      try {
        for (const tri of THREE.ShapeUtils.triangulateShape(v(outer), hs.map(v))) for (const q of tri) out.push(pts[q][0], Y(pts[q][0], pts[q][1]), pts[q][1]);
      } catch { /* zostaw pustą */ }
    }
    // „fartuch” wzdłuż brzegów komórki (4 m w dół): zasłania szpary między komórkami o różnej gęstości siatki
    if (g) for (let i = 0; i < n; i++) for (const [x0, z0, x1, z1] of [[bx + i * S, bz, bx + (i + 1) * S, bz], [bx + i * S, bz + TILE_SIZE, bx + (i + 1) * S, bz + TILE_SIZE], [bx, bz + i * S, bx, bz + (i + 1) * S], [bx + TILE_SIZE, bz + i * S, bx + TILE_SIZE, bz + (i + 1) * S]]) {
      const y0 = Y(x0, z0), y1 = Y(x1, z1);
      out.push(x0, y0, z0, x1, y1, z1, x1, y1 - 4, z1, x0, y0, z0, x1, y1 - 4, z1, x0, y0 - 4, z0);
    }
    // linie terenu: co drugą krawędź podkomórki (tylko w szczegółowych komórkach z terenem)
    const ln: number[] = [];
    if (g && n === this.fine) for (let i = 0; i <= n; i += 2) for (let j = 0; j < n; j++) {
      const a = bx + i * S, b0 = bz + j * S, b1 = b0 + S, c0 = bx + j * S, c1 = c0 + S, d = bz + i * S;
      ln.push(a, Y(a, b0) + .2, b0, a, Y(a, b1) + .2, b1, c0, Y(c0, d) + .2, d, c1, Y(c1, d) + .2, d);
    }
    this.cells.set(k, { lod: n, pos: new Float32Array(out), lines: new Float32Array(ln) }); this.dirty = true;
  }

  /** Komórka po wczytaniu dokładnego terenu: przebudowa (z najbliższą aktualizacją wybierze gęstość). */
  refresh(x: number, y: number): void {
    const c = this.cells.get(tileKey(x, y)); if (!c || !this.ground) return;
    this.buildCell(x, y, c.lod); this.last = [NaN, 0, 0];
  }

  /** Szczegółowość komórek wokół gracza (tylko z terenem). */
  private last: [number, number, number] = [NaN, 0, 0];
  update(px: number, pz: number, radius: number): void {
    const L = this.last, moved = !(Math.hypot(px - L[1], pz - L[2]) < 50 && Math.abs(radius - L[0]) < 100);
    if (moved) this.last = [radius, px, pz];
    if (this.ground && moved) for (const [k, c] of this.cells) {
      const [x, y] = k.split('_').map(Number);
      const dx = Math.max(0, Math.abs((x + .5) * TILE_SIZE - px) - TILE_SIZE / 2), dz = Math.max(0, Math.abs((y + .5) * TILE_SIZE - pz) - TILE_SIZE / 2);
      const d = Math.hypot(dx, dz), want = d <= Math.min(radius, 700) && this.hasDem(x, y) ? DEM_CELLS : d <= radius ? this.fine : this.coarse;
      if (c.lod !== want) this.buildCell(x, y, want);
    }
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return; this.dirty = false;
    let n = 0; for (const c of this.cells.values()) n += c.pos.length;
    const pos = new Float32Array(n); let o = 0; for (const c of this.cells.values()) { pos.set(c.pos, o); o += c.pos.length; }
    this.mesh.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals(); this.mesh.geometry = g;
    let m = 0; for (const c of this.cells.values()) m += c.lines.length;
    const lp = new Float32Array(m); o = 0; for (const c of this.cells.values()) { lp.set(c.lines, o); o += c.lines.length; }
    this.lines.geometry.dispose(); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); this.lines.geometry = lg;
  }

  setXray(xray: boolean): void { const m = this.mat; m.opacity = xray ? .12 : 1; m.transparent = xray; m.depthWrite = !xray; m.needsUpdate = true; }
  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); }
}
