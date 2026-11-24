// Telefon komórkowy gracza (nakładka w stylu współczesnego smartfona): Telefon (połączenia na razie zablokowane),
// Wiadomości (gracze, wszyscy, NPC ze zleceniami; tekst, lokalizacja, zdjęcia), Mapa (całe miasto, znaczniki,
// teleport w wersji deweloperskiej), Aparat (zdjęcia ekranu gry), Zdjęcia (galeria, wysyłanie, zapis na dysk).
import './phone.css';
import { NPCS } from '@miasto/shared/game/jobs';
import type { ServerMsg } from '@miasto/shared/net/protocol';
import type { Game } from '../game/game';
import { PhoneMap, type Marker } from './mapView';
import { cellName, fmtLatLon, parsePlace, unprojPoint } from '@miasto/shared/data/grid';

type Pm = Extract<ServerMsg, { t: 'pm' }>;
interface Msg { me: boolean; text?: string; loc?: [number, number]; img?: string; job?: Pm['job']; at: number; /** godzina w grze */ hm: string }
interface Conv { id: number; name: string; color: string; msgs: Msg[]; unread: number }

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const initials = (n: string) => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** zmniejszenie zdjęcia (JPEG) do szerokości w i jakości q */
function shrink(url: string, w: number, q: number): Promise<string> {
  return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, w / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; im.src = url; });
}
/** zdjęcie do wysłania: do ok. 58 kB (limit wiadomości serwera) */
async function forSending(url: string): Promise<string> {
  for (const [w, q] of [[640, .62], [520, .55], [420, .5], [320, .45]] as [number, number][]) { const s = await shrink(url, w, q); if (s.length < 58_000) return s; }
  return shrink(url, 260, .4);
}

export class Phone {
  readonly el = h('div'); private screen = h('div', 'screen'); private view = h('div', 'view');
  private clock = h('span'); private open = false;
  private convs = new Map<number, Conv>();
  private photos: string[] = [];
  private pins: Marker[] = [];
  private job: { target?: [number, number]; npc: string } | null = null;
  private map: PhoneMap | null = null;
  private current: (() => void) | null = null; // odświeżenie otwartego ekranu
  private vf = h('div'); private toastEl = h('div');
  private toastT = 0;
  onUnread: (n: number) => void = () => {};

  constructor(private game: Game) {
    this.el.id = 'phone';
    const bar = h('div', 'bar'); bar.append(this.clock, h('div', 'ico', '<span>▂▄▆█</span><span>5G</span><div class="batt"><i></i></div>'));
    const homebar = h('div', 'homebar', '<i></i>'); homebar.onclick = () => this.home();
    this.screen.append(h('div', 'island'), bar, this.view, homebar); this.el.append(this.screen);
    this.vf.id = 'viewfinder'; this.toastEl.id = 'phoneToast';
    document.body.append(this.el, this.vf, this.toastEl);
    try { this.photos = JSON.parse(localStorage.getItem('mm.zdjecia') || '[]'); } catch { this.photos = []; }
    for (const n of NPCS) this.conv(n.id, n.name, n.color);
    this.el.addEventListener('keydown', e => { if (e.key === 'Escape') this.toggle(false); e.stopPropagation(); });
    setInterval(() => { if (this.open) { this.tick(); } }, 1000);
    this.home();
  }

  get isOpen(): boolean { return this.open; }
  toggle(on = !this.open): void {
    this.open = on; this.el.classList.toggle('open', on);
    if (on) { this.game.input.releasePointer(); this.tick(); this.current?.(); } else this.vf.classList.remove('open');
  }

  // ---------- dane ----------
  private conv(id: number, name: string, color: string): Conv {
    let c = this.convs.get(id); if (!c) this.convs.set(id, c = { id, name, color, msgs: [], unread: 0 }); else { c.name = name; c.color = color; }
    return c;
  }
  private unread(): number { let n = 0; for (const c of this.convs.values()) n += c.unread; return n; }
  private online(): boolean { return !!this.game.online; }
  private place(x: number, z: number): string { const w = this.game.world; return w ? w.placeName(x, z) : ''; }
  private myPos(): { x: number; z: number; yaw: number } | null { const e = this.game.controlled(); return e ? { x: e.x, z: e.z, yaw: e.yaw } : null; }

  /** wiadomość z serwera (gracz, NPC, zlecenie) */
  onPm(m: Pm): void {
    const c = this.conv(m.from === this.game.session?.playerId ? m.to : m.to === 0 ? 0 : m.from, m.to === 0 ? 'Wszyscy' : m.name, m.to === 0 ? '#8e8e93' : m.color);
    c.msgs.push({ me: false, text: m.text, loc: m.loc, img: m.img, job: m.job, at: Date.now(), hm: this.hm() });
    if (m.job) {
      if (m.job.state === 'active' && m.job.target) this.job = { target: m.job.target, npc: m.name };
      if (m.job.state === 'done' || m.job.state === 'cancel') this.job = null;
    }
    if (m.loc) this.pins.unshift({ x: m.loc[0], z: m.loc[1], color: m.job ? '#ff453a' : '#bf5af2', label: m.name, kind: m.job ? 'job' : 'pin' }); this.pins = this.pins.slice(0, 12);
    const viewing = this.open && this.threadId === c.id;
    if (!viewing) { c.unread++; this.toast(m.to === 0 ? `${m.name} (do wszystkich)` : m.name, m.img ? '📷 Zdjęcie' : m.text ?? (m.loc ? '📍 Lokalizacja' : '')); }
    this.onUnread(this.unread()); this.current?.();
  }

  private toast(title: string, text: string): void {
    this.toastEl.innerHTML = `<div class="ic">💬</div><div><b>${esc(title)}</b><span>${esc(text.slice(0, 90))}</span></div>`;
    this.toastEl.classList.add('show'); this.toastEl.onclick = () => { this.toastEl.classList.remove('show'); this.toggle(true); this.messages(); };
    clearTimeout(this.toastT); this.toastT = window.setTimeout(() => this.toastEl.classList.remove('show'), 5000);
  }

  private send(id: number, body: { text?: string; loc?: [number, number]; img?: string }): void {
    const c = this.convs.get(id); if (!c) return;
    c.msgs.push({ me: true, ...body, at: Date.now(), hm: this.hm() });
    this.game.session?.pm(id, body); this.current?.();
  }

  /** godzina w grze HH:MM */
  private hm(): string { const t = this.game.clockText().match(/\d{1,2}:\d{2}/); return t ? t[0] : ''; }
  private tick(): void { this.clock.textContent = this.hm(); }

  // ---------- ekrany ----------
  private page(title: string, back: () => void, extra = ''): { page: HTMLDivElement; head: HTMLDivElement } {
    this.view.innerHTML = ''; const page = h('div', 'page'), head = h('div', 'head', `<span class="back">‹</span>${extra}<span>${esc(title)}</span>`);
    (head.querySelector('.back') as HTMLElement).onclick = back; page.append(head); this.view.append(page); return { page, head };
  }
  private threadId: number | null = null;

  home(): void {
    this.threadId = null; this.current = () => this.home(); this.view.innerHTML = ''; this.tick();
    const home = h('div', 'home'), s = this.game.session, money = s ? `${s.me.money.toFixed(0)} ${s.me.cur}` : '';
    const w = h('div', 'widget', `<b>${esc(this.hm())}</b><span>${esc(this.game.cityName)} · ${money}${this.job ? ' · zlecenie: ' + esc(this.job.npc) : ''}</span>`);
    home.append(w);
    const apps: [string, string, string, () => void, number?][] = [
      ['📞', 'Telefon', '#30d158', () => this.phone()],
      ['💬', 'Wiadomości', '#30d158', () => this.messages(), this.unread()],
      ['🗺️', 'Mapa', '#0a84ff', () => this.mapApp()],
      ['📷', 'Aparat', '#636366', () => this.camera()],
      ['🖼️', 'Zdjęcia', '#ff9f0a', () => this.gallery()],
      ['💼', 'Zlecenia', '#ff453a', () => this.jobs()],
    ];
    for (const [ic, name, bg, fn, badge] of apps) {
      const a = h('div', 'app', `<div class="icon" style="background:${bg}">${ic}</div><span>${name}</span>${badge ? `<div class="badge">${badge}</div>` : ''}`); a.onclick = fn; home.append(a);
    }
    this.view.append(home);
    const dock = h('div', 'dock');
    for (const [ic, bg, fn] of [['📞', '#30d158', () => this.phone()], ['💬', '#30d158', () => this.messages()], ['🗺️', '#0a84ff', () => this.mapApp()], ['📷', '#636366', () => this.camera()]] as [string, string, () => void][]) {
      const a = h('div', 'app', `<div class="icon" style="background:${bg}">${ic}</div>`); a.onclick = fn; dock.append(a);
    }
    this.view.append(dock);
  }

  /** Telefon: klawiatura, połączenia zablokowane w tej wersji */
  phone(): void {
    this.current = null; const { page } = this.page('Telefon', () => this.home());
    const d = h('div', 'dial'), num = h('div', 'num'), keys = h('div', 'keys');
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']) { const b = h('div', '', k); b.onclick = () => { if (num.textContent!.length < 12) num.textContent += k; }; keys.append(b); }
    const call = h('div', 'call', '📞'), info = h('div', 'locked', '🔒 Połączenia głosowe będą dostępne w kolejnej wersji gry.<br>Na razie pisz wiadomości.');
    call.onclick = () => { info.style.transform = 'scale(1.08)'; setTimeout(() => { info.style.transform = ''; }, 200); };
    d.append(num, keys, call, info); page.append(d);
  }

  /** lista rozmów */
  messages(): void {
    this.threadId = null;
    const render = () => {
      const { page } = this.page('Wiadomości', () => this.home());
      const list = h('div', 'list'), s = this.game.session;
      if (this.online() && s) { this.conv(0, 'Wszyscy', '#8e8e93'); for (const p of s.players.values()) if (p.id !== s.playerId) this.conv(p.id, p.name, p.color); }
      const convs = [...this.convs.values()].filter(c => c.id !== 0 || this.online())
        .sort((a, b) => (b.msgs[b.msgs.length - 1]?.at ?? 0) - (a.msgs[a.msgs.length - 1]?.at ?? 0));
      for (const c of convs) {
        const last = c.msgs[c.msgs.length - 1], prev = last ? (last.me ? 'Ty: ' : '') + (last.img ? '📷 Zdjęcie' : last.loc && !last.text ? '📍 Lokalizacja' : last.text ?? '') : c.id < 0 ? 'Kontakt (zlecenia)' : c.id === 0 ? 'Wiadomość do wszystkich graczy' : 'Gracz online';
        const r = h('div', 'row', `<div class="av" style="background:${c.color}">${c.id === 0 ? '👥' : esc(initials(c.name))}</div><div class="tx"><b>${esc(c.name)}</b><span>${esc(prev)}</span></div>${c.unread ? '<div class="dot"></div>' : ''}`);
        r.onclick = () => this.thread(c.id); list.append(r);
      }
      if (!this.online()) list.append(h('div', 'empty', 'Gra jednoosobowa: piszą do ciebie tylko kontakty ze zleceniami.<br>W grze sieciowej zobaczysz tu innych graczy.'));
      page.append(list);
    };
    this.current = render; render();
  }

  /** rozmowa */
  thread(id: number): void {
    const c = this.convs.get(id); if (!c) return;
    this.threadId = id; c.unread = 0; this.onUnread(this.unread());
    let draft = '';
    const render = () => {
      const { page } = this.page(c.name, () => this.messages(), `<div class="av" style="background:${c.color}">${c.id === 0 ? '👥' : esc(initials(c.name))}</div>`);
      const th = h('div', 'thread');
      for (const m of c.msgs) {
        const b = h('div', 'msg' + (m.me ? ' me' : ''));
        if (m.text) b.append(document.createTextNode(m.text));
        if (m.img) { const im = h('img'); im.src = m.img; im.onclick = () => this.viewPhoto(m.img!, () => this.thread(id)); b.append(im); }
        if (m.loc) { const l = h('div', 'loc', `📍 ${esc(this.place(m.loc[0], m.loc[1]) || 'Lokalizacja')} – pokaż na mapie`); l.onclick = () => this.mapApp(m.loc); b.append(l); }
        if (m.job?.state === 'offer' && !m.me) {
          const jb = h('div', 'job'), ok = h('button', 'ok', 'Przyjmij'), no = h('button', 'no', 'Odrzuć');
          ok.onclick = () => { this.game.session?.jobAnswer(m.job!.id, 'accept'); m.job = { ...m.job!, state: 'active' }; render(); };
          no.onclick = () => { this.game.session?.jobAnswer(m.job!.id, 'decline'); m.job = { ...m.job!, state: 'cancel' }; render(); };
          jb.append(ok, no); b.append(jb);
        }
        b.append(h('div', 'meta', m.hm));
        th.append(b);
      }
      if (!c.msgs.length) th.append(h('div', 'empty', c.id < 0 ? 'Ten kontakt odezwie się ze zleceniem.' : 'Napisz pierwszą wiadomość.'));
      const cp = h('div', 'compose'), loc = h('div', 'ib', '📍'), cam = h('div', 'ib', '🖼️'), inp = h('input'), snd = h('div', 'ib send', '↑');
      inp.placeholder = c.id < 0 ? 'Odpisz („tak” / „nie”)…' : 'Wiadomość'; inp.value = draft; inp.maxLength = 500;
      inp.oninput = () => { draft = inp.value; };
      const go = () => { const t = inp.value.trim(); if (!t) return; draft = ''; this.send(id, { text: t }); };
      snd.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
      loc.title = 'Wyślij swoją lokalizację'; loc.onclick = () => { const p = this.myPos(); if (p) this.send(id, { text: `Jestem tu: ${this.place(p.x, p.z)}`, loc: [p.x, p.z] }); };
      cam.title = 'Wyślij zdjęcie'; cam.onclick = () => this.gallery(async url => { this.thread(id); this.send(id, { img: await forSending(url) }); });
      if (c.id < 0) cam.style.display = 'none';
      cp.append(loc, cam, inp, snd); page.append(th, cp);
      th.scrollTop = th.scrollHeight; setTimeout(() => inp.focus(), 0);
    };
    this.current = render; render();
  }

  /** Zlecenia: aktywne zlecenie i cel */
  jobs(): void {
    const render = () => {
      const { page } = this.page('Zlecenia', () => this.home()), list = h('div', 'list');
      if (this.job?.target) {
        const p = this.myPos(), d = p ? Math.round(Math.hypot(this.job.target[0] - p.x, this.job.target[1] - p.z)) : 0;
        const r = h('div', 'row', `<div class="av" style="background:#ff453a">💼</div><div class="tx"><b>${esc(this.job.npc)}</b><span>Cel: ${esc(this.place(...this.job.target))} · ${d} m</span></div>`);
        r.onclick = () => this.mapApp(this.job!.target); list.append(r);
      } else list.append(h('div', 'empty', 'Brak aktywnego zlecenia.<br>Kontakty (Mietek, Pani Halina, Szef, Kurier Expres) piszą z ofertami w Wiadomościach.'));
      page.append(list);
    };
    this.current = render; render();
  }

  /** Mapa całego miasta; focus: punkt do pokazania */
  mapApp(focus?: [number, number]): void {
    const w = this.game.world; if (!w) return;
    if (!this.map || (this.map as unknown as { world: unknown }).world !== w) this.map = new PhoneMap(w);
    const m = this.map, { page } = this.page('Mapa', () => this.home());
    const pop = h('div', 'pop'), ui = h('div', 'mapui');
    const zin = h('div', '', '＋'), zout = h('div', '', '－'), me = h('div', '', '◎'), gr = h('div', '', '#');
    gr.title = 'Siatka kratek'; gr.style.opacity = m.showGrid ? '1' : '.5'; gr.onclick = () => { m.showGrid = !m.showGrid; gr.style.opacity = m.showGrid ? '1' : '.5'; m.draw(); };
    // wyszukiwanie: kratka (K12) albo współrzędne (51.1097, 17.0328)
    const find = h('div', 'compose'), q = h('input'), go = h('div', 'ib send', '→');
    q.placeholder = 'Idź do: kratka K12 albo 51.1097, 17.0328';
    const goTo = () => { const w2 = this.game.world; if (!w2) return; const pt = parsePlace(w2.city, m.grid, q.value); if (!pt) { q.style.borderColor = '#ff453a'; return; } q.style.borderColor = ''; m.center(pt[0], pt[1], Math.max(m.s, .25)); m.onTap(pt[0], pt[1]); };
    go.onclick = goTo; q.onkeydown = e => { if (e.key === 'Enter') goTo(); }; find.append(q, go);
    zin.onclick = () => m.zoom(1.6); zout.onclick = () => m.zoom(1 / 1.6);
    me.onclick = () => { const p = this.myPos(); if (p) m.center(p.x, p.z, Math.max(m.s, .6)); };
    ui.append(zin, zout, me, gr); page.append(find, m.canvas, ui, pop);
    const refresh = () => {
      const p = this.myPos(), s = this.game.session, mk: Marker[] = [];
      if (s) for (const pl of s.players.values()) if (pl.id !== s.playerId) { const e = s.entity(pl.vehicle ?? pl.walker); if (e) mk.push({ x: e.x, z: e.z, color: pl.color, label: pl.name, kind: 'player' }); }
      mk.push(...this.pins);
      if (this.job?.target) mk.push({ x: this.job.target[0], z: this.job.target[1], color: '#ff453a', label: 'Cel zlecenia', kind: 'job' });
      if (sel) mk.push({ x: sel[0], z: sel[1], color: '#0a84ff', kind: 'sel' });
      if (p) mk.push({ x: p.x, z: p.z, color: '#0a84ff', kind: 'me', yaw: p.yaw });
      m.markers = mk; m.draw();
    };
    let sel: [number, number] | null = null;
    m.onTap = (x, z) => {
      sel = [x, z]; refresh();
      const name = this.place(x, z);
      const ll = unprojPoint(w.city.o, x, z);
      pop.innerHTML = `<b>${esc(name && name !== '—' ? name : 'Wybrany punkt')}</b><div style="font-size:12px;opacity:.75">Kratka <b>${cellName(m.grid, x, z)}</b> · ${fmtLatLon(ll)}<br>x ${Math.round(x)}, z ${Math.round(z)}</div>`;
      const acts = h('div', 'acts'), tp = h('button', 'btn blue', '⚡ Teleportuj (wersja testowa)'), close = h('button', 'btn no', 'Zamknij'), cp = h('button', 'btn no', '⧉ Kopiuj współrzędne');
      cp.onclick = () => { navigator.clipboard?.writeText(`${fmtLatLon(ll)} (${cellName(m.grid, x, z)})`).catch(() => {}); cp.textContent = '✓ Skopiowano'; };
      tp.onclick = () => { this.game.session?.sendCommand({ type: 'teleport', x, z }); pop.classList.remove('show'); sel = null; setTimeout(() => { const p = this.myPos(); if (p) m.center(p.x, p.z); refresh(); }, 600); };
      close.onclick = () => { pop.classList.remove('show'); sel = null; refresh(); };
      acts.append(tp, cp, close); pop.append(acts); pop.classList.add('show');
    };
    const p = this.myPos();
    if (focus) m.center(focus[0], focus[1], Math.max(m.s, .5)); else if (p) m.center(p.x, p.z);
    this.current = refresh; refresh();
    requestAnimationFrame(() => m.draw());
  }

  /** Aparat: wizjer na całym ekranie gry, migawka zapisuje zdjęcie do galerii */
  camera(): void {
    this.current = null; this.el.classList.remove('open');
    this.vf.innerHTML = '<div class="frame"></div><div class="hint">Aparat: rozglądaj się myszą (przytrzymaj przycisk) · Spacja / przycisk = zdjęcie</div><div class="flash"></div>';
    const ctl = h('div', 'ctl'), back = h('div', 'vb', '‹ Telefon'), shot = h('div', 'shutter'), gal = h('div', 'vb', '🖼️ Zdjęcia');
    ctl.append(back, shot, gal); this.vf.append(ctl); this.vf.classList.add('open');
    const take = async () => {
      const flash = this.vf.querySelector('.flash') as HTMLElement; flash.style.opacity = '.85'; setTimeout(() => { flash.style.opacity = '0'; }, 120);
      const url = await shrink(await this.game.capture(), 1280, .82); this.addPhoto(url);
      gal.textContent = `🖼️ Zdjęcia (${this.photos.length})`;
    };
    const key = (e: KeyboardEvent) => { if (e.code === 'Space' && this.vf.classList.contains('open')) { e.preventDefault(); take(); } };
    const leave = (then: () => void) => { this.vf.classList.remove('open'); removeEventListener('keydown', key, true); this.el.classList.add('open'); this.open = true; then(); };
    shot.onclick = take; back.onclick = () => leave(() => this.home()); gal.onclick = () => leave(() => this.gallery());
    addEventListener('keydown', key, true);
  }

  private addPhoto(url: string): void {
    this.photos.unshift(url); this.photos = this.photos.slice(0, 24);
    // w pamięci przeglądarki ostatnie zdjęcia (mniejsze), jeśli jest miejsce
    shrink(url, 800, .7).then(() => { try { localStorage.setItem('mm.zdjecia', JSON.stringify(this.photos.slice(0, 8))); } catch { /* brak miejsca */ } });
  }

  /** Galeria; pick: wybór zdjęcia do wysłania */
  gallery(pick?: (url: string) => void): void {
    const render = () => {
      const { page } = this.page(pick ? 'Wybierz zdjęcie' : 'Zdjęcia', () => pick ? this.messages() : this.home()), grid = h('div', 'grid');
      this.photos.forEach(u => { const im = h('img'); im.src = u; im.onclick = () => pick ? pick(u) : this.viewPhoto(u, render); grid.append(im); });
      page.append(this.photos.length ? grid : h('div', 'empty', 'Brak zdjęć. Zrób je aparatem 📷'));
    };
    this.current = null; render();
  }

  private viewPhoto(url: string, back: () => void): void {
    const { page } = this.page('Zdjęcie', back), ph = h('div', 'photo'), im = h('img'), bar = h('div', 'bar2');
    im.src = url; ph.append(im);
    const dl = h('button', 'btn blue', '⬇ Zapisz na dysk'); dl.onclick = () => { const a = h('a'); a.href = url; a.download = `moje-miasto-${Date.now()}.jpg`; a.click(); };
    const share = h('button', 'btn ok', '✉ Wyślij…');
    share.onclick = () => { const { page: p2 } = this.page('Wyślij do', () => this.viewPhoto(url, back)), list = h('div', 'list');
      for (const c of this.convs.values()) if (c.id >= 0 && (c.id !== 0 || this.online())) { const r = h('div', 'row', `<div class="av" style="background:${c.color}">${c.id === 0 ? '👥' : esc(initials(c.name))}</div><div class="tx"><b>${esc(c.name)}</b></div>`); r.onclick = async () => { this.thread(c.id); this.send(c.id, { img: await forSending(url) }); }; list.append(r); }
      if (!list.children.length) list.append(h('div', 'empty', 'Zdjęcia wyślesz innym graczom w grze sieciowej.'));
      p2.append(list); };
    const del = h('button', 'btn no', '🗑 Usuń'); del.onclick = () => { this.photos = this.photos.filter(p => p !== url); try { localStorage.setItem('mm.zdjecia', JSON.stringify(this.photos.slice(0, 8))); } catch { /* */ } this.gallery(); };
    bar.append(dl, share, del); page.append(ph, bar);
  }
}
