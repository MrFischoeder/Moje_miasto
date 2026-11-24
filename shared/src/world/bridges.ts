// Wysokość pomostu mostu: interpolacja terenu między końcami całego ciągu mostu.
export function deckY(bw: number[] | undefined, localArc: number, ground: (x: number, z: number) => number): number {
  if (!bw) return 0;
  const [ax, az, bx, bz, s0, dir, total] = bw, t = Math.max(0, Math.min(1, (s0 + dir * localArc) / (total || 1)));
  // koniec mostu bywa tuż przy linii wody: wysokość brzegu = wyższa z (koniec, 12 m dalej na lądzie)
  const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L * 12, uz = (bz - az) / L * 12;
  const ha = Math.max(ground(ax, az), ground(ax - ux, az - uz)), hb = Math.max(ground(bx, bz), ground(bx + ux, bz + uz));
  return ha * (1 - t) + hb * t;
}
