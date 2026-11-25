// Posesje domów jednorodzinnych: działka wokół wolnostojącego domu, od ulicy (front za chodnikiem) do ok. 10 m
// za domem; granice z sąsiadami w połowie odstępu między budynkami (oś rozdzielająca), z innymi ulicami za ich
// chodnikiem. Na froncie furtka (1 m) i brama wjazdowa (3,4 m). Wspólny płot dwóch sąsiadów zapisany raz.
// Wynik: TileFence w kaflu domu (shared/src/tiles/types.ts); rysowanie client/src/world/tiles/fences.ts,
// kolizje shared/src/world/world.ts.
import { LANE_W } from '../../shared/src/tiles/build';
import type { TileBuilding, TileData, TileFence, TileRoad } from '../../shared/src/tiles/types';

type XZ = [number, number];
const ring = (f: number[]): XZ[] => { const o: XZ[] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const area = (r: XZ[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const hash = (n: number) => { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; };

/** Przycięcie wielokąta wypukłego półpłaszczyzną n·p <= c. */
function clip(P: XZ[], nx: number, nz: number, c: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], da = a[0] * nx + a[1] * nz - c, db = b[0] * nx + b[1] * nz - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

interface B { b: TileBuilding; o: XZ[]; c: XZ; A: number; tile: string; house: boolean }
const HOUSE_T = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'villa', 'farm', 'residential', 'yes']);

export function makePlots(tiles: Map<string, TileData>): { plots: number; skipped: number; segs: number } {
  const C = 40, bg = new Map<string, B[]>(), rg = new Map<string, { a: XZ; b: XZ; hw: number; r: TileRoad }[]>();
  const put = <T>(m: Map<string, T[]>, x0: number, z0: number, x1: number, z1: number, v: T) => { for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = i + ',' + j; let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); } };
  const near = <T>(m: Map<string, T[]>, x: number, z: number, r: number) => { const s = new Set<T>(); for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (const v of m.get(i + ',' + j) ?? []) s.add(v); return s; };
  const all: B[] = [];
  for (const [k, t] of tiles) {
    for (const b of t.b) {
      if (b.part || b.mh >= .5) continue;
      const o = ring(b.o), A = Math.abs(area(o)); let cx = 0, cz = 0; for (const p of o) { cx += p[0]; cz += p[1]; }
      const q: B = { b, o, c: [cx / o.length, cz / o.length], A, tile: k, house: b.st === 'dom' && A >= 45 && A <= 450 && HOUSE_T.has(b.t) };
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      put(bg, x0, z0, x1, z1, q); all.push(q);
    }
    for (const r of t.r) {
      if (r.tu || r.bp || ['motorway', 'steps'].includes(r.k)) continue;
      const p = ring(r.p), hw = r.w / 2 + (r.sw ? 2.5 : LANE_W[r.k] ? .3 : 0) + .5;
      for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1]; put(rg, Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw, { a, b, hw, r }); }
    }
  }
  const segDist = (s: { a: XZ; b: XZ }, x: number, z: number) => { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2)); return { d: Math.hypot(s.a[0] + dx * t - x, s.a[1] + dz * t - z), t, qx: s.a[0] + dx * t, qz: s.a[1] + dz * t }; };
  // segmenty zapisane już przez sąsiadów (do pominięcia wspólnych granic)
  const done = new Map<string, number[][]>();
  const segKey = (x: number, z: number) => Math.floor(x / C) + ',' + Math.floor(z / C);
  let plots = 0, skipped = 0, segs = 0;
  for (const h of all) {
    if (!h.house) continue;
    // ulica frontowa: najbliższa jezdnia
    let best: { s: { a: XZ; b: XZ; hw: number; r: TileRoad }; d: number; qx: number; qz: number } | null = null;
    for (const s of near(rg, h.c[0], h.c[1], 45)) { if (!LANE_W[s.r.k] || s.r.br) continue; const q = segDist(s, h.c[0], h.c[1]); if (q.d - s.hw < 45 && (!best || q.d - s.hw < best.d - best.s.hw)) best = { s, ...q }; }
    if (!best) { skipped++; continue; }
    let nx = h.c[0] - best.qx, nz = h.c[1] - best.qz; const nl = Math.hypot(nx, nz); if (nl < 1) { skipped++; continue; } nx /= nl; nz /= nl;
    // układ działki: v od osi ulicy w stronę domu, u wzdłuż ulicy
    const tx = nz, tz = -nx, Q: XZ = [best.qx, best.qz];
    const uv = (p: XZ): XZ => [(p[0] - Q[0]) * tx + (p[1] - Q[1]) * tz, (p[0] - Q[0]) * nx + (p[1] - Q[1]) * nz];
    const hv = h.o.map(uv), v0 = Math.min(...hv.map(p => p[1])), v1 = Math.max(...hv.map(p => p[1])), u0 = Math.min(...hv.map(p => p[0])), u1 = Math.max(...hv.map(p => p[0]));
    const vf = best.s.hw; if (v0 - vf < 1.2) { skipped++; continue; } // dom przy samej ulicy (bez ogródka od frontu)
    const back = Math.min(v1 + 11, vf + 70);
    const W = (p: XZ): XZ => [Q[0] + tx * p[0] + nx * p[1], Q[1] + tz * p[0] + nz * p[1]];
    let P: XZ[] = [W([u0 - 7, vf]), W([u1 + 7, vf]), W([u1 + 7, back]), W([u0 - 7, back])];
    // sąsiednie budynki: oś rozdzielająca w połowie odstępu (rzut na kierunek środek–środek)
    for (const o of near(bg, h.c[0], h.c[1], 60)) {
      if (o === h || (!o.house && o.A < 120)) continue; // drobne budynki gospodarcze zostają w ogrodzie
      let dx = o.c[0] - h.c[0], dz = o.c[1] - h.c[1]; const L = Math.hypot(dx, dz); if (L < .5 || L > 70) continue; dx /= L; dz /= L;
      const m1 = Math.max(...h.o.map(p => p[0] * dx + p[1] * dz)), m2 = Math.min(...o.o.map(p => p[0] * dx + p[1] * dz));
      if (m2 - m1 < .8) continue; // budynki zachodzą na siebie w tym kierunku
      P = clip(P, dx, dz, (m1 + m2) / 2); if (P.length < 3) break;
    }
    // inne ulice i ścieżki: płot za ich poboczem / chodnikiem
    if (P.length >= 3) for (const s of near(rg, h.c[0], h.c[1], 50)) {
      if (s === best.s || s.r.k === 'service') continue; // dojazdy (często prywatne, wewnątrz posesji)
      const q = segDist(s, h.c[0], h.c[1]); if (q.t <= 0 || q.t >= 1 || q.d > 50) continue;
      // ta sama ulica frontowa (kolejny odcinek, łuk): granicą jest front działki
      const sx = s.b[0] - s.a[0], sz = s.b[1] - s.a[1], sl = Math.hypot(sx, sz) || 1;
      if ((s.r === best.s.r || (s.r.n && s.r.n === best.s.r.n)) && Math.abs((sx * tx + sz * tz) / sl) > .9) continue;
      let ox = h.c[0] - q.qx, oz = h.c[1] - q.qz; const ol = Math.hypot(ox, oz); if (ol < .5) continue; ox /= ol; oz /= ol;
      // ta sama ulica frontowa (kolejny odcinek): ten sam bok
      P = clip(P, -ox, -oz, -(q.qx * ox + q.qz * oz + s.hw)); if (P.length < 3) break;
    }
    if (P.length < 3) { skipped++; continue; }
    // dom musi zostać w środku z zapasem, front działki co najmniej 6 m
    const inside = (x: number, z: number, m: number) => { for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1; if (((x - a[0]) * ez - (z - a[1]) * ex) / L > -m) return false; } return true; };
    if (area(P) > 0) P.reverse(); // zgodnie z ruchem wskazówek (wnętrze po lewej przy przejściu a→b w układzie X-wschód, Z-południe)
    const ins = (x: number, z: number, m: number) => inside(x, z, m) || (() => { P.reverse(); const r = inside(x, z, m); P.reverse(); return r; })();
    if (!h.o.every(p => ins(p[0], p[1], .4))) { skipped++; continue; }
    const PA = Math.abs(area(P)); if (PA < h.A * 2 || PA > 4000) { skipped++; continue; }
    // krawędź frontowa: na linii v = vf
    let fe = -1, fl = 0;
    // krawędź frontowa: równoległa do ulicy (±25°), najbliżej niej (także za osobnym chodnikiem z OSM)
    let fv = Infinity;
    for (let i = 0; i < P.length; i++) { const a = uv(P[i]), b = uv(P[(i + 1) % P.length]); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 5.5 || Math.abs(b[0] - a[0]) / L < .9) continue; const v = (a[1] + b[1]) / 2; if (v < fv) { fv = v; fl = L; fe = i; } }
    if (fv > v0 - .8) fe = -1; // front za linią domu
    if (fe < 0 || fl < 5.5) { skipped++; continue; }
    // kierunek obiegu: wnętrze działki po lewej stronie krawędzi (sprawdzenie środkiem domu)
    const lefty = (() => { const a = P[0], b = P[1]; return ((b[0] - a[0]) * (h.c[1] - a[1]) - (b[1] - a[1]) * (h.c[0] - a[0])) < 0; })();
    if (!lefty) { P.reverse(); fe = P.length - 2 - fe; if (fe < 0) fe += P.length; }
    // bramy na froncie: wjazd po stronie szerszego odstępu dom–granica, furtka na wprost domu
    const A0 = P[fe], A1 = P[(fe + 1) % P.length], ua = uv(A0)[0], ub = uv(A1)[0], dir = Math.sign(ub - ua) || 1;
    const at = (u: number): XZ => { const t = (u - ua) / (ub - ua); return [A0[0] + (A1[0] - A0[0]) * t, A0[1] + (A1[1] - A0[1]) * t]; };
    const lo = Math.min(ua, ub), hi = Math.max(ua, ub), gapLo = u0 - lo, gapHi = hi - u1;
    const DW = 3.4, PW = 1.0, hs = hash(h.b.id);
    let dc: number, pc: number;
    if (Math.max(gapLo, gapHi) >= DW + .8) dc = gapHi >= gapLo ? hi - .6 - DW / 2 : lo + .6 + DW / 2; // wjazd obok domu
    else dc = hs % 2 ? hi - .6 - DW / 2 : lo + .6 + DW / 2;
    pc = Math.max(lo + .8, Math.min(hi - .8, (u0 + u1) / 2));
    if (Math.abs(pc - dc) < DW / 2 + PW / 2 + .6) pc = dc > (lo + hi) / 2 ? dc - DW / 2 - .6 - PW / 2 : dc + DW / 2 + .6 + PW / 2;
    if (pc - PW / 2 < lo + .3 || pc + PW / 2 > hi - .3 || dc - DW / 2 < lo + .2 || dc + DW / 2 > hi - .2) { skipped++; continue; }
    const gates: [number, number, number][] = [[dc - DW / 2, dc + DW / 2, 1], [pc - PW / 2, pc + PW / 2, 0]].sort((a, b) => a[0] - b[0]) as [number, number, number][];
    const S: number[] = [], G: number[] = [];
    const addSeg = (a: XZ, b: XZ) => {
      // pominięcie części wspólnej z płotem zapisanym już przez sąsiada (współliniowe, nakładające się)
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .3) return;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; let keep: [number, number][] = [[0, L]];
      const cand = new Set<number[]>(); for (const p of [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as XZ]) for (const q of done.get(segKey(p[0], p[1])) ?? []) cand.add(q);
      for (const q of cand) {
        const d0 = Math.abs((q[0] - a[0]) * uz - (q[1] - a[1]) * ux), d1 = Math.abs((q[2] - a[0]) * uz - (q[3] - a[1]) * ux); if (d0 > .5 || d1 > .5) continue;
        const s0 = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz, s1 = (q[2] - a[0]) * ux + (q[3] - a[1]) * uz, c0 = Math.min(s0, s1) - .2, c1 = Math.max(s0, s1) + .2;
        keep = keep.flatMap(([k0, k1]) => c1 <= k0 || c0 >= k1 ? [[k0, k1]] as [number, number][] : ([[k0, Math.max(k0, c0)], [Math.min(k1, c1), k1]] as [number, number][]).filter(([x, y]) => y - x > .3));
      }
      for (const [k0, k1] of keep) {
        const q = [r1(a[0] + ux * k0), r1(a[1] + uz * k0), r1(a[0] + ux * k1), r1(a[1] + uz * k1)]; S.push(...q); segs++;
        for (const p of [[q[0], q[1]], [q[2], q[3]], [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2]]) { const k = segKey(p[0], p[1]); let l = done.get(k); if (!l) done.set(k, l = []); if (!l.includes(q)) l.push(q); }
      }
    };
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (i !== fe) { addSeg(a, b); continue; }
      // front z otworami bram (w kolejności od A0)
      const gs = gates.map(([g0, g1, k]) => (dir > 0 ? [g0, g1, k] : [g1, g0, k]) as [number, number, number]).sort((x, y) => (x[0] - ua) * dir - (y[0] - ua) * dir);
      let cur = a;
      for (const [g0, g1, k] of gs) { const p0 = at(g0), p1 = at(g1); addSeg(cur, p0); G.push(r1(p0[0]), r1(p0[1]), r1(p1[0]), r1(p1[1]), k); cur = p1; }
      addSeg(cur, b);
    }
    const k = hs % 10 < 4 ? 1 : hs % 10 < 7 ? 0 : hs % 10 < 9 ? 2 : 3;
    const t = tiles.get(h.tile)!; (t.fe ??= []).push({ s: S, g: G, k } as TileFence); plots++;
  }
  return { plots, skipped, segs };
}
