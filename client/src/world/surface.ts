// Powierzchnia: budynki (obrys wyciągnięty w górę), ulice jako linie, grunt z otworami nad zejściami.
import * as THREE from 'three';
import type { Proj } from '@miasto/shared/data/projection';
import type { Feature } from '@miasto/shared/osm/features';
import { heightOf } from '@miasto/shared/osm/heights';
import type { XZ } from '@miasto/shared/world/collision';
import { projectRing, type World } from '@miasto/shared/world/world';
import { MAX_SEG } from './geometry';

export interface SurfaceView { objects: THREE.Object3D[]; buildMat: THREE.MeshLambertMaterial; edgeMat: THREE.LineBasicMaterial; count: number }

export function buildSurface(feats: Feature[], proj: Proj): SurfaceView {
  const solids: THREE.BufferGeometry[] = [], cols: [number, number, number][] = [], edges: THREE.BufferGeometry[] = [], rp: number[] = []; let nb = 0;
  for (const f of feats) {
    if (f.k === 'p') continue;
    const pts = projectRing(f.pts, proj);
    if (f.k === 'r') {
      // ulice tnięte na odcinki do 20 m
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / MAX_SEG));
        for (let k = 0; k < n; k++) rp.push(x0 + (x1 - x0) * k / n, .06, z0 + (z1 - z0) * k / n, x0 + (x1 - x0) * (k + 1) / n, .06, z0 + (z1 - z0) * (k + 1) / n);
      }
      continue;
    }
    if (pts.length < 3) continue; const { h, mh } = heightOf(f.tags);
    let g: THREE.BufferGeometry;
    try { g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: h - mh, bevelEnabled: false }); } catch { continue; }
    g.rotateX(-Math.PI / 2); g.translate(0, mh, 0); if (g.index) g = g.toNonIndexed();
    const v = .05 + Math.min(h, 80) / 80 * .09; cols.push([v * .55, v * 1.1, v * .8]); solids.push(g); edges.push(new THREE.EdgesGeometry(g, 25)); nb++;
  }
  const buildMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x7dffb0, transparent: true });
  const objects: THREE.Object3D[] = [];
  if (solids.length) objects.push(new THREE.Mesh(merge(solids, cols), buildMat));
  if (edges.length) objects.push(new THREE.LineSegments(merge(edges, null), edgeMat));
  if (rp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); objects.push(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: .7 }))); }
  return { objects, buildMat, edgeMat, count: nb };
}

/** Scala geometrie w jedną; z kolorami (jeden kolor na bryłę) i normalnymi albo same pozycje. */
function merge(list: THREE.BufferGeometry[], cols: [number, number, number][] | null): THREE.BufferGeometry {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), no = cols && new Float32Array(n * 3), co = cols && new Float32Array(n * 3); let o = 0;
  list.forEach((g, gi) => {
    const c = g.attributes.position.count; pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (cols && no && co) { no.set(g.attributes.normal.array as Float32Array, o * 3); for (let i = 0; i < c; i++) co.set(cols[gi], (o + i) * 3); }
    o += c; g.dispose();
  });
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (no && co) { m.setAttribute('normal', new THREE.BufferAttribute(no, 3)); m.setAttribute('color', new THREE.BufferAttribute(co, 3)); }
  return m;
}

/** Grunt: prostokąt wokół stacji i budynków z otworami nad zejściami. */
export function buildGround(world: World, holes: XZ[][], xray: boolean): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const s of world.stations) { a = Math.min(a, s.x); b = Math.max(b, s.x); c = Math.min(c, s.z); d = Math.max(d, s.z); }
  for (const p of world.buildings.polys) { a = Math.min(a, p.a); b = Math.max(b, p.b); c = Math.min(c, p.c); d = Math.max(d, p.d); }
  a -= 800; b += 800; c -= 800; d += 800;
  const sh = new THREE.Shape([new THREE.Vector2(a, -c), new THREE.Vector2(b, -c), new THREE.Vector2(b, -d), new THREE.Vector2(a, -d)]);
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x020604, transparent: xray, opacity: xray ? .12 : 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const mesh = new THREE.Mesh(g, mat); mesh.position.y = -.03;
  return { mesh, mat };
}
