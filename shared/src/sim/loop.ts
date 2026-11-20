// Stały krok symulacji oddzielony od renderowania.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export class FixedStep {
  private acc = 0;
  constructor(readonly dt = SIM_DT, readonly maxSteps = 8) {}
  /**
   * Dodaje upływ czasu rzeczywistego i wykonuje tyle kroków, ile trzeba.
   * Zwraca współczynnik interpolacji (0..1) między poprzednim a bieżącym stanem.
   */
  advance(seconds: number, step: () => void): number {
    this.acc += Math.min(seconds, this.dt * this.maxSteps);
    while (this.acc >= this.dt) { step(); this.acc -= this.dt; }
    return this.acc / this.dt;
  }
}
