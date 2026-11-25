// Ożywienie miejsca (0..1): ile ludzi i aut może tu być. Liczone z kafli: powierzchnia użytkowa budynków
// (rzut × kondygnacje) i liczba punktów usługowych (sklepy, lokale) w promieniu ok. 150 m.
// Centrum (zwarta zabudowa kamienic, dużo lokali) ≈ 1, centra osiedli 0,5–0,7, domy jednorodzinne ≈ 0,1,
// pola, lasy, tereny poza miastem ≈ 0.
import { TILE_SIZE, tileKey, type TileData } from '../tiles/types';

const C = 50, R = 3; // komórka 50 m; okno 7 × 7 komórek (350 m, ważone do ok. 150 m)
interface Cell { fl: number; poi: number }

export class Activity {
  private cells = new Map<string, Map<string, Cell>>(); // kafel -> komórki
  private memo = new Map<string, number>();
  constructor(private tiles: Map<string, TileData>) {}

  private cellsOf(k: string, t: TileData): Map<string, Cell> {
    let m = this.cells.get(k); if (m) return m;
    m = new Map(); this.cells.set(k, m); this.memo.clear();
    const at = (x: number, z: number) => { const kk = Math.floor(x / C) + ',' + Math.floor(z / C); let c = m!.get(kk); if (!c) m!.set(kk, c = { fl: 0, poi: 0 }); return c; };
    for (const b of t.b) {
      if (b.part || b.mh >= 2) continue;
      const o = b.o; let s = 0, cx = 0, cz = 0; const n = o.length / 2;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += o[2 * i] * o[2 * j + 1] - o[2 * j] * o[2 * i + 1]; cx += o[2 * i]; cz += o[2 * i + 1]; }
      const A = Math.abs(s) / 2, lv = b.lv ?? Math.max(1, Math.round(b.h / 3));
      // hale, garaże, szopy: mało ludzi na m²
      const k = ['industrial', 'warehouse', 'garage', 'garages', 'shed', 'hangar', 'roof', 'farm_auxiliary', 'greenhouse'].includes(b.t) || b.st === 'przem' ? .2 : 1;
      at(cx / n, cz / n).fl += A * lv * k;
    }
    for (const p of t.poi) if (p.c === 'shop' || p.c === 'amenity') at(p.x, p.z).poi++;
    return m;
  }
  private cell(x: number, z: number): Cell | undefined {
    const k = tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)), t = this.tiles.get(k); if (!t) return undefined;
    return this.cellsOf(k, t).get(Math.floor(x / C) + ',' + Math.floor(z / C));
  }
  /** Zmiana kafli świata (dołożony / wyładowany): przeliczenie. */
  changed(k: string): void { this.cells.delete(k); this.memo.clear(); }

  /** Ożywienie w punkcie (0..1), wynik zapamiętany dla komórki 50 m. */
  at(x: number, z: number): number {
    const gx = Math.floor(x / C), gz = Math.floor(z / C), key = gx + ',' + gz, m = this.memo.get(key); if (m !== undefined) return m;
    let fl = 0, poi = 0, wsum = 0;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const w = Math.exp(-(i * i + j * j) / 4.5), c = this.cell((gx + i + .5) * C, (gz + j + .5) * C); wsum += w; if (c) { fl += c.fl * w; poi += c.poi * w; }
    }
    const far = fl / (wsum * C * C); // wskaźnik intensywności zabudowy (m² użytkowe / m² terenu)
    const a = Math.min(1, .75 * Math.min(1, far / 1.1) + .35 * Math.min(1, poi / wsum / .6));
    this.memo.set(key, a); if (this.memo.size > 20000) this.memo.clear();
    return a;
  }
  /** Średnie ożywienie wokół punktu (promień ok. 200 m). */
  around(x: number, z: number): number { let s = 0; for (const [dx, dz] of [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150], [110, 110], [-110, 110], [110, -110], [-110, -110]]) s += this.at(x + dx, z + dz); return s / 9; }
}
