// Auta gracza: legalne (kupione w salonie albo przerejestrowane „na lewo” w dziupli) i nielegalne (kradzione,
// bez papierów). Legalne auto jest warunkiem pracy jako kierowca taksówki (shared/src/game/cabJob.ts).
import { VEH } from '../sim/vehicles';

/** Ceny aut w salonie [zł; w Londynie przeliczane]: indeks = wariant VEH. */
export const CAR_PRICE: number[] = VEH.map(v => ({
  'Hatchback': 1200, 'Sedan': 1600, 'Kombi': 1700, 'SUV': 2500, 'Auto miejskie': 900, 'Minivan': 2000, 'Taksówka': 1500, 'Auto sportowe': 6000,
  'Dostawczak': 2200, 'Ciężarówka': 5000, 'Ciągnik z naczepą': 8000, 'Motocykl': 1100, 'Skuter': 400, 'Hulajnoga elektryczna': 150,
} as Record<string, number>)[v.name] ?? 1500);
/** Przerejestrowanie w dziupli: część ceny auta. */
export const REREG_SHARE = .35;
/** Auta, którymi można wozić klientów (osobowe i dostawcze). */
export const CAB_OK = (v: number) => ['car', 'van'].includes(VEH[v]?.cls ?? '') && (VEH[v]?.seats ?? 0) >= 2;
/** Dziupla (warsztat „na lewo”) w mieście: miejsce przerejestrowania kradzionych aut; promień [m]. */
export const DZIUPLA: Record<string, { x: number; z: number; name: string }> = {
  wroclaw: { x: 200, z: -1300, name: 'warsztat na Nadodrzu' },
  warszawa: { x: 1800, z: -2600, name: 'warsztat na Pradze' },
  londyn: { x: 2500, z: 1500, name: 'garage in Peckham' },
};
export const DZIUPLA_R = 30;
