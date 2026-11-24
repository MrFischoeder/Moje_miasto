// Mapa w telefonie: cała mapa miasta (plik przeglądowy) + budynki z wczytanych kafli przy dużym przybliżeniu,
// znaczniki (gracz, inni gracze, zlecenia, udostępnione lokalizacje). Przesuwanie, przybliżanie, dotknięcie punktu.
import type { World } from '@miasto/shared/world/world';
import { EMBEDDED_OVERVIEW } from '../world/embedded';
import { colName, GRID, gridOf, type GridDef } from '@miasto/shared/data/grid';

export interface Overview { bbox: number[]; water: number[][]; green: number[][]; major: number[][]; mid: number[][]; path: number[][]; rail: number[][]; tram: number[][]; bld: number[][]; names: [string, number, number][] }
export interface Marker { x: number; z: number; color: string; label?: string; kind: 'me' | 'player' | 'job' | 'pin' | 'sel'; yaw?: number }

const cache = new Map<string, Promise<Overview | null>>();
export function loadOverview(city: string): Promise<Overview | null> {
  let p = cache.get(city);
  if (!p) cache.set(city, p = (async () => {
    try {
      const url = EMBEDDED_OVERVIEW[city] || (location.protocol === 'file:' ? '' : `${import.meta.env.BASE_URL}overview/${city}.json.gz`); if (!url) return null;
      const r = await fetch(url); if (!r.ok) return null; let b = new Uint8Array(await r.arrayBuffer());
      if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      return b[0] === 0x7b ? JSON.parse(new TextDecoder().decode(b)) as Overview : null;
    } catch { return null; }
  })());
  return p;
}

const path = (list: number[][], close: boolean) => { const p = new Path2D(); for (const a of list) { if (a.length < 4) continue; p.moveTo(a[0], a[1]); for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]); if (close) p.closePath(); } return p; };

export class PhoneMap {
  readonly canvas = document.createElement('canvas');
  cx = 0; cz = 0; s = .25;
  markers: Marker[] = [];
  onTap: (x: number, z: number) => void = () => {};
  private P: Record<string, Path2D> | null = null;
  private ov: Overview | null = null;
  private tilePaths = new Map<string, Path2D>();
  private raf = 0;
  private ptr = new Map<number, { x: number; y: number }>();
  private moved = 0;
  /** siatka kratek 500 m (A1 w północno-zachodnim rogu obszaru miasta) */
  readonly grid: GridDef;
  showGrid = true;

  constructor(private world: World) {
    this.canvas.className = 'map'; this.grid = gridOf(world.city);
    loadOverview(world.key).then(o => { this.ov = o; if (o) this.P = { water: path(o.water, true), green: path(o.green, true), bld: path(o.bld, true), major: path(o.major, false), mid: path(o.mid, false), rail: path(o.rail, false), tram: path(o.tram, false) }; this.draw(); });
    const c = this.canvas;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); this.moved = 0; });
    c.addEventListener('pointermove', e => {
      const p = this.ptr.get(e.pointerId); if (!p) return;
      if (this.ptr.size === 1) { const dx = e.offsetX - p.x, dy = e.offsetY - p.y; this.cx -= dx / this.s; this.cz -= dy / this.s; this.moved += Math.abs(dx) + Math.abs(dy); }
      else { // szczypanie
        const [a, b] = [...this.ptr.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.offsetX; p.y = e.offsetY; const [a2, b2] = [...this.ptr.values()];
        this.zoom(Math.hypot(a2.x - b2.x, a2.y - b2.y) / (d0 || 1), (a2.x + b2.x) / 2, (a2.y + b2.y) / 2); this.moved += 10;
      }
      p.x = e.offsetX; p.y = e.offsetY; this.draw();
    });
    const up = (e: PointerEvent) => {
      if (this.ptr.size === 1 && this.moved < 6) { const [x, z] = this.toWorld(e.offsetX, e.offsetY); this.onTap(x, z); }
      this.ptr.delete(e.pointerId);
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', e => this.ptr.delete(e.pointerId));
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * .0015), e.offsetX, e.offsetY); this.draw(); }, { passive: false });
  }

  toWorld(px: number, py: number): [number, number] { return [this.cx + (px - this.canvas.clientWidth / 2) / this.s, this.cz + (py - this.canvas.clientHeight / 2) / this.s]; }
  zoom(k: number, px = this.canvas.clientWidth / 2, py = this.canvas.clientHeight / 2): void {
    const [wx, wz] = this.toWorld(px, py); this.s = Math.max(.02, Math.min(6, this.s * k));
    this.cx = wx - (px - this.canvas.clientWidth / 2) / this.s; this.cz = wz - (py - this.canvas.clientHeight / 2) / this.s; this.draw();
  }
  center(x: number, z: number, s?: number): void { this.cx = x; this.cz = z; if (s) this.s = s; this.draw(); }

  /** rysowanie w następnej klatce (bez wielokrotnego rysowania przy przesuwaniu) */
  draw(): void { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }

  private paint(): void {
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!, s = this.s;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#e9e5dc'; g.fillRect(0, 0, W, H);
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - this.cx * s), dpr * (H / 2 - this.cz * s));
    const lw = (px: number) => px / s;
    if (this.P) {
      g.fillStyle = '#c7e2b4'; g.fill(this.P.green);
      g.fillStyle = '#9ec9ec'; g.fill(this.P.water);
      if (s > .05) { g.fillStyle = '#d6d0c4'; g.fill(this.P.bld); }
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (s > .06) { g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(lw(1.2), 5); g.stroke(this.P.mid); }
      g.strokeStyle = '#f6cf65'; g.lineWidth = Math.max(lw(2.2), 9); g.stroke(this.P.major);
      g.strokeStyle = '#8a8f98'; g.lineWidth = lw(1.4); g.setLineDash([lw(5), lw(4)]); g.stroke(this.P.rail); g.setLineDash([]);
      if (s > .15) { g.strokeStyle = '#c98bd6'; g.lineWidth = lw(1); g.stroke(this.P.tram); }
    } else { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#555'; g.font = '14px sans-serif'; g.fillText('Wczytywanie mapy…', 20, 40); }
    // przy dużym przybliżeniu: wszystkie budynki z wczytanych kafli
    if (s > .5) {
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - this.cx * s), dpr * (H / 2 - this.cz * s));
      g.fillStyle = '#c4bcae'; g.strokeStyle = '#a69e90'; g.lineWidth = lw(.8);
      for (const [k, t] of this.world.tiles) {
        let p = this.tilePaths.get(k); if (!p) { p = path(t.b.filter(b => !b.part).map(b => b.o), true); this.tilePaths.set(k, p); }
        g.fill(p); g.stroke(p);
      }
      if (this.tilePaths.size > 80) this.tilePaths.clear();
    }
    // siatka kratek z podpisami kolumn (u góry) i wierszy (z lewej)
    if (this.showGrid && s > .03) {
      const G = this.grid, step = s < .08 ? 4 : s < .16 ? 2 : 1, cs = GRID * step;
      const [wx0, wz0] = this.toWorld(0, 0), [wx1, wz1] = this.toWorld(W, H);
      const c0 = Math.max(0, Math.floor((wx0 - G.x0) / cs)), c1 = Math.min(Math.ceil(G.cols / step), Math.ceil((wx1 - G.x0) / cs));
      const r0 = Math.max(0, Math.floor((wz0 - G.z0) / cs)), r1 = Math.min(Math.ceil(G.rows / step), Math.ceil((wz1 - G.z0) / cs));
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = 'rgba(40,60,120,.35)'; g.lineWidth = 1;
      g.beginPath();
      for (let c = c0; c <= c1; c++) { const px = W / 2 + (G.x0 + c * cs - this.cx) * s; g.moveTo(px, 0); g.lineTo(px, H); }
      for (let r = r0; r <= r1; r++) { const py = H / 2 + (G.z0 + r * cs - this.cz) * s; g.moveTo(0, py); g.lineTo(W, py); }
      g.stroke();
      g.font = '700 10px sans-serif'; g.fillStyle = 'rgba(30,45,100,.85)'; g.textAlign = 'center';
      for (let c = c0; c < c1; c++) { const px = W / 2 + (G.x0 + (c + .5) * cs - this.cx) * s; if (px > 8 && px < W - 8) g.fillText(colName(c * step) + (step > 1 ? '…' : ''), px, 12); }
      g.textAlign = 'left';
      for (let r = r0; r < r1; r++) { const py = H / 2 + (G.z0 + (r + .5) * cs - this.cz) * s; if (py > 20 && py < H - 30) g.fillText(String(r * step + 1), 3, py + 3); }
    }
    // nazwy ulic
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.ov && s > .35) {
      g.font = '600 11px sans-serif'; g.fillStyle = '#3b3b3b'; g.textAlign = 'center'; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
      for (const [n, x, z] of this.ov.names) { const px = W / 2 + (x - this.cx) * s, py = H / 2 + (z - this.cz) * s; if (px < -60 || px > W + 60 || py < 0 || py > H) continue; g.strokeText(n, px, py); g.fillText(n, px, py); }
    }
    // znaczniki
    for (const m of this.markers) {
      const px = W / 2 + (m.x - this.cx) * s, py = H / 2 + (m.z - this.cz) * s;
      g.save(); g.translate(px, py);
      if (m.kind === 'me') { g.rotate(-(m.yaw ?? 0)); g.fillStyle = '#0a84ff'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); }
      else if (m.kind === 'player') { g.fillStyle = m.color; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.stroke(); }
      else { // pinezka
        g.fillStyle = m.color; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(0, -18, 9, Math.PI * .8, Math.PI * 2.2); g.lineTo(0, 0); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -18, 3.5, 0, 7); g.fill();
      }
      g.restore();
      if (m.label) { g.font = '600 11px sans-serif'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.fillStyle = '#fff'; const ly = py + (m.kind === 'me' || m.kind === 'player' ? 20 : 12); g.strokeText(m.label, px, ly); g.fillText(m.label, px, ly); }
    }
    // podziałka
    const mpp = 1 / s, nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(v => v / mpp > 60) ?? 5000, w = nice / mpp;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, H - 24, w, 4); g.font = '600 11px sans-serif'; g.textAlign = 'left'; g.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', 12, H - 30);
  }
}
