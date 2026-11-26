# Ważne zadania na przyszłość

Lista zapisana na prośbę właściciela projektu (26.11.2026). **Jeszcze nie wykonywać.** Kiedy zaczniemy nowy etap pracy, najpierw przypomnieć te punkty i zapytać, od którego zacząć.

## 1. Drogi i ścieżki bez ślepych końców

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
