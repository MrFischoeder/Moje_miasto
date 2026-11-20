// Scena, kamera, światła, mgła i siatka gruntu.
import * as THREE from 'three';

// Prototyp działał na three.js r128 bez zarządzania kolorami; wyłączamy je,
// żeby kolory wierzchołków i materiałów wyglądały identycznie.
THREE.ColorManagement.enabled = false;

export interface SceneCtx {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  grid: THREE.LineSegments; fog: THREE.Fog;
}

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x030806);
  const fog = new THREE.Fog(0x030806, 40, 650); scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000); camera.rotation.order = 'YXZ';
  // Od r155 światła są fizyczne; mnożnik π odtwarza jasność dawnych świateł z r128.
  scene.add(new THREE.HemisphereLight(0x9fffd0, 0x0a1a12, 0.9 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI); sun.position.set(0.4, 1, 0.3); scene.add(sun);
  const grid = makeGrid(); scene.add(grid);
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  return { renderer, scene, camera, grid, fog };
}

/** Siatka gruntu: własne odcinki po 20 m (zamiast GridHelper), przesuwana za graczem. */
function makeGrid(): THREE.LineSegments {
  const p: number[] = [], c: number[] = [], H = 500, a = [.18, .54, .36], b = [.11, .33, .22];
  for (let i = -H; i <= H; i += 10) {
    const col = i % 50 ? b : a;
    for (let t = -H; t < H; t += 20) { p.push(i, 0, t, i, 0, t + 20, t, 0, i, t + 20, 0, i); c.push(...col, ...col, ...col, ...col); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })); l.frustumCulled = false; return l;
}

/** Siatka gruntu: dopasowanie wysokości wierzchołków do terenu po przesunięciu (bez terenu: płaska). */
export class GridDrape {
  private base: Float32Array | null = null;
  private key = '';
  constructor(private grid: THREE.LineSegments) {}
  update(ox: number, oz: number, scale: number, ground: ((x: number, z: number) => number) | null): void {
    const k = ground ? `${ox},${oz},${scale}` : 'flat'; if (k === this.key) return; this.key = k;
    const pos = this.grid.geometry.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array;
    if (!this.base) this.base = a.slice();
    for (let i = 0; i < a.length; i += 3) a[i + 1] = ground ? ground(ox + this.base[i] * scale, oz + this.base[i + 2] * scale) + .12 : 0;
    pos.needsUpdate = true;
  }
}
