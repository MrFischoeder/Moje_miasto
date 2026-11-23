// Licznik wydajności: czas części klatki (CPU), odstęp klatek (FPS, najgorsza klatka), dane rysowania.
// Różnica między odstępem klatek a czasem CPU to głównie praca karty graficznej i przeglądarki.
export interface PerfReport {
  fps: number; frameAvg: number; frameMax: number; cpuAvg: number;
  parts: [string, number][];
}

export class PerfStats {
  private acc = new Map<string, number>();
  private t = 0; private start = 0; private frames = 0; private cpu = 0;
  private intSum = 0; private intMax = 0; private lastFrame = 0; private since = performance.now();

  /** początek klatki */
  begin(now: number): void {
    if (this.lastFrame) { const d = now - this.lastFrame; this.intSum += d; this.intMax = Math.max(this.intMax, d); }
    this.lastFrame = now; this.t = this.start = performance.now();
  }
  /** koniec odcinka klatki o nazwie name */
  lap(name: string): void { const n = performance.now(); this.acc.set(name, (this.acc.get(name) ?? 0) + n - this.t); this.t = n; }
  /** koniec klatki */
  end(): void { this.cpu += performance.now() - this.start; this.frames++; }

  /** Raport z okna od ostatniego wywołania (i wyzerowanie). */
  take(): PerfReport {
    const now = performance.now(), sec = Math.max(.001, (now - this.since) / 1000), n = Math.max(1, this.frames);
    const r: PerfReport = {
      fps: this.frames / sec, frameAvg: this.intSum / n, frameMax: this.intMax, cpuAvg: this.cpu / n,
      parts: [...this.acc.entries()].map(([k, v]) => [k, v / n] as [string, number]).sort((a, b) => b[1] - a[1]),
    };
    this.acc.clear(); this.frames = 0; this.cpu = 0; this.intSum = 0; this.intMax = 0; this.since = now;
    return r;
  }
}
