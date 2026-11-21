// Geometria wnętrz: układ lokalny budynku (x wzdłuż frontu, y w głąb od frontu), prostokąty,
// najmniejszy prostokąt otaczający obrys i największy prostokąt wpisany w obrys (z dziedzińcami).
import { pip, type XZ } from '../world/collision';

export const ringXZ = (f: number[]): XZ[] => { const o: XZ[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };

/** Prostokąt w układzie lokalnym: x0..x1 wzdłuż frontu, y0..y1 w głąb. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
export const rw = (r: Rect) => r.x1 - r.x0;
export const rd = (r: Rect) => r.y1 - r.y0;
export const inRect = (r: Rect, x: number, y: number, m = 0) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m;
export const overlap = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
export const inset = (r: Rect, d: number): Rect => ({ x0: r.x0 + d, y0: r.y0 + d, x1: r.x1 - d, y1: r.y1 - d });

/** Układ lokalny: punkt świata = O + U·x + N·y; N = (-Uz, Ux). */
export interface Frame { ox: number; oz: number; ux: number; uz: number; W: number; D: number }
export const nOf = (f: Frame): XZ => [-f.uz, f.ux];
export function toWorld(f: Frame, x: number, y: number): XZ { return [f.ox + f.ux * x - f.uz * y, f.oz + f.uz * x + f.ux * y]; }
export function toLocal(f: Frame, wx: number, wz: number): XZ { const dx = wx - f.ox, dz = wz - f.oz; return [dx * f.ux + dz * f.uz, -dx * f.uz + dz * f.ux]; }

/** Najmniejszy prostokąt otaczający (kierunki krawędzi obrysu); U wzdłuż dłuższego boku. */
export function obb(ring: XZ[]): Frame {
  let best: Frame | null = null, ba = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .5) continue;
    let ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [px, pz] of ring) { const x = px * ux + pz * uz, y = -px * uz + pz * ux; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const area = (x1 - x0) * (y1 - y0); if (area >= ba - 1e-6) continue; ba = area;
    let W = x1 - x0, D = y1 - y0, ox = ux * x0 - uz * y0, oz = uz * x0 + ux * y0;
    if (D > W) { // obrót o 90°: U = N
      const nux = -uz, nuz = ux; // nowe U = stare N; nowe N = -stare U, więc początek w rogu (x1, y0)
      const cx = ux * x1 - uz * y0, cz = uz * x1 + ux * y0;
      ox = cx; oz = cz; ux = nux; uz = nuz; [W, D] = [D, W];
    }
    best = { ox, oz, ux, uz, W, D };
  }
  return best ?? { ox: ring[0][0], oz: ring[0][1], ux: 1, uz: 0, W: 1, D: 1 };
}

/** Największy prostokąt (w układzie f) zawarty w obrysie bez dziur; siatka g [m], dociąganie do krawędzi. */
export function maxRect(f: Frame, outer: XZ[], holes: XZ[][]): Rect | null {
  const g = Math.max(.5, Math.ceil(Math.max(f.W, f.D) / 80 * 2) / 2), nx = Math.max(1, Math.ceil(f.W / g)), ny = Math.max(1, Math.ceil(f.D / g));
  const inside = (x: number, y: number) => { const [wx, wz] = toWorld(f, x, y); return pip(outer, wx, wz) && !holes.some(h => pip(h, wx, wz)); };
  const hgt = new Int32Array(nx); let best: Rect | null = null, ba = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) hgt[i] = inside((i + .5) * g, (j + .5) * g) ? hgt[i] + 1 : 0;
    const st: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const h = i < nx ? hgt[i] : 0;
      while (st.length && hgt[st[st.length - 1]] >= h) {
        const top = st.pop()!, H = hgt[top], left = st.length ? st[st.length - 1] + 1 : 0, area = H * (i - left);
        if (H && area > ba) { ba = area; best = { x0: left * g, x1: i * g, y0: (j + 1 - H) * g, y1: (j + 1) * g }; }
      }
      st.push(i);
    }
  }
  if (!best) return null;
  // dociąganie boków do obrysu (dokładność ~5 cm)
  const sideOk = (r: Rect, s: number) => {
    const pts: XZ[] = []; const n = 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (s === 0) pts.push([r.x0 + (r.x1 - r.x0) * t, r.y0]); else if (s === 2) pts.push([r.x0 + (r.x1 - r.x0) * t, r.y1]);
      else if (s === 1) pts.push([r.x1, r.y0 + (r.y1 - r.y0) * t]); else pts.push([r.x0, r.y0 + (r.y1 - r.y0) * t]);
    }
    return pts.every(([x, y]) => inside(x, y));
  };
  for (let s = 0; s < 4; s++) for (let k = 0; k < g / .05 + 2; k++) {
    const r: Rect = { ...best }; if (s === 0) r.y0 -= .05; else if (s === 2) r.y1 += .05; else if (s === 1) r.x1 += .05; else r.x0 -= .05;
    if (!sideOk(r, s)) break; best = r;
  }
  return best;
}

/** Przesunięcie układu tak, by prostokąt r był [0,W]×[0,D]; opcjonalnie obrót o 90° (gdy głębszy niż szeroki) i odwrócenie frontu. */
export function reframe(f: Frame, r: Rect, rotate: boolean, flip: boolean): Frame {
  // narożniki r w świecie
  let ox: XZ, ux = f.ux, uz = f.uz, W = r.x1 - r.x0, D = r.y1 - r.y0;
  if (!rotate) { ox = toWorld(f, r.x0, r.y0); }
  else { ox = toWorld(f, r.x1, r.y0); const nux = -f.uz, nuz = f.ux; ux = nux; uz = nuz; [W, D] = [D, W]; }
  let o: Frame = { ox: ox[0], oz: ox[1], ux, uz, W, D };
  if (flip) { const c = toWorld(o, W, D); o = { ox: c[0], oz: c[1], ux: -ux, uz: -uz, W, D }; }
  return o;
}
