# Ważne zadania na przyszłość

Lista zapisana na prośbę właściciela projektu (26.11.2026). **Jeszcze nie wykonywać.** Kiedy zaczniemy nowy etap pracy, najpierw przypomnieć te punkty i zapytać, od którego zacząć.

## 1. Drogi i ścieżki bez ślepych końców (ZROBIONE)

Jak najmniej ślepych uliczek, dróg i ścieżek prowadzących donikąd. Każda droga lub ścieżka powinna:

- **prowadzić do budynku:**
  - ścieżka lub chodnik kończy się drzwiami wejściowymi;
  - droga kończy się wjazdem na podwórko (brama przejazdowa);
- **albo łączyć się z inną drogą lub ścieżką**, tworząc sensowne pętle.

Uwagi z obecnego stanu:

- Po uproszczeniu ścieżek część z nich kończy się na trawie kilka metrów od chodnika. Wcześniej łączyły się ze ścieżką biegnącą wzdłuż ulicy, która została usunięta.
- Na zrzucie z ul. Krupniczej (x -376, z 180) widać wąskie przejście między budynkami, które kończy się ścianą.

## 2. Budynki wchodzące jeden w drugi i kolizje witryn

Na ul. Krupniczej (x -420, z 231) budynki się przenikają, a do tego nakładają się na nie witryny sklepów. Wygląda to źle.

Trzeba to uporządkować:

- budynki nie mogą na siebie nachodzić;
- witryny powstają tylko na wolnej, widocznej ścianie;
- całość ma być logiczna i wizualnie akceptowalna.

## 3. Usunąć wiszące w powietrzu tabliczki

Chodzi o tabliczki miejsc, które nie są używane w grze (np. „STX Next Krupnicza 13”, „Kancelaria Adwokacka…”).

Pętla dodająca je w `client/src/world/signs.ts` została usunięta w commicie `afcac576`. Do zrobienia:

- sprawdzić na serwerze, czy po odświeżeniu (wyczyszczeniu pamięci przeglądarki) już ich nie ma;
- jeśli nadal są, znaleźć inne źródło.

## 4. Kluby i bary w piwnicach

W gęstej zabudowie, zwłaszcza w Rynku:

- wejście do klubu lub baru wygląda jak zwykłe wejście do budynku, ale z dużym neonem (szyldem świetlnym);
- sam klub jest w podziemiu (piwnicy budynku), żeby nie kolidował ze schodami klatki.

## 5. Sklep na parterze, mieszkania od 1. piętra

Jeśli na parterze kamienicy jest sklep, a wejście do klatki jest obok lub z drugiej strony budynku:

- na parterze nie tworzymy mieszkań;
- mieszkania zaczynają się od 1. piętra.

## 6. Pasy dla pieszych w poprzek jezdni

Przejścia dla pieszych często generują się wzdłuż drogi zamiast w poprzek, co wygląda absurdalnie. Zebra ma zawsze przecinać jezdnię prostopadle do jej osi.

## 7. Przepisy ruchu drogowego

- ograniczenia prędkości;
- zatrzymywanie się na czerwonym świetle (i kara za przejazd na czerwonym);
- samochody NPC też przestrzegają tych zasad.

## 8. Realistyczne kolizje

- można zostać potrąconym przez samochód lub tramwaj;
- samochody zderzają się ze sobą;
- kierowcy NPC jeżdżą przez to ostrożniej.

## 9. Płynna jazda samochodów w pobliżu gracza

- samochody blisko gracza (w zasięgu wzroku) skręcają płynnie po łuku, bez nagłego obrotu o 90°;
- auta daleko (kilkaset metrów, poza zasięgiem wzroku) mogą zachowywać się w uproszczony sposób.

## 10. Ruch postaci i ekwipunek

- skakanie i podskakiwanie;
- podnoszenie przedmiotów;
- plecak do przechowywania rzeczy.

## 11. (Do rozważenia) Głód

Tryb głodu, na razie tylko jako pomysł.

## 12. Czat tylko w telefonie (ZROBIONE)

Usunąć przycisk „Czat” z ekranu gry. Gracze komunikują się w grze przez komunikator w swoim telefonie.

## 13. Nawigacja do wybranych miejsc

System punktów nawigacyjnych (waypointów) albo nawigacji, która prowadzi gracza do wybranej lokacji (np. z mapy w telefonie).

## 14. Chodniki na mostach

Przykład: most w ciągu ul. Bolesława Krzywoustego nad Widawą. Po jezdni mostu da się chodzić, ale po zejściu na chodnik postać spada z mostu. Chodniki mostów muszą mieć pomost tak samo jak jezdnia (fizyka i wygląd).

## 15. Bez rowów melioracyjnych (ZROBIONE)

Usunąć z mapy rowy melioracyjne (drobne cieki, ditch/drain). Nie wnoszą wiele do wyglądu, a psują teren.

## 16. Nabrzeża rzek – ważny etap

Nabrzeża nadal wyglądają źle i są popsute, a rzeki powodują najwięcej błędów na mapie. Uprościć je maksymalnie:

- tylko dwa rodzaje brzegu: **pionowy mur** (woda tuż pod nim) albo **równa skarpa** o nachyleniu najwyżej ok. 45°;
- brzeg wyrównany na całej długości, bez poszarpanych krawędzi, dziur i „babolców”;
- obiekty nad wodą (budynki, restauracje) stoją na właściwej wysokości (patrz punkt 22).

## 17. Wejście do sklepu przez drzwi w witrynie

- W fasadzie każdego sklepu są drzwi, przez które da się wejść do środka.
- Zakupy u kasjera tylko po wejściu do sklepu, nie sprzed witryny.

## 18. Płynność gry (zwłaszcza lot helikopterem na telefonie)

Lot helikopterem jest szarpany, szczególnie na telefonie. Zoptymalizować grę jak najlepiej, a w razie potrzeby zmienić sposób wyświetlania i generowania świata (np. wczytywanie kafli, poziomy szczegółów, rozkład pracy na klatki).

Trop z panelu wydajności (PC, 26.11): minimapa zajmuje 9–12 ms na klatkę, prawie tyle co całe rysowanie (10–18 ms). To pierwsze miejsce do optymalizacji.

## 19. Gładkie, ciągłe drogi i ścieżki

Drogi i chodniki powinny być ładnymi, gładkimi, ciągłymi pasami. Dziś miejscami nakładają się na siebie kawałki nawierzchni (kafle) z ostrymi krawędziami i schodkami (przykład: ul. Świętego Antoniego, x -373, z 91). Do zrobienia: jednolita siatka nawierzchni na łączeniach, zaokrąglone zakręty, bez zachodzących na siebie płatów.

## 20. Płoty posesji pod kątami prostymi

Płoty parceli (tools/lib/plots.ts) układają się dziś w przypadkowe wielokąty, przez co działki wyglądają nienaturalnie. Zasada:

- zwykle działka jest prostokątem lub ma kąty proste, wyrównane do ulicy i do domu;
- tylko niewielki odsetek działek może zachować nieregularny kształt (wielokąt, skośne boki), jak w rzeczywistości.

## 21. Puste bloki, do których da się zajrzeć

Bloki (np. przy ul. Pomorskiej, x -103, z -551) często renderują się tak, że brakuje części ścian albo stropów: widać przez nie niebo i pustą przestrzeń w środku. To nie jest pojedynczy przypadek. Każdy budynek ma być zamkniętą bryłą (ściany, dach, ściany przy przejazdach bramnych i przewiązkach).

## 22. Restauracja między mostami zapadnięta w ziemi

Restauracja nad Odrą między mostami (okolice x -80, z -547) jest wkopana w teren, widać tylko dachy. Budynki przy nabrzeżach muszą stać na poziomie terenu po obróbce brzegów (do zrobienia razem z punktem 16).
