// Fizyka pojazdów i chodzenia (przeniesiona 1:1 z prototypu).
import type { World } from '../world/world';
import type { Entity, InputCmd } from './types';

/** Pojazdy naziemne (wariant e.v): klasa, długość [m], prędkość zwykła / z dopalaniem [m/s], przyspieszenie, miejsca */
export interface VSpec { name: string; cls: 'car' | 'van' | 'truck' | 'moto' | 'scooter' | 'escooter'; len: number; max: number; boost: number; acc: number; seats: number }
export const VEH: VSpec[] = [
  { name: 'Hatchback', cls: 'car', len: 4.3, max: 28, boost: 45, acc: 8, seats: 4 },
  { name: 'Sedan', cls: 'car', len: 4.7, max: 28, boost: 46, acc: 8, seats: 4 },
  { name: 'Kombi', cls: 'car', len: 4.7, max: 28, boost: 45, acc: 7.6, seats: 4 },
  { name: 'SUV', cls: 'car', len: 4.6, max: 27, boost: 43, acc: 7.6, seats: 4 },
  { name: 'Auto miejskie', cls: 'car', len: 3.6, max: 25, boost: 38, acc: 7.4, seats: 3 },
  { name: 'Minivan', cls: 'car', len: 4.8, max: 26, boost: 40, acc: 7, seats: 4 },
  { name: 'Taksówka', cls: 'car', len: 4.7, max: 28, boost: 46, acc: 8, seats: 4 },
  { name: 'Auto sportowe', cls: 'car', len: 4.6, max: 33, boost: 58, acc: 10.5, seats: 1 },
  { name: 'Dostawczak', cls: 'van', len: 5.9, max: 25, boost: 33, acc: 6, seats: 2 },
  { name: 'Ciężarówka', cls: 'truck', len: 8.5, max: 22, boost: 26, acc: 4.5, seats: 1 },
  { name: 'Ciągnik z naczepą', cls: 'truck', len: 16, max: 22, boost: 25, acc: 3.6, seats: 1 },
  { name: 'Motocykl', cls: 'moto', len: 2.2, max: 32, boost: 60, acc: 11.5, seats: 1 },
  { name: 'Skuter', cls: 'scooter', len: 1.9, max: 15, boost: 19, acc: 6.5, seats: 1 },
  { name: 'Hulajnoga elektryczna', cls: 'escooter', len: 1.1, max: 6.9, boost: 6.9, acc: 3.5, seats: 0 },
];
/** losowy wariant pojazdu NPC (r w [0, 1)): głównie osobowe, trochę dostawczych, ciężarówek, jednośladów */
const NPC_W = [14, 12, 10, 10, 9, 6, 4, 3, 7, 3, 2, 2, 2, .6];
export function npcVariant(r: number): number { const s = NPC_W.reduce((a, b) => a + b, 0); let x = r * s; for (let i = 0; i < NPC_W.length; i++) { x -= NPC_W[i]; if (x <= 0) return i; } return 0; }
export const vspec = (e: { v?: number }) => VEH[e.v ?? 0] ?? VEH[0];

export function walkStep(e: Entity, cmd: InputCmd, dt: number, w: World): void {
  e.yaw = cmd.yaw; e.pitch = cmd.pitch;
  const { f, s } = cmd, sp = 4.5 * (cmd.run ? 3 : 1);
  if (!f && !s) return;
  const m = Math.min(1, Math.hypot(f, s)) / Math.hypot(f, s), sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  const dx = (-sy * f + cy * s) * m * sp * dt, dz = (-cy * f - sy * s) * m * sp * dt;
  const sup = (x: number, z: number) => w.support(x, z, e.y);
  let g = sup(e.x + dx, e.z + dz);
  if (g) { e.x += dx; e.z += dz; }
  else if ((g = sup(e.x + dx, e.z))) e.x += dx;
  else if ((g = sup(e.x, e.z + dz))) e.z += dz;
  if (g) { e.y = g.h; e.reg = g.r ? g.r.id : -1; }
}

export function carStep(e: Entity, cmd: InputCmd, dt: number, w: World): void {
  const sp = vspec(e), { f, s, run } = cmd, max = run ? sp.boost : sp.max;
  if (f > 0) e.speed = e.speed < 0 ? e.speed + 22 * dt : Math.min(max, e.speed + sp.acc * f * (run ? 1.7 : 1) * dt);
  else if (f < 0) e.speed = e.speed > 0 ? e.speed - 22 * dt : Math.max(-9, e.speed + 6 * f * dt);
  else e.speed *= Math.max(0, 1 - .45 * dt);
  if (cmd.brake) e.speed *= Math.max(0, 1 - 3 * dt);
  if (Math.abs(e.speed) < .08 && !f) e.speed = 0;
  const as = Math.abs(e.speed), turn = s * 1.6 / (1 + as / 18) * Math.min(1, as / 3) * Math.sign(e.speed), ny = e.yaw - turn * dt;
  const nx = e.x - Math.sin(ny) * e.speed * dt, nz = e.z - Math.cos(ny) * e.speed * dt;
  if (!w.carHit(nx, nz, ny, e.y)) { e.x = nx; e.z = nz; e.yaw = ny; }
  else { if (!w.carHit(e.x, e.z, ny, e.y)) e.yaw = ny; e.speed *= -.3; }
  e.y = w.surfaceAt(e.x, e.z, e.y);
  e.roll += (turn * as * .004 - e.roll) * Math.min(1, 5 * dt);
}

export function heliStep(e: Entity, cmd: InputCmd, dt: number, w: World): void {
  const { f, s, run } = cmd, max = run ? 85 : 42, fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), k = Math.min(1, 1.2 * dt);
  e.yaw -= s * 1.3 * dt;
  e.vx += (fx * f * max - e.vx) * k; e.vz += (fz * f * max - e.vz) * k;
  const up = cmd.lift; e.lift = up;
  e.vy += (up * (run ? 25 : 14) - e.vy) * Math.min(1, 2.5 * dt);
  let nx = e.x + e.vx * dt, nz = e.z + e.vz * dt, ny = Math.min(1500, e.y + e.vy * dt);
  if (w.roofTop(nx, nz) > ny + .3) { e.vx = e.vz = 0; nx = e.x; nz = e.z; }
  const floor = w.roofTop(nx, nz); if (ny < floor) { ny = floor; if (e.vy < 0) e.vy = 0; }
  e.x = nx; e.z = nz; e.y = ny;
  const fs = e.vx * fx + e.vz * fz, air = ny > floor + .2; e.air = air;
  e.tilt += ((air ? -fs / max * .3 : 0) - e.tilt) * Math.min(1, 3 * dt);
  e.roll += ((air ? -s * .3 : 0) - e.roll) * Math.min(1, 3 * dt);
}
