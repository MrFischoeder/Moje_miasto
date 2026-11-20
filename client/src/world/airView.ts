// Samoloty: starty i lądowania liczone z powtarzalnego rozkładu i zegara gry (shared/air/flights).
import * as THREE from 'three';
import { AirTraffic, type AirData, type PlaneSize } from '@miasto/shared/air/flights';
import type { TransitSystem } from '@miasto/shared/transit/system';
import type { World } from '@miasto/shared/world/world';
import { disposeModel, makePlane, type VehicleModel } from '../player/models';

export class AirView {
  readonly group = new THREE.Group();
  readonly air: AirTraffic;
  private planes = new Map<string, VehicleModel>();
  count = 0;
  constructor(data: AirData, private world: World, private clockSys: TransitSystem) { this.air = new AirTraffic(data); }

  update(x: number, z: number, R = 9000): void {
    const lt = this.clockSys.local(), seen = new Set<string>();
    const flights = this.air.active(lt.sec, lt.date, this.world.ground);
    this.count = flights.length;
    for (const f of flights) {
      if (Math.abs(f.x - x) > R || Math.abs(f.z - z) > R) continue;
      seen.add(f.id); let m = this.planes.get(f.id);
      if (!m) { m = makePlane(f.size as PlaneSize); this.planes.set(f.id, m); this.group.add(m.root); }
      m.root.position.set(f.x, f.y, f.z); m.root.rotation.set(f.pitch, f.yaw, 0);
    }
    for (const [id, m] of this.planes) if (!seen.has(id)) { this.group.remove(m.root); disposeModel(m); this.planes.delete(id); }
  }
  dispose(): void { for (const m of this.planes.values()) disposeModel(m); this.planes.clear(); }
}

const cache = new Map<string, Promise<AirData | null>>();
export function loadAir(city: string): Promise<AirData | null> {
  let p = cache.get(city);
  if (!p) cache.set(city, p = (async () => {
    try { const r = await fetch(`${import.meta.env.BASE_URL}air/${city}.json`); if (!r.ok) return null; const t = await r.text(); return t[0] === '{' ? JSON.parse(t) as AirData : null; } catch { return null; }
  })());
  return p;
}
