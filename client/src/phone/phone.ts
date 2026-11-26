// Telefon komórkowy gracza (nakładka w stylu współczesnego smartfona): Telefon (połączenia na razie zablokowane),
// Wiadomości (gracze, wszyscy, NPC ze zleceniami; tekst, lokalizacja, zdjęcia), Mapa (całe miasto, znaczniki,
// teleport w wersji deweloperskiej), Aparat (zdjęcia ekranu gry), Zdjęcia (galeria, wysyłanie, zapis na dysk).
import './phone.css';
import { NPCS } from '@miasto/shared/game/jobs';
import { CAB_OK, CAR_PRICE, DZIUPLA, REREG_SHARE } from '@miasto/shared/game/cars';
import { VEH } from '@miasto/shared/sim/vehicles';
import { isOpen, shopKind } from '@miasto/shared/game/shops';
import type { TilePoi } from '@miasto/shared/tiles/types';
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
  /** ekran odświeżany co sekundę (Taxi: stan kursu) */
  private live = false;
  private vf = h('div'); private toastEl = h('div');
  private toastT = 0;
  /** sprzątanie po aparacie (nasłuch spustu) */
  private camOff: (() => void) | null = null;
  onUnread: (n: number) => void = () => {};

  constructor(private game: Game) {
    this.el.id = 'phone';
    const bar = h('div', 'bar'), x = h('button', 'close', '✕'); x.title = 'Schowaj telefon (C / Esc)'; x.onclick = e => { e.stopPropagation(); this.toggle(false); };
    const ico = h('div', 'ico', '<span>▂▄▆█</span><span>5G</span><div class="batt"><i></i></div>'); ico.append(x); bar.append(this.clock, ico);
    const homebar = h('div', 'homebar', '<i></i>'); homebar.onclick = () => this.home();
    this.screen.append(h('div', 'island'), bar, this.view, homebar); this.el.append(this.screen);
    this.vf.id = 'viewfinder'; this.toastEl.id = 'phoneToast';
    document.body.append(this.el, this.vf, this.toastEl);
    try { this.photos = JSON.parse(localStorage.getItem('mm.zdjecia') || '[]'); } catch { this.photos = []; }
    for (const n of NPCS) this.conv(n.id, n.name, n.color);
    // klawisze w telefonie: Esc i C (poza polem tekstowym) zamykają go; inne klawisze sterują grą, chyba że piszemy
    this.el.addEventListener('keydown', e => {
      const t = e.target as HTMLElement, typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
      if (e.key === 'Escape' || (e.code === 'KeyC' && !typing)) { e.preventDefault(); e.stopPropagation(); this.toggle(false); return; }
      if (typing) e.stopPropagation();
    });
    // Esc zamyka telefon także wtedy, gdy fokus nie jest w telefonie (klik w ikonę, w grę)
    addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !this.open) return;
      const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !this.el.contains(t)) return; // czat
      this.toggle(false);
    });
    setInterval(() => { if (this.open) { this.tick(); if (this.live) this.current?.(); } }, 1000);
    this.home();
  }

  get isOpen(): boolean { return this.open; }
  toggle(on = !this.open): void {
    this.open = on; this.el.classList.toggle('open', on); document.body.classList.toggle('phoneOpen', on); // przyciski gry chowane pod telefonem
    if (on) { this.game.input.releasePointer(); this.tick(); this.current?.(); }
    else { this.vf.classList.remove('open'); this.camOff?.(); this.camOff = null; (document.activeElement as HTMLElement | null)?.blur?.(); }
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
    this.live = false;
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
      ['🚕', 'Taxi', '#ffcc00', () => this.taxiApp()],
      ['🚗', 'Auta', '#5e5ce6', () => this.carsApp()],
      ['🏷️', 'Giełda', '#ff375f', () => this.marketApp()],
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

  /** Taxi: zamówienie (cel wybierany na mapie), stan kursu, odwołanie */
  taxiApp(): void {
    const render = () => {
      const { page } = this.page('Taxi', () => this.home()), box = h('div', 'list'), s = this.game.session, tx = s?.me.taxi ?? null, cur = s?.me.cur ?? 'zł';
      if (!tx) {
        box.append(h('div', 'empty', '🚕 Wybierz cel na mapie, a taksówka podjedzie po ciebie.<br>Opłata: 8 zł + ok. 3,20 zł za km (pobierana po kursie).'));
        const b = h('button', 'btn blue', '🗺️ Wybierz cel na mapie'); b.onclick = () => this.mapApp(undefined, true); b.style.margin = '12px auto'; b.style.display = 'block';
        box.append(b);
      } else {
        const where = esc(this.place(tx.dest[0], tx.dest[1]) || 'wybrany punkt');
        const st = tx.st === 'coming' ? `Taksówka jedzie po ciebie · ok. ${tx.eta} s` : tx.st === 'waiting' ? 'Taksówka czeka obok – podejdź i wsiądź (E / „Wsiądź”)' : `W drodze · na miejscu za ok. ${tx.eta} s`;
        box.append(h('div', 'row', `<div class="av" style="background:#ffcc00;color:#000">🚕</div><div class="tx"><b>${esc(st)}</b><span>Cel: ${where} · ok. ${tx.fare.toFixed(0)} ${esc(cur)}</span></div>`));
        const acts = h('div', 'acts'), map = h('button', 'btn blue', '🗺️ Pokaż na mapie'), cancel = h('button', 'btn no', tx.st === 'riding' ? 'Wysiądź tutaj' : 'Odwołaj');
        map.onclick = () => { const e = s?.entity(tx.id); this.mapApp(e ? [e.x, e.z] : tx.dest); };
        cancel.onclick = () => { s?.sendCommand({ type: 'taxi', cancel: true }); setTimeout(render, 400); };
        acts.append(map, cancel); acts.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:12px'; box.append(acts);
      }
      // praca: kierowca taksówki (tylko legalnym autem)
      const job = box, cab = s?.me.cab ?? null; job.append(h('div', 'sep'));
      job.append(h('div', 'row', `<div class="av" style="background:#ff9f0a">💼</div><div class="tx"><b>Praca: kierowca taksówki</b><span>${cab ? `Zarobek w tej zmianie: ${cab.earned.toFixed(2)} ${esc(cur)} · kursów: ${cab.rides}` : 'Woź klientów swoim legalnym autem i zarabiaj.'}</span></div>`));
      if (cab) {
        const p = this.myPos(), d = cab.target && p ? Math.round(Math.hypot(cab.target[0] - p.x, cab.target[1] - p.z)) : 0;
        const st = cab.st === 'search' ? 'Czekasz na zlecenie…' : cab.st === 'pickup' ? `Jedź po klienta: ${d} m (zatrzymaj się obok)` : `Wieziesz klienta: do celu ${d} m · ok. ${cab.pay.toFixed(0)} ${esc(cur)}`;
        job.append(h('div', 'empty', esc(st)));
        const acts = h('div', 'acts'), map = h('button', 'btn blue', '🗺️ Cel na mapie'), stop = h('button', 'btn no', 'Zakończ zmianę');
        map.onclick = () => { if (cab.target) this.mapApp(cab.target); }; stop.onclick = () => { s?.sendCommand({ type: 'cab', on: false }); setTimeout(render, 400); };
        acts.append(map, stop); acts.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:12px'; job.append(acts);
      } else {
        const v = s ? s.entity(s.player()?.vehicle ?? -1) : undefined, legal = !!s?.me.legal, okCar = !!v && v.kind === 'car' && CAB_OK(v.v ?? 0);
        const why = !v ? 'Wsiądź za kierownicę swojego legalnego auta (kupionego w aplikacji Auta albo przerejestrowanego w dziupli).' : !okCar ? 'Tym pojazdem nie przewieziesz klientów.' : !legal ? 'To auto nie ma papierów na ciebie (kradzione albo bez rejestracji). Kup auto albo przerejestruj je w dziupli.' : 'Możesz zaczynać.';
        job.append(h('div', 'empty', esc(why)));
        if (legal && okCar) { const go = h('button', 'btn ok', '▶ Zacznij pracę'); go.style.cssText = 'display:block;margin:10px auto'; go.onclick = () => { s?.sendCommand({ type: 'cab', on: true }); setTimeout(render, 400); }; job.append(go); }
      }
      page.append(box); this.live = true;
    };
    this.current = render; render();
  }

  /** Sklep / lokal: ekspedient i towary (zakup sprawdza serwer) */
  shopApp(p: TilePoi, name: string): void {
    this.toggle(true);
    const render = () => {
      const { page } = this.page(name, () => this.home()), s = this.game.session, cur = s?.me.cur ?? 'zł', k = shopKind(p), list = h('div', 'list');
      const lt = this.game.transit?.local(), hour = lt ? lt.sec / 3600 : 12, open = isOpen(k, hour), sc = this.game.world?.key === 'londyn' ? .35 : 1;
      list.append(h('div', 'row', `<div class="av" style="background:${open ? '#30d158' : '#8e8e93'}">🧑‍💼</div><div class="tx"><b>${esc(k.clerk)} · ${esc(k.k)}</b><span>${open ? 'Otwarte' : 'Zamknięte'} · ${k.open}:00–${k.close}:00 · twoje pieniądze: ${(s?.me.money ?? 0).toFixed(2)} ${esc(cur)}</span></div>`));
      if (!open) list.append(h('div', 'empty', 'Sklep jest teraz zamknięty. Wróć w godzinach otwarcia.'));
      k.items.forEach((it, i) => {
        const price = Math.round(it.price * sc * 100) / 100, have = s?.me.inv?.[it.n] ?? 0;
        const r = h('div', 'row', `<div class="av" style="background:#3a3a3c">🛒</div><div class="tx"><b>${esc(it.n)}</b><span>${price.toFixed(2)} ${esc(cur)}${it.heal ? ` · +${it.heal} zdrowia` : ''}${have ? ` · masz: ${have}` : ''}</span></div>`);
        if (open) { const b = h('button', 'btn ok', 'Kup'); b.onclick = e => { e.stopPropagation(); s?.sendCommand({ type: 'shopBuy', poi: p.id, item: i }); setTimeout(render, 500); }; r.append(b); }
        list.append(r);
      });
      page.append(list); this.live = true;
    };
    this.current = render; render();
  }

  /** Giełda samochodowa: ogłoszenia „Sprzedam…”, miejsce spotkania, kupno przy sprzedającym */
  marketApp(open?: string): void {
    const render = () => {
      const s = this.game.session, cur = s?.me.cur ?? 'zł', L = this.game.marketListings(), sold = new Set(s?.me.sold ?? []), p = this.myPos();
      const item = open ? L.find(q => q.id === open) : undefined;
      if (item) {
        const { page } = this.page('Ogłoszenie', () => { open = undefined; render(); }), box = h('div', 'list');
        const d = p ? Math.round(Math.hypot(item.x - p.x, item.z - p.z)) : 0;
        box.append(h('div', 'row', `<div class="av" style="background:#ff375f">🚗</div><div class="tx"><b>${esc(item.title)}</b><span>${item.price} ${esc(cur)} · ${esc(item.desc)}</span></div>`));
        box.append(h('div', 'empty', `Sprzedający: <b>${esc(item.seller)}</b>, tel. ${esc(item.phone)}<br>Spotkanie: przystanek <b>${esc(item.place)}</b> · ${d} m stąd<br>Przyjedź na miejsce i podejdź do sprzedającego, żeby kupić auto (z papierami na ciebie).`));
        const acts = h('div', 'acts'), map = h('button', 'btn blue', '🗺️ Pokaż na mapie'), buy = h('button', 'btn ok', sold.has(item.id) ? 'Sprzedane' : `Kup za ${item.price} ${cur}`);
        map.onclick = () => this.mapApp([item.x, item.z]);
        buy.onclick = () => { if (sold.has(item.id)) return; s?.sendCommand({ type: 'marketBuy', id: item.id }); setTimeout(render, 600); };
        acts.append(map, buy); acts.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:12px'; box.append(acts);
        page.append(box); this.live = true; return;
      }
      const { page } = this.page('Giełda', () => this.home()), list = h('div', 'list');
      list.append(h('div', 'empty', `${L.length} ogłoszeń · nowe co 6 godzin (czas gry). Twoje pieniądze: ${(s?.me.money ?? 0).toFixed(0)} ${esc(cur)}`));
      for (const q of L) {
        const d = p ? Math.round(Math.hypot(q.x - p.x, q.z - p.z)) : 0, sd = sold.has(q.id);
        const r = h('div', 'row', `<div class="av" style="background:${sd ? '#3a3a3c' : '#ff375f'}">${sd ? '✓' : '🚗'}</div><div class="tx"><b>${esc(q.title)}</b><span>${sd ? 'Sprzedane' : `${q.price} ${esc(cur)}`} · ${esc(q.place)} · ${d < 1000 ? d + ' m' : (d / 1000).toFixed(1) + ' km'}</span></div>`);
        r.onclick = () => { open = q.id; render(); }; list.append(r);
      }
      page.append(list); this.live = true;
    };
    this.current = render; render();
  }

  /** Auta: salon (kupno legalnego auta) i dziupla (przerejestrowanie kradzionego) */
  carsApp(): void {
    const render = () => {
      const { page } = this.page('Auta', () => this.home()), s = this.game.session, cur = s?.me.cur ?? 'zł', own = s?.me.owned ?? [], k = this.game.world?.key ?? 'wroclaw', sc = k === 'londyn' ? .35 : 1;
      const list = h('div', 'list');
      list.append(h('div', 'empty', `Twoje pieniądze: ${(s?.me.money ?? 0).toFixed(0)} ${esc(cur)}. Kupione auto przywołasz w trybie Auto (model w menu) – ma papiery, możesz nim pracować jako kierowca.`));
      VEH.forEach((v, i) => {
        const price = Math.round(CAR_PRICE[i] * sc), has = own.includes(i);
        const r = h('div', 'row', `<div class="av" style="background:${has ? '#30d158' : '#3a3a3c'}">${has ? '✓' : '🚗'}</div><div class="tx"><b>${esc(v.name)}</b><span>${has ? 'Twoje (legalne)' : `${price} ${esc(cur)}`}${CAB_OK(i) ? ' · nadaje się na taksówkę' : ''}</span></div>`);
        if (!has) { const b = h('button', 'btn ok', 'Kup'); b.onclick = e => { e.stopPropagation(); s?.sendCommand({ type: 'buyCar', v: i }); setTimeout(render, 500); }; r.append(b); }
        list.append(r);
      });
      // dziupla
      const d = DZIUPLA[k], dz = list;
      if (d) {
        const v = s ? s.entity(s.player()?.vehicle ?? -1) : undefined, p = this.myPos(), dist = p ? Math.round(Math.hypot(d.x - p.x, d.z - p.z)) : 0;
        const fee = v && v.kind === 'car' ? Math.round(CAR_PRICE[v.v ?? 0] * sc * REREG_SHARE) : 0;
        dz.append(h('div', 'row', `<div class="av" style="background:#8e8e93">🔧</div><div class="tx"><b>Dziupla: ${esc(d.name)}</b><span>Przerejestrowanie kradzionego auta „na lewo” (35% ceny) · ${dist} m stąd</span></div>`));
        const acts = h('div', 'acts'), map = h('button', 'btn blue', '🗺️ Pokaż na mapie'); map.onclick = () => this.mapApp([d.x, d.z]); acts.append(map);
        if (v && v.kind === 'car' && !s?.me.legal) { const rr = h('button', 'btn ok', `Przerejestruj (${fee} ${cur})`); rr.onclick = () => { s?.sendCommand({ type: 'rereg' }); setTimeout(render, 500); }; acts.append(rr); }
        acts.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:12px'; dz.append(acts);
        if (v && v.kind === 'car') dz.append(h('div', 'empty', s?.me.legal ? 'Auto, którym jedziesz, ma papiery na ciebie.' : 'Auto, którym jedziesz, nie ma papierów (kradzione / bez rejestracji). Podjedź nim do dziupli.'));
      }
      page.append(list); this.live = true;
    };
    this.current = render; render();
  }

  /** Mapa całego miasta; focus: punkt do pokazania; taxi: wybór celu kursu */
  mapApp(focus?: [number, number], taxi = false): void {
    const w = this.game.world; if (!w) return;
    if (!this.map || (this.map as unknown as { world: unknown }).world !== w) this.map = new PhoneMap(w);
    const m = this.map, { page } = this.page(taxi ? 'Taxi: wybierz cel' : 'Mapa', () => taxi ? this.taxiApp() : this.home());
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
      const cab = this.game.session?.me.cab; if (cab?.target) mk.push({ x: cab.target[0], z: cab.target[1], color: '#ffcc00', label: cab.st === 'pickup' ? 'Klient' : 'Cel kursu', kind: 'job' });
      for (const q of this.game.marketListings()) if (!(this.game.session?.me.sold ?? []).includes(q.id)) mk.push({ x: q.x, z: q.z, color: '#ff375f', label: q.title.replace('Sprzedam ', ''), kind: 'job' });
      const dzp = DZIUPLA[this.game.world?.key ?? '']; if (dzp) mk.push({ x: dzp.x, z: dzp.z, color: '#8e8e93', label: 'Dziupla', kind: 'job' });
      const tx = this.game.session?.me.taxi; if (tx) { const e = this.game.session?.entity(tx.id); if (e) mk.push({ x: e.x, z: e.z, color: '#ffcc00', label: 'Taksówka', kind: 'player' }); mk.push({ x: tx.dest[0], z: tx.dest[1], color: '#ffcc00', label: 'Cel kursu', kind: 'job' }); }
      if (p) mk.push({ x: p.x, z: p.z, color: '#0a84ff', kind: 'me', yaw: p.yaw });
      m.markers = mk; m.draw();
    };
    let sel: [number, number] | null = null;
    m.onTap = (x, z) => {
      sel = [x, z]; refresh();
      const name = this.place(x, z);
      const ll = unprojPoint(w.city.o, x, z);
      pop.innerHTML = `<b>${esc(name && name !== '—' ? name : 'Wybrany punkt')}</b><div style="font-size:12px;opacity:.75">Kratka <b>${cellName(m.grid, x, z)}</b> · ${fmtLatLon(ll)}<br>x ${Math.round(x)}, z ${Math.round(z)}</div>`;
      const cab = h('button', 'btn ok', '🚕 Taksówka tutaj'), fare = (() => { const p = this.myPos(); return p ? Math.round(8 + 3.2 * Math.hypot(x - p.x, z - p.z) * 1.3 / 1000) : 0; })();
      cab.textContent = `🚕 Taksówka tutaj (ok. ${fare} ${this.game.session?.me.cur ?? 'zł'})`;
      cab.onclick = () => { this.game.session?.sendCommand({ type: 'taxi', x, z }); pop.classList.remove('show'); sel = null; setTimeout(() => this.taxiApp(), 500); };
      const acts = h('div', 'acts'), tp = h('button', 'btn blue', '⚡ Teleportuj (wersja testowa)'), close = h('button', 'btn no', 'Zamknij'), cp = h('button', 'btn no', '⧉ Kopiuj współrzędne');
      cp.onclick = () => { navigator.clipboard?.writeText(`${fmtLatLon(ll)} (${cellName(m.grid, x, z)})`).catch(() => {}); cp.textContent = '✓ Skopiowano'; };
      tp.onclick = () => { this.game.session?.sendCommand({ type: 'teleport', x, z }); pop.classList.remove('show'); sel = null; setTimeout(() => { const p = this.myPos(); if (p) m.center(p.x, p.z); refresh(); }, 600); };
      close.onclick = () => { pop.classList.remove('show'); sel = null; refresh(); };
      if (taxi) acts.append(cab, close); else acts.append(cab, tp, cp, close); pop.append(acts); pop.classList.add('show');
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
    const leave = (then: () => void) => { this.vf.classList.remove('open'); removeEventListener('keydown', key, true); this.camOff = null; this.el.classList.add('open'); this.open = true; then(); };
    shot.onclick = take; back.onclick = () => leave(() => this.home()); gal.onclick = () => leave(() => this.gallery());
    addEventListener('keydown', key, true); this.camOff = () => removeEventListener('keydown', key, true);
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
