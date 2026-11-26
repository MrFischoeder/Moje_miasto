// Wysokość pomostu mostu: interpolacja terenu między końcami całego ciągu mostu.
export function deckY(bw: number[] | undefined, localArc: number, ground: (x: number, z: number) => number): number {
  if (!bw) return 0;
  const [ax, az, bx, bz, s0, dir, total] = bw, t = Math.max(0, Math.min(1, (s0 + dir * localArc) / (total || 1)));
  // końce pomostu na wysokości gruntu (drogi dojazdowej) – z modelem terenu z LiDAR-u (wały, nasypy) bez uskoków; między nimi równy spadek
  // wysokości końców zapisane w danych (tools/lib/waterBanks.ts), inaczej z gruntu (zależnie od wczytanych kafli)
  const ha = bw.length >= 9 ? bw[7] : ground(ax, az), hb = bw.length >= 9 ? bw[8] : ground(bx, bz);
  return ha * (1 - t) + hb * t;
}
