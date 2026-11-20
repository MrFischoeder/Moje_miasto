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

  /** Wysokość w punkcie (interpolacja dwuliniowa; poza siatką: najbliższa krawędź). */
  height(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.z0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j, n = this.nx, h = this.h, k = j * n + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - w) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * w;
  }
}
