// Wejście klienta: łączy grę z HUD, menu, minimapą i sterowaniem dotykowym.
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './style.css';
import { cityAt, type CityKey } from '@miasto/shared/data/cities';
import type { SaveState } from '@miasto/shared/sim/types';
import { Game, type GameUI } from './game/game';
import { parseOsmText } from './osm/parse';
import { locText } from './ui/hud';
import { renderMinimap } from './ui/minimap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c'), mini = $<HTMLCanvasElement>('mini'), menu = $('menu'), stSel = $<HTMLSelectElement>('stSel');
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
const SAVE_KEY = 'moje-miasto.save';

const nearestIndex = (g: Game) => { const w = g.world!; return w.nearestStation(g.pose.x, g.pose.z).i; };
const openMenu = () => { menu.classList.remove('hide'); if (game.world) stSel.value = String(nearestIndex(game)); game.input.releasePointer(); };
const closeMenu = () => menu.classList.add('hide');

function info(g: Game): void {
  const w = g.world!, v = g.view!, st = v.streamer.stats, s = g.session;
  const b = v.streamer.hasTiles ? ` · budynki: ${v.buildingCount}` + (g.fromFile ? '' : ` · kafelki: ${st.visible}/${st.indexed}`) : ' · bez budynków';
  const on = g.online && s ? ` · sieć: ${s.players.size} graczy` : '';
  const tr = g.transit ? ` · komunikacja: ${g.transitDots().length} w pobliżu` : '';
  $('info').textContent = `${w.stations.length} stacji · ${w.metro.tunnels.length} tuneli` + b + (w.osmStations ? ` · stacje z OSM: ${w.osmStations}` : '') + tr + on;
}

// ---------- czat ----------
const chatBox = $('chat'), chatLog = $('chatLog'), chatIn = $<HTMLInputElement>('chatIn');
function addChat(from: string, color: string, text: string, sys = false): void {
  const d = document.createElement('div'); if (sys) d.className = 'sys';
  if (from) { const b = document.createElement('b'); b.style.color = color; b.textContent = from + ': '; d.append(b); }
  d.append(document.createTextNode(text)); chatLog.append(d);
  while (chatLog.children.length > 8) chatLog.firstChild!.remove();
  setTimeout(() => { if (!chatBox.classList.contains('open')) d.remove(); }, 12000);
}
function openChat(): void { chatBox.classList.add('open'); game.input.releasePointer(); setTimeout(() => chatIn.focus(), 0); }
function closeChat(): void { chatBox.classList.remove('open'); chatIn.value = ''; chatIn.blur(); }
chatIn.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const t = chatIn.value.trim(); if (t) game.chat(t); closeChat(); e.preventDefault(); }
  else if (e.key === 'Escape') closeChat();
});

const ui: GameUI = {
  setBusy(on) { $('busy').style.display = on ? 'grid' : 'none'; },
  setStatus(t) { $('status').textContent = t; },
  onMenu: openMenu,
  onChat(l) { addChat(l.from, l.color, l.text, l.sys); },
  onEvent(text, kind) {
    const box = $('evt'), d = document.createElement('div'); d.className = kind; d.textContent = text; box.append(d);
    while (box.children.length > 3) box.firstChild!.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, kind === 'info' ? 2600 : 4500);
  },
  onPlayers(g) { info(g); },
  onXray(on) { $('xrayBtn').className = on ? 'on' : 'ghost'; },
  onModeChanged(mode) {
    for (const [id, k] of [['walkBtn', 'walk'], ['carBtn', 'car'], ['heliBtn', 'heli']]) $(id).className = mode === k ? 'on' : 'ghost';
    document.body.classList.toggle('heli', mode === 'heli'); document.body.classList.toggle('car', mode === 'car');
  },
  onCityLoaded(g) {
    const w = g.world!, city = w.city, k = w.key;
    $('cityName').textContent = city.name.toUpperCase();
    info(g);
    $('note').textContent = city.note;
    $('cityW').className = k === 'warszawa' ? '' : 'ghost'; $('cityL').className = k === 'londyn' ? '' : 'ghost';
    stSel.innerHTML = w.stations.map(s => [s.name, s.i] as [string, number]).sort((a, b) => a[0].localeCompare(b[0], 'pl'))
      .map(([n, i]) => `<option value="${i}">${n} (${[...w.stations[i].lines.keys()].map(l => city.lines[l].n).join(', ')})</option>`).join('');
    stSel.value = String(nearestIndex(g));
  },
  slowFrame(g) {
    const e = g.controlled(); if (!e || !g.world) return;
    const ride = g.ridePose(), clock = g.clockText();
    const box = g.mode === 'walk' && !ride ? g.world.interiors.container(e.x, e.z, e.y) : null;
    $('loc').textContent = (clock ? clock + ' · ' : '') + (ride ? ride.desc : locText(g.world, g.mode, e)) + (box ? ` · E: przeszukaj (${box.item.n})` : ''); info(g);
  },
  frame(g) {
    const st = g.session?.me;
    if (st) {
      const hp = Math.max(0, Math.min(100, st.hp));
      $('hpFill').style.width = hp + '%'; $('hpBar').classList.toggle('low', hp < 30);
      $('money').textContent = `${st.money.toFixed(2).replace(/\.00$/, '')} ${st.cur}`;
      $('stars').textContent = '★'.repeat(st.wanted) + '☆'.repeat(5 - st.wanted); $('stars').classList.toggle('flash', st.wanted > 0);
      document.body.classList.toggle('dead', st.dead);
    }
    const w = g.world, P = g.pose, gr = w ? w.ground(P.x, P.z) : 0;
    const s = g.session, me = s?.player(), others = [];
    if (s && me) for (const p of s.players.values()) if (p.id !== me.id) { const e = s.entity(p.vehicle ?? p.walker); if (e) others.push({ x: e.x, z: e.z, color: p.color }); }
    renderMinimap(mini, w, { ...P, yaw: g.mode === 'walk' ? g.viewYaw : P.yaw, mode: g.mode, xray: g.xray, under: P.y < gr - 1, height: P.y - gr, others, transit: g.transitDots() });
  },
};

const game = new Game(canvas, ui);
const origAction = game.action.bind(game);
game.action = a => { if (a === 'chat') openChat(); else origAction(a); };
game.input.attachTouch($('joy'), $('knob'), $('upB'), $('dnB'));

$('xrayBtn').onclick = () => game.toggleXray();
$('walkBtn').onclick = () => game.action('modeWalk');
$('carBtn').onclick = () => game.action('modeCar');
$('heliBtn').onclick = () => game.action('modeHeli');
$('camBtn').onclick = () => game.action('camera');
$('menuBtn').onclick = openMenu;
$('chatBtn').onclick = openChat;
$('cityW').onclick = () => { game.loadCity('warszawa', null); closeMenu(); };
$('cityL').onclick = () => { game.loadCity('londyn', null); closeMenu(); };
$('goBtn').onclick = () => { game.goStation(+stSel.value, false); closeMenu(); };
$('upBtn').onclick = () => { game.goStation(+stSel.value, true); closeMenu(); };
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('q').textContent || ''); $('copyBtn').textContent = 'Skopiowano'; }
  catch { $('copyBtn').textContent = 'Zaznacz i skopiuj ręcznie'; }
};
$<HTMLInputElement>('fileIn').onchange = async e => {
  const inp = e.target as HTMLInputElement, f = inp.files?.[0]; if (!f) return; $('status').textContent = 'Wczytuję ' + f.name + '…';
  try {
    const raw = parseOsmText(await f.text()), [la, lo] = raw.center(), best = cityAt(la, lo);
    if (!best) throw new Error('Ten plik nie leży w Warszawie ani w Londynie');
    $('status').textContent = ''; closeMenu(); game.loadCity(best, raw);
  } catch (err) { $('status').textContent = 'Błąd: ' + (err as Error).message; }
  inp.value = '';
};
$('saveBtn').onclick = async () => {
  const s = await game.save(); if (!s) { $('status').textContent = 'W grze sieciowej postęp zapisuje serwer.'; return; }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); $('status').textContent = 'Zapisano stan gry.'; }
  catch { $('status').textContent = 'Nie udało się zapisać (pamięć przeglądarki niedostępna).'; }
};
$('loadBtn').onclick = () => {
  let s: SaveState | null = null;
  try { const t = localStorage.getItem(SAVE_KEY); s = t ? JSON.parse(t) : null; } catch { s = null; }
  if (!s) { $('status').textContent = 'Brak zapisanego stanu.'; return; }
  game.load(s).then(() => { $('status').textContent = ''; closeMenu(); }, err => { $('status').textContent = 'Błąd: ' + (err as Error).message; });
};

// ---------- lobby ----------
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* brak */ } } };
const nickIn = $<HTMLInputElement>('nick'), serverIn = $<HTMLInputElement>('server');
nickIn.value = store.get('moje-miasto.nick') || ''; game.playerName = nickIn.value || 'Gracz';
serverIn.value = store.get('moje-miasto.server') || (location.port === '8787' ? location.origin : `http://${location.hostname || 'localhost'}:8787`);
nickIn.onchange = () => { store.set('moje-miasto.nick', nickIn.value); game.playerName = nickIn.value || 'Gracz'; };
serverIn.onchange = () => store.set('moje-miasto.server', serverIn.value);
const httpBase = () => { let u = serverIn.value.trim().replace(/\/+$/, ''); if (!/^https?:\/\//.test(u)) u = 'http://' + u; return u.replace(/^ws/, 'http'); };
interface SessionRow { id: string; city: CityKey; cityName: string; players: number; max: number }
async function refreshSessions(): Promise<void> {
  const list = $('sessList'); list.textContent = 'Łączę…';
  try {
    const r = await fetch(httpBase() + '/api/sessions'); const rows = await r.json() as SessionRow[];
    list.textContent = rows.length ? '' : 'Brak gier na serwerze.';
    for (const row of rows) {
      const d = document.createElement('div'); d.className = 's';
      const t = document.createElement('span'); t.textContent = `${row.cityName} · ${row.players}/${row.max} graczy`;
      const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'Dołącz'; b.onclick = () => join(row.id);
      d.append(t, b); list.append(d);
    }
  } catch { list.textContent = 'Serwer nie odpowiada. Uruchom go poleceniem: npm run server'; }
}
async function join(id: string): Promise<void> {
  if (!nickIn.value.trim()) { nickIn.focus(); $('status').textContent = 'Podaj nick.'; return; }
  store.set('moje-miasto.nick', nickIn.value); $('status').textContent = '';
  try { closeMenu(); await game.joinOnline(httpBase(), id, nickIn.value.trim()); } catch (e) { openMenu(); $('status').textContent = 'Błąd: ' + (e as Error).message; }
}
async function create(city: CityKey): Promise<void> {
  try {
    const r = await fetch(httpBase() + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city }) });
    if (!r.ok) throw new Error(await r.text()); const row = await r.json() as SessionRow; await join(row.id);
  } catch (e) { $('status').textContent = 'Błąd: ' + (e as Error).message; }
}
$('refreshBtn').onclick = refreshSessions;
// zegar gry (gra jednoosobowa)
const timeSel = $<HTMLSelectElement>('timeSel'), speedSel = $<HTMLSelectElement>('speedSel');
const applyTime = () => {
  if (game.online) { $('status').textContent = 'W grze sieciowej czas ustala serwer.'; return; }
  game.session?.setTime(timeSel.value === 'now' ? null : +timeSel.value, +speedSel.value);
};
timeSel.onchange = applyTime; speedSel.onchange = applyTime;
$('newW').onclick = () => create('warszawa'); $('newL').onclick = () => create('londyn');

// wydajność: wnętrza budynków (zapamiętane w przeglądarce)
const intChk = $<HTMLInputElement>('intChk');
try { intChk.checked = localStorage.getItem('mm.wnetrza') !== '0'; } catch { /* brak dostępu do pamięci */ }
game.interiorsOn = intChk.checked;
intChk.onchange = () => {
  try { localStorage.setItem('mm.wnetrza', intChk.checked ? '1' : '0'); } catch { /* brak dostępu */ }
  if (!game.setInteriorsOn(intChk.checked)) $('status').textContent = 'W grze sieciowej o wnętrzach decyduje serwer.';
};

game.loadCity('warszawa' as CityKey, null); closeMenu();

// uchwyt dla testów i konsoli
(window as unknown as { __game: Game }).__game = game;
