# Żywe miasto: komunikacja, ruch, samoloty, mieszkańcy

## Zasada: dwa poziomy szczegółowości

| Poziom | Co | Gdzie liczone | Koszt |
|---|---|---|---|
| **Rozkład (zawsze, całe miasto)** | metro, tramwaje, autobusy, koleje, promy, kolejki, samoloty; w przyszłości mieszkańcy | funkcja czasu: `stan = f(rozkład, zegar)` u każdego klienta i na serwerze | zero symulacji, zero ruchu sieciowego |
| **Symulacja (tylko przy graczach)** | auta z kierowcami NPC, w przyszłości piesi | serwer, krok 30 Hz, w promieniu ok. 480 m od każdego gracza | proporcjonalny do liczby graczy |

Dzięki temu pociąg metra, który pojechał na Kabaty, nadal „jedzie” i wróci zgodnie z rozkładem, choć nikt go nie
symuluje krok po kroku: jego położenie w dowolnej chwili wylicza się z rozkładu (`shared/src/transit/timetable.ts`).
Wszyscy gracze widzą te same pojazdy, bo liczą je z tego samego rozkładu i zegara sesji (serwer wysyła tylko czas).

## Komunikacja miejska (prawdziwe rozkłady)

- Dane: GTFS. Warszawa: ZTM (metro, tramwaje, autobusy, SKM), Koleje Mazowieckie, WKD, PKP Intercity (mkuran.pl/gtfs).
  Londyn: Bus Open Data Service (DfT): metro, DLR, Overground, Elizabeth line, tramwaje, autobusy, promy, kolejka linowa.
- `tools/gtfs-build.py` zamienia GTFS na plik gry: trzy typy dnia (dzień powszedni, sobota, niedziela) wzięte
  z prawdziwych dat rozkładu, wzorce tras z kształtem w metrach, profile czasów i godziny startu kursów.
- Ruch pojazdu: postój na przystanku, rozruch, jazda, hamowanie (profil trapezowy); kursy po północy (czasy GTFS > 24:00).
- Metro jedzie po tunelach i halach gry, właściwym torem (prawostronnie w Warszawie, lewostronnie w Londynie).
- Wsiadanie: E przy pojeździe stojącym na przystanku (w metrze z całego peronu). Wysiadanie: E lub 1 tylko na przystanku.
  Serwer pilnuje, kto czym jedzie; pozycję pasażera liczy z rozkładu.
- Odświeżenie rozkładów: pobrać nowe GTFS i uruchomić `gtfs-build.py` (polecenia w README).

## Samoloty

- Pasy startowe i lotniska z OSM (`tools/airports.py`): Chopin, Heathrow, London City i mniejsze.
- Prawdziwe rozkłady lotów nie są otwartymi danymi, więc rozkład jest powtarzalny (ziarno = lotnisko + data)
  z natężeniem zależnym od lotniska i godziny (cisza nocna). Podejście po ścieżce 3°, przyziemienie, dobieg;
  start: ustawienie, rozbieg, wznoszenie. Heathrow: osobne pasy do lądowań i startów, zamiana o 15:00.

## Ruch uliczny

- Graf pasów z kafli OSM (`shared/src/traffic/graph.ts`), budowany przyrostowo przy doładowaniu kafli.
- Auta z kierowcami NPC (model IDM): odstęp, hamowanie, zatrzymanie na czerwonym (prawdziwe sygnalizatory z OSM,
  cykl 60 s, dwie grupy kierunków), hamowanie przed graczami. Natężenie wg godziny (szczyty 7–9 i 15–18).
- **Pojazdy jeżdżą tylko z kierowcą:** auto NPC zawsze ma kierowcę; zaparkowane auta stoją, dopóki ktoś nie usiądzie za kierownicą.
- **Przejęcie auta:** auto NPC hamuje przed graczem; E przy stojącym aucie (do 2 m/s) wyrzuca kierowcę, który ucieka
  chodnikiem, a gracz siada za kierownicą. Auto przestaje należeć do ruchu ulicznego; inni gracze mogą się dosiąść (E).

## Piesi NPC

- Chodniki po obu stronach ulic (z tagów OSM `sidewalk`, a przy ulicach miejskich domyślnie), ścieżki, deptaki i schody
  z kafli OSM (`shared/src/traffic/peds.ts`). Na węzłach wybierają dalszą drogę, także przejście na drugą stronę.
- Wokół każdego gracza do 50 pieszych (zależnie od godziny), pojawiają się i znikają poza zasięgiem wzroku. Auta hamują przed nimi.
- Dziś piesi chodzą losowo; po dodaniu mieszkańców (niżej) będą to konkretne osoby wykonujące swój plan dnia.

## Mieszkańcy z cyklem dnia (plan)

Ten sam model dwóch poziomów:
1. **Populacja jako rozkład:** dla każdego budynku mieszkalnego (OSM: `building=apartments|house|...`, piętra, powierzchnia)
   szacowana liczba mieszkańców; każdy mieszkaniec ma deterministyczny plan dnia z ziarna `id budynku + nr osoby + data`:
   dom → (praca/szkoła: biura, szkoły, sklepy z OSM) → zakupy/rozrywka → dom, z godzinami zależnymi od typu dnia.
   Środek transportu wybierany z odległości: pieszo, komunikacja (trasa z rozkładu), auto.
2. **Plan jest funkcją czasu**, tak jak kurs komunikacji: w dowolnej chwili wiadomo, gdzie dana osoba jest
   (w domu, w drodze, w pracy). Nic nie jest symulowane daleko od graczy.
3. **Przy graczach plan zamienia się w symulację:** osoby w drodze w promieniu kilkuset metrów stają się pieszymi
   NPC na chodnikach i przejściach, pasażerami pojazdów komunikacji albo kierowcami aut z ruchu ulicznego;
   osoby „w budynku” pojawiają się we wnętrzach (etap wnętrz). Po oddaleniu gracza wracają do planu.
4. Natężenie ruchu ulicznego i obłożenie pojazdów komunikacji będzie wynikać z planów mieszkańców zamiast z krzywej godzinowej.

## Zasady gry: policja, zdrowie, pieniądze (`shared/src/game/rules.ts`, `shared/src/traffic/police.ts`)

Wszystko liczy serwer (autorytatywnie); klient dostaje tylko swój stan (`me`: zdrowie, pieniądze, gwiazdki) i komunikaty (`event`).

- **Poziom poszukiwania 0–5 ★.** Kradzież auta +1, kradzież radiowozu +2, potrącenie pieszego +1, policjanta +2, innego gracza +1.
  Gwiazdki spadają o jedną, gdy żaden policjant nie widzi gracza (150 m) przez 30 s + 10 s × poziom.
- **Policja.** Liczba radiowozów zależy od gwiazdek (1, 2, 3, 4, 6). Radiowóz wyjeżdża z najbliższego komisariatu z OSM
  (do 700 m), inaczej ze skrzyżowania 180–320 m od gracza; jedzie grafem ulic, zwalnia przed zakrętami, cofa, gdy utknie.
  Przy stojącym celu policjanci wysiadają i biegną; zatrzymanie po 1,6 s w zasięgu 1,8 m. Kradzież radiowozu jest możliwa.
- **Zatrzymanie:** grzywna (100 zł / £50 albo 10% gotówki, jeśli więcej), gwiazdki zerowane, wypuszczenie przy komisariacie.
- **Zdrowie 0–100:** zderzenia aut (powyżej 12 m/s), potrącenia; regeneracja po 8 s bez obrażeń.
  Śmierć: utrata 100 zł / £50, po 4 s odrodzenie przy najbliższym szpitalu z OSM.
- **Pieniądze:** start 500 zł / £500, prawdziwa cena biletu jednorazowego (Warszawa 4,40 zł, Londyn £1,75) pobierana przy wsiadaniu;
  bez pieniędzy jazda na gapę. Stan zapisywany na serwerze razem z pozycją.

## Okna na budynkach (`shared/src/interiors/facade.ts`, `client/src/world/tiles/windows.ts`)

- Typologia budynku z danych OSM (`building=*`, liczba kondygnacji, wysokość, kształt obrysu, miasto) wyznacza wysokość kondygnacji,
  podniesiony parter (blok: 1 m, kamienica: 0,5 m) i siatkę okien: rozstaw, szerokość, wysokość, parapet (blok, kamienica, budynek
  korytarzowy, szeregowiec, sklep, biurowiec, hale bez okien).
- Okna rysuje shader ścian (bez dodatkowej geometrii): ramki w kolorze fosforu, szyby, wygaszanie siatki w oddali (bez migotania).
- Nocą część okien świeci: odsetek zależy od godziny gry (wieczorem ok. 60%, w nocy ok. 6%), które okna to stałe ziarno budynku.
- Ta sama funkcja `windowSlots` wycina okna we wnętrzach, więc okna z zewnątrz i od środka są w tych samych miejscach.

## Wnętrza budynków (`shared/src/interiors/`)

Pokaz 9 szablonów na prawdziwych budynkach: `docs/wnetrza/plany.png` (plany pięter), `docs/wnetrza/plany.html`.

- **Dane, nie kod:** `data/szablony.json` (szablony lokali i parametry typologii), `data/meble.json` (meble wg rodzaju pomieszczenia),
  `data/lupy.json` (tabele łupów), `data/sieci.json` (sieci sklepów: archetyp wnętrza, kolor akcentu).
- **Szablon** to drzewo podziałów prostokąta: części o wymiarach z zakresów albo elastyczne, warianty (`pick`, np. kuchnia z oknem
  albo ślepa), te same wymiary na wszystkich piętrach domu (`key`), odbicie lustrzane. Drzwi z listy szablonu, a gdy któreś
  pomieszczenie zostaje odcięte, dokładane są brakujące drzwi; wejście tylko w dozwolonym odcinku ściany (np. przy podeście klatki).
- **Szablony na start (9):** M-2 i M-3 w bloku, mieszkanie w kamienicy (amfilada, służbówka); terraced house (2 piętra, schody),
  new-build flat (otwarta kuchnia), council flat (2 sypialnie); sklep osiedlowy (typ Żabki), convenience UK (typ Tesco Express),
  dyskont/supermarket (typ Lidla, Biedronki).
- **Typologie budynku** (plan w `plan.ts`): układ lokalny z frontem od ulicy (bliżej drogi, nie zasłonięty innym budynkiem),
  największy prostokąt wpisany w obrys (z dziedzińcami), potem:
  - *blok*: klatki schodowe na całą głębokość, 2 mieszkania na piętro, wysoki parter, schody dwubiegowe z podestem przy oknie;
  - *kamienica*: szersza klatka, duże mieszkania, wysokie sufity;
  - *budynek korytarzowy* (apartamentowiec, council block, new-build): klatki na końcach, korytarz środkiem, hol wejściowy;
  - *szeregowiec*: dzielenie frontu na domy 4,5–6 m, każdy z własnym wejściem i schodami (płytkie domy: jeden poziom);
  - *sklep*: prawdziwe punkty `shop=convenience|supermarket|discount` z OSM; sklep zajmuje parter (lokal przy punkcie albo cały budynek),
    szablon z konfiguracji sieci, nazwa na szyldzie wg `BRANDING`.
- **Ziarno:** id budynku z OSM + numer lokalu + piętro. Serwer i każdy klient składają identyczne wnętrza; przez sieć nic nie idzie.
- **Leniwie, w prawdziwym miejscu:** plan powstaje, gdy gracz jest w promieniu 45 m; parter zawsze, piętra wokół gracza w budynku
  (±1, trzymane ±2). Po odejściu (70 m) wszystko jest zwalniane. Budżet 4 ms na synchronizację (serwer co 1/3 s, klient co 0,3 s).
- **Fizyka:** pomieszczenia, drzwi, biegi schodów to regiony chodzenia (jak hale metra), meble to przeszkody; ściany wynikają z braku
  regionu. Z zewnątrz bryła budynku zostaje bez zmian; w ścianie budynku shader wycina otwór drzwi wejściowych.
- **Przeszukiwanie (serwer):** E przy pojemniku (szafa, komoda, lodówka, biurko, sejf, kasa...) losuje łup z tabeli (ziarno pojemnika),
  odnowienie po 15 min. Kasa w sklepie = napad (2 gwiazdki), sejf = włamanie, półka = kradzież sklepowa.
- **Test dostępności** (`reach.ts`, testy jednostkowe): przeszukanie wszerz fizyką chodzenia od drzwi na ulicy; każde pomieszczenie
  parteru i dwóch pięter ma być osiągalne. Lokal, do którego nie da się wejść z ulicy (np. front zasłonięty innym budynkiem), jest zamknięty.
- **Jeszcze nie ma:** wind, piwnic, dachów, biur, domów jednorodzinnych w Warszawie, zamkniętych drzwi i wytrychów, mieszkańców we wnętrzach.
