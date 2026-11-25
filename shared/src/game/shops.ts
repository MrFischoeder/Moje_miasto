// Sklepy i lokale z punktów OSM: rodzaj (co sprzedają), godziny otwarcia i towary u ekspedienta.
// Zakup sprawdza serwer (sim.ts: shopBuy): sklep otwarty, gracz przy witrynie, pieniądze. Napad: w przyszłości (robbable).
import type { TilePoi } from '../tiles/types';

export interface ShopItem { n: string; price: number; heal?: number }
export interface ShopKind { k: string; open: number; close: number; clerk: string; items: ShopItem[]; robbable: boolean }

const K = (k: string, open: number, close: number, clerk: string, items: [string, number, number?][]): ShopKind => ({ k, open, close, clerk, robbable: true, items: items.map(([n, price, heal]) => ({ n, price, ...(heal ? { heal } : {}) })) });
const FOOD = K('spożywczy', 6, 23, 'Kasjerka', [['Bułka', 1.2, 4], ['Chleb', 5, 10], ['Woda', 2.5, 5], ['Batonik', 3, 6], ['Kanapka', 9, 15], ['Energetyk', 6, 8]]);
const KINDS: Record<string, ShopKind> = {
  food: FOOD,
  bakery: K('piekarnia', 6, 18, 'Pani z piekarni', [['Drożdżówka', 4, 8], ['Chleb', 6, 10], ['Pączek', 3.5, 7], ['Rogal', 3, 6]]),
  butcher: K('mięsny', 7, 18, 'Rzeźnik', [['Kiełbasa', 12, 14], ['Szynka (10 dag)', 6, 8], ['Pasztet', 8, 10]]),
  cafe: K('kawiarnia', 8, 21, 'Barista', [['Espresso', 9, 5], ['Cappuccino', 13, 7], ['Ciasto', 16, 12], ['Herbata', 10, 5]]),
  bar: K('bar', 12, 2, 'Barman', [['Piwo', 14, 3], ['Lemoniada', 12, 6], ['Frytki', 15, 10], ['Shot', 10]]),
  restaurant: K('restauracja', 12, 23, 'Kelner', [['Zupa dnia', 18, 18], ['Pierogi', 29, 30], ['Schabowy', 39, 40], ['Deser', 19, 10]]),
  fast_food: K('fast food', 10, 23, 'Sprzedawca', [['Kebab', 25, 25], ['Hamburger', 22, 22], ['Zapiekanka', 14, 15], ['Cola', 7, 4]]),
  ice_cream: K('lodziarnia', 10, 21, 'Lodziarz', [['Gałka lodów', 6, 4], ['Lody w rożku (3 gałki)', 15, 9]]),
  pharmacy: K('apteka', 8, 21, 'Farmaceutka', [['Plastry', 9, 10], ['Tabletki przeciwbólowe', 14, 20], ['Bandaż', 12, 25], ['Apteczka', 60, 60]]),
  alcohol: K('monopolowy', 6, 23, 'Sprzedawca', [['Piwo', 4.5, 2], ['Wino', 25], ['Chipsy', 7, 5]]),
  kiosk: K('kiosk', 6, 20, 'Kioskarz', [['Gazeta', 4], ['Bilet komunikacji', 4.6], ['Guma do żucia', 3, 1], ['Zapalniczka', 5]]),
  clothes: K('odzież', 10, 20, 'Sprzedawczyni', [['Koszulka', 49], ['Bluza', 129], ['Czapka', 39], ['Kurtka', 299]]),
  shoes: K('obuwie', 10, 20, 'Sprzedawca', [['Trampki', 159], ['Buty sportowe', 249], ['Klapki', 49]]),
  florist: K('kwiaciarnia', 8, 19, 'Florystka', [['Róża', 8], ['Bukiet', 59], ['Kwiat doniczkowy', 35]]),
  electronics: K('elektronika', 10, 20, 'Doradca', [['Ładowarka', 49], ['Słuchawki', 129], ['Powerbank', 99], ['Telefon', 899]]),
  books: K('księgarnia', 10, 19, 'Księgarz', [['Książka', 39], ['Mapa Wrocławia', 19], ['Kryminał', 34]]),
  other: K('sklep', 10, 19, 'Sprzedawca', [['Drobiazg', 15], ['Pamiątka', 25], ['Prezent', 59]]),
};
const MAP: Record<string, string> = {
  convenience: 'food', supermarket: 'food', discount: 'food', greengrocer: 'food', deli: 'food', department_store: 'food', variety_store: 'food',
  bakery: 'bakery', pastry: 'bakery', confectionery: 'bakery', butcher: 'butcher', cafe: 'cafe', coffee: 'cafe', tea: 'cafe',
  bar: 'bar', pub: 'bar', biergarten: 'bar', restaurant: 'restaurant', food_court: 'restaurant', fast_food: 'fast_food', ice_cream: 'ice_cream',
  pharmacy: 'pharmacy', chemist: 'pharmacy', alcohol: 'alcohol', wine: 'alcohol', beverages: 'alcohol', kiosk: 'kiosk', newsagent: 'kiosk', tobacco: 'kiosk',
  clothes: 'clothes', boutique: 'clothes', fashion: 'clothes', second_hand: 'clothes', shoes: 'shoes', bag: 'shoes', florist: 'florist', garden_centre: 'florist',
  electronics: 'electronics', mobile_phone: 'electronics', computer: 'electronics', books: 'books', stationery: 'books',
};
export function shopKind(p: TilePoi): ShopKind { return KINDS[MAP[p.t] ?? 'other']; }
/** Czy otwarte o godzinie h (0..24); zamknięcie po północy (np. bar do 2:00) obsłużone. */
export function isOpen(k: ShopKind, h: number): boolean { return k.close > k.open ? h >= k.open && h < k.close : h >= k.open || h < k.close; }
/** Odległość od punktu sklepu (OSM, wewnątrz budynku), z której można kupować [m]. */
export const SHOP_R = 22;
