// Wysokość pomostu mostu: interpolacja terenu między końcami całego ciągu mostu.
export function deckY(bw: number[] | undefined, localArc: number, ground: (x: number, z: number) => number): number {
  if (!bw) return 0;
  const [ax, az, bx, bz, s0, dir, total] = bw, t = Math.max(0, Math.min(1, (s0 + dir * localArc) / (total || 1)));
  return ground(ax, az) * (1 - t) + ground(bx, bz) * t;
}
