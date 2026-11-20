// Gra po stronie klienta: ładowanie miasta, pętla (stały krok symulacji + renderowanie), widok bytów.
import * as THREE from 'three';
import { CITIES, type CityKey } from '@miasto/shared/data/cities';
import type { RawOsm } from '@miasto/shared/osm/raw';
import { buildTiles } from '@miasto/shared/tiles/build';
import type { Entity, Mode, SaveState } from '@miasto/shared/sim/types';
import { World } from '@miasto/shared/world/world';
import { createScene, type SceneCtx } from '../render/scene';
import { CityView } from '../world/cityView';
import { HttpTileSource, MemoryTileSource, NoTiles, type TileSource } from '../world/tiles/source';
import { StationLabels } from '../world/labels';
import { CameraRig } from '../player/camera';
import { disposeModel, makeCar, makeHeli, type VehicleModel } from '../player/models';
import { Input } from '../input/input';
import type { Action } from '../input/bindings';
import { LocalSession, type GameSession } from './session';

export interface GameUI {
  onCityLoaded(game: Game): void;
  onModeChanged(mode: Mode, fp: boolean): void;
  onXray(on: boolean): void;
  onMenu(): void;
  setBusy(on: boolean): void;
  setStatus(text: string): void;
  frame(game: Game): void;
  slowFrame(game: Game): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  readonly ctx: SceneCtx;
  readonly input: Input;
  readonly rig: CameraRig;
  session: GameSession | null = null;
  view: CityView | null = null;
  /** świat zbudowany z wczytanego pliku OSM */
  fromFile = false;
  xray = false;
  readonly labels = new StationLabels();
  private world3d = new THREE.Group();
  private models = new Map<number, VehicleModel>();
  /** kierunek patrzenia pieszego (należy do klienta, wysyłany w poleceniu wejścia) */
  viewYaw = 0; viewPitch = 0;
  private viewSeq = -1;
  private lastMode: Mode = 'walk';
  private last = performance.now(); private lastSlow = 0;
  /** pozycja do renderowania (interpolowana) bytu sterowanego przez gracza */
  readonly pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(canvas: HTMLCanvasElement, private ui: GameUI) {
    this.ctx = createScene(canvas);
    this.ctx.scene.add(this.world3d, this.labels.group);
    this.rig = new CameraRig(this.ctx.camera);
    this.input = new Input(canvas);
    this.input.onLook = (dx, dy) => this.look(dx, dy);
    this.input.onAction = a => this.action(a);
    requestAnimationFrame(t => this.frame(t));
  }

  get world(): World | null { return this.session?.world ?? null; }
  get mode(): Mode { return this.lastMode; }

  /** Ładuje miasto (z obiektami OSM albo bez). */
  loadCity(key: CityKey, raw: RawOsm | null): void {
    this.ui.setBusy(true);
    setTimeout(() => {
      try { this.doLoad(key, raw); } catch (e) { this.ui.setStatus('Błąd: ' + (e as Error).message); console.error(e); }
      this.ui.setBusy(false);
    }, 30);
  }

  private doLoad(key: CityKey, raw: RawOsm | null): void {
    this.view?.dispose(); this.labels.clear();
    for (const m of this.models.values()) { this.world3d.remove(m.root); disposeModel(m); } this.models.clear();
    if (this.view) this.world3d.remove(this.view.group);
    let world: World, source: TileSource;
    if (raw) {
      // plik OSM: te same kafelki co z tools/fetch-osm, budowane w pamięci
      const tiles = buildTiles(raw, key, CITIES[key].o);
      world = new World(key, { tiles: tiles.values(), osmPoints: raw.taggedNodes() });
      source = new MemoryTileSource(tiles, key);
    } else {
      world = new World(key);
      // plik otwarty z dysku (wersja jednoplikowa) nie może pobierać kafelków
      source = location.protocol === 'file:' ? new NoTiles() : new HttpTileSource(`${import.meta.env.BASE_URL}tiles/${key}/`);
    }
    this.fromFile = !!raw;
    this.session = new LocalSession(world);
    const view = this.view = new CityView(world, source, this.xray);
    this.world3d.add(view.group);
    view.streamer.init().then(n => { if (this.view === view && n) this.ui.slowFrame(this); });
    this.viewSeq = -1; this.syncView();
    this.lastMode = 'walk'; this.rig.reset(); this.ui.onModeChanged('walk', this.rig.fp);
    this.ui.onCityLoaded(this);
  }

  get cityName(): string { return this.world ? CITIES[this.world.key].name : ''; }

  // ---------- sterowanie ----------
  private look(dx: number, dy: number): void {
    if (this.lastMode !== 'walk') { this.rig.look(dx, dy, performance.now()); return; }
    this.viewYaw -= dx * .0025; this.viewPitch = Math.max(-1.45, Math.min(1.45, this.viewPitch - dy * .0025));
  }

  action(a: Action): void {
    const s = this.session;
    switch (a) {
      case 'modeWalk': s?.sendCommand({ type: 'mode', mode: 'walk' }); break;
      case 'modeCar': s?.sendCommand({ type: 'mode', mode: 'car' }); break;
      case 'modeHeli': s?.sendCommand({ type: 'mode', mode: 'heli' }); break;
      case 'interact': if (this.lastMode === 'walk') s?.sendCommand({ type: 'enter' }); break;
      case 'camera': this.rig.toggleFP(); this.ui.onModeChanged(this.lastMode, this.rig.fp); break;
      case 'xray': this.toggleXray(); break;
      case 'menu': this.ui.onMenu(); break;
    }
    this.afterCommand();
  }

  goStation(i: number, street: boolean): void { this.session?.sendCommand({ type: 'goStation', station: i, street }); this.afterCommand(); }

  toggleXray(): void { this.xray = !this.xray; this.view?.setXray(this.xray); this.ui.onXray(this.xray); }

  save(): SaveState | null { return this.session?.save() ?? null; }
  load(s: SaveState): void {
    if (!this.session) return;
    if (s.city !== this.session.world.key) { this.doLoad(s.city as CityKey, null); }
    this.session.load(s); this.afterCommand();
  }

  /** Po poleceniu: przejmij kierunek patrzenia z symulacji i odśwież tryb. */
  private afterCommand(): void {
    if (!this.session) return;
    this.syncView();
    const m = this.sessionMode();
    if (m !== this.lastMode) { this.lastMode = m; this.rig.reset(); this.ui.onModeChanged(m, this.rig.fp); }
  }

  private sessionMode(): Mode {
    const s = this.session!, p = s.player();
    if (p.vehicle == null) return 'walk';
    for (const e of s.entities()) if (e.id === p.vehicle) return e.kind === 'heli' ? 'heli' : 'car';
    return 'walk';
  }

  private syncView(): void {
    const s = this.session!, p = s.player();
    if (p.viewSeq === this.viewSeq) return; this.viewSeq = p.viewSeq;
    for (const e of s.entities()) if (e.id === p.walker) { this.viewYaw = e.yaw; this.viewPitch = e.pitch; }
  }

  /** Byt sterowany przez gracza. */
  controlled(): Entity | null {
    const s = this.session; if (!s) return null; const p = s.player(), id = p.vehicle ?? p.walker;
    for (const e of s.entities()) if (e.id === id) return e;
    return null;
  }

  // ---------- pętla ----------
  private frame(now: number): void {
    requestAnimationFrame(t => this.frame(t));
    const s = this.session; if (!s) return;
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const I = this.input;
    const f = I.axis('throttle'), st = I.axis('steer');
    s.sendInput({ f, s: st, run: I.button('run'), brake: I.button('handbrake'), lift: I.axis('lift'), yaw: this.viewYaw, pitch: this.viewPitch });
    const alpha = s.advance(dt);
    this.afterCommand();
    const me = this.controlled(); if (!me) return;
    const pv = s.previous(me.id) ?? me, P = this.pose;
    P.x = lerp(pv.x, me.x, alpha); P.y = lerp(pv.y, me.y, alpha); P.z = lerp(pv.z, me.z, alpha); P.yaw = lerpAngle(pv.yaw, me.yaw, alpha);
    this.renderEntities(alpha, dt);
    const mode = this.lastMode, w = s.world, cam = this.rig;
    if (mode === 'walk') {
      const bob = (f || st) ? Math.sin(now / 140) * .04 : 0;
      cam.walk(P.x, P.y, P.z, this.viewYaw, this.viewPitch, bob);
    } else {
      const V = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, roll: me.roll, kind: mode };
      if (mode === 'car') cam.chase(V, 9, 2.2, 1.2, dt, now, w.buildings); else cam.chase(V, 17, 5, 2.5, dt, now, w.buildings);
    }
    {
      const radius = mode === 'heli' ? Math.min(3000, 900 + P.y * 10) : mode === 'car' ? 1200 : P.y < -1 ? 600 : 900;
      this.view!.update(P.x, P.z, radius);
    }
    const under = mode === 'walk' && P.y < -1, { grid, fog } = this.ctx;
    { const gs = mode === 'heli' && P.y > 120 ? 5 : 1, step = 10 * gs; grid.scale.set(gs, 1, gs); grid.position.set(Math.round(P.x / step) * step, .04, Math.round(P.z / step) * step); }
    fog.near = under ? 30 : 60; fog.far = under ? 240 : mode === 'heli' ? Math.min(6000, 700 + P.y * 12) : mode === 'car' ? 900 : 650;
    if (now - this.lastSlow > 500) { this.lastSlow = now; this.labels.update(w, P.x, P.z); this.view!.slowUpdate(P.x, P.z); this.ui.slowFrame(this); }
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    this.ui.frame(this);
  }

  /** Modele pojazdów: jeden na byt, interpolowane między krokami symulacji. */
  private renderEntities(alpha: number, dt: number): void {
    const s = this.session!, p = s.player(), seen = new Set<number>();
    for (const e of s.entities()) {
      if (e.kind === 'walker') continue; seen.add(e.id);
      let m = this.models.get(e.id);
      if (!m) { m = e.kind === 'car' ? makeCar() : makeHeli(); this.models.set(e.id, m); this.world3d.add(m.root); }
      const pv = s.previous(e.id) ?? e, x = lerp(pv.x, e.x, alpha), y = lerp(pv.y, e.y, alpha), z = lerp(pv.z, e.z, alpha), yaw = lerpAngle(pv.yaw, e.yaw, alpha);
      m.root.visible = !(e.id === p.vehicle && this.rig.fp);
      if (e.kind === 'car') { m.root.position.set(x, 0, z); m.root.rotation.set(0, yaw, 0); m.root.rotateZ(e.roll); }
      else {
        m.root.position.set(x, y, z); m.root.rotation.set(e.tilt, yaw, e.roll);
        m.rotor!.rotation.y += dt * (e.driver == null ? 0 : e.air || e.lift > 0 ? 30 : 10); m.trotor!.rotation.x += dt * 45;
      }
    }
    for (const [id, m] of this.models) if (!seen.has(id)) { this.world3d.remove(m.root); disposeModel(m); this.models.delete(id); }
  }
}
