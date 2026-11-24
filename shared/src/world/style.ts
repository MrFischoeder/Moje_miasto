// Styl (epoka) budynku: decyduje o dachu, detalach dachu i fasadzie.
// Dane OSM rzadko mają datę budowy, więc styl rozpoznajemy z typu, liczby kondygnacji, kształtu obrysu,
// zwartości zabudowy (kwartały kamienic vs wolnostojące „płyty”) i tego, co dominuje w okolicy (tools/simplify-tiles.ts).
//
//   kam   – kamienica / zabudowa przedwojenna: zwarta, strome dachy z dachówki, lukarny, kominy
//   dom   – dom jednorodzinny / willa: stromy dach (dwu- lub czterospadowy), komin, czasem lukarna
//   pow   – powojenny niski blok (1945–1970), 2–4 kondygnacje: dach dwuspadowy z dachówki, rząd kominów
//   blok  – blok z wielkiej płyty (1960–1990): płaski dach z attyką, maszynownie wind lub wyłazy, wywiewki,
//           fasada z płyt (spoiny), balkony / loggie
//   wsp   – zabudowa współczesna (po 1990): płaski dach, wyjście na dach z drzwiami, cofnięte ostatnie piętro, jasne elewacje
//   biuro – biura, usługi, handel: płaski dach z urządzeniami (klimatyzacja)
//   przem – przemysł, magazyny, hale: płaski dach, świetliki
//   pub   – budynki publiczne (szkoły, szpitale, uczelnie)
export type BStyle = 'kam' | 'dom' | 'pow' | 'blok' | 'wsp' | 'biuro' | 'przem' | 'pub';
export const STYLES: BStyle[] = ['kam', 'dom', 'pow', 'blok', 'wsp', 'biuro', 'przem', 'pub'];
/** style ze stromym dachem */
export const PITCHED: BStyle[] = ['kam', 'dom', 'pow'];

export interface StyleIn {
  /** building=* */
  t: string;
  /** liczba kondygnacji (z OSM albo z wysokości) i czy podana w OSM */
  lv: number; lvTag: boolean;
  /** pole obrysu, boki prostokąta opisanego (W ≥ D), wypełnienie prostokąta (pole / W·D) */
  A: number; W: number; D: number; rect: number;
  /** głębokość efektywna 2·pole/obwód (pas zabudowy stałej głębokości: ~głębokość) i średnia długość krawędzi obrysu */
  dEff: number; mE: number;
  /** dziedzińce, liczba budynków połączonych w bryłę, styka się z innym budynkiem */
  holes: number; members: number; attached: boolean;
  /** rok budowy (start_date), zabytek, kształt dachu z OSM */
  yr?: number; hist?: boolean; rs?: string;
  /** odległość od centrum (Rynku) [m] */
  dc: number;
}

const HOUSE = ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'villa', 'cabin'];
const RES = ['apartments', 'residential', 'yes', 'dormitory', 'flats', 'hotel'];
const OFFICE = ['office', 'commercial', 'retail', 'supermarket', 'mall', 'kiosk', 'bank'];
const IND = ['industrial', 'warehouse', 'service', 'hangar', 'manufacture', 'garage', 'garages', 'storage_tank', 'transformer_tower', 'roof', 'carport', 'shed', 'parking', 'barn', 'farm_auxiliary', 'greenhouse', 'construction'];
const PUB = ['school', 'university', 'college', 'kindergarten', 'hospital', 'public', 'civic', 'government', 'train_station', 'transportation', 'sports_hall', 'fire_station', 'museum', 'theatre', 'police'];
const STEEP = ['gabled', 'hipped', 'half-hipped', 'mansard', 'gambrel', 'saltbox'];

/** Styl i pewność (true: rozpoznany z pewnych cech; false: do ujednolicenia z okolicą). */
export function styleOf(s: StyleIn): { st: BStyle; sure: boolean } {
  const { t, lv, A, W, D, rect } = s, steep = !!s.rs && STEEP.includes(s.rs), flat = s.rs === 'flat';
  if (IND.includes(t)) return { st: 'przem', sure: true };
  if (OFFICE.includes(t)) return { st: lv <= 3 && (s.hist || steep) ? 'kam' : 'biuro', sure: true };
  if (PUB.includes(t)) return { st: s.hist || steep ? 'kam' : flat ? 'pub' : s.yr != null && s.yr < 1945 ? 'kam' : 'pub', sure: true };
  if (HOUSE.includes(t)) return { st: lv >= 4 && !steep ? 'wsp' : 'dom', sure: true };
  if (!RES.includes(t)) return { st: lv <= 2 && A < 250 ? 'dom' : 'biuro', sure: false };
  // rok budowy (rzadko w OSM) rozstrzyga
  if (s.yr != null) {
    if (s.yr < 1945) return { st: lv <= 2 && A < 350 ? 'dom' : 'kam', sure: true };
    if (s.yr < 1962) return { st: lv <= 4 ? 'pow' : steep ? 'pow' : 'blok', sure: true };
    if (s.yr < 1993) return { st: lv <= 2 && A < 350 ? 'dom' : lv <= 3 && steep ? 'pow' : 'blok', sure: true };
    return { st: lv <= 2 && A < 350 ? 'dom' : 'wsp', sure: true };
  }
  if (s.hist) return { st: lv <= 2 && A < 350 ? 'dom' : 'kam', sure: true };
  // małe niskie budynki mieszkalne: domy
  if (lv <= 2 && A < 320) return { st: 'dom', sure: true };
  // zwarta zabudowa kwartałowa: dziedziniec, wiele połączonych budynków, nieregularny obrys
  // (pierzeje z oficynami: dużo krótkich krawędzi; pełne kwartały: duża głębokość efektywna)
  // (kamienice mają najwyżej 6–7 kondygnacji)
  const perimeter = lv <= 6 && (s.holes > 0 || (rect < .7 && s.dEff >= 11) || (rect < .8 && s.mE < 7 && s.members >= 3 && s.dc < 3500));
  // „wężowiec” / blok łamany: pas o stałej głębokości ~10–12 m z długich prostych odcinków
  const snake = rect < .86 && s.dEff >= 6.5 && s.dEff < 11.5 && s.mE >= 7 && W >= 40;
  // prosta „płyta”: prostokąt, głębokość typowa dla wielkiej płyty, długa albo wysoka (punktowiec)
  const slab = rect >= .86 && D >= 9 && D <= 17 && (W >= 2.2 * D || W >= 36);
  const point = rect >= .8 && lv >= 9 && W <= 32 && D >= 13;
  if (lv >= 9) {
    if (slab || point) return { st: 'blok', sure: s.lvTag && !steep };
    return { st: steep ? 'kam' : 'wsp', sure: false };
  }
  if (lv >= 4) {
    if (perimeter) return { st: 'kam', sure: true };
    // centrum: prostokątne pierzeje kamienic też bywają „płytami” z obrysu – rozstrzyga okolica
    const inner = s.dc < 2200;
    if (steep) return { st: s.attached || inner ? 'kam' : lv <= 5 && slab ? 'pow' : 'kam', sure: false };
    if (slab || snake) return { st: 'blok', sure: !inner && (s.lvTag || W >= 50) };
    if (lv >= 7) return { st: s.mE >= 10 ? 'blok' : 'wsp', sure: false };
    if (rect < .78 && !s.attached) return { st: 'wsp', sure: false };
    if (flat) return { st: D > 15 ? 'wsp' : 'blok', sure: false };
    return { st: inner ? 'kam' : 'blok', sure: false };
  }
  // 2–3 kondygnacje; długi pas bez opisanej liczby pięter (domyślne 9 m) poza centrum to blok
  if ((slab || snake) && !s.lvTag && W >= 40 && s.dc >= 2200) return { st: 'blok', sure: W >= 60 };
  if (perimeter || (s.attached && s.dc < 3500 && rect < .86)) return { st: 'kam', sure: !!perimeter };
  if (flat) return { st: 'wsp', sure: false };
  if (rect >= .85 && W >= 16) return { st: 'pow', sure: false };
  return { st: A < 450 ? 'dom' : 'pow', sure: false };
}

/** Ujednolicenie z okolicą: niepewne budynki mieszkalne dostają styl dominujący wśród pewnych w pobliżu. */
export function smoothStyles<T extends { x: number; z: number; st: BStyle; sure: boolean; res: boolean; lv: number; lvTag?: boolean; W?: number }>(items: T[], cell = 250): void {
  const key = (x: number, z: number) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
  const votes = new Map<string, Record<string, number>>();
  for (const q of items) if (q.sure && q.res && q.st !== 'dom') {
    const k = key(q.x, q.z); const v = votes.get(k) ?? {}; v[q.st] = (v[q.st] ?? 0) + 1; votes.set(k, v);
  }
  for (const q of items) {
    if (q.sure || !q.res || q.st === 'dom') continue;
    const cx = Math.floor(q.x / cell), cz = Math.floor(q.z / cell), tot: Record<string, number> = {};
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const v = votes.get((cx + a) + ',' + (cz + b)); if (v) for (const [s, n] of Object.entries(v)) tot[s] = (tot[s] ?? 0) + n * (a === 0 && b === 0 ? 2 : 1); }
    const best = Object.entries(tot).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 3) continue;
    const st = best[0] as BStyle;
    // nie zmieniamy wysokości „epoki”: niski budynek w blokowisku zostaje niski (pawilon), wysoki w kwartale kamienic – współczesny plomb
    if (st === 'blok' && q.lv < 4 && (q.lvTag || (q.W ?? 0) < 20)) continue;
    if (st === 'kam' && q.lv >= 7) continue;
    q.st = st;
  }
}

/** Rok z start_date (1885, 1885-05-01, ~1890, C19 = 1850, „before 1900” …). */
export function yearOf(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.match(/(\d{4})/); if (m) { const y = +m[1]; return y > 1000 && y < 2100 ? y : undefined; }
  const c = v.match(/C(\d{2})/i); if (c) return (+c[1] - 1) * 100 + 50;
  return undefined;
}
