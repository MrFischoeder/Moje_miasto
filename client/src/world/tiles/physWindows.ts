// Fizyczne okna przy graczu: rama, słupek, parapet i szyba jako geometria (instancje) na ścianach budynków.
// Rozmieszczenie dokładnie jak okna z shadera (windows.ts), które dalej rysują okna w oddali.
// Dane liczone w wątku kafli (computeTile), siatki tworzone tylko dla fragmentów kafla blisko kamery.
import * as THREE from 'three';
import { MAX_DOORS, type WindowUniforms } from './windows';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** liczb na okno: x, y, z (środek), kąt, szerokość, wysokość, los zapalenia */
export const WIN_STRIDE = 7;
/** okna rysowane fizycznie do tej odległości [m] */
export const WIN_R = 110;
const CELL = 100;

const fr = (x: number) => x - Math.floor(x);
/** ten sam los co w shaderze okien (zapalone nocą te same okna) */
export function winHash(ci: number, k: number, seed: number): number {
  let a = fr(ci * .1031), b = fr(k * .1031), c = fr(Math.floor(seed * 997 + .5) * .1031);
  const d = a * (c + 31.32) + b * (b + 31.32) + c * (a + 31.32); a += d; b += d; c += d;
  return fr((a + b) * c);
}

/** Okna jednej ściany (a→c) budynku; parametry jak atrybuty aFacA/B/C shadera. */
export function wallWindows(out: number[], a: [number, number], c: [number, number], nrm: number[], base: number, y0: number, y1: number,
  levelH: number, spacing: number, ww: number, wh: number, raise: number, sill: number, levels: number, seed: number): void {
  const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
  if (L <= .5 || spacing <= .5 || levelH <= 0) return;
  const n = Math.floor((L - .6) / spacing); if (n < 1) return;
  const off = (L - n * spacing) / 2, ux = dx / L, uz = dz / L, yaw = Math.atan2(nrm[0], nrm[2]);
  for (let k = 0; k < levels; k++) {
    const yc = base + raise + k * levelH + sill + wh / 2;
    if (yc - wh / 2 < y0 - .01 || yc + wh / 2 > y1 + .01) continue;
    for (let ci = 0; ci < n; ci++) {
      const s = off + (ci + .5) * spacing;
      out.push(a[0] + ux * s, yc, a[1] + uz * s, yaw, ww, wh, winHash(ci, k, seed));
    }
  }
}

/** bez ścianki od strony muru (niewidoczna): mniej trójkątów */
function dropBack(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), keep: number[] = [];
  for (let i = 0; i < P.count; i += 3) if (N.getZ(i) > -.5) keep.push(i, i + 1, i + 2);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep.flatMap(i => [P.getX(i), P.getY(i), P.getZ(i)]), 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(keep.flatMap(i => [N.getX(i), N.getY(i), N.getZ(i)]), 3));
  return out;
}

// --- geometria jednego okna (1 x 1 m, oś z na zewnątrz ściany) ---
function unitWindow(): THREE.BufferGeometry {
  const parts: [number, number, number, number, number, number, [number, number, number], number][] = [
    // szer., wys., głęb., x, y, z, kolor, szyba
    [1, .09, .09, 0, .455, .045, [.93, .93, .9], 0], [1, .09, .09, 0, -.455, .045, [.93, .93, .9], 0],
    [.09, 1, .09, .455, 0, .045, [.93, .93, .9], 0], [.09, 1, .09, -.455, 0, .045, [.93, .93, .9], 0],
    [1.16, .07, .2, 0, -.535, .1, [.62, .62, .6], 0], // parapet
  ];
  const gs: THREE.BufferGeometry[] = [];
  for (const [w, h, d, x, y, z, col, gl] of parts) {
    const g = dropBack(new THREE.BoxGeometry(w, h, d).toNonIndexed()); g.translate(x, y, z); gs.push(g);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => col).flat(), 3));
    g.setAttribute('aGlass', new THREE.Float32BufferAttribute(new Array(n).fill(gl), 1));
  }
  const glass = new THREE.PlaneGeometry(.92, .92).toNonIndexed(); glass.translate(0, 0, .012); glass.deleteAttribute('uv');
  const n = glass.getAttribute('position').count;
  glass.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [.16, .22, .3]).flat(), 3));
  glass.setAttribute('aGlass', new THREE.Float32BufferAttribute(new Array(n).fill(1), 1));
  gs.push(glass);
  return mergeGeometries(gs)!;
}

export class WindowMaterials {
  readonly geo = unitWindow();
  readonly uLit = { value: 0 };
  readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  /** wejścia do budynków (te same co w shaderze ścian): okna w strefie bramy nie są rysowane */
  private doors: WindowUniforms | null = null;
  useDoors(d: WindowUniforms): void { this.doors = d; this.mat.needsUpdate = true; }
  constructor() {
    const U = this.uLit;
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uLit = U;
      const D = this.doors; if (D) Object.assign(sh.uniforms, { uDoorA: D.uDoorA, uDoorB: D.uDoorB, uDoorN: D.uDoorN });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlass; attribute float aHash; uniform float uLit; varying float vLitW; varying vec3 vWPosD;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vLitW = aGlass * step(aHash, uLit);
#ifdef USE_INSTANCING
vWPosD = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; // środek okna: całe okno znika albo zostaje
#else
vWPosD = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vLitW; varying vec3 vWPosD;
uniform vec4 uDoorA[${MAX_DOORS}]; uniform vec4 uDoorB[${MAX_DOORS}]; uniform int uDoorN;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${MAX_DOORS}; i++) {
  if (i >= uDoorN) break;
  vec4 a = uDoorA[i]; vec4 b = uDoorB[i]; vec2 d = vWPosD.xz - a.xy;
  if (abs(dot(d, a.zw)) < b.z + 1.3 && abs(dot(d, vec2(-a.w, a.z))) < 1.2 && vWPosD.y > b.x - 0.3 && vWPosD.y < b.y + 1.1) discard;
}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * 0.85 * vLitW;');
    };
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

interface Chunk { cx: number; cz: number; data: Float32Array; mesh: THREE.InstancedMesh | null }

/** Okna jednego kafla: podział na pola 100 m, siatki tylko dla pól blisko kamery. */
export class TileWindows {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  constructor(data: Float32Array, private M: WindowMaterials) {
    this.group.name = 'okna';
    const cells = new Map<string, number[]>();
    for (let i = 0; i < data.length; i += WIN_STRIDE) {
      const k = Math.floor(data[i] / CELL) + ',' + Math.floor(data[i + 2] / CELL);
      let l = cells.get(k); if (!l) cells.set(k, l = []); for (let j = 0; j < WIN_STRIDE; j++) l.push(data[i + j]);
    }
    for (const [k, l] of cells) { const [i, j] = k.split(',').map(Number); this.chunks.push({ cx: (i + .5) * CELL, cz: (j + .5) * CELL, data: new Float32Array(l), mesh: null }); }
  }

  update(x: number, z: number): void {
    for (const c of this.chunks) {
      const near = Math.hypot(c.cx - x, c.cz - z) < WIN_R + CELL * .71;
      if (near && !c.mesh) this.group.add(c.mesh = this.build(c.data));
      else if (!near && c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.dispose(); c.mesh = null; }
    }
  }

  private build(d: Float32Array): THREE.InstancedMesh {
    const n = d.length / WIN_STRIDE, im = new THREE.InstancedMesh(this.M.geo, this.M.mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const hash = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * WIN_STRIDE;
      p.set(d[o], d[o + 1], d[o + 2]); q.setFromAxisAngle(Y, d[o + 3]); s.set(d[o + 4], d[o + 5], 1);
      im.setMatrixAt(i, m.compose(p, q, s)); hash[i] = d[o + 6];
    }
    im.geometry = this.M.geo.clone(); // atrybut instancji (los zapalenia) jest osobny dla każdej siatki
    im.geometry.setAttribute('aHash', new THREE.InstancedBufferAttribute(hash, 1));
    im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix();
    return im;
  }

  dispose(): void { for (const c of this.chunks) if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.dispose(); c.mesh = null; } }
}
