// Projekcja równoodległościowa wokół stałego środka miasta.
// Oś X na wschód, oś Z na południe, Y w górę, 1 jednostka = 1 m.
export type Proj = (lat: number, lon: number) => [number, number];

export function makeProj(o: [number, number]): Proj {
  const kx = Math.cos(o[0] * Math.PI / 180) * 111320, ky = 110540;
  return (lat, lon) => [(lon - o[1]) * kx, -(lat - o[0]) * ky];
}

/** Normalizacja nazw stacji: bez polskich znaków, bez słów „metro”, „station” itd. */
export const normName = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|metro|underground|station|stacja/g, '').replace(/[^a-z0-9]/g, '');
