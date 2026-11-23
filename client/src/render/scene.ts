// Scena, kamera, światła, mgła i siatka gruntu.
import * as THREE from 'three';
import { daylight, skyColor } from './palette';

// Prototyp działał na three.js r128 bez zarządzania kolorami; wyłączamy je,
// żeby kolory wierzchołków i materiałów wyglądały identycznie.
THREE.ColorManagement.enabled = false;

export interface SceneCtx {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  grid: THREE.LineSegments; fog: THREE.Fog;
  hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight;
}

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fc6e6);
  const fog = new THREE.Fog(0x9fc6e6, 40, 650); scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000); camera.rotation.order = 'YXZ';
  // Od r155 światła są fizyczne; mnożnik π odtwarza jasność dawnych świateł z r128.
  // low-poly: światło nieba i ziemi + słońce (płaskie cieniowanie ścian); natężenie wg pory dnia (applyDaylight)
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6a6458, 0.75 * Math.PI); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.8 * Math.PI); sun.position.set(0.45, 1, 0.25); scene.add(sun);
  const grid = makeGrid(); grid.visible = false; scene.add(grid);
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  return { renderer, scene, camera, grid, fog, hemi, sun };
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

/** Pora dnia: barwa nieba i mgły, natężenie i kierunek słońca, światło otoczenia (noc nie jest całkiem czarna). */
export function applyDaylight(ctx: SceneCtx, hour: number, underground = false): void {
  const d = daylight(hour), sky = skyColor(hour);
  if (underground) sky.setRGB(.05, .06, .07);
  (ctx.scene.background as THREE.Color).copy(sky); ctx.fog.color.copy(sky);
  ctx.hemi.intensity = (.14 + .44 * d) * Math.PI; ctx.sun.intensity = .62 * d * Math.PI;
  const a = ((hour - 6) / 12) * Math.PI; ctx.sun.position.set(Math.cos(a) * .8, Math.max(.15, Math.sin(a)), .35);
}
