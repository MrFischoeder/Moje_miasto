// Minimapa obracana razem z graczem: budynki, ulice, tunele w kolorach linii, hale i lokale.
import { CELL } from '@miasto/shared/world/grid';
import type { BuildingPoly } from '@miasto/shared/world/collision';
import type { Mode } from '@miasto/shared/sim/types';
import type { World } from '@miasto/shared/world/world';
import type { TileData } from '@miasto/shared/tiles/types';

export interface MiniView { x: number; y: number; z: number; yaw: number; mode: Mode; xray: boolean; under: boolean; height: number; others?: { x: number; z: number; color: string }[]; transit?: { x: number; z: number; color: string }[] }

const layers: HTMLCanvasElement[] = []; let li = 0;
/** Pomocnicza warstwa rysowania (po jednej na wywołanie, wielokrotnego użytku). */
function layer(W: number): HTMLCanvasElement { const c = layers[li % 2] ?? (layers[li % 2] = document.createElement('canvas')); li++; if (c.width !== W) { c.width = W; c.height = W; } return c; }

export function renderMinimap(mini: HTMLCanvasElement, world: World | null, C: MiniView): void {
  const mctx = mini.getContext('2d')!, W = mini.width; mctx.clearRect(0, 0, W, W); if (!world) return;
  const city = world.city, MODE = C.mode;
  const under = (MODE === 'walk' && C.under) || C.xray;
  const view = MODE === 'heli' ? Math.min(3000, 300 + C.height * 5) : MODE === 'car' ? 450 : (C.under ? 500 : 260), s = W / view, R = view / 2 * 1.45;
  mctx.save(); mctx.beginPath(); mctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); mctx.clip();
  mctx.translate(W / 2, W / 2); mctx.rotate(C.yaw); mctx.scale(s, s); mctx.translate(-C.x, -C.z);
  const lw = 1 / s;
  if (!C.under) {
    mctx.fillStyle = 'rgba(125,255,176,.3)'; mctx.strokeStyle = 'rgba(125,255,176,.8)'; mctx.lineWidth = lw; const seen = new Set<BuildingPoly>();
    if (view < 1500) for (let i = Math.floor((C.x - R) / CELL); i <= Math.floor((C.x + R) / CELL); i++) for (let j = Math.floor((C.z - R) / CELL); j <= Math.floor((C.z + R) / CELL); j++) {
      const l = world.buildings.grid.get(i + ',' + j); if (!l) continue;
      for (const p of l) { if (seen.has(p)) continue; seen.add(p); mctx.beginPath(); p.poly.forEach((q, k) => k ? mctx.lineTo(q[0], q[1]) : mctx.moveTo(q[0], q[1])); mctx.closePath(); mctx.fill(); mctx.stroke(); }
    }
    const near = (t: TileData) => Math.abs((t.x + .5) * t.size - C.x) < R + t.size && Math.abs((t.y + .5) * t.size - C.z) < R + t.size;
    const path = (f: number[], close = false) => { mctx.beginPath(); for (let i = 0; i < f.length; i += 2) i ? mctx.lineTo(f[i], f[i + 1]) : mctx.moveTo(f[i], f[i + 1]); if (close) mctx.closePath(); };
    for (const t of world.tiles.values()) {
      if (!near(t)) continue;
      for (const a of t.a) { mctx.fillStyle = a.k === 'water' ? 'rgba(60,140,255,.45)' : a.k === 'park' || a.k === 'forest' ? 'rgba(60,200,100,.18)' : 'rgba(150,170,170,.12)'; path(a.o, true); mctx.fill(); }
    }
    // ulice: rysowane bez przezroczystości na osobnej warstwie (zaokrąglone łączenia i końce), nakładane raz z przezroczystością
    // — bez jaśniejszych plam i szwów tam, gdzie odcinki dróg na siebie zachodzą
    for (const [jezdnie, col, alpha] of [[false, '#96d2b4', .3], [true, '#cfe9ff', .5]] as const) {
      const L = layer(W), lc = L.getContext('2d')!; lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, W, W);
      lc.translate(W / 2, W / 2); lc.rotate(C.yaw); lc.scale(s, s); lc.translate(-C.x, -C.z);
      lc.strokeStyle = col; lc.lineCap = 'round'; lc.lineJoin = 'round';
      for (const t of world.tiles.values()) {
        if (!near(t)) continue;
        for (const r of t.r) { if (!!r.ln !== jezdnie) continue; lc.lineWidth = Math.max(2 * lw, r.w); lc.beginPath(); for (let i = 0; i < r.p.length; i += 2) i ? lc.lineTo(r.p[i], r.p[i + 1]) : lc.moveTo(r.p[i], r.p[i + 1]); lc.stroke(); }
      }
      mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.beginPath(); mctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); mctx.clip(); mctx.globalAlpha = alpha; mctx.drawImage(L, 0, 0); mctx.restore();
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
  mctx.globalAlpha = 1;
  for (const o of C.transit || []) { mctx.fillStyle = o.color; mctx.fillRect(o.x - 3 * lw, o.z - 3 * lw, 6 * lw, 6 * lw); }
  for (const o of C.others || []) { mctx.fillStyle = o.color; mctx.beginPath(); mctx.arc(o.x, o.z, 5 * lw, 0, 7); mctx.fill(); }
  mctx.restore();
  mctx.fillStyle = MODE === 'car' ? '#ffcc33' : MODE === 'heli' ? '#66e0ff' : '#fff';
  mctx.beginPath(); mctx.moveTo(W / 2, W / 2 - 13); mctx.lineTo(W / 2 - 9, W / 2 + 9); mctx.lineTo(W / 2 + 9, W / 2 + 9); mctx.closePath(); mctx.fill();
}
