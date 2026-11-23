// Obiekty miejskie low-poly na kaflu: drzewa (przy ulicach, w parkach, lasach i na cmentarzach), latarnie (z OSM
// i uzupełnione wzdłuż ulic), ławki w parkach, wiaty przystanków (z rozkładów komunikacji). Wszystko jako instancje:
// jedno wywołanie rysowania na rodzaj obiektu w kaflu. Rozmieszczenie z ziarna kafla: identyczne u każdego.
// Zasady: nie na jezdni, chodniku ani ścieżce, nie w budynku ani wodzie, nie przy skrzyżowaniach (widoczność).
// Na razie tylko wygląd (bez kolizji).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '@miasto/shared/util/rng';
import { isVehicleRoad } from '@miasto/shared/tiles/build';
import type { TileData } from '@miasto/shared/tiles/types';
import { pip, type XZ } from '@miasto/shared/world/collision';
import { toXZ, type World } from '@miasto/shared/world/world';

/** Przystanek: położenie słupka i kierunek jezdni. */
export interface StopPoint { x: number; z: number; yaw: number; kind: 'bus' | 'tram' }

// ---- geometrie wspólne (płaskie cieniowanie) ----
const flat = (g: THREE.BufferGeometry) => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; };
const G = {
  trunk: flat(new THREE.CylinderGeometry(.6, 1, 1, 5).translate(0, .5, 0)),
  crown: flat(new THREE.IcosahedronGeometry(1, 0)),
  cone: flat(new THREE.ConeGeometry(1, 1, 7).translate(0, .5, 0)),
  pole: flat(mergeGeometries([new THREE.CylinderGeometry(.07, .1, 7, 6).translate(0, 3.5, 0), new THREE.BoxGeometry(.08, .08, 1.6).translate(0, 6.95, .75)])),
  lampHead: flat(new THREE.BoxGeometry(.32, .14, .5).translate(0, 6.85, 1.45)),
  bench: flat(mergeGeometries([new THREE.BoxGeometry(1.8, .08, .45).translate(0, .45, 0), new THREE.BoxGeometry(1.8, .45, .07).translate(0, .75, .22),
    new THREE.BoxGeometry(.08, .45, .45).translate(-.8, .22, 0), new THREE.BoxGeometry(.08, .45, .45).translate(.8, .22, 0)])),
  shelter: flat(mergeGeometries([new THREE.BoxGeometry(4.2, .12, 1.6).translate(0, 2.55, 0), new THREE.BoxGeometry(.1, 2.5, .1).translate(-2, 1.25, .7),
    new THREE.BoxGeometry(.1, 2.5, .1).translate(2, 1.25, .7), new THREE.BoxGeometry(.1, 2.5, .1).translate(-2, 1.25, -.7), new THREE.BoxGeometry(.1, 2.5, .1).translate(2, 1.25, -.7),
    new THREE.BoxGeometry(2.2, .08, .4).translate(0, .48, .45)])),
  glass: flat(mergeGeometries([new THREE.BoxGeometry(4, 2.1, .04).translate(0, 1.35, .74), new THREE.BoxGeometry(.04, 2.1, 1.3).translate(-2, 1.35, 0)])),
};

/** Materiały obiektów (wspólne dla kafli); lampy świecą nocą (setNight). */
export class PropMaterials {
  readonly wood = new THREE.MeshLambertMaterial({ color: 0x6a4a30 });
  readonly leaves = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }); // kolor z instancji
  readonly metal = new THREE.MeshLambertMaterial({ color: 0x3a3e44 });
  readonly lamp = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffd890, emissiveIntensity: 0 });
  readonly bench = new THREE.MeshLambertMaterial({ color: 0x7a5434 });
  readonly shelter = new THREE.MeshLambertMaterial({ color: 0x50565e });
  readonly glass = new THREE.MeshLambertMaterial({ color: 0x9cc4d8, transparent: true, opacity: .45, depthWrite: false });
  /** 0 = dzień, 1 = noc */
  setNight(n: number): void { this.lamp.emissiveIntensity = n * 1.6; }
  dispose(): void { for (const m of [this.wood, this.leaves, this.metal, this.lamp, this.bench, this.shelter, this.glass]) m.dispose(); }
}

class Inst {
  readonly m: THREE.Matrix4[] = []; readonly c: THREE.Color[] = [];
  constructor(readonly geo: THREE.BufferGeometry, readonly mat: THREE.Material) {}
  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, col?: THREE.Color): void {
    this.m.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)));
    if (col) this.c.push(col);
  }
  mesh(): THREE.InstancedMesh | null {
    if (!this.m.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.c.length === this.m.length) this.c.forEach((c, i) => im.setColorAt(i, c));
    im.computeBoundingSphere(); return im;
  }
}

/** Indeks odcinków dróg i torów kafla (siatka 8 m) do sprawdzania odległości. */
class SegIndex {
  private g = new Map<string, number[]>(); private S: number[] = [];
  constructor(private cell = 8) {}
  add(ax: number, az: number, bx: number, bz: number, hw: number): void {
    const i = this.S.length; this.S.push(ax, az, bx, bz, hw);
    const r = hw + 4, c = this.cell;
    for (let x = Math.floor((Math.min(ax, bx) - r) / c); x <= Math.floor((Math.max(ax, bx) + r) / c); x++)
      for (let y = Math.floor((Math.min(az, bz) - r) / c); y <= Math.floor((Math.max(az, bz) + r) / c); y++) { const k = x + ',' + y; let l = this.g.get(k); if (!l) this.g.set(k, l = []); l.push(i); }
  }
  /** Czy punkt jest bliżej niż hw + m od któregoś odcinka. */
  near(x: number, z: number, m: number): boolean {
    const l = this.g.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)); if (!l) return false; const S = this.S;
    for (const i of l) {
      const ax = S[i], az = S[i + 1], dx = S[i + 2] - ax, dz = S[i + 3] - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < S[i + 4] + m) return true;
    }
    return false;
  }
}

const URBAN = ['primary', 'secondary', 'tertiary', 'residential', 'living'];
const LEAF = [new THREE.Color(.24, .42, .16), new THREE.Color(.3, .48, .18), new THREE.Color(.2, .36, .14), new THREE.Color(.36, .5, .2), new THREE.Color(.26, .4, .22)];
const NEEDLE = [new THREE.Color(.12, .28, .16), new THREE.Color(.16, .32, .18), new THREE.Color(.1, .24, .14)];

/** Obiekty jednego kafla. ground: wysokość terenu (null = płasko); stops: przystanki w kaflu. */
export function buildProps(t: TileData, M: PropMaterials, world: World | null, ground: ((x: number, z: number) => number) | null, stops: StopPoint[]): THREE.Object3D[] {
  const R = rng(`obiekty${t.x}_${t.y}`), Y = (x: number, z: number) => ground ? ground(x, z) : 0;
  const trunk = new Inst(G.trunk, M.wood), crown = new Inst(G.crown, M.leaves), cone = new Inst(G.cone, M.leaves);
  const pole = new Inst(G.pole, M.metal), head = new Inst(G.lampHead, M.lamp), bench = new Inst(G.bench, M.bench);
  const shelter = new Inst(G.shelter, M.shelter), glass = new Inst(G.glass, M.glass);
  const x0 = t.x * t.size, z0 = t.y * t.size, inTile = (x: number, z: number) => x >= x0 && x < x0 + t.size && z >= z0 && z < z0 + t.size;
  const blocked = (x: number, z: number) => !!world && world.blocked(x, z);
  // drogi, ścieżki, tory: zakazane pasy
  const segs = new SegIndex();
  for (const r of t.r) { if (r.tu) continue; const p = toXZ(r.p), hw = r.w / 2 + (r.sw || (isVehicleRoad(r.k) && URBAN.includes(r.k)) ? 2.6 : .2); for (let i = 0; i + 1 < p.length; i++) segs.add(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], hw); }
  for (const l of t.l) { const p = toXZ(l.p); for (let i = 0; i + 1 < p.length; i++) segs.add(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], 1.8); }
  // skrzyżowania i przejścia: wolne pole widzenia
  const keep: XZ[] = [...t.g.filter(g => g.jn).map(g => [g.x, g.z] as XZ)], cross: XZ[] = t.n.filter(n => n.k === 'crossing' || n.k === 'signals').map(n => [n.x, n.z]);
  const nearPt = (pts: XZ[], x: number, z: number, r: number) => pts.some(([a, b]) => Math.abs(a - x) < r && Math.abs(b - z) < r && Math.hypot(a - x, b - z) < r);
  let nTree = 0; const MAX_TREES = 4500;
  const tree = (x: number, z: number, kind: 'liść' | 'iglak' | 'topola', scale: number) => {
    if (nTree >= MAX_TREES) return; nTree++;
    const y = Y(x, z), yaw = R() * 6.28;
    if (kind === 'iglak') {
      const h = (7 + R() * 7) * scale; trunk.add(x, y, z, yaw, .22 * scale, h * .25, .22 * scale);
      cone.add(x, y + h * .18, z, yaw, h * .3, h * .85, h * .3, NEEDLE[Math.floor(R() * NEEDLE.length)]);
    } else {
      const h = (kind === 'topola' ? 3.5 : 2.4 + R() * 1.6) * scale, cr = (kind === 'topola' ? 1.5 : 2.2 + R() * 1.6) * scale;
      trunk.add(x, y, z, yaw, .2 * scale, h + cr * .4, .2 * scale);
      crown.add(x, y + h + cr * (kind === 'topola' ? 1.6 : .8), z, yaw, cr, cr * (kind === 'topola' ? 2.4 : .9 + R() * .25), cr, LEAF[Math.floor(R() * LEAF.length)]);
    }
  };

  // 1) drzewa w parkach, lasach i na cmentarzach (rozrzut po siatce z przesunięciem)
  const parks: XZ[][] = [];
  for (const a of t.a) {
    const spec = a.k === 'forest' ? { s: 6.5, p: .9, con: .55 } : a.k === 'park' ? { s: 12, p: .55, con: .12 } : a.k === 'cemetery' ? { s: 9, p: .7, con: .35 } : null;
    if (!spec) continue;
    const outer = toXZ(a.o), holes = (a.i || []).map(toXZ); if (a.k === 'park') parks.push(outer);
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity; for (const [x, z] of outer) { ax = Math.min(ax, x); bx = Math.max(bx, x); az = Math.min(az, z); bz = Math.max(bz, z); }
    for (let gx = Math.floor(ax / spec.s) * spec.s; gx < bx; gx += spec.s) for (let gz = Math.floor(az / spec.s) * spec.s; gz < bz; gz += spec.s) {
      const h = rng(`${Math.round(gx)},${Math.round(gz)}`); if (h() > spec.p) continue;
      const x = gx + h() * spec.s, z = gz + h() * spec.s;
      if (!inTile(x, z) || !pip(outer, x, z) || holes.some(r => pip(r, x, z)) || segs.near(x, z, 1.5) || blocked(x, z)) continue;
      tree(x, z, h() < spec.con ? 'iglak' : 'liść', .8 + h() * .5);
    }
  }
  // 2) szpalery drzew wzdłuż ulic miejskich (za chodnikiem), z przerwami przy skrzyżowaniach i przejściach
  for (const r of t.r) {
    if (r.tu || r.br || !isVehicleRoad(r.k) || !URBAN.includes(r.k)) continue;
    const p = toXZ(r.p), off = r.w / 2 + 3.6, step = 10 + (r.id % 4), topola = r.id % 9 === 0;
    let acc = R() * step;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < .1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (; acc < L; acc += step) for (const sd of [-1, 1]) {
        if (r.sw === 1 && sd > 0) continue; if (r.sw === 2 && sd < 0) continue;
        const x = ax + ux * acc - uz * off * sd, z = az + uz * acc + ux * off * sd;
        if (!inTile(x, z) || R() < .25 || nearPt(keep, x, z, 16) || nearPt(cross, x, z, 9) || segs.near(x, z, -.4) || blocked(x, z)) continue;
        tree(x, z, topola ? 'topola' : 'liść', .75 + R() * .35);
      }
      acc -= L;
    }
  }
  // 3) latarnie: punkty z OSM (ramię w stronę najbliższej jezdni) + uzupełnienie co ~32 m na ulicach miejskich
  const lamps: XZ[] = [];
  const lampAt = (x: number, z: number, yaw: number) => { const y = Y(x, z) + .15; pole.add(x, y, z, yaw, 1, 1, 1); head.add(x, y, z, yaw, 1, 1, 1); lamps.push([x, z]); };
  for (const n of t.n) if (n.k === 'lamp' && inTile(n.x, n.z)) {
    let best: [number, number] | null = null, bd = 30;
    for (const r of t.r) { if (!isVehicleRoad(r.k)) continue; const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((n.x - ax) * dx + (n.z - az) * dz) / L2));
      const qx = ax + dx * u, qz = az + dz * u, d = Math.hypot(qx - n.x, qz - n.z); if (d < bd) { bd = d; best = [qx, qz]; } } }
    lampAt(n.x, n.z, best ? Math.atan2(best[0] - n.x, best[1] - n.z) : R() * 6.28);
  }
  for (const r of t.r) {
    if (r.tu || !isVehicleRoad(r.k) || !['primary', 'secondary', 'tertiary', 'residential', 'trunk'].includes(r.k)) continue;
    const p = toXZ(r.p), off = r.w / 2 + .5; let acc = 8, side = r.id % 2 ? 1 : -1;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < .1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (; acc < L; acc += 32, side = -side) {
        const x = ax + ux * acc - uz * off * side, z = az + uz * acc + ux * off * side;
        if (!inTile(x, z) || nearPt(lamps, x, z, 22) || nearPt(keep, x, z, 7) || blocked(x, z)) continue;
        lampAt(x, z, Math.atan2(uz * side, -ux * side)); // ramię nad jezdnię
      }
      acc -= L;
    }
  }
  // 4) ławki przy alejkach w parkach (co ~28 m, przodem do alejki)
  for (const r of t.r) {
    if (!['footway', 'path', 'pedestrian'].includes(r.k) || r.tu || r.br) continue;
    const p = toXZ(r.p); let acc = 10 + R() * 10;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < .1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (; acc < L; acc += 28) {
        const sd = R() < .5 ? 1 : -1, off = r.w / 2 + .9, x = ax + ux * acc - uz * off * sd, z = az + uz * acc + ux * off * sd;
        if (!inTile(x, z) || !parks.some(o => pip(o, x, z)) || blocked(x, z)) continue;
        bench.add(x, Y(x, z), z, Math.atan2(-uz * sd, ux * sd), 1, 1, 1);
      }
      acc -= L;
    }
  }
  // 5) wiaty przystanków autobusowych i tramwajowych (z rozkładów), tyłem do chodnika
  for (const s of stops) {
    if (!inTile(s.x, s.z) || blocked(s.x, s.z)) continue;
    const y = Y(s.x, s.z) + .15; shelter.add(s.x, y, s.z, s.yaw, 1, 1, 1); glass.add(s.x, y, s.z, s.yaw, 1, 1, 1);
  }
  const out: THREE.Object3D[] = [];
  for (const i of [trunk, crown, cone, pole, head, bench, shelter, glass]) { const m = i.mesh(); if (m) out.push(m); }
  return out;
}
