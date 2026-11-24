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

const hashKey = (k: string) => { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return Math.abs(h) % 1000; };

export class TransitView {
  readonly group = new THREE.Group();
  private fill = new Dyn(); private lines = new Dyn(); private glass = new Dyn();
  private colors = new Map<number, [RGB, RGB]>();
  private mats: (THREE.MeshBasicMaterial | THREE.LineBasicMaterial)[] = [];
  /** materiały bez oświetlenia: przyciemnienie nocą (wnętrza pojazdów lekko jaśniejsze – oświetlenie w środku) */
  setLight(day: number): void { const k = .3 + .7 * day; for (const m of this.mats) m.color.setScalar(k); }
  private signs = new Map<string, THREE.Sprite>();
  /** ostatnio widziane kursy (minimapa, HUD) */
  visible: ActiveTrip[] = [];

  constructor(private sys: TransitSystem, lineColors: Record<string, string> = {}) {
    for (const [i, r] of sys.tt.data.routes.entries()) {
      const c = hex(lineColors[r.n] || (r.c && r.c !== '#FFFFFF' && r.c !== '#ffffff' ? r.c : DEFAULT_COL[r.t]));
      this.colors.set(i, [c, [c[0] * .35, c[1] * .35, c[2] * .35]]); // low-poly: pełny kolor linii, ciemniejsze krawędzie
    }
    const m = new THREE.Mesh(this.fill.geo, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide }));
    const l = new THREE.LineSegments(this.lines.geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    // szyby: półprzezroczyste (widać pasażerów), bez zapisu głębi
    const g = new THREE.Mesh(this.glass.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide }));
    g.renderOrder = 2; m.frustumCulled = l.frustumCulled = g.frustumCulled = false; this.group.add(m, l, g);
    this.mats = [m.material as THREE.MeshBasicMaterial, l.material as THREE.LineBasicMaterial, g.material as THREE.MeshBasicMaterial];
  }

  /** Przebudowa dla pojazdów w promieniu R od (x, z); `hide` = kurs, którym jedzie gracz w widoku z wnętrza. */
  update(x: number, z: number, R: number, hide: string | null = null): void {
    this.fill.reset(); this.lines.reset(); this.glass.reset();
    this.visible = this.sys.near([x - R, z - R, x + R, z + R]);
    const near = new Set<string>();
    for (const a of this.visible) {
      if (a.key === hide) continue;
      const k = a.p.kind, spec = CAR[k], L = LENGTH[k], cl = L / spec.n, [fc, ec] = this.colors.get(a.p.route)!;
      for (let j = 0; j < spec.n; j++) {
        const s1 = a.st.s + L / 2 - j * cl, s0 = s1 - cl + .6;
        const A = this.sys.pose(a.p, s0), B = this.sys.pose(a.p, s1);
        this.car(A, B, spec.w, spec.h, spec.lift, fc, ec, j === 0, j === spec.n - 1, k, hashKey(a.key) + j * 7);
      }
      // numer linii nad czołem (tylko blisko)
      const front = this.sys.pose(a.p, a.st.s + L / 2);
      if (Math.abs(front.x - x) < 90 && Math.abs(front.z - z) < 90 && k !== 'ferry') {
        near.add(a.key); let sp = this.signs.get(a.key);
        if (!sp) { sp = this.sign(this.sys.tt.data.routes[a.p.route].n, a.p.head, fc); this.signs.set(a.key, sp); this.group.add(sp); }
        sp.position.set(front.x, front.y + spec.h + spec.lift + .9, front.z);
      }
    }
    for (const [key, sp] of this.signs) if (!near.has(key)) { this.group.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); this.signs.delete(key); }
    this.fill.flush(); this.lines.flush(); this.glass.flush();
  }

  /**
   * Wagon / autobus od A (tył) do B (przód): dolna część i dach nieprzezroczyste, pas przezroczystych okien
   * ze słupkami, skośna przednia szyba (czoło składu), drzwi po prawej stronie, podłoga, fotele i pasażerowie.
   * Barwy: tramwaj biały z niebieskim pasem dolnym, autobus biały; kolor linii jako pas pod oknami.
   */
  private car(A: { x: number; y: number; z: number }, B: { x: number; y: number; z: number }, w: number, h: number, lift: number, fc: RGB, ec: RGB, front: boolean, rear: boolean, kind: TransitKind, seed: number): void {
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, nx = -uz * w / 2, nz = ux * w / 2;
    const c = (p: typeof A, s: number, y: number, du = 0): number[] => [p.x + nx * s + ux * du, p.y + lift + y, p.z + nz * s + uz * du];
    const F = this.fill, G = this.glass, Ln = this.lines;
    const tri = (D: Dyn, a: number[], b: number[], cc: number[], col: RGB) => { for (const v of [a, b, cc]) D.push(v[0], v[1], v[2], col); };
    const quad = (D: Dyn, a: number[], b: number[], cc: number[], d: number[], col: RGB) => { tri(D, a, b, cc, col); tri(D, a, cc, d, col); };
    const city = kind === 'tram' || kind === 'bus';
    const body: RGB = city ? [.94, .94, .92] : fc, low: RGB = kind === 'tram' ? [.1, .26, .55] : city ? [.22, .24, .28] : [fc[0] * .7, fc[1] * .7, fc[2] * .7];
    const glassC: RGB = [.55, .72, .82], frame: RGB = [.16, .17, .19];
    const yw0 = h * .36, yw1 = h * .86, inset = front ? .55 : 0; // wysokość pasa okien; czoło skośne
    const P = (t: number, s: number, y: number, du = 0) => { const q = { x: A.x + dx * t, y: A.y + (B.y - A.y) * t, z: A.z + dz * t }; return c(q, s, y, du); };
    for (const s of [-1, 1]) {
      const k = s > 0 ? .8 : .7, sh = (col: RGB): RGB => [col[0] * k, col[1] * k, col[2] * k];
      quad(F, P(0, s, 0), P(1, s, 0), P(1, s, yw0 * .45), P(0, s, yw0 * .45), sh(low));       // pas dolny
      quad(F, P(0, s, yw0 * .45), P(1, s, yw0 * .45), P(1, s, yw0 - .12), P(0, s, yw0 - .12), sh(body));
      quad(F, P(0, s, yw0 - .12), P(1, s, yw0 - .12), P(1, s, yw0), P(0, s, yw0), sh(city ? fc : body)); // pas w kolorze linii
      quad(F, P(0, s, yw1), P(1, s, yw1), P(1, s, h), P(0, s, h), sh(body));                    // nad oknami
      // okna ze słupkami co ok. 1,7 m; drzwi (prawa strona) w stałych miejscach
      const n = Math.max(2, Math.round(L / 1.7)), doors = s > 0 ? (kind === 'bus' ? [.12, .5, .86] : [.2, .72]) : [];
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, door = doors.some(d => d >= t0 && d < t1);
        if (door) { quad(F, P(t0 + .01, s * 1.003, .1), P(t1 - .01, s * 1.003, .1), P(t1 - .01, s * 1.003, yw1), P(t0 + .01, s * 1.003, yw1), [.3, .32, .35]); quad(G, P(t0 + .02, s * 1.006, yw0 * .5), P(t1 - .02, s * 1.006, yw0 * .5), P(t1 - .02, s * 1.006, yw1 - .1), P(t0 + .02, s * 1.006, yw1 - .1), glassC); continue; }
        quad(G, P(t0, s, yw0), P(t1, s, yw0), P(t1, s, yw1), P(t0, s, yw1), glassC);
        quad(F, P(t0, s * 1.004, yw0), P(t0 + .1 / L, s * 1.004, yw0), P(t0 + .1 / L, s * 1.004, yw1), P(t0, s * 1.004, yw1), frame);
      }
    }
    // dach, podłoga
    quad(F, P(0, -1, h), P(1 - (front ? inset / L : 0), -1, h), P(1 - (front ? inset / L : 0), 1, h), P(0, 1, h), [body[0] * 1.05, body[1] * 1.05, body[2] * 1.05].map(v => Math.min(1, v)) as RGB);
    quad(F, P(0, -1, .25), P(1, -1, .25), P(1, 1, .25), P(0, 1, .25), [.25, .26, .28]);
    // czoło: skośna szyba w składzie z przodu, inaczej ściana z przejściem
    const endWall = (t: number, out: number, isFront: boolean) => {
      if (isFront) {
        quad(F, P(t, -1, 0), P(t, 1, 0), P(t, 1, yw0 * .8), P(t, -1, yw0 * .8), low);
        const top = 1 - inset / L; quad(G, P(t, -1, yw0 * .8), P(t, 1, yw0 * .8), P(top, 1, h), P(top, -1, h), glassC);
        for (const s of [-1, 1]) tri(G, P(t, s, yw0 * .8), P(top, s, h), P(t, s, h), glassC);
        quad(F, P(t, -.6, yw0 * .45, out * .02), P(t, -.3, yw0 * .45, out * .02), P(t, -.3, yw0 * .6, out * .02), P(t, -.6, yw0 * .6, out * .02), [1, .96, .8]); // reflektory
        quad(F, P(t, .3, yw0 * .45, out * .02), P(t, .6, yw0 * .45, out * .02), P(t, .6, yw0 * .6, out * .02), P(t, .3, yw0 * .6, out * .02), [1, .96, .8]);
      } else quad(F, P(t, -1, 0), P(t, 1, 0), P(t, 1, h), P(t, -1, h), [body[0] * .75, body[1] * .75, body[2] * .75]);
    };
    endWall(1, 1, front); if (rear) endWall(0, -1, kind === 'tram' || kind === 'metro'); // tramwaj dwukierunkowy: czoło także z tyłu
    // fotele i pasażerowie (stałe dla kursu)
    const R = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
    const seatC: RGB = kind === 'tram' ? [.15, .3, .6] : [.55, .1, .12], skins: RGB[] = [[.95, .78, .66], [.86, .68, .52], [.6, .42, .3]], shirts: RGB[] = [[.25, .45, .7], [.7, .3, .25], [.3, .55, .35], [.85, .75, .3], [.35, .35, .4], [.6, .4, .65]];
    const box = (t: number, s: number, y0: number, y1: number, hw: number, hd: number, col: RGB) => {
      const q = (a: number, b: number, y: number) => P(t + a / L, s + b / (w / 2), y);
      quad(F, q(-hd, -hw, y1), q(hd, -hw, y1), q(hd, hw, y1), q(-hd, hw, y1), col);
      for (const [a0, b0, a1, b1] of [[-hd, -hw, hd, -hw], [hd, -hw, hd, hw], [hd, hw, -hd, hw], [-hd, hw, -hd, -hw]]) quad(F, q(a0, b0, y0), q(a1, b1, y0), q(a1, b1, y1), q(a0, b0, y1), [col[0] * .8, col[1] * .8, col[2] * .8]);
    };
    const rows = Math.max(2, Math.floor((L - 2) / 1.6));
    for (let i = 0; i < rows; i++) for (const s of [-.62, .62]) {
      const t = (1 + i * 1.6) / L; if (t > .92) continue;
      box(t, s, .25, .7, .38, .25, seatC);
      if (R(i * 2 + (s > 0 ? 1 : 0)) < .45) { const sh = shirts[Math.floor(R(i + 9) * shirts.length)], sk = skins[Math.floor(R(i + 3) * skins.length)]; box(t, s, .7, 1.3, .22, .14, sh); box(t, s, 1.3, 1.58, .13, .12, sk); }
    }
    const seg = (u: number[], v: number[], col: RGB) => { Ln.push(u[0], u[1], u[2], col); Ln.push(v[0], v[1], v[2], col); };
    for (const s of [-1, 1]) { seg(P(0, s, 0), P(1, s, 0), ec); seg(P(0, s, h), P(1 - (front ? inset / L : 0), s, h), ec); }
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
    this.fill.geo.dispose(); this.lines.geo.dispose(); this.glass.geo.dispose();
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.material) (m.material as THREE.Material).dispose(); });
  }
}
