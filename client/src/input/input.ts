// Warstwa wejścia: klawiatura, mysz (pointer lock z zapasowym przeciąganiem) i dotyk mapowane na akcje.
import { DEFAULT_BINDINGS, type Action, type Axis, type Bindings, type Button } from './bindings';

export class Input {
  private keys: Record<string, boolean> = {};
  private joy = { id: null as number | null, x: 0, y: 0, ox: 0, oy: 0 };
  private lk = { id: null as number | null, x: 0, y: 0 };
  private touchUp = false; private touchDn = false;
  private locked = false; private drag = false;
  private actionKeys = new Map<string, Action[]>();

  /** obrót kamery (piksele) */
  onLook: (dx: number, dy: number) => void = () => {};
  onAction: (a: Action) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private bindings: Bindings = DEFAULT_BINDINGS) {
    for (const [a, codes] of Object.entries(bindings.actions) as [Action, string[]][]) for (const c of codes) {
      const l = this.actionKeys.get(c) || []; l.push(a); this.actionKeys.set(c, l);
    }
    this.keyboard(); this.mouse();
  }

  get pointerLocked(): boolean { return this.locked; }

  axis(a: Axis): number {
    const b = this.bindings.axes[a]; let v = 0;
    if (b.pos.some(k => this.keys[k])) v++; if (b.neg.some(k => this.keys[k])) v--;
    if (a === 'throttle') v -= this.joy.y; else if (a === 'steer') v += this.joy.x;
    else if (a === 'lift') v += (this.touchUp ? 1 : 0) - (this.touchDn ? 1 : 0);
    return Math.max(-1, Math.min(1, v));
  }
  button(b: Button): boolean {
    if (b === 'run' && Math.hypot(this.joy.x, this.joy.y) > .95) return true;
    return this.bindings.buttons[b].some(k => this.keys[k]);
  }

  private keyboard(): void {
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); };
    addEventListener('keydown', e => {
      if (typing(e)) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      for (const a of this.actionKeys.get(e.code) || []) this.onAction(a);
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }

  private mouse(): void {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === c; });
    c.addEventListener('mousedown', () => {
      this.drag = true;
      if (!this.locked) { try { const r = c.requestPointerLock() as unknown as Promise<void> | undefined; if (r && r.catch) r.catch(() => {}); } catch { /* brak pointer lock */ } }
    });
    addEventListener('mouseup', () => { this.drag = false; });
    addEventListener('mousemove', e => { if (this.locked || this.drag) this.onLook(e.movementX, e.movementY); });
  }

  releasePointer(): void { if (this.locked) document.exitPointerLock(); }

  /** Dotyk: joystick po lewej, przeciąganie po prawej obraca kamerę, przyciski ▲▼ helikoptera. */
  attachTouch(joyEl: HTMLElement, knob: HTMLElement, upBtn: HTMLElement, dnBtn: HTMLElement): void {
    const joy = this.joy, lk = this.lk;
    const moveJoy = (t: Touch) => {
      let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy; const m = Math.hypot(dx, dy), R = 55;
      if (m > R) { dx *= R / m; dy *= R / m; } joy.x = dx / R; joy.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    this.canvas.addEventListener('touchstart', e => { for (const t of e.changedTouches) if (t.clientX > innerWidth * .4 && lk.id == null) { lk.id = t.identifier; lk.x = t.clientX; lk.y = t.clientY; } }, { passive: true });
    joyEl.addEventListener('touchstart', e => {
      const t = e.changedTouches[0], r = joyEl.getBoundingClientRect(); joy.id = t.identifier; joy.ox = r.left + r.width / 2; joy.oy = r.top + r.height / 2; moveJoy(t); e.preventDefault();
    }, { passive: false });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) moveJoy(t);
        else if (t.identifier === lk.id) { this.onLook((t.clientX - lk.x) * 1.6, (t.clientY - lk.y) * 1.6); lk.x = t.clientX; lk.y = t.clientY; }
      }
    }, { passive: true });
    addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
        if (t.identifier === lk.id) lk.id = null;
      }
    });
    for (const [b, up] of [[upBtn, true], [dnBtn, false]] as [HTMLElement, boolean][]) {
      const set = (v: boolean) => { if (up) this.touchUp = v; else this.touchDn = v; };
      b.addEventListener('pointerdown', e => { e.preventDefault(); set(true); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => set(false));
    }
  }
}
