// Tabliczki z nazwami ulic na ścianach narożnych budynków przy skrzyżowaniach (jak w mieście) i szyldy sklepów/usług.
// Tworzone tylko w pobliżu gracza; tekstura jednej nazwy jest wspólna dla wszystkich jej tabliczek.
import * as THREE from 'three';
import { signText } from '@miasto/shared/config/branding';
import type { TileData } from '@miasto/shared/tiles/types';
import type { World } from '@miasto/shared/world/world';
import { pip } from '@miasto/shared/world/collision';
import { CELL } from '@miasto/shared/world/grid';
import { buildFront, isFrontPoi, shopFronts, SHOP_Y0, SHOP_Y1, type Front } from './shopfronts';
import { isOpen, shopKind } from '@miasto/shared/game/shops';

const FONT = '"Chakra Petch", sans-serif';

function sprite(lines: string[], bg: string, fg: string, accent: string, w: number): THREE.Sprite {
  const H = 64 * lines.length + 16, cv = document.createElement('canvas'); cv.width = 512; cv.height = H; const x = cv.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, 512, H); x.fillStyle = accent; x.fillRect(0, 0, 512, 6);
  x.fillStyle = fg; x.textBaseline = 'middle';
  lines.forEach((t, i) => { let fs = 40; x.font = `600 ${fs}px ${FONT}`; while (x.measureText(t).width > 480 && fs > 18) { fs -= 2; x.font = `600 ${fs}px ${FONT}`; } x.fillText(t, 16, 40 + i * 64); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  sp.scale.set(w, w * H / 512, 1); return sp;
}

interface Sign { x: number; z: number; y: number; make(): THREE.Object3D; shared?: boolean; front?: Front }

/** Tabliczka: biała, czarny napis, czerwony pasek (styl miejskiej informacji); materiał wspólny dla nazwy. */
const PLATES = new Map<string, THREE.MeshLambertMaterial>();
const PLATE_GEO = new THREE.PlaneGeometry(1.3, .34);
function plateMat(name: string, city: string): THREE.MeshLambertMaterial {
  let m = PLATES.get(name); if (m) return m;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 134; const x = cv.getContext('2d')!;
  x.fillStyle = '#f2f1ec'; x.fillRect(0, 0, 512, 134); x.fillStyle = '#c8102e'; x.fillRect(0, 118, 512, 16); x.strokeStyle = '#1a1a1a'; x.lineWidth = 4; x.strokeRect(2, 2, 508, 130);
  const pre = (city === 'warszawa' || city === 'wroclaw') && !/^(al\.|aleja|aleje|plac|pl\.|rondo|most|skwer|bulwar|wybrzeże|trakt|osiedle)/i.test(name) ? 'ul. ' : '';
  x.fillStyle = '#141414'; x.textBaseline = 'middle'; x.textAlign = 'center';
  let fs = 62; const text = pre + name; x.font = `700 ${fs}px ${FONT}`; while (x.measureText(text).width > 470 && fs > 22) { fs -= 2; x.font = `700 ${fs}px ${FONT}`; }
  x.fillText(text, 256, 60);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  if (PLATES.size > 300) { const [k, old] = PLATES.entries().next().value!; old.map?.dispose(); old.dispose(); PLATES.delete(k); }
  PLATES.set(name, m); return m;
}

/** Ściana budynku przy punkcie (x, z), równoległa do kierunku (dx, dz): punkt na ścianie najbliżej skrzyżowania (jx, jz) i normalna na zewnątrz. */
function wallNear(world: World, x: number, z: number, dx: number, dz: number, jx: number, jz: number): { x: number; z: number; nx: number; nz: number } | null {
  const l = world.buildings.grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)); if (!l) return null;
  let best: { x: number; z: number; nx: number; nz: number } | null = null, bd = 9;
  for (const p of l) {
    if (p.a > x + 10 || p.b < x - 10 || p.c > z + 10 || p.d < z - 10) continue;
    const P = p.poly;
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez); if (L < 2.2) continue;
      if (Math.abs((ex * dx + ez * dz) / L) < .85) continue; // ściana równoległa do ulicy
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (L * L))), d = Math.hypot(ax + ex * u - x, az + ez * u - z); if (d >= bd) continue;
      // punkt bliżej skrzyżowania, 0,8 m od narożnika
      const uj = Math.max(.8 / L, Math.min(1 - .8 / L, ((jx - ax) * ex + (jz - az) * ez) / (L * L))), px = ax + ex * uj, pz = az + ez * uj;
      let nx = -ez / L, nz = ex / L; if (pip(P, px + nx * .3, pz + nz * .3)) { nx = -nx; nz = -nz; }
      bd = d; best = { x: px, z: pz, nx, nz };
    }
  }
  return best;
}

export class Signs {
  readonly group = new THREE.Group();
  private list: Sign[] = [];
  private live = new Map<number, THREE.Object3D>();

  /** Przebudowa listy po zmianie kafelków (tylko dane, bez sprite'ów). */
  rebuild(tiles: Iterable<TileData>, ground: (x: number, z: number) => number = () => 0, world: World | null = null): void {
    this.list = [];
    for (const t of tiles) {
      // skrzyżowania ulic o różnych nazwach: tabliczki na ścianach narożnych budynków, równolegle do każdej z ulic
      const legs = new Map<number, { name: string; dx: number; dz: number; hw: number }[]>();
      for (const r of t.r) if (r.n && !r.tu) for (let i = 0; i < r.j.length; i += 2) {
        const vi = r.j[i], id = r.j[i + 1], p = r.p, nv = p.length / 2;
        for (const o of [vi - 1, vi + 1]) if (o >= 0 && o < nv) {
          const dx = p[o * 2] - p[vi * 2], dz = p[o * 2 + 1] - p[vi * 2 + 1], L = Math.hypot(dx, dz); if (L < .5) continue;
          let l = legs.get(id); if (!l) legs.set(id, l = []); l.push({ name: r.n, dx: dx / L, dz: dz / L, hw: r.w / 2 });
        }
      }
      for (const g of t.g) {
        const l = legs.get(g.id); if (!g.jn || !l || new Set(l.map(q => q.name)).size < 2 || !world) continue;
        const done = new Set<string>(), seen: [number, number][] = [];
        for (const leg of l) {
          if (done.has(leg.name)) continue;
          const other = Math.max(...l.filter(q => q.name !== leg.name).map(q => q.hw));
          let n = 0;
          for (const sd of [1, -1]) {
            const px = g.x + leg.dx * (other + 6) - leg.dz * sd * (leg.hw + 4), pz = g.z + leg.dz * (other + 6) + leg.dx * sd * (leg.hw + 4);
            const w = wallNear(world, px, pz, leg.dx, leg.dz, g.x, g.z); if (!w || seen.some(([a, b]) => Math.hypot(a - w.x, b - w.z) < 2)) continue;
            seen.push([w.x, w.z]); n++;
            const name = leg.name, city = t.city, yaw = Math.atan2(w.nx, w.nz);
            this.list.push({ x: w.x + w.nx * .06, z: w.z + w.nz * .06, y: ground(w.x + w.nx, w.z + w.nz) + 2.8, shared: true,
              make: () => { const m = new THREE.Mesh(PLATE_GEO, plateMat(name, city)); m.rotation.y = yaw; return m; } });
          }
          if (n) done.add(leg.name);
        }
      }
      // witryny sklepów i lokali na parterach (szyld z nazwą zamiast unoszącej się tabliczki)
      const fronts = shopFronts(t, world), withFront = new Set(fronts.map(f => f.p.id));
      for (const f of fronts) this.list.push({ x: f.c[0], z: f.c[1], y: f.base, front: f, make: () => buildFront(f) });
      // tabliczki unoszące się w powietrzu (biura, pomniki, inne punkty bez witryny): usunięte – zostają szyldy nad witrynami
      void withFront;
    }
    this.clear();
  }

  /** Otwory witryn w pobliżu (dla shadera fasad: jak drzwi wejściowe) */
  holes: { c: [number, number]; u: [number, number]; w: number; y0: number; y1: number; up?: number }[] = [];
  /** drzwi wejściowe budynków z wnętrzem (świat): witryna, w której są takie drzwi, nie ma makiety ani otworu */
  doorsAt: (() => { c: [number, number]; w: number }[]) | null = null;
  /** godzina gry (0..24): ekspedient widoczny, gdy sklep otwarty */
  hourAt: (() => number) | null = null;
  /** witryny w pobliżu (przycisk sklepu, zakupy) */
  fronts: Front[] = [];

  update(x: number, z: number, r = 110): void {
    const near = new Set<number>(); this.holes = [];
    const doors = this.doorsAt?.() ?? [], hour = this.hourAt?.() ?? 12; this.fronts = [];
    // drzwi do wnętrza w miejscu witryny: witryna przesuwa się wzdłuż ściany (szklana witryna zawsze widoczna);
    // gdy na ścianie nie ma miejsca, znika tylko makieta wnętrza (drzwi zostają przejściem)
    const hit = (f: Front, t: number) => doors.some(d => { const dx = d.c[0] - f.a[0], dz = d.c[1] - f.a[1], along = dx * f.u[0] + dz * f.u[1], off = Math.abs(dx * f.u[1] - dz * f.u[0]); return off < 1.6 && Math.abs(along - t) < f.w / 2 + d.w / 2 + .5; });
    this.list.forEach((s, i) => {
      const f = s.front; if (!f || Math.abs(s.x - x) > r || Math.abs(s.z - z) > r) return;
      let blk = false;
      if (hit(f, f.t)) {
        let best: number | null = null; for (let t = f.w / 2 + .8; t <= f.L - f.w / 2 - .8; t += .5) if (!hit(f, t) && (best == null || Math.abs(t - f.t) < Math.abs(best - f.t))) best = t;
        if (best != null) { f.t = best; f.c = [f.a[0] + f.u[0] * best, f.a[1] + f.u[1] * best]; s.x = f.c[0]; s.z = f.c[1]; const o = this.live.get(i); if (o) this.drop(i, o); }
        else blk = true;
      }
      const open = isOpen(shopKind(f.p), hour), o = this.live.get(i);
      if (o) o.traverse(c => { if (c.userData.clerk) c.visible = open && !blk; else if (c.userData.room) c.visible = !blk; });
      this.holes.push({ c: f.c, u: f.u, w: f.w, y0: f.base + SHOP_Y0, y1: f.base + SHOP_Y1, up: 1.5 });
      this.fronts.push(f);
    });
    this.list.forEach((s, i) => {
      if (Math.abs(s.x - x) > r || Math.abs(s.z - z) > r) return; near.add(i); if (this.live.has(i)) return;
      const o = s.make(); o.position.x = s.x; o.position.z = s.z; o.position.y += s.y; this.group.add(o); this.live.set(i, o);
    });
    for (const [i, o] of this.live) if (!near.has(i)) this.drop(i, o);
  }

  clear(): void { for (const [i, o] of this.live) this.drop(i, o); }
  private drop(i: number, o: THREE.Object3D): void {
    o.traverse(c => {
      if (c instanceof THREE.Sprite) { c.material.map?.dispose(); c.material.dispose(); } // tabliczki: materiał wspólny, zostaje
      else if (c.userData.own && c instanceof THREE.Mesh) { c.geometry.dispose(); const m = c.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose(); } // witryny
    });
    this.group.remove(o); this.live.delete(i);
  }
}
