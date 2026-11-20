// Sesja gry: jedyne miejsce, przez które klient rozmawia z symulacją.
// Teraz symulacja działa w tym samym wątku (LocalSession); później ten sam interfejs
// obsłuży serwer w Web Workerze (gra jednoosobowa) i serwer sieciowy (WebSocket).
import { Simulation } from '@miasto/shared/sim/sim';
import { FixedStep } from '@miasto/shared/sim/loop';
import type { Command, Entity, InputCmd, PlayerState, SaveState } from '@miasto/shared/sim/types';
import type { World } from '@miasto/shared/world/world';

export interface GameSession {
  readonly world: World;
  readonly playerId: number;
  sendInput(cmd: InputCmd): void;
  sendCommand(c: Command): void;
  /** Posuwa czas; zwraca współczynnik interpolacji 0..1. */
  advance(seconds: number): number;
  player(): PlayerState;
  entities(): Iterable<Entity>;
  /** stan sprzed ostatniego kroku (do interpolacji) */
  previous(id: number): Pick<Entity, 'x' | 'y' | 'z' | 'yaw'> | undefined;
  save(): SaveState;
  load(s: SaveState): void;
}

export class LocalSession implements GameSession {
  readonly sim: Simulation;
  readonly playerId: number;
  private loop = new FixedStep();
  private prev = new Map<number, Pick<Entity, 'x' | 'y' | 'z' | 'yaw'>>();

  constructor(readonly world: World, name = 'Gracz') {
    this.sim = new Simulation(world);
    this.playerId = this.sim.addPlayer(name).id;
  }

  sendInput(cmd: InputCmd): void { this.sim.setInput(this.playerId, cmd); }
  sendCommand(c: Command): void {
    this.sim.command(this.playerId, c);
    this.prev.clear(); // bez interpolacji po skoku
  }
  advance(seconds: number): number {
    return this.loop.advance(seconds, () => {
      for (const e of this.sim.entities.values()) {
        const p = this.prev.get(e.id);
        if (p) { p.x = e.x; p.y = e.y; p.z = e.z; p.yaw = e.yaw; } else this.prev.set(e.id, { x: e.x, y: e.y, z: e.z, yaw: e.yaw });
      }
      this.sim.step();
    });
  }
  player(): PlayerState { return this.sim.players.get(this.playerId)!; }
  entities(): Iterable<Entity> { return this.sim.entities.values(); }
  previous(id: number) { return this.prev.get(id); }
  save(): SaveState { return this.sim.serialize(); }
  load(s: SaveState): void { this.sim.load(s); this.prev.clear(); }
}
