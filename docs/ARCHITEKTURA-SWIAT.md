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
- **Pojazdy jeżdżą tylko z kierowcą:** auto NPC zawsze ma kierowcę, do takich aut nie da się wsiąść;
  zaparkowane auta graczy stoją, dopóki ktoś nie usiądzie za kierownicą.

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
