# Moje miasto

Gra z otwartym światem w prawdziwych miastach (Warszawa, Londyn), w wektorowym stylu terminala CRT.
Założenia i plan etapów: [`docs/PROMPT_CLAUDE_CODE.md`](docs/PROMPT_CLAUDE_CODE.md).

## Jak zagrać

**Bez instalacji:** pobierz `moje-miasto.html` i otwórz go dwuklikiem w Chrome, Edge albo Firefoksie.
Cała gra jest w tym jednym pliku i działa bez internetu. Świeży plik buduje się sam po każdym pushu:
GitHub → zakładka **Actions** → ostatni przebieg „Build” → **Artifacts** → `moje-miasto`.

Lokalnie zbudujesz go poleceniem `npm run build:single` (wynik: `dist-single/moje-miasto.html`).

## Uruchomienie dla programisty

```bash
npm install
npm run dev            # gra: http://localhost:5173
npm test               # testy jednostkowe (shared)
npm run test:e2e       # test dymny w Playwright
npm run typecheck
npm run sim:headless -- warszawa 8 10   # symulacja w Node.js bez przeglądarki
```

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
  src/game/         pętla gry, sesja (LocalSession; później Worker i WebSocket)
server/   Node.js: na razie symulacja bez przeglądarki (headless.ts)
tools/    przetwarzanie danych miasta (etap 2)
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
