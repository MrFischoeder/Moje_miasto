// Pojazdy komunikacji miejskiej: wszystkie w pobliżu w jednym dynamicznym buforze (jeden mesh + jedne linie),
// przebudowywanym co klatkę z rozkładu i zegara. Składy (tramwaj, metro, pociąg) mają wagony na łukach toru.
import * as THREE from 'three';
import type { TransitSystem } from '@miasto/shared/transit/system';
import { LENGTH, type ActiveTrip, type TransitKind } from '@miasto/shared/transit/timetable';
import { hex, type RGB } from '@miasto/shared/util/rng';

/** wagon: długość, szerokość, wysokość, prześwit */
const CAR: Record<TransitKind, { n: number; w: number; h: number; lift: number }> = {
  bus: { n: 1, w: 2.55, h: 3.1, lift: .35 }, tram: { n: 3, w: 2.4, h: 3.3, lift: .35 }, metro: { n: 6, w: 2.7, h: 3.6, lift: .1 },
  rail: { n: 5, w: 2.9, h: 4.0, lift: .2 }, ferry: { n: 1, w: 7, h: 3, lift: -1 }, cable: { n: 1, w: 2.5, h: 2.6, lift: 6 },
};
const DEFAULT_COL: Record<TransitKind, string> = { bus: '#d8213a', tram: '#e8b400', metro: '#3b7ddd', rail: '#2fa36b', ferry: '#66e0ff', cable: '#ff8a3d' };

class Dyn {
  P = new Float32Array(0); C = new Float32Array(0); n = 0;
  readonly geo = new THREE.BufferGeometry();
  reset(): void { this.n = 0; }
  push(x: number, y: number, z: number, c: RGB): void {
    if (this.n * 3 + 3 > this.P.length) { const P = new Float32Array(Math.max(3072, this.P.length * 2)), C = new Float32Array(P.length); P.set(this.P); C.set(this.C); this.P = P; this.C = C; }
    const i = this.n * 3; this.P[i] = x; this.P[i + 1] = y; this.P[i + 2] = z; this.C[i] = c[0]; this.C[i + 1] = c[1]; this.C[i + 2] = c[2]; this.n++;
  }
  flush(): void {
    const g = this.geo, cap = this.P.length;
    if (!g.getAttribute('position') || (g.getAttribute('position') as THREE.BufferAttribute).array.length !== cap) {
      g.setAttribute('position', new THREE.BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.C, 3));
    }
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true; (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n); g.computeBoundingSphere();
  }
}

export class TransitView {
  readonly group = new THREE.Group();
  private fill = new Dyn(); private lines = new Dyn();
  private colors = new Map<number, [RGB, RGB]>();
  private signs = new Map<string, THREE.Sprite>();
  /** ostatnio widziane kursy (minimapa, HUD) */
  visible: ActiveTrip[] = [];

  constructor(private sys: TransitSystem, lineColors: Record<string, string> = {}) {
    for (const [i, r] of sys.tt.data.routes.entries()) {
      const c = hex(lineColors[r.n] || (r.c && r.c !== '#FFFFFF' && r.c !== '#ffffff' ? r.c : DEFAULT_COL[r.t]));
      this.colors.set(i, [[c[0] * .22 + .02, c[1] * .22 + .02, c[2] * .22 + .02], c]);
    }
    const m = new THREE.Mesh(this.fill.geo, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide }));
    const l = new THREE.LineSegments(this.lines.geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    m.frustumCulled = l.frustumCulled = false; this.group.add(m, l);
  }

  /** Przebudowa dla pojazdów w promieniu R od (x, z); `hide` = kurs, którym jedzie gracz w widoku z wnętrza. */
  update(x: number, z: number, R: number, hide: string | null = null): void {
    this.fill.reset(); this.lines.reset();
    this.visible = this.sys.near([x - R, z - R, x + R, z + R]);
    const near = new Set<string>();
    for (const a of this.visible) {
      if (a.key === hide) continue;
      const k = a.p.kind, spec = CAR[k], L = LENGTH[k], cl = L / spec.n, [fc, ec] = this.colors.get(a.p.route)!;
      for (let j = 0; j < spec.n; j++) {
        const s1 = a.st.s + L / 2 - j * cl, s0 = s1 - cl + .6;
        const A = this.sys.pose(a.p, s0), B = this.sys.pose(a.p, s1);
        this.car(A, B, spec.w, spec.h, spec.lift, fc, ec, j === 0);
      }
      // numer linii nad czołem (tylko blisko)
      const front = this.sys.pose(a.p, a.st.s + L / 2);
      if (Math.abs(front.x - x) < 90 && Math.abs(front.z - z) < 90 && k !== 'ferry') {
        near.add(a.key); let sp = this.signs.get(a.key);
        if (!sp) { sp = this.sign(this.sys.tt.data.routes[a.p.route].n, a.p.head, ec); this.signs.set(a.key, sp); this.group.add(sp); }
        sp.position.set(front.x, front.y + spec.h + spec.lift + .9, front.z);
      }
    }
    for (const [key, sp] of this.signs) if (!near.has(key)) { this.group.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); this.signs.delete(key); }
    this.fill.flush(); this.lines.flush();
  }

  /** Wagon jako prostopadłościan od punktu A (tył) do B (przód), z pasem okien i drzwiami. */
  private car(A: { x: number; y: number; z: number }, B: { x: number; y: number; z: number }, w: number, h: number, lift: number, fc: RGB, ec: RGB, front: boolean): void {
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2;
    const c = (p: typeof A, s: number, y: number): number[] => [p.x + nx * s, p.y + lift + y, p.z + nz * s];
    const q = [c(A, -1, 0), c(B, -1, 0), c(B, 1, 0), c(A, 1, 0), c(A, -1, h), c(B, -1, h), c(B, 1, h), c(A, 1, h)];
    const F = this.fill, Ln = this.lines, tri = (i: number, j: number, k: number) => { for (const v of [q[i], q[j], q[k]]) F.push(v[0], v[1], v[2], fc); };
    // ściany i dach (bez podłogi)
    for (const [a, b, cc, d] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) { tri(a, b, cc); tri(a, cc, d); }
    const seg = (u: number[], v: number[], col: RGB) => { Ln.push(u[0], u[1], u[2], col); Ln.push(v[0], v[1], v[2], col); };
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg(q[a], q[b], ec);
    // pas okien po obu stronach
    const win: RGB = [ec[0] * .5 + .4, ec[1] * .5 + .4, ec[2] * .5 + .4];
    for (const sd of [-1, 1]) { seg(c(A, sd, h * .45), c(B, sd, h * .45), win); seg(c(A, sd, h * .85), c(B, sd, h * .85), win); }
    if (front) { const m = (p: number[], r: number[]) => [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2, (p[2] + r[2]) / 2]; seg(m(q[1], q[5]), m(q[2], q[6]), [1, 1, .85]); }
  }

  private sign(num: string, head: string, col: RGB): THREE.Sprite {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d')!;
    x.fillStyle = 'rgba(0,0,0,.8)'; x.fillRect(0, 0, 512, 96);
    x.fillStyle = `rgb(${col.map(v => Math.round(v * 255)).join(',')})`; x.fillRect(0, 0, 130, 96);
    x.font = '700 54px "Chakra Petch", sans-serif'; x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(num.slice(0, 5), 65, 50);
    x.textAlign = 'left'; let fs = 36; x.font = `600 ${fs}px "Chakra Petch", sans-serif`; while (x.measureText(head).width > 360 && fs > 16) { fs -= 2; x.font = `600 ${fs}px "Chakra Petch", sans-serif`; }
    x.fillText(head, 146, 50);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })); sp.scale.set(5, .94, 1); return sp;
  }

  dispose(): void {
    for (const sp of this.signs.values()) { sp.material.map?.dispose(); sp.material.dispose(); }
    this.fill.geo.dispose(); this.lines.geo.dispose();
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.material) (m.material as THREE.Material).dispose(); });
  }
}
