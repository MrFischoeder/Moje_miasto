// Warstwa transportu: gra nie wie, czy rozmawia z Workerem (gra jednoosobowa) czy z serwerem (WebSocket).
// Później można dodać WebTransport bez zmian w grze.
export interface Transport {
  send(d: ArrayBuffer | string): void;
  close(): void;
  onMessage: (d: ArrayBuffer | string) => void;
  onClose: () => void;
}

export class WsTransport implements Transport {
  private ws: WebSocket;
  onMessage: (d: ArrayBuffer | string) => void = () => {};
  onClose: () => void = () => {};
  readonly opened: Promise<void>;
  constructor(url: string) {
    this.ws = new WebSocket(url); this.ws.binaryType = 'arraybuffer';
    this.opened = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('Nie udało się połączyć z serwerem')); });
    this.ws.onmessage = e => this.onMessage(e.data as ArrayBuffer | string);
    this.ws.onclose = () => this.onClose();
  }
  send(d: ArrayBuffer | string): void { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(d); }
  close(): void { this.ws.onclose = null; this.ws.close(); }
}

/** Komunikaty Worker <-> gra */
export type WorkerIn = { t: 'init'; init: unknown } | { t: 'msg'; d: ArrayBuffer | string };

export class WorkerTransport implements Transport {
  onMessage: (d: ArrayBuffer | string) => void = () => {};
  onClose: () => void = () => {};
  constructor(private w: Worker) { w.onmessage = e => this.onMessage(e.data as ArrayBuffer | string); }
  send(d: ArrayBuffer | string): void { const m: WorkerIn = { t: 'msg', d }; if (typeof d === 'string') this.w.postMessage(m); else this.w.postMessage(m, [d]); }
  close(): void { this.w.terminate(); }
}
