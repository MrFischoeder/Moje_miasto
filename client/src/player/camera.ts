// Kamera: pierwsza osoba pieszo, pościgowa albo z kokpitu w pojazdach.
import type * as THREE from 'three';
import type { BuildingIndex } from '@miasto/shared/world/collision';

export interface VehiclePose { x: number; y: number; z: number; yaw: number; roll: number; kind: 'car' | 'heli' }

export class CameraRig {
  /** kamera z kokpitu */
  fp = false;
  /** odchylenie kamery pojazdu sterowane myszą / dotykiem */
  off = 0; pit = 0;
  private lastLook = 0;
  private snap = true;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Natychmiastowe ustawienie kamery przy następnej klatce (zmiana trybu, teleport). */
  reset(): void { this.off = 0; this.pit = 0; this.snap = true; }
  toggleFP(): void { this.fp = !this.fp; this.snap = true; }

  look(dx: number, dy: number, now: number): void {
    this.off -= dx * .004; this.pit = Math.max(-.6, Math.min(1.2, this.pit + dy * .003)); this.lastLook = now;
  }

  walk(x: number, y: number, z: number, yaw: number, pitch: number, bob: number): void {
    this.camera.position.set(x, y + 1.7 + bob, z); this.camera.rotation.set(pitch, yaw, 0);
  }

  /** Kamera pościgowa: dist za pojazdem, h nad nim, patrzy na lookH. */
  chase(V: VehiclePose, dist: number, h: number, lookH: number, dt: number, now: number, B: BuildingIndex): void {
    const cam = this.camera;
    if (now - this.lastLook > 2000) { this.off *= Math.max(0, 1 - 2 * dt); this.pit *= Math.max(0, 1 - 2 * dt); }
    if (this.fp) {
      const fx = -Math.sin(V.yaw), fz = -Math.cos(V.yaw), hd = V.kind === 'car' ? [1.25, .2] : [1.7, 2.2];
      cam.position.set(V.x - fx * hd[1], V.y + hd[0], V.z - fz * hd[1]);
      cam.rotation.set(this.pit - (V.kind === 'heli' ? .2 : .03), V.yaw + this.off, V.kind === 'heli' ? V.roll : 0); return;
    }
    const yaw = V.yaw + this.off, pit = Math.max(-.1, Math.min(1.3, .22 + this.pit));
    const tx = V.x + Math.sin(yaw) * dist * Math.cos(pit), tz = V.z + Math.cos(yaw) * dist * Math.cos(pit), ty = V.y + h + Math.sin(pit) * dist;
    const k = this.snap ? 1 : 1 - Math.exp(-7 * dt); this.snap = false;
    cam.position.x += (tx - cam.position.x) * k; cam.position.y += (ty - cam.position.y) * k; cam.position.z += (tz - cam.position.z) * k;
    cam.position.y = Math.max(cam.position.y, B.top(cam.position.x, cam.position.z) + .6, .6);
    cam.lookAt(V.x, V.y + lookH, V.z);
  }
}
