// Minimapa obracana razem z graczem: budynki, ulice, tunele w kolorach linii, hale i lokale.
import { CELL } from '@miasto/shared/world/grid';
import type { BuildingPoly } from '@miasto/shared/world/collision';
import type { Mode } from '@miasto/shared/sim/types';
import type { World } from '@miasto/shared/world/world';

export interface MiniView { x: number; y: number; z: number; yaw: number; mode: Mode; xray: boolean }

export function renderMinimap(mini: HTMLCanvasElement, world: World | null, C: MiniView): void {
  const mctx = mini.getContext('2d')!, W = mini.width; mctx.clearRect(0, 0, W, W); if (!world) return;
  const city = world.city, MODE = C.mode;
  const under = (MODE === 'walk' && C.y < -1) || C.xray;
  const view = MODE === 'heli' ? Math.min(3000, 300 + C.y * 5) : MODE === 'car' ? 450 : (C.y < -1 ? 500 : 260), s = W / view, R = view / 2 * 1.45;
  mctx.save(); mctx.beginPath(); mctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); mctx.clip();
  mctx.translate(W / 2, W / 2); mctx.rotate(C.yaw); mctx.scale(s, s); mctx.translate(-C.x, -C.z);
  const lw = 1 / s;
  if (C.y > -1) {
    mctx.fillStyle = 'rgba(125,255,176,.3)'; mctx.strokeStyle = 'rgba(125,255,176,.8)'; mctx.lineWidth = lw; const seen = new Set<BuildingPoly>();
    if (view < 1500) for (let i = Math.floor((C.x - R) / CELL); i <= Math.floor((C.x + R) / CELL); i++) for (let j = Math.floor((C.z - R) / CELL); j <= Math.floor((C.z + R) / CELL); j++) {
      const l = world.buildings.grid.get(i + ',' + j); if (!l) continue;
      for (const p of l) { if (seen.has(p)) continue; seen.add(p); mctx.beginPath(); p.poly.forEach((q, k) => k ? mctx.lineTo(q[0], q[1]) : mctx.moveTo(q[0], q[1])); mctx.closePath(); mctx.fill(); mctx.stroke(); }
    }
    mctx.strokeStyle = 'rgba(207,233,255,.5)'; mctx.lineWidth = 2 * lw;
    for (const r of world.roads) {
      const p0 = r[0]; if (Math.abs(p0[0] - C.x) > R + 400 || Math.abs(p0[1] - C.z) > R + 400) continue;
      mctx.beginPath(); r.forEach((q, k) => k ? mctx.lineTo(q[0], q[1]) : mctx.moveTo(q[0], q[1])); mctx.stroke();
    }
  }
  mctx.globalAlpha = under ? 1 : .45;
  for (const t of world.metro.tunnels) {
    if (Math.min(t.a[0], t.b[0]) > C.x + R || Math.max(t.a[0], t.b[0]) < C.x - R || Math.min(t.a[1], t.b[1]) > C.z + R || Math.max(t.a[1], t.b[1]) < C.z - R) continue;
    mctx.strokeStyle = city.lines[t.l].c; mctx.lineWidth = 3 * lw; mctx.beginPath(); mctx.moveTo(t.a[0], t.a[1]); mctx.lineTo(t.b[0], t.b[1]); mctx.stroke();
  }
  for (const r of world.regions.list) {
    if (r.kind === 'tunnel' || Math.abs(r.a[0] - C.x) > R + 150 || Math.abs(r.a[1] - C.z) > R + 150) continue;
    mctx.fillStyle = r.kind === 'hall' ? city.lines[r.info.l!].c : r.kind === 'room' ? '#ffbe5a' : '#9fd8b8';
    const c = [[0, -r.hw], [r.len, -r.hw], [r.len, r.hw], [0, r.hw]].map(([t, q]) => [r.a[0] + r.u[0] * t + r.n[0] * q, r.a[1] + r.u[1] * t + r.n[1] * q]);
    mctx.beginPath(); c.forEach((q, k) => k ? mctx.lineTo(q[0], q[1]) : mctx.moveTo(q[0], q[1])); mctx.closePath(); mctx.fill();
  }
  mctx.globalAlpha = 1; mctx.restore();
  mctx.fillStyle = MODE === 'car' ? '#ffcc33' : MODE === 'heli' ? '#66e0ff' : '#fff';
  mctx.beginPath(); mctx.moveTo(W / 2, W / 2 - 13); mctx.lineTo(W / 2 - 9, W / 2 + 9); mctx.lineTo(W / 2 + 9, W / 2 + 9); mctx.closePath(); mctx.fill();
}
