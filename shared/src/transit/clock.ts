// Zegar gry: czas lokalny miasta (strefa czasowa), typ dnia rozkładu. Serwer jest źródłem czasu;
// klient dostaje przesunięcie przy dołączeniu. Skala czasu > 1 przyspiesza dobę (testy, później opcja gry).
export const CITY_TZ: Record<string, string> = { warszawa: 'Europe/Warsaw', londyn: 'Europe/London' };

/** Typ dnia rozkładu: 0 dzień powszedni, 1 sobota, 2 niedziela. */
export type DayType = 0 | 1 | 2;

export interface LocalTime { day: DayType; prevDay: DayType; sec: number; weekday: number; date: string }

const fmt = new Map<string, Intl.DateTimeFormat>();
/** Czas lokalny w strefie miasta dla chwili epoch [ms]. */
export function localTime(epochMs: number, tz: string): LocalTime {
  let f = fmt.get(tz);
  if (!f) fmt.set(tz, f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' }));
  const p: Record<string, string> = {}; for (const x of f.formatToParts(new Date(epochMs))) p[x.type] = x.value;
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  const dayOf = (w: number): DayType => (w < 5 ? 0 : w === 5 ? 1 : 2);
  const sec = +p.hour * 3600 + +p.minute * 60 + +p.second + (epochMs % 1000) / 1000;
  return { day: dayOf(wd), prevDay: dayOf((wd + 6) % 7), sec, weekday: wd, date: `${p.year}-${p.month}-${p.day}` };
}

/** Zegar gry: czas gry = start + (teraz - kotwica) × skala. */
export class GameClock {
  constructor(public anchorReal = Date.now(), public anchorGame = Date.now(), public scale = 1) {}
  now(real = Date.now()): number { return this.anchorGame + (real - this.anchorReal) * this.scale; }
  set(game: number, scale = this.scale, real = Date.now()): void { this.anchorReal = real; this.anchorGame = game; this.scale = scale; }
}
