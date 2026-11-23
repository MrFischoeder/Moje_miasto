// Teren z NMT: układ PL-1992, czytanie rastrów (ASC, XYZ, obie kolejności osi), budowa kafli terenu gry,
// pierwszeństwo dokładnego terenu przed zgrubnym w świecie gry. Dane syntetyczne o znanej funkcji wysokości.
import { describe, expect, it } from 'vitest';
import { fromPL1992, meridianArc, toPL1992 } from '../src/data/pl1992';
import { CITIES } from '../src/data/cities';
import { DemTile, Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import type { TileData } from '../src/tiles/types';
import { buildDemTile, gameToLatLon, parseAsc, parseXyz, sampleRaster, type Raster, type RasterRef } from '../../tools/lib/nmt';

const o = CITIES.warszawa.o, center = toPL1992(o[0], o[1]);
/** Znana „rzeźba terenu”: nachylenie + wzgórze; wartości w m n.p.m. */
const H = (E: number, N: number) => 100 + .004 * (E - center[0]) - .003 * (N - center[1]) + 6 * Math.exp(-((E - center[0] - 250) ** 2 + (N - center[1] + 250) ** 2) / 120 ** 2);
const ref = 112.3;

/** Raster ASC 1 m pokrywający kafel gry (tx, ty) z zapasem; swap: osie jak w polskiej geodezji (X = północ). */
function ascFor(tx: number, ty: number, swap: boolean): string {
  let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
  for (const [x, z] of [[tx * 500, ty * 500], [tx * 500 + 500, ty * 500], [tx * 500, ty * 500 + 500], [tx * 500 + 500, ty * 500 + 500]]) {
    const [la, lo] = gameToLatLon(o, x, z), [E, N] = toPL1992(la, lo); E0 = Math.min(E0, E); E1 = Math.max(E1, E); N0 = Math.min(N0, N); N1 = Math.max(N1, N);
  }
  E0 = Math.floor(E0) - 5; N0 = Math.floor(N0) - 5; E1 = Math.ceil(E1) + 5; N1 = Math.ceil(N1) + 5;
  const [a0, a1, b0, b1] = swap ? [N0, N1, E0, E1] : [E0, E1, N0, N1], na = a1 - a0 + 1, nb = b1 - b0 + 1, rows: string[] = [];
  for (let j = 0; j < nb; j++) { const b = b1 - j, row: string[] = []; for (let i = 0; i < na; i++) { const a = a0 + i; row.push((swap ? H(b, a) : H(a, b)).toFixed(2)); } rows.push(row.join(' ')); }
  return `ncols ${na}\nnrows ${nb}\nxllcenter ${a0}\nyllcenter ${b0}\ncellsize 1\nnodata_value -9999\n` + rows.join('\n');
}
const refOf = (r: Raster): RasterRef => ({ bbox: r.bbox, load: async () => r });

describe('układ PL-1992 (EPSG:2180)', () => {
  it('południk osiowy i łuk południka niezależnie (całkowanie numeryczne); obie strony przeliczenia', () => {
    const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), phi = 52 * Math.PI / 180;
    let M = 0; const steps = 20000; for (let i = 0; i < steps; i++) { const p = (i + .5) / steps * phi; M += a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p) ** 2, 1.5) * phi / steps; }
    expect(meridianArc(phi)).toBeCloseTo(M, 2);
    const [E, N] = toPL1992(52, 19); expect(E).toBeCloseTo(500000, 3); expect(N).toBeCloseTo(.9993 * M - 5300000, 2);
    // Warszawa: < 1 mm; skraje Polski (do 5° od południka osiowego): < 3 cm (skrócone szeregi odwrotności)
    for (const [la, lo, tol] of [[52.23, 21.01, .001], [52.1, 20.85, .001], [52.37, 21.27, .001], [54.4, 14.2, .03], [49.2, 24.1, .03]]) {
      const [e, n] = toPL1992(la, lo), [la2, lo2] = fromPL1992(e, n);
      expect(Math.abs(la2 - la) * 111000).toBeLessThan(tol); expect(Math.abs(lo2 - lo) * 70000).toBeLessThan(tol);
    }
    expect(center[0]).toBeGreaterThan(630000); expect(center[0]).toBeLessThan(645000); // centrum Warszawy
    expect(center[1]).toBeGreaterThan(480000); expect(center[1]).toBeLessThan(495000);
  });
});

describe('import NMT do kafli terenu', () => {
  for (const swap of [false, true]) it(`ASC ${swap ? '(X = północ, jak w geodezji)' : '(X = wschód)'}: wysokości w grze zgodne co do centymetrów`, async () => {
    const r = parseAsc(ascFor(0, 0, swap), center); expect(r.swap).toBe(swap);
    const res = await buildDemTile(o, 0, 0, 2, ref, [refOf(r)], new Map(), null, .5);
    expect(res).not.toBeNull(); expect(res!.cover).toBe(1);
    const back = DemTile.parse(res!.tile.encode()), T = new Terrain(-2000, -2000, 30, 200, 200, ref, new Float32Array(200 * 200)); T.addFine(back);
    for (const [x, z] of [[0, 0], [123.4, 321.9], [250, 250], [499, 1], [377.7, 488.8]]) {
      const [la, lo] = gameToLatLon(o, x, z), [E, N] = toPL1992(la, lo);
      expect(Math.abs(T.height(x, z) + ref - H(E, N)), `(${x}, ${z})`).toBeLessThan(.06);
    }
    expect(T.height(-100, -100)).toBe(0); // poza dokładnym kaflem: model zgrubny
    expect(sampleRaster(r, ...toPL1992(...gameToLatLon(o, 250, 250)))).toBeCloseTo(H(...toPL1992(...gameToLatLon(o, 250, 250))), 1);
  });

  it('XYZ i luki w danych: punkty bez danych uzupełnia model zgrubny, mało danych = brak kafla', async () => {
    const asc = parseAsc(ascFor(0, 0, false), center), lines: string[] = [];
    for (let j = 0; j < asc.nb; j += 1) for (let i = 0; i < asc.na; i += 1) { const E = asc.a0 + i, N = asc.b1 - j; if (E < center[0] + 200) lines.push(`${E} ${N} ${asc.d[j * asc.na + i].toFixed(2)}`); }
    const r = parseXyz(lines.join('\n'), center);
    const res = await buildDemTile(o, 0, 0, 2, ref, [refOf(r)], new Map(), () => -50, .1);
    expect(res!.cover).toBeGreaterThan(.2); expect(res!.cover).toBeLessThan(.6);
    expect(Math.min(...res!.tile.h)).toBe(-50); // uzupełnienie
    expect(await buildDemTile(o, 0, 0, 2, ref, [refOf(r)], new Map(), null, .9)).toBeNull();
    expect(await buildDemTile(o, 5, 5, 2, ref, [refOf(r)], new Map(), null, .5)).toBeNull(); // kafel poza danymi
  });

  it('świat gry: kafel z dokładnym terenem ma pierwszeństwo, po zwolnieniu wraca model zgrubny', async () => {
    const r = parseAsc(ascFor(0, 0, false), center), dem = (await buildDemTile(o, 0, 0, 2, ref, [refOf(r)], new Map(), null))!.tile;
    const T = new Terrain(-2000, -2000, 30, 200, 200, ref, new Float32Array(200 * 200).fill(-1)), w = new World('warszawa', { terrain: T });
    const tile: TileData = { v: 1, city: 'warszawa', x: 0, y: 0, size: 500, b: [], r: [], a: [], l: [], n: [], g: [], poi: [], dem };
    expect(w.ground(100, 100)).toBe(-1);
    w.addTile(tile);
    const [E, N] = toPL1992(...gameToLatLon(o, 100, 100)); expect(Math.abs(w.ground(100, 100) + ref - H(E, N))).toBeLessThan(.06);
    w.removeTile('0_0'); expect(w.ground(100, 100)).toBe(-1);
  });
});
