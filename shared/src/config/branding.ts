// Szyldy sklepów i usług: nazwa z OSM (domyślnie), parodia albo nazwa generyczna.
// Przed publicznym wydaniem wystarczy zmienić BRANDING. Bez oryginalnych logotypów i grafik.
import type { TilePoi } from '../tiles/types';

export type Branding = 'osm-name' | 'parody' | 'generic';
export const BRANDING: Branding = 'osm-name';

const GENERIC: Record<string, string> = {
  convenience: 'Sklep', supermarket: 'Supermarket', discount: 'Dyskont', department_store: 'Dom towarowy', bakery: 'Piekarnia',
  butcher: 'Mięsny', alcohol: 'Monopolowy', kiosk: 'Kiosk', clothes: 'Odzież', shoes: 'Obuwie', hairdresser: 'Fryzjer',
  pharmacy: 'Apteka', cafe: 'Kawiarnia', restaurant: 'Restauracja', fast_food: 'Bar', pub: 'Pub', bar: 'Bar', bank: 'Bank',
  atm: 'Bankomat', fuel: 'Stacja paliw', post_office: 'Poczta', car_repair: 'Warsztat', florist: 'Kwiaciarnia', books: 'Księgarnia',
  mobile_phone: 'Telefony', electronics: 'Elektronika', beauty: 'Kosmetyczka', optician: 'Optyk', dentist: 'Dentysta', doctors: 'Lekarz',
  school: 'Szkoła', kindergarten: 'Przedszkole', place_of_worship: 'Kościół', theatre: 'Teatr', cinema: 'Kino', library: 'Biblioteka',
  police: 'Policja', fire_station: 'Straż pożarna', hospital: 'Szpital', hotel: 'Hotel',
  souvenirs: 'Pamiątki', gift: 'Upominki', jewelry: 'Jubiler', toys: 'Zabawki', sports: 'Sport', furniture: 'Meble', hardware: 'Sklep żelazny',
  doityourself: 'Market budowlany', variety_store: 'Wszystko po 5 zł', greengrocer: 'Warzywniak', confectionery: 'Cukiernia', pastry: 'Cukiernia',
  tobacco: 'Tytoń', newsagent: 'Prasa', chemist: 'Drogeria', cosmetics: 'Kosmetyki', perfumery: 'Perfumeria', bag: 'Torebki', watches: 'Zegarki',
  ice_cream: 'Lody', biergarten: 'Ogródek piwny', computer: 'Komputery', copyshop: 'Ksero', laundry: 'Pralnia', dry_cleaning: 'Pralnia',
  travel_agency: 'Biuro podróży', pet: 'Zoologiczny', art: 'Galeria sztuki', music: 'Muzyka', wine: 'Wina', coffee: 'Kawa', tea: 'Herbaciarnia',
  second_hand: 'Second hand', charity: 'Sklep charytatywny', mall: 'Galeria handlowa', bureau_de_change: 'Kantor', frame: 'Ramiarnia', tailor: 'Krawiec',
};

/** Prosta, powtarzalna parodia nazwy (zamiana kilku liter). */
function parody(name: string): string {
  const swap: Record<string, string> = { a: 'o', o: 'a', e: 'y', i: 'e', k: 'x', b: 'p', l: 'll' };
  let out = '', done = 0;
  for (const ch of name) { const lo = ch.toLowerCase(); if (done < 2 && swap[lo]) { const s = swap[lo]; out += ch === lo ? s : s.toUpperCase(); done++; } else out += ch; }
  return out;
}

export function signText(p: TilePoi, mode: Branding = BRANDING): string {
  const generic = GENERIC[p.t] || p.t.replace(/_/g, ' ');
  const name = p.n || p.brand;
  if (!name || mode === 'generic') return generic;
  return mode === 'parody' ? parody(name) : name;
}
