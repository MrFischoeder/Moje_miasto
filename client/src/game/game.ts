// Gra po stronie klienta: ładowanie miasta, sesja (lokalny serwer w Workerze albo serwer sieciowy),
// przewidywanie własnego ruchu, interpolacja innych graczy, renderowanie.
import * as THREE from 'three';
import { CITIES, type CityKey } from '@miasto/shared/data/cities';
import type { RawOsm } from '@miasto/shared/osm/raw';
import { buildTiles } from '@miasto/shared/tiles/build';
import type { Entity, Mode, SaveState } from '@miasto/shared/sim/types';
import type { TileData } from '@miasto/shared/tiles/types';
import { World } from '@miasto/shared/world/world';
import type { Terrain } from '@miasto/shared/world/terrain';
import { createScene, GridDrape, type SceneCtx } from '../render/scene';
import { CityView } from '../world/cityView';
import { loadTerrain } from '../world/terrainLoader';
import { loadTransit } from '../world/transitLoader';
import { TransitView } from '../world/transitView';
import { AirView, loadAir } from '../world/airView';
import { TransitSystem } from '@miasto/shared/transit/system';
import type { TransitData } from '@miasto/shared/transit/timetable';
import { EMBEDDED_TILES } from '../world/embedded';
import { decodeTile, HttpTileSource, MemoryTileSource, NoTiles, type TileSource } from '../world/tiles/source';
import { StationLabels } from '../world/labels';
import { CameraRig } from '../player/camera';
import { disposeModel, makeAvatar, makeOfficer, makeHeli, type AvatarModel, type VehicleModel } from '../player/models';
import { makePoliceVehicle, makeVehicle, registerHQ, setOccupants, VEHICLE_Q, type Vehicle3D } from '../player/vehicles';
import { buildHQ } from '../player/vehiclesHQ';
registerHQ(buildHQ);
import { Input } from '../input/input';
import type { Action } from '../input/bindings';
import { NetSession, type ChatLine } from '../net/netSession';
import { WorkerTransport, WsTransport, type Transport, type WorkerIn } from '../net/transport';
import { localTime } from '@miasto/shared/transit/clock';
import { litFraction } from '@miasto/shared/interiors/facade';
import { InteriorView } from '../world/interiorView';
import { PerfStats } from './perf';
import { applyDaylight } from '../render/scene';
import { daylight } from '../render/palette';
import type { StopPoint } from '../world/tiles/props';
import { TILE_SIZE } from '@miasto/shared/tiles/types';
import type { LocalInit } from '../net/localServer.worker';
import LocalServer from '../net/localServer.worker?worker&inline';

export interface GameUI {
  onCityLoaded(game: Game): void;
  onModeChanged(mode: Mode, fp: boolean): void;
  onXray(on: boolean): void;
  onMenu(): void;
  onChat(l: ChatLine): void;
  /** wiadomość telefonu */
  onPm?(m: Extract<import('@miasto/shared/net/protocol').ServerMsg, { t: 'pm' }>): void;
  /** serwer zmienił tryb wnętrz */
  onInteriors?(on: boolean): void;
  onEvent(text: string, kind: 'crime' | 'arrest' | 'death' | 'info'): void;
  onPlayers(game: Game): void;
  setBusy(on: boolean): void;
  setStatus(text: string): void;
  frame(game: Game): void;
  slowFrame(game: Game): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const tilesBase = (key: string) => `${new URL(import.meta.env.BASE_URL, location.href).href}tiles/${key}/`;
/** dokładny teren (NMT) w kaflach: public/terrain/<miasto>/ */
const demBase = (key: string) => `${new URL(import.meta.env.BASE_URL, location.href).href}terrain/${key}/`;

/** kolory pieszych NPC (stonowane, żeby gracze się wyróżniali) */
const PED_COLORS = ['#3a5a8a', '#8a3030', '#d8d0c0', '#2e6a4a', '#c88a30', '#5a5a64', '#7a4a8a', '#e0e0e0', '#2a2a30', '#b05a5a'];
/** kolory aut z ruchu ulicznego */
const NPC_COLORS = [0xf0f0f0, 0xb8bcc0, 0x2a2c30, 0x6a7078, 0xa82020, 0x1e3a78, 0x3a5a8a, 0x2e5a3a, 0xd8d0c0, 0x8a2a2a, 0x4a4a50, 0xc8a040];

export interface OnlineInfo { http: string; session: string; name: string }

export class Game {
  readonly ctx: SceneCtx;
  readonly input: Input;
  readonly rig: CameraRig;
  session: NetSession | null = null;
  view: CityView | null = null;
  interiors: InteriorView | null = null;
  /** ustawienie: wnętrza budynków (gra jednoosobowa; w sieciowej decyduje serwer) */
  interiorsOn = true;
  /** ustawienia: najwięcej aut i pieszych NPC wokół gracza (gra jednoosobowa) */
  carMax = 70; pedMax = 50;
  /** licznik wydajności */
  readonly perf = new PerfStats();
  /** dane rysowania z ostatniej klatki */
  readonly drawInfo = { calls: 0, tris: 0, lines: 0 };
  private lastInt = 0;
  /** komunikacja miejska wg rozkładów (liczona lokalnie z zegara sesji) */
  transit: TransitSystem | null = null;
  private transitView: TransitView | null = null;
  airView: AirView | null = null;
  /** świat zbudowany z wczytanego pliku OSM */
  fromFile = false;
  /** gra sieciowa (null = jednoosobowa) */
  online: OnlineInfo | null = null;
  xray = false;
  /** wybrany własny pojazd naziemny (wariant VEH) */
  vehicle = 0;
  playerName = 'Gracz';
  readonly labels = new StationLabels();
  private drape: GridDrape;
  private world3d = new THREE.Group();
  private models = new Map<number, VehicleModel | AvatarModel | Vehicle3D>();
  private walkPhase = new Map<number, { x: number; z: number; ph: number }>();
  /** kierunek patrzenia pieszego (należy do klienta, wysyłany w poleceniu wejścia) */
  viewYaw = 0; viewPitch = 0;
  private viewSeq = -1;
  private lastMode: Mode = 'walk';
  private last = performance.now(); private lastSlow = 0;
  private loadGen = 0;
  /** pozycja do renderowania bytu, za którym podąża kamera */
  readonly pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(canvas: HTMLCanvasElement, private ui: GameUI) {
    this.ctx = createScene(canvas);
    this.ctx.scene.add(this.world3d, this.labels.group);
    this.drape = new GridDrape(this.ctx.grid);
    this.rig = new CameraRig(this.ctx.camera);
    this.input = new Input(canvas);
    this.input.onLook = (dx, dy) => this.look(dx, dy);
    this.input.onAction = a => this.action(a);
    requestAnimationFrame(t => this.frame(t));
  }

  get world(): World | null { return this.session?.world ?? null; }
  get mode(): Mode { return this.lastMode; }
  get cityName(): string { return this.world ? CITIES[this.world.key].name : ''; }

  // ---------- start ----------
  /** Gra jednoosobowa: lokalny serwer w Workerze (z obiektami OSM z pliku albo bez). */
  loadCity(key: CityKey, raw: RawOsm | null): Promise<void> { return this.start(key, raw, null); }

  /** Gra sieciowa: dołączenie do sesji na serwerze. */
  async joinOnline(http: string, session: string, name: string): Promise<void> {
    const r = await fetch(`${http}/api/sessions`); if (!r.ok) throw new Error('Serwer nie odpowiada');
    const s = (await r.json() as { id: string; city: CityKey }[]).find(x => x.id === session);
    if (!s) throw new Error('Nie ma takiej sesji');
    return this.start(s.city, null, { http, session, name });
  }

  private start(key: CityKey, raw: RawOsm | null, online: OnlineInfo | null): Promise<void> {
    const gen = ++this.loadGen;
    this.ui.setBusy(true);
    return new Promise((res, rej) => setTimeout(async () => {
      try {
        const [terrain, transit] = await Promise.all([loadTerrain(key), loadTransit(key)]); if (gen !== this.loadGen) return res();
        await this.setup(key, raw, terrain, online, transit); res();
      } catch (e) { this.ui.setStatus('Błąd: ' + (e as Error).message); console.error(e); rej(e); }
      finally { this.ui.setBusy(false); }
    }, 30));
  }

  private async setup(key: CityKey, raw: RawOsm | null, terrain: Terrain | null, online: OnlineInfo | null, transit: TransitData | null): Promise<void> {
    this.teardown();
    let world: World, source: TileSource, fileTiles: TileData[] | null = null;
    const emb = !raw && location.protocol === 'file:' ? EMBEDDED_TILES[key] : undefined;
    if (emb) {
      // wersja jednoplikowa: wbudowane kafle centrum
      const tiles = new Map<string, TileData>();
      for (const [k, url] of Object.entries(emb)) tiles.set(k, await decodeTile(url));
      fileTiles = [...tiles.values()];
      world = new World(key, { tiles: fileTiles, terrain });
      source = new MemoryTileSource(tiles, key);
    } else if (raw) {
      // plik OSM: te same kafelki co z tools/fetch-osm, budowane w pamięci
      const tiles = buildTiles(raw, key, CITIES[key].o); fileTiles = [...tiles.values()];
      world = new World(key, { tiles: fileTiles, osmPoints: raw.taggedNodes(), terrain });
      source = new MemoryTileSource(tiles, key);
    } else {
      world = new World(key, { terrain });
      source = location.protocol === 'file:' ? new NoTiles() : new HttpTileSource(tilesBase(key), demBase(key));
    }
    let tr: Transport;
    if (online) {
      const ws = new WsTransport(`${online.http.replace(/^http/, 'ws')}/ws?session=${encodeURIComponent(online.session)}&name=${encodeURIComponent(online.name)}`);
      await ws.opened; tr = ws;
    } else {
      const w = new LocalServer(), init: LocalInit = {
        city: key, name: this.playerName, terrain: terrain ? terrain.encode() : null,
        tiles: fileTiles, tilesBase: raw || location.protocol === 'file:' ? null : tilesBase(key), demBase: raw || location.protocol === 'file:' ? null : demBase(key), osmPoints: raw ? raw.taggedNodes() : null, transit,
      };
      tr = new WorkerTransport(w);
      const m: WorkerIn = { t: 'init', init }; w.postMessage(m);
    }
    const s = this.session = new NetSession(world, tr);
    s.onChat = l => this.ui.onChat(l);
    s.onPm = m => this.ui.onPm?.(m);
    s.onInteriors = on => { this.interiorsOn = on; this.ui.onInteriors?.(on); };
    s.onEvent = (t, k) => this.ui.onEvent(t, k);
    s.onPlayers = () => this.ui.onPlayers(this);
    s.onError = t => this.ui.setStatus(t);
    s.onClose = () => { if (this.session === s) this.ui.onChat({ from: '', color: '#ff6b6b', text: 'Rozłączono z serwerem.', sys: true, at: performance.now() }); };
    this.fromFile = !!raw; this.online = online;
    const view = this.view = new CityView(world, source, this.xray);
    this.world3d.add(view.group);
    this.interiors = new InteriorView(world); this.world3d.add(this.interiors.group);
    if (transit) {
      this.transit = new TransitSystem(transit, world, s.clock);
      const lc: Record<string, string> = {}; for (const l of world.city.lines) lc[l.n] = l.c;
      this.transitView = new TransitView(this.transit, lc); this.world3d.add(this.transitView.group);
      // wiaty przystanków autobusowych i tramwajowych: słupek z rozkładu, tyłem do chodnika (od toru jazdy)
      const byTile = new Map<string, StopPoint[]>(), seen = new Set<number>(), sys = this.transit;
      for (const p of sys.tt.patterns) {
        if (p.kind !== 'bus' && p.kind !== 'tram') continue;
        p.stops.forEach((si, j) => {
          if (seen.has(si)) return; const st = sys.tt.data.stops[si]; if (!st) return; seen.add(si);
          const q = sys.pose(p, p.stopS[j]), sx = st[1], sz = st[2], d = Math.hypot(sx - q.x, sz - q.z);
          const yaw = d > .5 && d < 25 ? Math.atan2(sx - q.x, sz - q.z) : q.yaw + Math.PI / 2;
          const k = Math.floor(sx / TILE_SIZE) + '_' + Math.floor(sz / TILE_SIZE); let l = byTile.get(k); if (!l) byTile.set(k, l = []);
          l.push({ x: sx, z: sz, yaw, kind: p.kind as 'bus' | 'tram' });
        });
      }
      view.streamer.stopsFor = (x, y) => byTile.get(x + '_' + y) ?? [];
      const transitSys = this.transit;
      loadAir(key).then(d => { if (d && this.transit === transitSys) { this.airView = new AirView(d, world, transitSys); this.world3d.add(this.airView.group); } });
    }
    view.streamer.init().then(n => { if (this.view === view && n) this.ui.slowFrame(this); });
    await Promise.race([s.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Serwer gry nie odpowiada')), 15000))]);
    await new Promise<void>(res => { const chk = () => s.player() ? res() : setTimeout(chk, 20); chk(); });
    this.viewSeq = -1; this.syncView();
    this.lastMode = 'walk'; this.rig.reset(); this.ui.onModeChanged('walk', this.rig.fp);
    if (!this.interiorsOn && !online) { world.interiors.setEnabled(false); s.setInteriors(false); }
    if (!online) s.setTraffic(this.carMax, this.pedMax);
    this.ui.onCityLoaded(this);
  }

  /** liczba widocznych pojazdów komunikacji (licznik wydajności) */
  get transitVisible(): number { return this.transitView?.visible.length ?? 0; }

  /** Limity ruchu NPC (gra jednoosobowa). Zwraca false w grze sieciowej. */
  setTraffic(cars: number, peds: number): boolean {
    this.carMax = cars; this.pedMax = peds;
    if (!this.session) return true;
    this.session.setTraffic(cars, peds); return true; // serwer sieciowy przyjmuje tylko w trybie testowym
  }

  /** Włącza / wyłącza wnętrza budynków (klient i lokalny serwer razem). Zwraca false w grze sieciowej. */
  setInteriorsOn(on: boolean): boolean {
    this.interiorsOn = on;
    if (!this.session) return true;
    if (this.online) { this.session.setInteriors(on); return true; } // serwer sieciowy: tylko w trybie testowym, odpowiada komunikatem 'interiors'
    this.session.world.interiors.setEnabled(on); this.session.setInteriors(on); return true;
  }

  /** Pojazdy komunikacji w pobliżu (minimapa). */
  transitDots(): { x: number; z: number; color: string }[] {
    const out: { x: number; z: number; color: string }[] = []; const v = this.transitView, t = this.transit; if (!v || !t) return out;
    const col: Record<string, string> = { bus: '#ff5a6e', tram: '#ffd23f', metro: '#5aa0ff', rail: '#4ce08a', ferry: '#66e0ff', cable: '#ff8a3d' };
    for (const a of v.visible) { const q = t.pose(a.p, a.st.s); out.push({ x: q.x, z: q.z, color: col[a.p.kind] }); }
    return out;
  }
  /** Godzina gry, np. „08:12 · śr”. */
  clockText(): string {
    if (!this.transit && !this.session) return '';
    const tz = this.transit?.tz ?? 'Europe/Warsaw', ms = this.session!.clock.now();
    return new Intl.DateTimeFormat('pl-PL', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date(ms));
  }

  private teardown(): void {
    this.session?.close(); this.session = null;
    if (this.transitView) { this.world3d.remove(this.transitView.group); this.transitView.dispose(); this.transitView = null; } this.transit = null;
    if (this.airView) { this.world3d.remove(this.airView.group); this.airView.dispose(); this.airView = null; }
    if (this.view) { this.world3d.remove(this.view.group); this.view.dispose(); this.view = null; }
    if (this.interiors) { this.world3d.remove(this.interiors.group); this.interiors.dispose(); this.interiors = null; }
    this.labels.clear();
    for (const m of this.models.values()) { this.world3d.remove(m.root); disposeModel(m); } this.models.clear();
  }

  // ---------- sterowanie ----------
  private look(dx: number, dy: number): void {
    if (this.lastMode !== 'walk') { this.rig.look(dx, dy, performance.now()); return; }
    this.viewYaw -= dx * .0025; this.viewPitch = Math.max(-1.45, Math.min(1.45, this.viewPitch - dy * .0025));
  }

  action(a: Action): void {
    const s = this.session;
    switch (a) {
      case 'modeWalk': s?.sendCommand({ type: 'mode', mode: 'walk' }); break;
      case 'modeCar': s?.sendCommand({ type: 'mode', mode: 'car', v: this.vehicle }); break;
      case 'modeHeli': s?.sendCommand({ type: 'mode', mode: 'heli' }); break;
      case 'interact': if (this.lastMode === 'walk' || this.riding) s?.sendCommand({ type: 'enter' }); break;
      case 'kick': if (this.lastMode === 'walk' && !this.riding) s?.sendCommand({ type: 'kick' }); break;
      case 'camera': this.rig.toggleFP(); this.ui.onModeChanged(this.lastMode, this.rig.fp); break;
      case 'xray': this.toggleXray(); break;
      case 'menu': this.ui.onMenu(); break;
    }
  }

  goStation(i: number, street: boolean): void { this.session?.sendCommand({ type: 'goStation', station: i, street }); }
  toggleXray(): void { this.xray = !this.xray; this.view?.setXray(this.xray); this.ui.onXray(this.xray); }
  chat(text: string): void { this.session?.chat(text); }
  private shot: ((url: string) => void) | null = null;
  /** Zdjęcie ekranu gry (sama scena 3D, bez nakładek), JPEG jako data URL. */
  capture(): Promise<string> { return new Promise(res => { this.shot = res; }); }

  /** Zapis i odczyt (gra jednoosobowa; w sieci stan zapisuje serwer). */
  async save(): Promise<SaveState | null> { return this.session && !this.online ? this.session.save() : null; }
  async load(s: SaveState): Promise<void> {
    if (this.online) throw new Error('W grze sieciowej postęp zapisuje serwer');
    if (!this.session || s.city !== this.session.world.key) await this.loadCity(s.city as CityKey, null);
    this.session!.load(s);
  }

  /** Tryb (pieszo / auto / helikopter) wg serwera. */
  private sessionMode(): Mode {
    const s = this.session!, p = s.player(); if (!p || p.vehicle == null) return 'walk';
    const v = s.entity(p.vehicle); return v ? (v.kind === 'heli' ? 'heli' : 'car') : this.lastMode;
  }

  private syncView(): void {
    const p = this.session?.player(); if (!p || p.viewSeq === this.viewSeq) return;
    this.viewSeq = p.viewSeq;
    if (p.viewYaw != null) { this.viewYaw = p.viewYaw; this.viewPitch = p.viewPitch ?? 0; }
  }

  /** Byt, za którym podąża kamera (pieszy albo pojazd, także jako pasażer). */
  controlled(): Entity | null {
    const s = this.session, p = s?.player(); if (!s || !p) return null;
    return s.entity(p.vehicle ?? p.walker) ?? null;
  }
  get isPassenger(): boolean { return !!this.session?.player()?.passenger; }
  /** kurs komunikacji, którym jedzie gracz */
  get riding(): string | null { return this.session?.player()?.ride ?? null; }
  /** Pozycja pojazdu komunikacji, którym jedzie gracz (liczona lokalnie z rozkładu). */
  ridePose(): { x: number; y: number; z: number; yaw: number; desc: string } | null {
    const k = this.riding; if (!k || !this.transit) return null;
    const a = this.transit.trip(k); if (!a) return null;
    const q = this.transit.pose(a.p, a.st.s); return { ...q, desc: this.transit.describe(a) };
  }

  // ---------- pętla ----------
  private frame(now: number): void {
    requestAnimationFrame(t => this.frame(t));
    const s = this.session; if (!s || !s.player()) return;
    const raw = (now - this.last) / 1000, dt = Math.min(.05, raw); this.last = now; const T = this.perf; T.begin(now);
    const I = this.input;
    const f = I.axis('throttle'), st = I.axis('steer');
    s.sendInput({ f, s: st, run: I.button('run'), brake: I.button('handbrake'), lift: I.axis('lift'), yaw: this.viewYaw, pitch: this.viewPitch });
    const alpha = s.advance(Math.min(.25, raw)); // stały krok nadrabia wolne klatki
    this.syncView(); T.lap('symulacja (przewidywanie)');
    const m = this.sessionMode();
    if (m !== this.lastMode) { this.lastMode = m; this.rig.reset(); this.ui.onModeChanged(m, this.rig.fp); }
    const me = this.controlled(); if (!me) { T.end(); return; }
    const pv = s.previous(me.id) ?? me, P = this.pose, ride = this.ridePose();
    if (ride) { P.x = ride.x; P.y = ride.y + 1.0; P.z = ride.z; P.yaw = ride.yaw; }
    else { P.x = lerp(pv.x, me.x, alpha); P.y = lerp(pv.y, me.y, alpha); P.z = lerp(pv.z, me.z, alpha); P.yaw = lerpAngle(pv.yaw, me.yaw, alpha); }
    this.renderEntities(alpha, dt); T.lap('auta i postacie');
    const mode = this.lastMode, w = s.world, cam = this.rig, gr = w.ground(P.x, P.z), alt = P.y - gr, under = mode === 'walk' && P.y < gr - 1;
    if (mode === 'walk') {
      const bob = (f || st) ? Math.sin(now / 140) * .04 : 0;
      cam.walk(P.x, P.y, P.z, this.viewYaw, this.viewPitch, bob);
    } else {
      const V = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, roll: me.roll, kind: mode };
      const top = (x: number, z: number) => w.roofTop(x, z);
      if (mode === 'car') cam.chase(V, 9, 2.2, 1.2, dt, now, top); else cam.chase(V, 17, 5, 2.5, dt, now, top);
    }
    const radius = mode === 'heli' ? Math.min(3000, 900 + alt * 10) : mode === 'car' ? 1200 : under ? 600 : 900;
    this.view!.update(P.x, P.z, radius); T.lap('kafle (doczytywanie)');
    this.transitView?.update(P.x, P.z, Math.min(radius, 1500), this.riding);
    this.airView?.update(P.x, P.z); T.lap('komunikacja i samoloty');
    const { grid, fog } = this.ctx;
    const gs = mode === 'heli' && alt > 120 ? 5 : 1, step = 10 * gs, gx = Math.round(P.x / step) * step, gz = Math.round(P.z / step) * step;
    grid.scale.set(gs, 1, gs); grid.position.set(gx, w.terrain ? 0 : .04, gz); this.drape.update(gx, gz, gs, w.terrain ? w.ground : null);
    T.lap('teren i siatka'); fog.near = under ? 30 : 60; fog.far = under ? 240 : mode === 'heli' ? Math.min(6000, 700 + alt * 12) : mode === 'car' ? 900 : 650;
    // wnętrza budynków wokół gracza (ten sam algorytm co na serwerze: przewidywanie ruchu się zgadza)
    if (this.interiors) {
      if (now - this.lastInt > 300) { this.lastInt = now; const me = s0Pos(this); w.interiors.sync(me ? [me] : []); }
      this.interiors.update(P.x, P.z, this.view!.streamer.mats.windows);
    }
    T.lap('wnętrza');
    if (now - this.lastSlow > 500) {
      const tz = this.transit?.tz ?? (w.key === 'londyn' ? 'Europe/London' : 'Europe/Warsaw'), lt = localTime(this.session!.clock.now(), tz);
      this.view!.streamer.mats.windows.uLit.value = litFraction(lt.sec / 3600);
      applyDaylight(this.ctx, lt.sec / 3600, under);
      this.view!.streamer.mats.props.setNight(1 - daylight(lt.sec / 3600));
      const day = under ? .6 : daylight(lt.sec / 3600); this.view!.streamer.mats.setLight(day); this.transitView?.setLight(day);
      this.view!.streamer.updateLamps(P.x, P.z, under ? 0 : 1 - daylight(lt.sec / 3600));
      const cp = this.ctx.camera.position; this.view!.streamer.updateWindows(cp.x, cp.z, under ? 0 : litFraction(lt.sec / 3600));
    }
    if (now - this.lastSlow > 500) {
      this.lastSlow = now; this.labels.update(w, P.x, P.z); T.lap('etykiety');
      this.view!.slowUpdate(P.x, P.z); T.lap('kafle (doczytywanie)'); this.ui.slowFrame(this);
    }
    T.lap('interfejs');
    const R = this.ctx.renderer; R.render(this.ctx.scene, this.ctx.camera); T.lap('rysowanie (wysłanie do GPU)');
    if (this.shot) { const f = this.shot; this.shot = null; f(R.domElement.toDataURL('image/jpeg', .9)); } // aparat w telefonie: obraz zaraz po narysowaniu
    this.drawInfo.calls = R.info.render.calls; this.drawInfo.tris = R.info.render.triangles; this.drawInfo.lines = R.info.render.lines;
    this.ui.frame(this); T.lap('interfejs (minimapa)');
    T.end();
  }

  /** Pojazdy i postacie innych graczy; własny byt interpolowany między krokami przewidywania. */
  private renderEntities(alpha: number, dt: number): void {
    const s = this.session!, p = s.player()!, seen = new Set<number>();
    for (const e of s.entities()) {
      if (e.kind === 'walker' && (e.id === p.walker || e.hide)) continue;
      seen.add(e.id);
      let m = this.models.get(e.id);
      if (m && e.kind === 'car' && (m.root.userData.v !== (e.v ?? 0) || m.root.userData.hq !== VEHICLE_Q.hq || (e.npc && m.root.userData.pk !== !!e.parked))) { this.world3d.remove(m.root); disposeModel(m); this.models.delete(e.id); m = undefined; } // zmiana pojazdu gracza
      if (!m) {
        if (e.kind === 'walker') {
          if (e.police) m = makeOfficer(e.id);
          else if (e.npc) m = makeAvatar(PED_COLORS[e.id % PED_COLORS.length], '', e.id);
          else { const pl = [...s.players.values()].find(q => q.walker === e.id); m = makeAvatar(pl?.color ?? '#7dffb0', pl?.name ?? '?', e.id); }
        }
        else if (e.kind === 'car') { m = e.police ? makePoliceVehicle(e.id) : makeVehicle(e.v ?? 0, e.npc || e.parked ? NPC_COLORS[e.id % NPC_COLORS.length] : 0xe8b830, !!e.npc && !e.parked, e.id); m.root.userData.v = e.v ?? 0; m.root.userData.pk = !!e.parked; }
        else m = makeHeli();
        this.models.set(e.id, m); this.world3d.add(m.root);
      }
      const pv = s.previous(e.id) ?? e, x = lerp(pv.x, e.x, alpha), y = lerp(pv.y, e.y, alpha), z = lerp(pv.z, e.z, alpha), yaw = lerpAngle(pv.yaw, e.yaw, alpha);
      if (e.kind === 'walker') {
        const a = m as AvatarModel, w = this.walkPhase.get(e.id) ?? { x, z, ph: 0 }, sp = Math.hypot(x - w.x, z - w.z) / Math.max(dt, 1e-3);
        w.ph += sp * dt * 2.2; w.x = x; w.z = z; this.walkPhase.set(e.id, w);
        const sw = Math.min(1, sp / 4) * Math.sin(w.ph) * .6;
        a.legs[0].rotation.x = sw; a.legs[1].rotation.x = -sw; a.arms[0].rotation.x = -sw; a.arms[1].rotation.x = sw;
        a.root.position.set(x, y + (e.tilt ? .15 : 0), z); a.root.rotation.set(0, yaw, 0); a.root.rotateX(e.tilt);
        continue;
      }
      m.root.visible = !(e.id === p.vehicle && this.rig.fp);
      if (e.kind === 'car') {
        m.root.position.set(x, y, z); m.root.rotation.set(0, yaw, 0); m.root.rotateZ(e.roll);
        if (m.lights) { const ph = Math.floor(performance.now() / 160) % 2; m.lights[0].visible = ph === 0; m.lights[1].visible = ph === 1; }
        if ('occupants' in m) setOccupants(m, e.driver != null, e.pass.length); // widać, kto siedzi w środku
      }
      else {
        m.root.position.set(x, y, z); m.root.rotation.set(e.tilt, yaw, e.roll);
        const hm = m as VehicleModel; hm.rotor!.rotation.y += dt * (e.driver == null ? 0 : e.air || e.lift > 0 ? 30 : 10); hm.trotor!.rotation.x += dt * 45;
      }
    }
    for (const [id, m] of this.models) if (!seen.has(id)) { this.world3d.remove(m.root); disposeModel(m); this.models.delete(id); this.walkPhase.delete(id); }
  }
}

/** Pozycja pieszego gracza (także w pojeździe) do synchronizacji wnętrz. */
function s0Pos(g: Game): { x: number; y: number; z: number } | null {
  const s = g.session, p = s?.player(); if (!s || !p) return null;
  const e = g.controlled(); return e ? { x: e.x, y: e.y, z: e.z } : null;
}
