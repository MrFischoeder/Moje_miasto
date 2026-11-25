// Giełda samochodowa (aplikacja w telefonie): ok. 20 ogłoszeń „Sprzedam…” odnawianych co 6 godzin czasu gry.
// Ogłoszenia liczone tak samo u klienta i na serwerze (ziarno: miasto + data + pora dnia, miejsca: przystanki).
// Na miejscu ogłoszenia (gdy gracz jest blisko) stoi auto i sprzedający; kupno tylko przy sprzedającym.
// Kupione auto ma papiery na gracza (legalne – można nim pracować jako kierowca taksówki).
import { rng } from '../util/rng';
import { CAR_PRICE } from './cars';
import { VEH } from '../sim/vehicles';

export interface Listing { id: string; v: number; title: string; year: number; price: number; desc: string; x: number; z: number; place: string; seller: string; phone: string }

/** marki i modele dla wariantów VEH (indeks), waga = jak często trafiają się w ogłoszeniach */
const MODELS: [number, string[], number][] = [
  [0, ['Volkswagen Golf', 'Opel Astra', 'Ford Focus', 'Škoda Fabia', 'Toyota Auris', 'Peugeot 308', 'Renault Megane'], 6],
  [1, ['Toyota Corolla', 'Škoda Octavia', 'Audi A4', 'Honda Civic', 'Mercedes C 200', 'BMW 320d'], 5],
  [2, ['VW Passat Variant', 'Škoda Superb Combi', 'Opel Insignia ST', 'Ford Mondeo kombi', 'Audi A6 Avant'], 4],
  [3, ['Kia Sportage', 'Nissan Qashqai', 'Toyota RAV4', 'Dacia Duster', 'Hyundai Tucson'], 3],
  [4, ['Fiat Panda', 'Toyota Yaris', 'Fiat 500', 'Renault Clio', 'Daewoo Matiz', 'Škoda Citigo'], 5],
  [5, ['Opel Zafira', 'Renault Scenic', 'VW Touran', 'Citroën C4 Picasso'], 2],
  [6, ['Škoda Octavia (po taxi)', 'Toyota Prius (po taxi)'], 1],
  [7, ['BMW M3', 'Mazda MX-5', 'Subaru Impreza WRX', 'Audi TT', 'Porsche Boxster'], 1],
  [8, ['Ford Transit', 'Renault Master', 'Fiat Ducato', 'VW Crafter'], 2],
  [9, ['MAN TGL', 'Iveco Eurocargo'], .5],
  [10, ['Scania R450', 'Volvo FH'], .3],
  [11, ['Honda CBR 600', 'Yamaha MT-07', 'Kawasaki Z650', 'Suzuki GSX-R'], 1.5],
  [12, ['Piaggio Zip', 'Honda SH 125', 'Romet Pony'], 1],
  [13, ['Xiaomi Pro 2', 'Segway Ninebot'], .7],
];
const DESC = ['stan bardzo dobry, garażowany', 'pierwszy właściciel, serwisowany w ASO', 'do drobnych poprawek, cena do negocjacji', 'zadbany, nowe opony', 'bezwypadkowy, ważny przegląd', 'sprzedaję z powodu wyjazdu', 'lekko porysowany, mechanicznie sprawny', 'okazja, pilne!', 'niski przebieg, książka serwisowa', 'auto po dziadku, jeździł tylko do kościoła'];
const SELLERS = ['Pan Henryk', 'Pani Bożena', 'Marek', 'Pan Stanisław', 'Agnieszka', 'Komis „U Zdzicha”', 'Pan Wiesiek', 'Kasia', 'Pan Józef', 'Tomek'];

/** Ziarno ogłoszeń: data gry i pora (co 6 h). */
export const marketSeed = (date: string, sec: number) => `${date}#${Math.floor(sec / 21600)}`;

export function listings(city: string, seed: string, stops: [string, number, number][], scale = 1, n = 20): Listing[] {
  const R = rng(`gielda:${city}:${seed}`), out: Listing[] = [], used = new Set<number>();
  const total = MODELS.reduce((s, m) => s + m[2], 0);
  if (!stops.length) return out;
  for (let k = 0; k < n; k++) {
    let x = R() * total, m = MODELS[0]; for (const q of MODELS) { x -= q[2]; if (x <= 0) { m = q; break; } }
    const v = m[0]; if (!VEH[v]) continue;
    const name = m[1][Math.floor(R() * m[1].length)], year = 2003 + Math.floor(R() * 19), age = (2022 - year) / 19;
    const price = Math.max(50, Math.round(CAR_PRICE[v] * scale * (1.05 - age * .6) * (.85 + R() * .3) / 50) * 50);
    let si = Math.floor(R() * stops.length); for (let t = 0; t < 10 && used.has(si); t++) si = Math.floor(R() * stops.length); used.add(si);
    const [place, sx, sz] = stops[si];
    out.push({ id: `${seed}:${k}`, v, title: `Sprzedam ${name}, ${year}`, year, price, desc: DESC[Math.floor(R() * DESC.length)], x: sx, z: sz, place, seller: SELLERS[Math.floor(R() * SELLERS.length)], phone: `${500 + Math.floor(R() * 299)} ${100 + Math.floor(R() * 899)} ${100 + Math.floor(R() * 899)}` });
  }
  return out;
}
