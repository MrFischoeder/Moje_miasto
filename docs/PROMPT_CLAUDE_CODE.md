# Gra w stylu GTA w prawdziwych miastach: przeniesienie prototypu „Miasto i metro FPP” do Claude Code

## Cel całego projektu (najważniejsze)

Docelowo budujemy **grę z otwartym światem w stylu GTA**, osadzoną w prawdziwych miastach (najpierw Warszawa i Londyn). Założenia:

- **Grafika celowo uproszczona** (wektorowe krawędzie, płaskie wypełnienia, styl terminala CRT). Nie inwestujemy w realistyczną grafikę.
- **Wysiłek idzie w dwie rzeczy:**
  1. **Mechanikę gry** jak w GTA: chodzenie, prowadzenie i kradzież pojazdów, ruch uliczny i piesi, misje, policja i poziom poszukiwania, pieniądze, sklepy, wnętrza, metro, pora dnia.
  2. **Realizm miast:** układ ulic, budynki z prawdziwymi wysokościami i kształtami, prawdziwe stacje i wejścia do metra, parki, woda, mosty, pasy ruchu, chodniki, przejścia, sygnalizacja, nazwy ulic i sklepów z OpenStreetMap. Gracz, który zna Warszawę, ma rozpoznać swoją ulicę.
- Nie kopiujemy niczego z GTA (nazw, postaci, grafik, muzyki); to tylko wzorzec gatunku.

Każdą decyzję architektoniczną podejmuj pod ten cel: świat musi się dać **strumieniować** (całe miasto nie zmieści się w pamięci naraz), symulacja musi obsłużyć **wiele bytów naraz** (auta, piesi, pociągi), a dane miasta mają pochodzić **automatycznie z OSM**, nie z ręcznego modelowania.

**Silnik:** zostajemy przy przeglądarce i three.js, bo prototyp już działa, a grafika jest prosta. Jeśli w trakcie uznasz, że wydajność symulacji wymaga zmiany (np. Web Workers, WebGPU, a w ostateczności Godot), najpierw przedstaw mi argumenty, zanim cokolwiek przepiszesz. Przetwarzanie danych miasta (`tools/`) pisz tak, żeby nie zależało od silnika (wynik to pliki JSON / binarne w metrach).

## Multiplayer (wymóg od pierwszego dnia)

Gra będzie **wieloosobowa**. Minimum to **8 graczy** w jednym mieście. Docelowy maksymalny rozmiar jeszcze nie jest ustalony (możliwe nawet **64**). Projektuj tak, żeby przejście z 8 do 32–64 wymagało strojenia, nie przepisywania.

Założenia architektury:
- **Serwer autorytatywny** (Node.js + TypeScript, wspólny kod symulacji z klientem). Serwer decyduje o pozycjach pojazdów, NPC, kolizjach, pieniądzach i misjach. Klient wysyła tylko **polecenia wejścia** (np. gaz, skręt, „wsiądź”), nigdy gotowe pozycje. To chroni też przed oszukiwaniem.
- **Transport:** WebSocket na start (prosto i wszędzie działa). Warstwę sieciową oddziel interfejsem, żeby później dało się przejść na WebTransport / UDP-podobny kanał bez ruszania gry.
- **Stały krok symulacji** po stronie serwera (np. 30 Hz) i ten sam kod kroku na kliencie: **przewidywanie** ruchu własnej postaci lub pojazdu, korekta po odpowiedzi serwera, **interpolacja** cudzych bytów.
- **Świat statyczny nie leci przez sieć.** Budynki, ulice i metro powstają u każdego z tych samych plików kafelków i z tych samych ziaren losowości, więc serwer i klienci mają identyczny świat. Przesyła się tylko stan dynamiczny.
- **Zarządzanie zainteresowaniem:** każdy gracz dostaje tylko byty z kafelków wokół siebie (siatka kafelków i tak istnieje). Ruch uliczny i piesi są symulowani na serwerze tylko tam, gdzie jest jakiś gracz. To jest klucz do skalowania z 8 do 64.
- **Kompaktowe wiadomości:** binarne (np. pozycje jako liczby całkowite w centymetrach, kąty skwantowane), tylko zmiany względem ostatniego potwierdzonego stanu.
- **Sesje:** lobby / lista serwerów, sesja to jedno miasto. Gra jednoosobowa = lokalnie uruchomiony serwer w tym samym procesie (Web Worker), żeby nie utrzymywać dwóch ścieżek kodu.
- Na razie bez kont i bazy danych; postęp gracza zapisuje serwer w pliku. Konta i trwały świat później.
- Wydajność serwera mierz od początku: skrypt z botami symulującymi 8, 16, 32 i 64 graczy jeżdżących po mieście, raport czasu kroku i przepustowości na gracza.

## Wnętrza budynków (system do zaprojektowania w etapie 3)

Gracz ma móc **wejść do budynku i go przeszukać**. Nie modelujemy wnętrz ręcznie ani nie generujemy każdego zupełnie inaczej. Założenie: **biblioteka kilkudziesięciu standardowych szablonów** (30–60 łącznie) plus **losowa zmienność w ramach szablonu**, oparte na **typowych wymiarach i układach dla danego kraju**. Mieszkanie w Londynie ma wyglądać jak brytyjskie, w Warszawie jak polskie.

### Typologie (punkt wyjścia; uzupełnij, jeśli znasz lepsze)
**Polska:**
- Blok z wielkiej płyty (lata 60.–80.): klatka schodowa pośrodku, 2–4 mieszkania na piętro, M-2 (ok. 25–38 m²), M-3 (ok. 38–50 m²), M-4 (ok. 50–65 m²). Wąski przedpokój, mała łazienka (często z osobnym WC), kuchnia ślepa albo z oknem, pokoje przechodnie lub nie. Wysokość pomieszczeń ok. 2,5–2,6 m. Piwnice i komórki lokatorskie, zsyp, winda w wyższych blokach.
- Kamienica (przedwojenna): wysokie sufity ok. 3,2–3,8 m, grube ściany, amfilada, duże pokoje, mieszkania od frontu większe, oficyna od podwórka-studni mniejsza, klatka główna i kuchenna.
- Nowy apartamentowiec (po 2000): korytarz z mieszkaniami po obu stronach, aneks kuchenny, garaż podziemny, wysokość ok. 2,6–2,8 m.
- Dom jednorodzinny „kostka” (PRL) i nowy dom na osiedlu.
- Lokale usługowe w parterach bloków i kamienic.

**Wielka Brytania:**
- Wiktoriański / edwardiański szeregowiec (terraced house): wąski front ok. 4,5–6 m, korytarz wzdłuż ściany, front room i back room (często połączone w through-lounge), kuchnia w tylnej przybudówce, schody na piętro z 2–3 sypialniami i łazienką. Wysokość ok. 2,6–3,0 m.
- Bliźniak z lat 30. (semi-detached): bay window, hall, lounge, dining room, kuchnia z tyłu.
- Komunalne bloki i wieżowce (council flats / tower blocks): korytarze galeriowe lub klatka z windami, mieszkania 1–3 bed.
- Mansion block (kamienica brytyjska) i przerobiony szeregowiec na mieszkania (conversion flats).
- Nowe mieszkania (new-build): małe, 1-bed ok. 45–55 m², open-plan kitchen/living, wysokość ok. 2,4–2,5 m.

**Sklepy i usługi:** patrz podsekcja „Sieci sklepów” niżej, plus generyczne lokale: apteka, kebab / takeaway, kawiarnia, pub (UK) i bar, bank, fryzjer, monopolowy, warsztat, kiosk.

### Sieci sklepów (prawdziwe lokalizacje, typowe układy)
Sklepy sieciowe mają stać **tam, gdzie naprawdę są**, i wyglądać w środku jak **typowy sklep danego formatu**. Źródło lokalizacji: OSM `shop=convenience|supermarket|discount|department_store` z tagami `brand=*`, `brand:wikidata=*`, `name=*`. Jeśli punkt sklepu leży w budynku, sklep zajmuje parter tego budynku (albo jego część przy wejściu). Duże sklepy często są osobnymi budynkami z parkingiem (`amenity=parking` obok).

Zbuduj to jako **archetypy formatów + konfigurację sieci** (dane, nie kod):

| Archetyp | Przykłady PL | Przykłady UK | Typowa powierzchnia sprzedaży (orientacyjnie) |
|---|---|---|---|
| mały convenience | Żabka | sklepik osiedlowy, corner shop | ok. 50–100 m² |
| convenience sieciowy | Carrefour Express, Lewiatan | Tesco Express, Sainsbury's Local, Co-op | ok. 150–300 m² |
| dyskont | Lidl, Biedronka, Aldi, Dino | Lidl, Aldi | ok. 800–1 500 m² |
| supermarket | Carrefour Market, Kaufland (mniejsze) | Tesco Metro / Superstore, Sainsbury's, Morrisons, Asda | ok. 1 500–4 000 m² |
| hipermarket | Auchan, Carrefour, Kaufland | Tesco Extra, Asda Supercentre | ok. 5 000–15 000 m² |

Cechy układów (z wiedzy ogólnej, do weryfikacji i dopracowania):
- **Żabka-podobny:** wejście z ulicy w parterze bloku lub kamienicy; lada z kasą tuż przy wejściu, ekspres do kawy i podgrzewacz z hot dogami przy kasie, nowe sklepy także z kasą samoobsługową; ściany z lodówkami (napoje, piwo, nabiał), 2–3 krótkie regały na środku, zaplecze z tyłu.
- **Tesco Express / Sainsbury's Local-podobny:** przy wejściu owoce, warzywa, kwiaty, gazety i meal deal; ściany z chłodziarkami; 4–6 alejek; kasy i kasy samoobsługowe przy wyjściu; alejka z alkoholem; zaplecze z rampą lub wejściem od tyłu.
- **Dyskont (Lidl, Biedronka):** wejście przez strefę pieczywa z piecami, potem owoce i warzywa; długie alejki z towarem na paletach i w kartonach; środkowe stoły lub alejka z promocjami non-food; chłodnie i zamrażarki wzdłuż ścian; rząd kas przy wyjściu; parking przed sklepem, rampa dostaw z tyłu.
- **Supermarket i hipermarket:** wiele działów (pieczywo, mięso i ryby na ladach, nabiał, mrożonki, chemia, alkohol, elektronika, odzież w hipermarkecie), dziesiątki alejek z oznaczeniami nad nimi, linia kas, punkt obsługi klienta, wózki, często galeria handlowa z mniejszymi lokalami i duży parking.

Każdy archetyp ma kilka szablonów (prostokąt, L, wąski głęboki lokal) i losowy dobór regałów i towaru w zakresach, tak jak mieszkania. Konfiguracja sieci określa: archetyp, kolory akcentów (wnętrze, szyld), domyślny układ działów i tabele łupów.

**Marki:** domyślnie szyld pokazuje nazwę z OSM jako zwykły tekst w stylu gry, **bez oryginalnych logotypów i grafik**. Dodaj w konfiguracji przełącznik `branding: "osm-name" | "parody" | "generic"`, żeby przed ewentualnym publicznym wydaniem dało się jednym ruchem przejść na nazwy-parodie (jak w GTA) albo nazwy generyczne. Same układy wnętrz wzorujemy na formatach, nie kopiujemy konkretnych materiałów sieci.

**Inne:** biuro (open space), klatki schodowe, piwnice, garaże podziemne, zaplecza sklepów, dachy z wyjściem.

### Jak to złożyć
1. **Dopasowanie typu do budynku z OSM:** `building=*` (apartments, house, terrace, semidetached_house, retail, commercial, office…), `building:levels`, powierzchnia i kształt obrysu, miasto (kraj), `start_date` / `building:architecture`, jeśli są, oraz punkty `shop=*` / `amenity=*` w parterze. Brak danych → heurystyka (np. długi wąski obrys w Londynie = szereg domów; duży prostokąt 10+ pięter w Warszawie = blok z płyty).
2. **Podział budynku:** obrys → rdzeń (klatka, winda) wg typologii → korytarz → podział reszty na lokale o szerokościach typowych dla kraju. Szeregowiec dzieli się wzdłuż frontu na osobne domy.
3. **Szablon lokalu:** zapisany w danych (JSON), nie w kodzie. Pomieszczenia jako prostokąty z **zakresami wymiarów**, drzwi, okna, połączenia, sloty na meble i pojemniki do przeszukania. Szablon się rozciąga lub przycina do przydzielonego miejsca w granicach swoich zakresów, może być odbity lustrzanie i obrócony.
4. **Zmienność:** z szablonu losuj wymiary w zakresach, wariant układu (np. kuchnia ślepa albo z oknem), zestaw mebli, kolory akcentów, otwarte i zamknięte drzwi, bałagan.
5. **Ziarno:** `id budynku z OSM + piętro + numer lokalu`. Każdy gracz w multiplayerze generuje u siebie identyczne wnętrze, nic nie leci przez sieć poza stanem dynamicznym (otwarte drzwi, przeszukane pojemniki, zabrane przedmioty).
6. **Wnętrza są w budynku, w prawdziwym miejscu** (bez ekranów ładowania). Generuj je leniwie: tylko budynek, w którym jest gracz, i najbliższe drzwi; piętra generują się przy wejściu na klatkę. Scalaj geometrię na lokal. Z zewnątrz budynek pozostaje prostą bryłą; okna mogą się świecić nocą.
7. **Spójność z fasadą (opcjonalnie, jeśli tanie):** drzwi wejściowe od strony ulicy, okna w fasadzie zgodne z oknami pomieszczeń.
8. **Przeszukiwanie:** pojemniki (szafy, szuflady, lodówka, biurko, sejf, kasa sklepowa) mają tabele łupów zależne od typu lokalu i dzielnicy. Łup i jego odnawianie liczy serwer. Na później: zamknięte drzwi i wytrychy, alarmy w sklepach, mieszkańcy i reakcja policji.
9. **Wydajność:** mierz koszt wygenerowania lokalu i całego bloku; cel to bez zauważalnej przycinki przy wejściu na klatkę (w razie potrzeby Web Worker).

Zacznij od małego zestawu: 3 szablony polskie (M-2, M-3 w bloku, mieszkanie w kamienicy), 3 brytyjskie (terraced house, new-build flat, council flat), 3 sklepy (mały convenience typu Żabka, convenience typu Tesco Express, dyskont typu Lidl) rozstawione w prawdziwych lokalizacjach z OSM, klatka schodowa każdej typologii. Pokaż mi je na budynku testowym, zanim rozbudujesz bibliotekę.

## Kontekst

Ten folder zawiera działający prototyp przeglądarkowej gry/symulatora: prawdziwe miasto (Warszawa, Londyn) jako wektorowy świat 3D w stylu retro-futurystycznego terminala CRT (czarne tło, fosforowa zieleń `#7dffb0`, krawędzie brył jako linie). Po mieście chodzi się w pierwszej osobie, jeździ samochodem i lata helikopterem. Pod miastem jest metro z prawdziwym układem stacji i połączeń oraz proceduralnie generowanymi peronami, tunelami i zejściami.

Prototyp powstał jako **jeden plik HTML** (`index.html`, ok. 60 KB) z three.js r128 ładowanym z CDN. Działa, ale dalej rozwijać go w jednym pliku będzie trudno. Twoje zadanie: przenieść go do porządnego projektu i rozbudować, **nie tracąc niczego, co już działa**.

Komunikuj się ze mną po polsku. Teksty w interfejsie gry też po polsku.

## Zawartość folderu

```
index.html            gotowy, działający prototyp (otwórz w przeglądarce, żeby zobaczyć stan wyjściowy)
template.html         to samo co index.html, ale z miejscem /*CITIES*/ na dane miast
data/cities.json      dane metra Warszawy i Londynu (format niżej)
data/prep.py          skrypt, który zbudował cities.json z plików w data/raw
data/raw/             źródła: london.stations.csv, london.lines.csv, london.connections.csv
                      (repo nicola/tubemaps, ok. 2016), wtube.xml (kolejność stacji Warszawy,
                      repo michal-josef-spacek/Map-Tube-Warsaw)
```

Budowanie obecnej wersji: `index.html = template.html` z `/*CITIES*/` zastąpionym zawartością `data/cities.json`.

## Co już działa (zachowaj wszystko)

### Powierzchnia
- Wczytywanie pliku z OpenStreetMap: `.osm` (XML), Overpass JSON (`out geom` albo `out body; >; out skel`), GeoJSON.
- Budynki: obrys wyciągnięty w górę (`ExtrudeGeometry`), wysokość z `height` / `building:height`, w drugiej kolejności `building:levels × 3,2 m` (+ `roof:levels × 2,5`). Bez tych tagów wysokość domyślna zależna od typu `building=*` (tabele `LOW` i `MID`). Obsługiwane `min_height` i `building:min_level`. Wszystkie budynki są scalone w jeden mesh (wypełnienie) i jeden `LineSegments` (krawędzie).
- Ulice (`highway=*`) to linie na gruncie.
- Kolizje pieszego i auta z obrysami budynków: siatka przestrzenna o komórkach 40 m i test punkt-w-wielokącie.
- Program rozpoznaje miasto po środku pliku (do 60 km od środka Warszawy lub Londynu).
- Jeśli plik zawiera stacje metra (`railway=station` + `station=subway` albo `public_transport=station` + `subway=yes`) z pasującą nazwą, stacja zostaje przesunięta na prawdziwe miejsce (do 900 m od pozycji przybliżonej). Nazwy są normalizowane: bez polskich znaków, bez słów „metro” i „station”.
- Wejścia `railway=subway_entrance` w promieniu 260 m od stacji stają się prawdziwymi zejściami: korytarz na poziomie peronu, potem schody do punktu wejścia.

### Metro (proceduralne, ziarno = nazwa miasta + nazwa stacji, więc zawsze takie samo)
- Projekcja: równoodległościowa wokół stałego środka miasta (`o` w danych), oś X na wschód, oś Z na południe, Y w górę, 1 jednostka = 1 m.
- Na każdej stacji jest osobna hala peronowa dla każdej linii. Oś hali biegnie od poprzedniego do następnego sąsiada na linii. Losowane są: długość 104–136 m, szerokość, wysokość, peron wyspowy (60%) albo boczne, rząd filarów, świetlówki, żółte krawędzie peronów, szyny.
- Głębokość zależy od linii (`d: [min,max]` w danych). Na stacjach przesiadkowych hale są przynajmniej 7 m pod sobą i łączy je pochylnia ze schodami.
- Tunel to rura o 8 bokach i promieniu 2,8 m, od końca jednej hali do końca hali sąsiada, z liniowo zmieniającą się wysokością. Ma pierścienie co 15 m, szyny i pas w kolorze linii.
- Zejścia z ulicy: 2 schodami prostopadle do hali (strona wybierana tak, żeby wylot nie trafił w budynek) albo prawdziwe wejścia z OSM. Na górze stoi pawilon (rama, świecący daszek), a w gruncie jest otwór (`Shape.holes`).
- Od hali odchodzi 0–2 korytarzy technicznych zakończonych **pustym lokalem** (pomarańczowe krawędzie). To przyszłe sklepy.
- Model chodzenia pod ziemią: lista „regionów” (pasów: początek, kierunek, długość, półszerokość, wysokość od y0 do y1). Gracz stoi na regionie, którego wysokość jest najbliższa jego obecnej (tolerancja 0,95 m), a regiony pochyłe (schody, pochylnie, tunele) mają pierwszeństwo. Powierzchnia (y = 0, poza budynkami) też jest takim podłożem. Brak podłoża oznacza ścianę.
- Bryły podziemi to jeden scalony mesh (`MeshBasicMaterial`, kolory wierzchołków, ściany jednostronne zwrócone do środka) i jeden `LineSegments` z kolorami wierzchołków.
- Etykiety z nazwami stacji (sprite z canvasu) tworzą się tylko w promieniu 350 m i są usuwane, gdy się oddalisz.

### Tryby ruchu
- **Pieszo:** WASD i mysz (pointer lock z zapasowym przeciąganiem), Shift to bieg, lekkie kołysanie kamery.
- **Samochód** (2/G): gaz, hamulec/wsteczny, skręt zależny od prędkości, hamulec ręczny na spacji, dopalacz na Shift. Kolizja to 6 punktów prostokąta auta. Kamera pościgowa albo z kokpitu (V).
- **Helikopter** (3/F): bezwładność, wznoszenie E/spacja, opuszczanie Q/Ctrl, przechyły, wirniki. Nie przelatuje przez budynki, ląduje na dachach (`bTop`).
- **Prześwietlenie** (X): grunt i budynki półprzezroczyste, widać sieć metra.
- **Telefon:** joystick po lewej, przeciąganie po prawej obraca kamerę, przyciski ▲▼ dla helikoptera.
- **Minimapa:** obracana razem z graczem, pokazuje budynki, ulice, tunele w kolorach linii, hale i lokale.
- **Menu:** wybór miasta, teleport na peron wybranej stacji albo na ulicę przy jej wejściu, wczytanie pliku OSM.

### Ważna pułapka techniczna (znaleziona w testach)
Bardzo długie linie i trójkąty (setki metrów i więcej) **znikały blisko kamery** przy renderowaniu (przycinanie na niektórych GPU / SwiftShader). Dlatego `line()` tnie każdą linię na odcinki do 20 m, tunele są cięte na odcinki po 25 m, a siatka gruntu to własny `LineSegments` z odcinkami po 20 m, który przesuwa się za graczem (zamiast `GridHelper`). Pilnuj tej zasady w nowym kodzie.

## Format `data/cities.json`

```json
{
  "warszawa": {
    "name": "Warszawa", "o": [lat, lon], "spawn": "Świętokrzyska", "note": "...",
    "lines": [{"n": "M1", "c": "#3b7ddd", "d": [10, 14]}],
    "st":    [["Kabaty", 52.1314, 21.0656]],
    "ed":    [[indeksStacjiA, indeksStacjiB, indeksLinii]]
  },
  "londyn": { ... }
}
```

Uwagi o danych:
- **Warszawa:** kolejność stacji jest prawdziwa. Współrzędne są **przybliżone (do ok. 150 m), wpisane ręcznie**. Lazurowa, Chrzanów i Karolin (M2) są oznaczone „(w budowie)”: budowę zakończono w listopadzie 2026, otwarcie zapowiadane na początek 2027.
- **Londyn:** dane z ok. 2016 roku plus dopisana Northern line do Nine Elms i Battersea Power Station. Pominięte są DLR i East London (dziś Overground). Nie ma Elizabeth line.

## Zadania (kolejność)

### Etap 1: przeniesienie bez zmian w zachowaniu
1. Załóż projekt Vite + three.js z npm (przypnij wersję; prototyp używał r128, możesz przejść na nowszą i poprawić zmienione API, np. `Float32BufferAttribute`, `EdgesGeometry` są dalej dostępne).
2. Rozbij kod na moduły, mniej więcej:
   - `src/data/` (ładowanie `cities.json`, projekcja),
   - `src/osm/` (parser OSM, wysokości budynków),
   - `src/world/surface.js` (budynki, ulice, grunt z otworami, siatka),
   - `src/world/metro/` (`stations.js` z halami, tunelami, zejściami i lokalami; `geometry.js` z `quad`, `line`, `shell`, `box`; `regions.js` z regionami chodzenia i siatką),
   - `src/player/` (`walk.js`, `car.js`, `heli.js`, `camera.js`),
   - `src/ui/` (HUD, menu, minimapa, sterowanie dotykowe),
   - `src/main.js`.
3. Zachowaj wygląd i sterowanie 1:1. Porównaj z `index.html`, otwierając oba obok siebie.
4. Dodaj prosty test dymny w Playwright: start, Warszawa, przejście peronem do tunelu (region `tunnel`), wyjście na ulicę, Londyn się ładuje, brak błędów w konsoli.

5. Przygotuj już teraz fundament pod grę, nawet jeśli nie dodajesz jeszcze nowych funkcji:
- pętla gry ze **stałym krokiem symulacji** (np. 60 Hz) oddzielonym od renderowania,
- prosty **system bytów** (gracz, pojazd, w przyszłości NPC i pociąg), żeby gracz mógł wsiadać do dowolnego pojazdu, a nie tylko do „swojego” auta,
- warstwa **wejścia** (klawiatura, mysz, dotyk, później pad) mapowana na akcje,
- stan gry gotowy do **zapisu i odczytu**.
- **symulacja całkowicie oddzielona od renderowania i UI** (osobny pakiet `shared/sim`, bez importów three.js i DOM), tak żeby ten sam kod uruchomił się na serwerze Node.js; struktura repo: `client/`, `server/`, `shared/`, `tools/`.

### Etap 2: automatyczne dane OSM (rzecz, której prototyp nie mógł zrobić)
6. Skrypt `tools/fetch-osm.(py|mjs)`, który przez Overpass API pobiera dla danego miasta i obszaru: budynki (`way` i `relation` multipolygon z `building` i `building:part`), ulice, stacje metra i wejścia. Zapisuje je **w kafelkach** (np. 500 × 500 m) jako skompresowany JSON w `public/tiles/<miasto>/<x>_<y>.json`, już w metrach w projekcji miasta. Szanuj limity Overpass (pauzy, ponawianie, możliwość ustawienia alternatywnego serwera).
7. W grze doładowuj kafelki wokół gracza (i dalej dla helikoptera), zwalniaj dalekie. Kolizje i minimapa mają działać na załadowanych kafelkach.
8. Dla Warszawy pobierz z OSM prawdziwe położenia wszystkich stacji metra i zaktualizuj `cities.json` (skrypt, nie ręcznie). To samo zrób dla Londynu, jeśli łatwo uzyskać aktualne połączenia; jeśli nie, zostaw stare dane i dopisz brakujące stacje.
9. Relacje multipolygon (dziedzińce kamienic) mają mieć dziury w bryłach.

### Etap 2b: realizm miasta z OSM
10. Budując kafelki, z danych OSM wyciągnij **graf drogowy**: jezdnie z liczbą pasów (`lanes`), kierunkiem (`oneway`), typem drogi, skrzyżowania, sygnalizację (`highway=traffic_signals`), przejścia dla pieszych, chodniki. Rysuj jezdnie jako pasy o realnej szerokości (nie linie), z liniami pasów.
11. Dodaj tereny: parki i zieleń, wodę (Wisła, Tamiza) z mostami na właściwej wysokości, tory tramwajowe i kolejowe, place.
12. Zbierz z OSM nazwy ulic (tabliczki na skrzyżowaniach), adresy oraz punkty `shop=*` i `amenity=*` przypisane do budynków (przyszłe wejścia do sklepów).
13. Teren: model wysokościowy (np. Copernicus DEM / SRTM) jako podłoże z wysokością, żeby skarpa wiślana w Warszawie była skarpą.

### Etap 2c: pierwszy multiplayer (przed rozbudową mechaniki)
14. Serwer Node.js z jednym miastem, dołączanie przez lobby, do 8 graczy: chodzenie, auto i helikopter z przewidywaniem po stronie klienta i interpolacją cudzych.
15. Widoczni inni gracze (wektorowa postać z kolorem gracza, nick nad głową), wsiadanie jako pasażer do cudzego auta.
16. Prosty czat tekstowy.
17. Test z botami (8 → 64) i krótki raport: gdzie jest wąskie gardło i co trzeba zmienić dla 64 graczy.

Każdą nową mechanikę z etapu 3 buduj od razu jako sieciową (autorytatywny serwer), nie najpierw jednoosobowo.

### Etap 3: mechanika gry (najpierw zapytaj mnie, od czego zacząć, i zaproponuj kolejność)
- **Ruch uliczny:** auta AI jadące grafem drogowym, z pasami, sygnalizacją i pierwszeństwem; piesi na chodnikach i przejściach. Gęstość ruchu zależna od pory dnia. Byty pojawiają się i znikają wokół gracza.
- **Pojazdy:** różne typy (osobowe, dostawcze, autobusy, tramwaje po prawdziwych torach, skutery), wsiadanie i kradzież, prostsza fizyka zderzeń.
- **Metro jako system:** pociągi kursujące po tunelach według rozkładu, wsiadanie i przejazd między stacjami.
- **Wnętrza budynków i sklepów:** wg sekcji „Wnętrza budynków” (szablony krajowe + losowa zmienność, wchodzenie i przeszukiwanie). Puste lokale pod stacjami metra też mają się stać sklepami.
- **Pętla rozgrywki:** pieniądze, misje (także wspólne dla kilku graczy), pościgi gracz kontra gracz, (dostawy, pościgi, przejazdy na czas), policja z poziomem poszukiwania, zdrowie, prosty HUD i mapa całego miasta.
- **Świat:** cykl dnia i nocy (oświetlone okna i latarnie w stylu wektorowym), pogoda.
- Zapis gry, ustawienia, wsparcie pada.

## Zasady
- Zachowaj estetykę: czerń, fosforowe krawędzie, kolory linii metra jako akcenty, czcionka Chakra Petch.
- Wydajność: scalaj geometrię (jeden mesh i jedne linie na kafelek lub stację), nie twórz tysięcy obiektów. Celuj w płynność także na telefonie.
- Proceduralne elementy zawsze mają ziarno, żeby świat był powtarzalny.
- Po każdym etapie krótko podsumuj po polsku, co zrobiłeś, co sprawdziłeś testem, a czego nie.
