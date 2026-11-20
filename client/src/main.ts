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
  const w = g.world!, v = g.view!, st = v.streamer.stats;
  const b = v.streamer.hasTiles ? ` · budynki: ${v.buildingCount}` + (g.fromFile ? '' : ` · kafelki: ${st.visible}/${st.indexed}`) : ' · bez budynków';
  $('info').textContent = `${w.stations.length} stacji · ${w.metro.tunnels.length} tuneli` + b + (w.osmStations ? ` · stacje z OSM: ${w.osmStations}` : '');
}

const ui: GameUI = {
  setBusy(on) { $('busy').style.display = on ? 'grid' : 'none'; },
  setStatus(t) { $('status').textContent = t; },
  onMenu: openMenu,
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
  slowFrame(g) { const e = g.controlled(); if (e && g.world) { $('loc').textContent = locText(g.world, g.mode, e); info(g); } },
  frame(g) { renderMinimap(mini, g.world, { ...g.pose, yaw: g.mode === 'walk' ? g.viewYaw : g.pose.yaw, mode: g.mode, xray: g.xray }); },
};

const game = new Game(canvas, ui);
game.input.attachTouch($('joy'), $('knob'), $('upB'), $('dnB'));

$('xrayBtn').onclick = () => game.toggleXray();
$('walkBtn').onclick = () => game.action('modeWalk');
$('carBtn').onclick = () => game.action('modeCar');
$('heliBtn').onclick = () => game.action('modeHeli');
$('camBtn').onclick = () => game.action('camera');
$('menuBtn').onclick = openMenu;
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
$('saveBtn').onclick = () => {
  const s = game.save(); if (!s) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); $('status').textContent = 'Zapisano stan gry.'; }
  catch { $('status').textContent = 'Nie udało się zapisać (pamięć przeglądarki niedostępna).'; }
};
$('loadBtn').onclick = () => {
  let s: SaveState | null = null;
  try { const t = localStorage.getItem(SAVE_KEY); s = t ? JSON.parse(t) : null; } catch { s = null; }
  if (!s) { $('status').textContent = 'Brak zapisanego stanu.'; return; }
  try { game.load(s); $('status').textContent = ''; closeMenu(); } catch (err) { $('status').textContent = 'Błąd: ' + (err as Error).message; }
};

game.loadCity('warszawa' as CityKey, null); closeMenu();

// uchwyt dla testów i konsoli
(window as unknown as { __game: Game }).__game = game;
