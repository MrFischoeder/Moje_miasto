// Wejście klienta: łączy grę z HUD, menu, minimapą i sterowaniem dotykowym.
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './style.css';
import { CITIES, cityAt, type CityKey } from '@miasto/shared/data/cities';
import type { SaveState } from '@miasto/shared/sim/types';
import { Game, type GameUI } from './game/game';
import { Phone } from './phone/phone';
import { setVehicleQuality, VEHICLE_Q } from './player/vehicles';
import { TRANSIT_Q } from './world/transitView';
import { VEH } from '@miasto/shared/sim/vehicles';
import { cellName, fmtLatLon, gridOf, unprojPoint } from '@miasto/shared/data/grid';
import { parseOsmText } from './osm/parse';
import { locText } from './ui/hud';
import { renderMinimap } from './ui/minimap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let miniOn = true; // minimapa włączona (menu: Wydajność)
const canvas = $<HTMLCanvasElement>('c'), mini = $<HTMLCanvasElement>('mini'), menu = $('menu'), stSel = $<HTMLSelectElement>('stSel');
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
const SAVE_KEY = 'moje-miasto.save';

const nearestIndex = (g: Game) => { const w = g.world!; return w.stations.length ? w.nearestStation(g.pose.x, g.pose.z).i : -1; };
const openMenu = () => { menu.classList.remove('hide'); if (game.world) stSel.value = String(nearestIndex(game)); game.input.releasePointer(); };
const closeMenu = () => menu.classList.add('hide');
const menuOpen = () => !menu.classList.contains('hide');
$('menuClose').onclick = closeMenu;
menu.addEventListener('mousedown', e => { if (e.target === menu && game.world) closeMenu(); }); // klik w tło obok okna
addEventListener('keydown', e => {
  if (!menuOpen() || !game.world) return;
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (e.key === 'Escape' || (e.code === 'KeyM' && !typing)) { e.preventDefault(); e.stopPropagation(); closeMenu(); }
}, true);

function info(g: Game): void {
  const w = g.world!, v = g.view!, st = v.streamer.stats, s = g.session;
  const b = v.streamer.hasTiles ? ` · budynki: ${v.buildingCount}` + (g.fromFile ? '' : ` · kafelki: ${st.visible}/${st.indexed}`) : ' · bez budynków';
  const on = g.online && s ? ` · sieć: ${s.players.size} graczy` : '';
  const tr = g.transit ? ` · komunikacja: ${g.transitDots().length} w pobliżu` : '';
  $('info').textContent = (w.stations.length ? `${w.stations.length} stacji · ${w.metro.tunnels.length} tuneli` : 'bez metra') + b + (w.osmStations ? ` · stacje z OSM: ${w.osmStations}` : '') + tr + on;
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
  onMenu: () => { if (menuOpen()) closeMenu(); else openMenu(); },
  onChat(l) { addChat(l.from, l.color, l.text, l.sys); },
  onPm(m) { phone?.onPm(m); },
  onInteriors(on) { const c = $<HTMLInputElement>('intChk'); if (c.checked !== on) { c.checked = on; logEvent(`serwer: wnętrza budynków ${on ? 'włączone' : 'wyłączone'}`); } },
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
    $('cityWr').className = k === 'wroclaw' ? '' : 'ghost'; $('cityW').className = k === 'warszawa' ? '' : 'ghost'; $('cityL').className = k === 'londyn' ? '' : 'ghost';
    stSel.innerHTML = w.stations.map(s => [s.name, s.i] as [string, number]).sort((a, b) => a[0].localeCompare(b[0], 'pl'))
      .map(([n, i]) => `<option value="${i}">${n} (${[...w.stations[i].lines.keys()].map(l => city.lines[l].n).join(', ')})</option>`).join('');
    stSel.value = String(nearestIndex(g));
  },
  slowFrame(g) {
    const e = g.controlled(); if (!e || !g.world) return;
    const ride = g.ridePose(), clock = g.clockText();
    const I = g.world.interiors, box = g.mode === 'walk' && !ride ? I.container(e.x, e.z, e.y) : null, dr = g.mode === 'walk' && !ride ? I.nearDoor(e.x, e.z, e.y) : null;
    // akcja w pobliżu: drzwi (otwórz / zamknij / na klucz → wyważ), pojemnik, auto do wejścia, wysiadanie z komunikacji
    const useDoor = dr && (dr.dist <= 1 || !box), locked = !!useDoor && (dr!.code & 2) !== 0 && (dr!.code & 4) === 0;
    let act = '', kick = false;
    if (useDoor) { act = locked ? 'Zamknięte' : dr!.open ? 'Zamknij' : (dr!.code & 4) ? 'Otwórz (wyważone)' : 'Otwórz'; kick = locked; }
    else if (box) act = 'Przeszukaj';
    else if (ride || g.session?.me.taxi?.st === 'riding') act = 'Wysiądź';
    else if (g.mode === 'walk' && g.session) for (const q of g.session.entities()) if (q.kind !== 'walker' && Math.hypot(q.x - e.x, q.z - e.z) < 3.5 && Math.abs(q.y - e.y) < 2) { act = g.session.me.taxi?.id === q.id ? 'Wsiądź do taksówki' : q.npc && !q.parked ? 'Przejmij auto' : 'Wsiądź'; break; }
    // giełda: sprzedający w pobliżu (pieszo) – kupno przyciskiem
    let sale: { id: string; price: number; title: string } | null = null;
    if (!act && g.mode === 'walk' && g.session) for (const q of g.marketListings()) if (!g.session.me.sold.includes(q.id) && Math.hypot(q.x - e.x, q.z - e.z) < 60) {
      for (const o of g.session.entities()) if (o.kind === 'walker' && o.npc && Math.hypot(o.x - e.x, o.z - e.z) < 6) { sale = { id: q.id, price: q.price, title: q.title }; break; }
      if (sale) break;
    }
    if (sale) act = `Kup auto (${sale.price} ${g.session!.me.cur})`;
    // sklep / lokal przy witrynie (pieszo): ekspedient i towary w telefonie
    let shop: { p: import('@miasto/shared/tiles/types').TilePoi; name: string } | null = null;
    if (!act && g.mode === 'walk' && !ride && g.view) { let bd = 7; for (const f of g.view.signs.fronts) { const d = Math.hypot(f.c[0] - e.x, f.c[1] - e.z); if (d < bd) { bd = d; shop = { p: f.p, name: f.text }; } } }
    if (shop) act = `🛒 ${shop.name}`;
    const ab = $('actBtn'), kb = $('kickBtn'); (ab as HTMLElement & { sale?: string | null }).sale = sale?.id ?? null; (ab as HTMLElement & { shop?: typeof shop }).shop = shop;
    ab.hidden = !act; ab.innerHTML = act + '<span class="k">E</span>'; ab.className = locked ? 'ghost' : '';
    kb.hidden = !kick; kb.innerHTML = 'Wyważ<span class="k">B</span>';
    const cab = g.session?.me.cab, cabHint = cab?.target ? ` · ${cab.st === 'pickup' ? 'klient' : 'cel kursu'}: ${Math.round(Math.hypot(cab.target[0] - e.x, cab.target[1] - e.z))} m` : cab ? ' · czekasz na zlecenie' : '';
    const hint = cabHint + (useDoor ? ` · E: ${locked ? 'zamknięte na klucz · B: wyważ' : (dr!.open ? 'zamknij' : 'otwórz') + ' drzwi'}` : box ? ` · E: przeszukaj (${box.item.n})` : '');
    $('loc').textContent = (clock ? clock + ' · ' : '') + (ride ? ride.desc : locText(g.world, g.mode, e)) + hint; info(g);
    // współrzędne do testów: szerokość/długość geograficzna, kratka mapy, układ gry
    const city = g.world.city; $('coords').textContent = `📍 ${fmtLatLon(unprojPoint(city.o, e.x, e.z))} · kratka ${cellName(gridOf(city), e.x, e.z)} · x ${Math.round(e.x)} z ${Math.round(e.z)}`;
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
    const cabT = g.session?.me.cab?.target; if (cabT) others.push({ x: cabT[0], z: cabT[1], color: '#ffcc00' }); // praca kierowcy: klient / cel kursu
    if (miniOn) renderMinimap(mini, w, { ...P, yaw: g.mode === 'walk' ? g.viewYaw : P.yaw, mode: g.mode, xray: g.xray, under: P.y < gr - 1, height: P.y - gr, others, transit: g.transitDots() });
  },
};

const game = new Game(canvas, ui);
const origAction = game.action.bind(game);
// wybór własnego pojazdu (zapamiętany w przeglądarce)
const vehSel = $<HTMLSelectElement>('vehSel');
vehSel.innerHTML = VEH.map((v, i) => `<option value="${i}">${v.name}</option>`).join('');
try { game.vehicle = Math.min(VEH.length - 1, Math.max(0, +(localStorage.getItem('mm.pojazd') ?? 0) || 0)); } catch { /* brak pamięci */ } vehSel.value = String(game.vehicle);
vehSel.onchange = () => { game.vehicle = +vehSel.value; try { localStorage.setItem('mm.pojazd', vehSel.value); } catch { /* */ } };

// telefon (klawisz C, przycisk Telefon)
const phone: Phone = new Phone(game);
const phoneBtn = $('phoneBtn');
phone.onUnread = n => { phoneBtn.innerHTML = 'Telefon' + (n ? `<span class="n">${n}</span>` : ''); };
phoneBtn.onclick = () => phone.toggle();
game.action = a => { const sh = ($('actBtn') as HTMLElement & { shop?: { p: import('@miasto/shared/tiles/types').TilePoi; name: string } | null }).shop; if (a === 'chat') openChat(); else if (a === 'phone') phone.toggle(); else if (a === 'interact' && sh && !$('actBtn').hidden) phone.shopApp(sh.p, sh.name); else origAction(a); }; // E przy sklepie: ekspedient
game.input.attachTouch($('joy'), $('knob'), $('upB'), $('dnB'));

$('xrayBtn').onclick = () => game.toggleXray();
$('actBtn').onclick = () => { const el = $('actBtn') as HTMLElement & { sale?: string | null; shop?: { p: import('@miasto/shared/tiles/types').TilePoi; name: string } | null }; if (el.sale) game.session?.sendCommand({ type: 'marketBuy', id: el.sale }); else if (el.shop) phone.shopApp(el.shop.p, el.shop.name); else game.action('interact'); setTimeout(() => ui.slowFrame(game), 150); };
$('kickBtn').onclick = () => { game.action('kick'); setTimeout(() => ui.slowFrame(game), 150); };
$('walkBtn').onclick = () => game.action('modeWalk');
$('carBtn').onclick = () => game.action('modeCar');
$('heliBtn').onclick = () => game.action('modeHeli');
$('camBtn').onclick = () => game.action('camera');
$('menuBtn').onclick = openMenu;
// przycisk czatu usunięty: gracze piszą przez komunikator w telefonie
$('cityWr').onclick = () => { game.loadCity('wroclaw', null); closeMenu(); };
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
$('newWr').onclick = () => create('wroclaw'); $('newW').onclick = () => create('warszawa'); $('newL').onclick = () => create('londyn');

// wydajność: wnętrza budynków (zapamiętane w przeglądarce)
const intChk = $<HTMLInputElement>('intChk');
// przyciski na górze menu (test wydajności): stan widoczny na przycisku, zsynchronizowany z polami w sekcji Wydajność
$('ver').textContent = __VERSION__;
const intBtn = $<HTMLButtonElement>('intBtn'), perfBtn = $<HTMLButtonElement>('perfBtn');
const showTestBtns = () => {
  intBtn.textContent = `Wnętrza budynków: ${intChk.checked ? 'WŁĄCZONE' : 'WYŁĄCZONE'}`; intBtn.className = intChk.checked ? '' : 'ghost';
  const pc = document.getElementById('perfChk') as HTMLInputElement | null; perfBtn.textContent = `Licznik wydajności: ${pc?.checked ? 'WŁ.' : 'WYŁ.'}`;
};
intBtn.onclick = () => { intChk.checked = !intChk.checked; intChk.dispatchEvent(new Event('change')); };
perfBtn.onclick = () => { const pc = $<HTMLInputElement>('perfChk'); pc.checked = !pc.checked; pc.dispatchEvent(new Event('change')); };
$('perfSave2').onclick = () => $('perfSave').click();
setInterval(showTestBtns, 500);
try { intChk.checked = localStorage.getItem('mm.wnetrza') !== '0'; } catch { /* brak dostępu do pamięci */ }
game.interiorsOn = intChk.checked;
intChk.onchange = () => {
  try { localStorage.setItem('mm.wnetrza', intChk.checked ? '1' : '0'); } catch { /* brak dostępu */ }
  logEvent(`zmiana: wnętrza budynków ${intChk.checked ? 'włączone' : 'wyłączone'}`);
  game.setInteriorsOn(intChk.checked);
  if (game.online) $('status').textContent = 'Zmiana wnętrz wysłana do serwera (działa na serwerze testowym).';
};

// dziennik testu (plik .txt, klawisz L): wiersze pomiarów co sekundę i zdarzenia – każda zmiana ustawień wydajności
const LOG_MAX = 3 * 3600;
const perfLog: string[] = (() => { try { return (localStorage.getItem('mm.perflog') ?? '').split('\n').filter(Boolean); } catch { return []; } })();
function logEvent(text: string): void {
  perfLog.push(`${new Date().toLocaleTimeString('pl-PL')}\t# ${text}`);
  if (perfLog.length > LOG_MAX) perfLog.splice(0, perfLog.length - LOG_MAX);
  try { localStorage.setItem('mm.perflog', perfLog.join('\n')); } catch { /* brak miejsca */ }
}

// wydajność: modele pojazdów proste / szczegółowe (zapamiętane; auta przebudowują się od razu)
const komSel = $<HTMLSelectElement>('komSel');
try { TRANSIT_Q.light = localStorage.getItem('mm.komunikacja') === '1'; } catch { /* brak pamięci przeglądarki */ }
komSel.value = TRANSIT_Q.light ? '1' : '0';
komSel.onchange = () => { TRANSIT_Q.light = komSel.value === '1'; try { localStorage.setItem('mm.komunikacja', komSel.value); } catch { /* */ } logEvent(`zmiana: komunikacja miejska ${TRANSIT_Q.light ? 'lżejsza (zasięg 500 m, szczegóły 70 m)' : 'pełna (zasięg 800 m, szczegóły 150 m)'}`); };
const autaSel = $<HTMLSelectElement>('autaSel');
autaSel.value = VEHICLE_Q.hq ? '1' : '0';
autaSel.onchange = () => { setVehicleQuality(autaSel.value === '1'); logEvent(`zmiana: pojazdy ${autaSel.value === '1' ? 'szczegółowe' : 'proste'}`); };

// wydajność: liczba aut i pieszych NPC (zapamiętana)
const carRng = $<HTMLInputElement>('carRng'), pedRng = $<HTMLInputElement>('pedRng');
const load = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v == null ? d : +v; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* brak dostępu */ } };
carRng.value = String(load('mm.auta', 70)); pedRng.value = String(load('mm.piesi', 50));
const showRng = () => { $('carVal').textContent = carRng.value; $('pedVal').textContent = pedRng.value; };
showRng(); game.carMax = +carRng.value; game.pedMax = +pedRng.value;
const applyTraffic = () => {
  showRng(); save('mm.auta', carRng.value); save('mm.piesi', pedRng.value);
  game.setTraffic(+carRng.value, +pedRng.value);
  logEvent(`zmiana: auta NPC ${carRng.value}, piesi NPC ${pedRng.value} na gracza${game.online ? ' (wysłane do serwera sieciowego; przyjmuje tylko serwer testowy)' : ' (serwer lokalny)'}`);
  if (game.online) $('status').textContent = 'Limity ruchu wysłane do serwera (działa na serwerze testowym).';
};
carRng.oninput = showRng; pedRng.oninput = showRng; carRng.onchange = applyTraffic; pedRng.onchange = applyTraffic;

// licznik wydajności (P)
// minimapa: włączana / wyłączana w menu (wyłączona oszczędza czas klatki – rysowanie mapy na płótnie)
const miniChk = $<HTMLInputElement>('miniChk');
const setMini = (on: boolean, log = true) => { miniOn = on; miniChk.checked = on; mini.style.display = on ? '' : 'none'; save('mm.minimapa', on ? '1' : '0'); if (log) logEvent(`minimapa ${on ? 'włączona' : 'wyłączona'}`); };
setMini(load('mm.minimapa', 1) === 1, false);
miniChk.onchange = () => setMini(miniChk.checked);
const perfChk = $<HTMLInputElement>('perfChk'), perfEl = $('perf');
perfChk.checked = load('mm.licznik', 0) === 1; perfEl.hidden = !perfChk.checked;
const setPerf = (on: boolean) => { perfChk.checked = on; perfEl.hidden = !on; save('mm.licznik', on ? '1' : '0'); game.perf.take(); logEvent(`licznik wydajności ${on ? 'włączony' : 'wyłączony'}`); };
perfChk.onchange = () => setPerf(perfChk.checked);
addEventListener('keydown', e => { if (e.code === 'KeyP' && !(document.activeElement instanceof HTMLInputElement)) setPerf(!perfChk.checked); });
// dziennik wydajności: jedna linia na sekundę, póki licznik jest włączony
const perfLogN = $('perfLogN');
function gpuName(): string {
  try { const gl = game.ctx.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)); } catch { return '?'; }
}
function savePerfLog(): void {
  const head = [`Moje miasto – dziennik wydajności, zapisano ${new Date().toLocaleString('pl-PL')}`,
    `Przeglądarka: ${navigator.userAgent}`, `Karta graficzna: ${gpuName()}`, `Ekran: ${innerWidth}x${innerHeight}, skala ${devicePixelRatio}`,
    `Ustawienia: auta ${carRng.value}, piesi ${pedRng.value}, wnętrza ${$<HTMLInputElement>('intChk').checked ? 'tak' : 'nie'}, pojazdy ${VEHICLE_Q.hq ? 'szczegółowe' : 'proste'}, gra ${game.online ? 'sieciowa' : 'lokalna'}`,
    'Wiersze zaczynające się od # to zdarzenia (zmiany ustawień); pozostałe to pomiary co sekundę.', '',
    ['czas', 'fps', 'klatka_ms', 'najgorsza_ms', 'cpu_ms', 'gpu_ms', 'rysowanie_ms', 'interfejs_ms', 'komunikacja_ms', 'auta_ms', 'kafle_ms',
      'wywolania', 'trojkaty', 'auta_npc', 'piesi_npc', 'komunikacja', 'kafle', 'symulacja_ms', 'symulacja_maks_ms', 'tryb', 'x', 'z'].join('\t')];
  const a = document.createElement('a'), d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(new Blob([[...head, ...perfLog].join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }));
  a.download = `moje-miasto-wydajnosc-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.txt`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  perfLog.length = 0; try { localStorage.removeItem('mm.perflog'); } catch { /* */ }
  perfLogN.textContent = 'pobrano plik, dziennik wyczyszczony';
}
$('perfSave').onclick = savePerfLog;
addEventListener('keydown', e => { if (e.code === 'KeyL' && !(document.activeElement instanceof HTMLInputElement)) savePerfLog(); });
const ms = (v: number) => v.toFixed(1).padStart(5) + ' ms', k = (v: number) => v >= 1000 ? Math.round(v / 1000) + ' tys.' : String(v);
setInterval(() => {
  if (perfEl.hidden) return;
  const r = game.perf.take(), s = game.session, d = game.drawInfo;
  let cars = 0, peds = 0; if (s) for (const e of s.entities()) if (e.npc) { if (e.kind === 'car') cars++; else if (e.kind === 'walker') peds++; }
  const lines = [
    `FPS ${r.fps.toFixed(0).padStart(3)}   klatka śr. ${r.frameAvg.toFixed(1)} ms, najgorsza ${r.frameMax.toFixed(0)} ms`,
    `CPU klatki ${r.cpuAvg.toFixed(1)} ms; reszta (GPU, przeglądarka) ok. ${Math.max(0, r.frameAvg - r.cpuAvg).toFixed(1)} ms`,
    ...r.parts.filter(([, v]) => v >= .05).map(([n, v]) => `  ${n.padEnd(27)}${ms(v)}`),
    `Rysowanie: ${d.calls} wywołań, ${k(d.tris)} trójkątów, ${k(d.lines)} linii`,
    `Widoczne: ${cars} aut NPC, ${peds} pieszych NPC, ${game.transitVisible} pojazdów komunikacji`,
    `Kafle: ${game.view ? [...game.view.streamer.loadedTiles()].length : 0}, budynki z wnętrzami: ${game.world?.interiors.live.size ?? 0}`,
  ];
  const st = s?.serverStats;
  if (st) lines.push(`Symulacja (wątek gry): krok ${st.tickMs.toFixed(1)} ms, maks. ${st.tickMsMax.toFixed(0)} ms (budżet 33 ms)`, `  aut ${st.cars}, pieszych ${st.peds}, radiowozów ${st.police}, wnętrz ${st.interiors}`);
  else if (game.online) lines.push('Symulacja: na serwerze sieciowym');
  perfEl.textContent = lines.join('\n');
  // zapis co sekundę (dziennik w pamięci i w przeglądarce, do pobrania jako .txt)
  const cam = game.ctx.camera.position, part = (n: string) => (r.parts.find(([p]) => p.startsWith(n))?.[1] ?? 0).toFixed(1);
  perfLog.push([new Date().toLocaleTimeString('pl-PL'), r.fps.toFixed(0), r.frameAvg.toFixed(1), r.frameMax.toFixed(0), r.cpuAvg.toFixed(1),
    Math.max(0, r.frameAvg - r.cpuAvg).toFixed(1), part('rysowanie'), part('interfejs'), part('komunikacja'), part('auta'), part('kafle'),
    d.calls, d.tris, cars, peds, game.transitVisible, game.view ? [...game.view.streamer.loadedTiles()].length : 0,
    st ? st.tickMs.toFixed(1) : '-', st ? st.tickMsMax.toFixed(0) : '-', game.mode, cam.x.toFixed(0), cam.z.toFixed(0)].join('\t'));
  if (perfLog.length > LOG_MAX) perfLog.splice(0, perfLog.length - LOG_MAX);
  if (perfLog.length % 10 === 0) try { localStorage.setItem('mm.perflog', perfLog.join('\n')); } catch { /* brak miejsca */ }
  perfLogN.textContent = `zapisano ${perfLog.length} s`;
}, 1000);

// Wrocław: główna mapa; inne miasto na start: ?miasto=warszawa
const startCity = new URLSearchParams(location.search).get('miasto') ?? '';
game.loadCity((startCity in CITIES ? startCity : 'wroclaw') as CityKey, null); closeMenu();

// uchwyt dla testów i konsoli
(window as unknown as { __game: Game }).__game = game;
// narzędzia deweloperskie (podgląd modeli w testach)
import('./player/vehicles').then(m => import('three').then(T => { (window as unknown as { __dev: unknown }).__dev = { ...m, THREE: T }; }));
