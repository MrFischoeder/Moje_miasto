// Układ współrzędnych PL-1992 (EPSG:2180): odwzorowanie Gaussa–Krügera na elipsoidzie GRS80,
// południk osiowy 19°, skala 0,9993, przesunięcia E +500 000 m, N −5 300 000 m. W nim GUGiK udostępnia NMT.
// Wzory: Snyder, „Map Projections – A Working Manual” (USGS 1987), odwzorowanie poprzeczne Merkatora (dokładność < 1 mm w Polsce).

const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const K0 = 0.9993, LON0 = 19 * Math.PI / 180, FE = 500000, FN = -5300000;
const e4 = E2 * E2, e6 = e4 * E2;
const M1 = 1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256, M2 = 3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024, M3 = 15 * e4 / 256 + 45 * e6 / 1024, M4 = 35 * e6 / 3072;

/** Długość łuku południka od równika do szerokości phi [rad]. */
export function meridianArc(phi: number): number {
  return A * (M1 * phi - M2 * Math.sin(2 * phi) + M3 * Math.sin(4 * phi) - M4 * Math.sin(6 * phi));
}

/** Szerokość i długość [stopnie] → [E, N] w PL-1992 [m]. */
export function toPL1992(lat: number, lon: number): [number, number] {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, Aa = (lam - LON0) * c, M = meridianArc(phi);
  const x = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120);
  const y = K0 * (M + N * t * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  return [x + FE, y + FN];
}

/** [E, N] w PL-1992 [m] → szerokość i długość [stopnie]. */
export function fromPL1992(E: number, Nn: number): [number, number] {
  const x = E - FE, M = (Nn - FN) / K0, mu = M / (A * M1), e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1), C1 = EP2 * c * c, T1 = t * t;
  const N1 = A / Math.sqrt(1 - E2 * s * s), R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5), D = x / (N1 * K0);
  const phi = phi1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lam = LON0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [phi * 180 / Math.PI, lam * 180 / Math.PI];
}
