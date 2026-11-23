// Model terenu: siatka wysokości (np. co 30 m) w metrach względem wysokości środka miasta.
// Format pliku (little endian): 'MMT1', int32 x0, int32 z0, float32 krok, int32 nx, int32 nz,
// float32 wysokość odniesienia [m n.p.m.], potem Int16[nx*nz] w decymetrach (wiersze po z).
export class Terrain {
  constructor(readonly x0: number, readonly z0: number, readonly step: number, readonly nx: number, readonly nz: number,
    readonly ref: number, readonly h: Float32Array) {}

  static parse(buf: ArrayBuffer): Terrain {
    const v = new DataView(buf);
    if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'MMT1') throw new Error('To nie jest plik terenu');
    const x0 = v.getInt32(4, true), z0 = v.getInt32(8, true), step = v.getFloat32(12, true), nx = v.getInt32(16, true), nz = v.getInt32(20, true), ref = v.getFloat32(24, true);
    const h = new Float32Array(nx * nz); for (let i = 0; i < h.length; i++) h[i] = v.getInt16(28 + i * 2, true) / 10;
    return new Terrain(x0, z0, step, nx, nz, ref, h);
  }

  encode(): ArrayBuffer {
    const buf = new ArrayBuffer(28 + this.h.length * 2), v = new DataView(buf);
    'MMT1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setInt32(4, this.x0, true); v.setInt32(8, this.z0, true); v.setFloat32(12, this.step, true); v.setInt32(16, this.nx, true); v.setInt32(20, this.nz, true); v.setFloat32(24, this.ref, true);
    for (let i = 0; i < this.h.length; i++) v.setInt16(28 + i * 2, Math.max(-32768, Math.min(32767, Math.round(this.h[i] * 10))), true);
    return buf;
  }

  /** kafle w wysokiej rozdzielczości (klucz x_y), mają pierwszeństwo przed siatką zgrubną */
  private fine = new Map<string, DemTile>();
  /** krok kafli dokładnych [m] (0 = brak) */
  fineStep = 0;
  addFine(t: DemTile): void { this.fine.set(t.tx + '_' + t.ty, t); this.fineStep = t.step; }
  removeFine(key: string): void { this.fine.delete(key); }
  hasFine(tx: number, ty: number): boolean { return this.fine.has(tx + '_' + ty); }

  /** Wysokość: kafel dokładny (jeśli wczytany i ma dane w punkcie), inaczej siatka zgrubna. */
  height(x: number, z: number): number {
    if (this.fine.size) {
      const t = this.fine.get(Math.floor(x / 500) + '_' + Math.floor(z / 500));
      if (t) { const v = t.sample(x, z); if (!Number.isNaN(v)) return v + t.ref - this.ref; }
    }
    return this.coarse(x, z);
  }

  /** Wysokość z siatki zgrubnej (interpolacja dwuliniowa; poza siatką: najbliższa krawędź). */
  coarse(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.z0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j, n = this.nx, h = this.h, k = j * n + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - w) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * w;
  }
}

// ---------------------------------------------------------------------------------------------
// Teren w wysokiej rozdzielczości (np. NMT 1 m z LiDAR GUGiK) w kaflach 500 m, zgodnych z kaflami mapy.
// Format pliku (little endian): 'MMT2', int32 tx, int32 ty, float32 krok, int32 n (próbek na bok, krawędzie wspólne
// z sąsiadami), float32 wysokość odniesienia [m n.p.m.], potem Int16[n*n] w centymetrach względem odniesienia
// (wiersze po z), wartość -32768 = brak danych.

export const DEM_NODATA = -32768;

export class DemTile {
  constructor(readonly tx: number, readonly ty: number, readonly step: number, readonly n: number, readonly ref: number, readonly h: Float32Array) {}
  get x0(): number { return this.tx * this.step * (this.n - 1); }
  get z0(): number { return this.ty * this.step * (this.n - 1); }

  static parse(buf: ArrayBuffer): DemTile {
    const v = new DataView(buf);
    if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'MMT2') throw new Error('To nie jest kafel terenu');
    const tx = v.getInt32(4, true), ty = v.getInt32(8, true), step = v.getFloat32(12, true), n = v.getInt32(16, true), ref = v.getFloat32(20, true);
    const h = new Float32Array(n * n);
    for (let i = 0; i < h.length; i++) { const q = v.getInt16(24 + i * 2, true); h[i] = q === DEM_NODATA ? NaN : q / 100; }
    return new DemTile(tx, ty, step, n, ref, h);
  }

  encode(): ArrayBuffer {
    const buf = new ArrayBuffer(24 + this.h.length * 2), v = new DataView(buf);
    'MMT2'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setInt32(4, this.tx, true); v.setInt32(8, this.ty, true); v.setFloat32(12, this.step, true); v.setInt32(16, this.n, true); v.setFloat32(20, this.ref, true);
    for (let i = 0; i < this.h.length; i++) v.setInt16(24 + i * 2, Number.isNaN(this.h[i]) ? DEM_NODATA : Math.max(-32767, Math.min(32767, Math.round(this.h[i] * 100))), true);
    return buf;
  }

  /** Wysokość względem odniesienia w punkcie (dwuliniowo); NaN poza kaflem lub bez danych. */
  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.step, fz = (z - this.z0) / this.step, n = this.n;
    if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return NaN;
    const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fz)), u = fx - i, w = fz - j, k = j * n + i, h = this.h;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - w) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * w;
  }
}
