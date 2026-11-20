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
  /** pasażerowie (id graczy) */
  pass: number[];
  /** ukryty (pieszy siedzący w pojeździe) */
  hide: boolean;
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
  /** siedzi jako pasażer (nie steruje) */
  passenger: boolean;
  /** jedzie komunikacją miejską: klucz kursu (wzorzec:kurs:dzień) */
  ride: string | null;
  /** kolor gracza (#rrggbb) */
  color: string;
  /**
   * Rośnie, gdy symulacja sama ustawia kierunek patrzenia pieszego
   * (teleport, wyjście z pojazdu). Klient przejmuje wtedy yaw/pitch z bytu.
   */
  viewSeq: number;
  /** kierunek patrzenia ustawiony przez symulację przy zmianie viewSeq */
  viewYaw?: number; viewPitch?: number;
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
  | { type: 'alight' }
  | { type: 'goStation'; station: number; street: boolean };

export const PLAYER_COLORS = ['#7dffb0', '#ffcc33', '#66e0ff', '#ff6b9a', '#b18cff', '#ff8a3d', '#3dffea', '#e8ff5a'];
/** Miejsca dla pasażerów w pojeździe. */
export const SEATS: Record<EntityKind, number> = { walker: 0, car: 3, heli: 3 };

export interface SaveState {
  v: 1;
  city: string;
  tick: number;
  nextId: number;
  entities: Entity[];
  players: PlayerState[];
}
