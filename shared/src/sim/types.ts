// Stan dynamiczny gry: byty (piesi, pojazdy, w przyszłości NPC i pociągi) i gracze.
// Tylko proste dane (JSON), żeby dało się je zapisać, odczytać i wysłać przez sieć.

export type EntityKind = 'walker' | 'car' | 'heli';
export type Mode = 'walk' | 'car' | 'heli';

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  /** prędkość wzdłużna auta */
  speed: number;
  vx: number; vy: number; vz: number;
  roll: number; tilt: number;
  /** region chodzenia (indeks w World.regions.list), -1 = powierzchnia */
  reg: number;
  /** helikopter w powietrzu */
  air: boolean;
  /** ostatnie polecenie wznoszenia (-1..1), do animacji wirnika */
  lift: number;
  /** gracz prowadzący pojazd */
  driver: number | null;
  /** właściciel (pojazd przywoływany przez gracza) */
  owner: number | null;
}

export interface PlayerState {
  id: number;
  name: string;
  /** byt pieszego gracza */
  walker: number;
  /** pojazd, w którym gracz siedzi */
  vehicle: number | null;
  /**
   * Rośnie, gdy symulacja sama ustawia kierunek patrzenia pieszego
   * (teleport, wyjście z pojazdu). Klient przejmuje wtedy yaw/pitch z bytu.
   */
  viewSeq: number;
}

/** Polecenie wejścia wysyłane co krok (klient nigdy nie wysyła pozycji). */
export interface InputCmd {
  /** przód / tył (-1..1) */
  f: number;
  /** prawo / lewo (-1..1) */
  s: number;
  run: boolean;
  /** hamulec ręczny */
  brake: boolean;
  /** wznoszenie helikoptera (-1..1) */
  lift: number;
  /** kierunek patrzenia pieszego */
  yaw: number; pitch: number;
}

export const NO_INPUT: InputCmd = { f: 0, s: 0, run: false, brake: false, lift: 0, yaw: 0, pitch: 0 };

/** Polecenia jednorazowe. */
export type Command =
  | { type: 'mode'; mode: Mode }
  | { type: 'enter' }
  | { type: 'goStation'; station: number; street: boolean };

export interface SaveState {
  v: 1;
  city: string;
  tick: number;
  nextId: number;
  entities: Entity[];
  players: PlayerState[];
}
