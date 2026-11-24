# Moje miasto

Gra z otwartym światem w prawdziwych miastach (Warszawa, Londyn), w wektorowym stylu terminala CRT.
Założenia i plan etapów: [`docs/PROMPT_CLAUDE_CODE.md`](docs/PROMPT_CLAUDE_CODE.md).

## Jak zagrać

**Bez instalacji:** pobierz `moje-miasto.html` i otwórz go dwuklikiem w Chrome, Edge albo Firefoksie.
Cała gra jest w tym jednym pliku (ok. 32 MB) i działa bez internetu i bez serwera (tryb jednoosobowy):
Warszawa ok. 4 km wokół Świętokrzyskiej i centrum Londynu ok. 3 km wokół Oxford Circus, z terenem, wnętrzami,
rozkładami komunikacji i lotniskami; dalej od centrum świat jest pusty. Świeży plik buduje się sam po każdym pushu:
GitHub → zakładka **Actions** → ostatni przebieg „Build” → **Artifacts** → `moje-miasto`.

Lokalnie zbudujesz go poleceniem `npm run build:single` (wynik: `dist-single/moje-miasto.html`).

## Gra wieloosobowa (etap 2c)

```bash
npm run build      # zbudowana gra, którą serwer udostępnia znajomym
npm run server     # serwer gry: http://localhost:8787 (lobby, WebSocket /ws, statystyki /api/stats)
```

Znajomi w tej samej sieci otwierają `http://<adres-komputera>:8787`, w menu wpisują nick i klikają „Pokaż gry” → „Dołącz”.
Z wersji deweloperskiej (`npm run dev`) albo z pliku `moje-miasto.html` wpisz adres serwera w polu „Adres serwera”.
Bez serwera gra działa jednoosobowo: ten sam kod serwera uruchamia się wtedy w Web Workerze.

- Serwer jest autorytatywny: klient wysyła tylko wejście (13 bajtów, 30 Hz) i polecenia (wsiądź, tryb, teleport, czat).
- Klient przewiduje własny ruch (ten sam kod kroku co serwer) i poprawia go po odpowiedzi serwera; innych graczy
  interpoluje ~100 ms w przeszłości.
- Migawki 15 Hz: binarne, tylko zmienione pola, tylko byty w promieniu ~1 km (helikopter 2,5 km).
- E przy cudzym aucie albo helikopterze = wsiadasz jako pasażer; T albo Enter = czat.
- Postęp (pozycja) zapisuje serwer w `server/data/players.json` po nicku.
- Test obciążenia: `npm run bots` (8–64 botów), wyniki: [`docs/RAPORT-MULTIPLAYER.md`](docs/RAPORT-MULTIPLAYER.md).

## Żywe miasto (etap 3)

Komunikacja miejska wg prawdziwych rozkładów (GTFS), samoloty na prawdziwych pasach, ruch uliczny z kierowcami NPC.
Opis i plan mieszkańców z cyklem dnia: [`docs/ARCHITEKTURA-SWIAT.md`](docs/ARCHITEKTURA-SWIAT.md).

```bash
curl -O https://mkuran.pl/gtfs/warsaw.zip -O https://mkuran.pl/gtfs/wkd.zip -O https://mkuran.pl/gtfs/polish_trains.zip
python3 tools/gtfs-build.py --city warszawa --feed warsaw.zip --feed wkd.zip --feed polish_trains.zip
curl -L -o london.zip https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/london/
python3 tools/gtfs-build.py --city londyn --feed london.zip --bus-radius 8000
python3 tools/airports.py --city warszawa --pbf Warsaw.osm.pbf
```

W grze: E przy stojącym autobusie, tramwaju, pociągu albo metrze = wsiadasz; E albo 1 na przystanku = wysiadasz.
W menu (gra jednoosobowa): godzina gry (np. szczyt 7:30, noc 2:00) i tempo czasu (×1–×300).

Przestępstwa i policja: E przy zatrzymanym aucie NPC = kradzież (★). Policja wyjeżdża z prawdziwych komisariatów,
policjanci wysiadają i zatrzymują (grzywna). HUD: zdrowie, pieniądze (bilety po prawdziwych cenach), gwiazdki.
Śmierć = odrodzenie przy szpitalu. Szczegóły w [`docs/ARCHITEKTURA-SWIAT.md`](docs/ARCHITEKTURA-SWIAT.md#zasady-gry-policja-zdrowie-pieniądze-sharedsrcgamerulests-sharedsrctrafficpolicets).

Okna i wnętrza: okna na fasadach (nocą część się świeci), do budynków mieszkalnych i sklepów z OSM można wejść drzwiami od ulicy
(klatki schodowe, mieszkania, sklepy sieciowe w prawdziwych miejscach). E przy szafie, lodówce, kasie = przeszukanie (kasa = napad).
Opis i 9 szablonów: [`docs/ARCHITEKTURA-SWIAT.md`](docs/ARCHITEKTURA-SWIAT.md#wnętrza-budynków-sharedsrcinteriors), plany: `docs/wnetrza/plany.png`.

## Uruchomienie dla programisty

```bash
npm install
npm run dev            # gra: http://localhost:5173
npm test               # testy jednostkowe (shared)
npm run test:e2e       # test dymny w Playwright
npm run typecheck
npm run sim:headless -- warszawa 8 10   # symulacja w Node.js bez przeglądarki
```

## Dane miasta (etap 2)

```bash
npm run fetch-osm -- --city warszawa                 # kafelki OSM 2 km wokół środka (Overpass API)
npm run fetch-osm -- --city warszawa --radius 4000   # większy obszar
npm run fetch-osm -- --city warszawa --area metro    # cały obszar metra (długo, setki zapytań)
npm run update-stations -- --city warszawa           # prawdziwe pozycje stacji i wejść w data/cities.json
npm run fetch-dem -- --city warszawa                 # model terenu (Copernicus DEM, AWS Open Data)
npm run build-tiles -- --in mapa.json                # kafelki z własnego pliku (Overpass JSON / GeoJSON)
```

**Bez dostępu do Overpass (wycinek PBF, tak zbudowano kafle w repo):**

```bash
pip install osmium
curl -O https://download.bbbike.org/osm/bbbike/Warsaw/Warsaw.osm.pbf          # albo London, albo Geofabrik
python3 tools/pbf-extract.py --city warszawa --pbf Warsaw.osm.pbf              # paczki 1 km w .cache/osm/warszawa
npm run fetch-osm -- --city warszawa --offline --area metro                      # kafle z paczek, bez sieci
npm run update-stations -- --city warszawa --from .cache/osm/warszawa/stations.json
```

**Wrocław (główna mapa, bez metra)** – obszar z pola `area` w `data/cities.json` (od Leśnicy do Długołęki, od Szymanowa
do Suchego Dworu i Siechnicy), wycinek BBBike Wroclaw:

```bash
curl -o .cache/pbf/Wroclaw.osm.pbf https://download.bbbike.org/osm/bbbike/Wroclaw/Wroclaw.osm.pbf
python3 tools/pbf-extract.py --city wroclaw --pbf .cache/pbf/Wroclaw.osm.pbf
npx tsx tools/fetch-osm.ts --city wroclaw --offline --area bbox     # kafle -> potem przenieś do tiles-pelne/wroclaw
npx tsx tools/simplify-tiles.ts --city wroclaw
npm run fetch-dem -- --city wroclaw
python3 tools/airports.py --city wroclaw --pbf .cache/pbf/Wroclaw.osm.pbf
# rozkłady MPK (GTFS, portal Otwarty Wrocław: open-data.cui.wroclaw.pl/hdb/ft/6/ – najnowszy plik na górze listy)
python3 tools/gtfs-build.py --city wroclaw --feed .cache/gtfs/wroclaw_new.zip --pbf .cache/pbf/Wroclaw.osm.pbf   # --pbf: trasy dopasowane do dróg i torów z OSM (tools/lib/mapmatch.py)
```

Wrocław: 2519 kafli (22,5 × 27 km), budynki 208 tys. → 86 tys. po uproszczeniu, 21 MB. Start na płycie Rynku (pole `sp`).
Inne miasto na start: adres gry z `?miasto=warszawa` albo `?miasto=londyn`.

W repo: Warszawa – cały obszar metra (+1 km, 1230 kafli, 33 MB), Londyn – centrum w promieniu 6 km (576 kafli, 20 MB);
dane z wycinków BBBike z 14.11.2026. Pozycje stacji i wejść z OSM: Warszawa 38/41 (bez trzech stacji „w budowie”),
Londyn 266/268 (bez Amersham i Chesham, poza wycinkiem).

- Kafelki 500 × 500 m trafiają do `client/public/tiles/<miasto>/<x>_<y>.json.gz` (+ `index.json`), w metrach
  w projekcji miasta. Format: `shared/src/tiles/types.ts`. Surowe odpowiedzi Overpass są w `.cache/osm/` (poza gitem).
- `fetch-osm` pyta Overpass w paczkach 1 × 1 km, z pauzą (`--pause 3` s), ponawianiem z rosnącą pauzą i przechodzeniem
  na kolejny serwer. Własny serwer: `--server URL` albo zmienna `OVERPASS_URL`.
- Teren: `client/public/terrain/<miasto>.bin.gz` (siatka 30 m). Bez pliku świat jest płaski.
- Gra doładowuje kafelki wokół gracza (dalej dla helikoptera) i zwalnia dalekie; kolizje i minimapa działają na załadowanych.
- Dane: © współtwórcy OpenStreetMap (ODbL). Teren: Copernicus WorldDEM-30 © DLR e.V. 2010–2014 i © Airbus Defence
  and Space GmbH 2014–2018, udostępniony w ramach programu Copernicus przez UE i ESA.

## Struktura

```
shared/   wspólny kod klienta i serwera: bez three.js i bez DOM (sprawdza to test i tsconfig bez lib DOM)
  src/data/         dane miast (data/cities.json), projekcja, normalizacja nazw
  src/osm/          wspólny format obiektów OSM, parser JSON/GeoJSON, wysokości budynków
  src/world/        świat statyczny: kolizje z budynkami, regiony chodzenia, układ metra (World)
  src/sim/          symulacja: stały krok 60 Hz, byty, gracze, polecenia, zapis i odczyt
client/   przeglądarka (Vite + three.js 0.186)
  src/render/       scena, kamera, światła, siatka gruntu
  src/world/        bryły: podziemia (geometry.ts, metro.ts), powierzchnia, etykiety stacji
  src/player/       kamera (pierwsza osoba, pościgowa, kokpit), modele pojazdów
  src/input/        warstwa wejścia: klawiatura, mysz, dotyk -> akcje (bindings.ts to dane)
  src/ui/           HUD, minimapa
  src/game/         pętla gry, renderowanie bytów i innych graczy
server/   Node.js: serwer gry (WebSocket, lobby, zapis graczy), test z botami, symulacja bez przeglądarki
  shared/src/net/     protokół: wejście, migawki (kwantyzacja, maski zmian), komunikaty JSON
  shared/src/server/  pokój gry (Room): wspólny dla serwera i Workera gry jednoosobowej
  client/src/net/     sesja sieciowa (przewidywanie, korekta, interpolacja), transporty WebSocket i Worker
tools/    przetwarzanie danych miasta: fetch-osm, build-tiles, update-stations, fetch-dem
  shared/src/tiles/  format i budowa kafelków (wspólne dla skryptów i gry)
data/     dane metra i skrypt prep.py ze źródłami
legacy/   pierwotny prototyp (jeden plik HTML) jako punkt odniesienia
tests/    test dymny Playwright i plik OSM testowy
```

## Zasady

- Świat statyczny powstaje deterministycznie (ziarno = nazwa miasta + nazwa stacji), więc serwer i klienci
  mają identyczny świat bez przesyłania go przez sieć. Test sprawdza, że regiony metra są takie same jak w prototypie.
- Klient wysyła do symulacji tylko polecenia wejścia (`InputCmd`) i polecenia jednorazowe (`Command`), nigdy pozycje.
- Długie linie i trójkąty znikają blisko kamery na niektórych GPU: linie tniemy na odcinki do 20 m, tunele co 25 m.
- Scalamy geometrię: jeden mesh i jedne linie na podziemia i na zabudowę.
