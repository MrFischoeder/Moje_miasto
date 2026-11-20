// Tekst położenia w HUD.
import type { Entity, Mode } from '@miasto/shared/sim/types';
import type { World } from '@miasto/shared/world/world';

export function locText(world: World, mode: Mode, e: Entity): string {
  const near = () => world.nearestStation(e.x, e.z).name, city = world.city;
  if (mode === 'car') return `Samochód · ${Math.round(Math.abs(e.speed) * 3.6)} km/h · najbliżej: ${near()}`;
  if (mode === 'heli') return `Helikopter · ${Math.round(e.y)} m · ${Math.round(Math.hypot(e.vx, e.vz) * 3.6)} km/h · nad: ${near()}`;
  const r = e.reg >= 0 ? world.regions.list[e.reg] : null; if (!r) return 'Ulica · najbliżej: ' + near();
  const d = Math.round(-e.y) + ' m pod ziemią', sn = r.info.s != null ? world.stations[r.info.s].name : '';
  if (r.kind === 'hall') return `Peron ${sn} · ${city.lines[r.info.l!].n} · ${d}`;
  if (r.kind === 'tunnel') return `Tunel ${city.lines[r.info.l!].n}: ${r.info.A} ↔ ${r.info.B} · ${d}`;
  if (r.kind === 'room') return `Lokal pod stacją ${sn} · ${d}`;
  if (r.kind === 'stair') return `Schody · ${sn} · ${d}`;
  if (r.kind === 'ramp') return `Przejście między liniami · ${sn}`;
  return `Korytarz · ${sn} · ${d}`;
}
