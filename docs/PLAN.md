# Ustalenia i kolejka prac

Stan na 23.11.2026. Szczegóły planu rozwoju: specyfikacja użytkownika (sekcje 1–23) i odpowiedzi w rozmowie.

## Ustalenia
- Styl: prosty, low-poly (bez kupowania modeli; geometria z danych, proste modele kodem lub z pakietów CC0).
- Okna: sylwetki prawdziwych postaci widoczne z zewnątrz, możliwy strzał przez szybę (serwer liczy tor pocisku
  funkcją okien fasady), z wnętrza widać całe miasto. Bez fałszywych sylwetek.
- Multiplayer: rozważane wstrzymanie; furtka zostaje (symulacja w osobnym wątku, zmiany stanu tylko przez polecenia).
- Skupienie na Warszawie. Silnik do decyzji: przeglądarka (three.js, low-poly) albo Godot.
- Bez instalatora (ostrzeżenia SmartScreen): preferowana gra w przeglądarce, docelowo pod linkiem na VPS użytkownika.

## Kolejka (od najbliższych)
1. Etap wydajności:
   - [x] przełącznik wnętrz budynków (menu „Wydajność”, zapamiętany w przeglądarce)
   - [x] licznik wydajności (FPS, czasy części klatki, liczba rysowań i obiektów; klawisz P)
   - [x] suwaki: liczba aut i pieszych NPC (w szczycie, 0 = brak)
   - [ ] suwaki: zasięg ruchu; komunikacja: zasięg i liczba rysowanych pojazdów, rodzaje osobno
   - [ ] profile jakości (niski / średni / wysoki), rozdzielczość renderowania, zasięg widzenia
   - [ ] budowa kafli w osobnym wątku, instancje aut i pieszych, scalone warstwy, uproszczone dalsze kafle, minimapa z pamięci
2. Styl low-poly (rozpoczęty):
   - [x] oświetlenie słońcem i niebem wg pory dnia, kolory ziemi, terenów, wody
   - [x] budynki: kolory elewacji wg typu, dachy, okna z ramami (nocą zapalone), bez linii krawędzi
   - [x] ulice: asfalt, chodniki podniesione o krawężnik (15 cm), torowiska wyżej niż jezdnia (podsypka, podkłady, szyny; tramwaj na trawie)
   - [x] auta, radiowóz, helikopter, samoloty, postacie (skóra, koszula, spodnie), pojazdy komunikacji
   - [x] wnętrza: jasne ściany i podłogi
   - [x] drzewa (parki, lasy, cmentarze, szpalery wzdłuż ulic; liściaste, iglaste, topole), latarnie (OSM + co ~32 m, świecą nocą),
         ławki przy alejkach w parkach, wiaty przystanków z rozkładów; metro i pawilony w nowym stylu
   - [x] tabliczki z nazwami ulic na ścianach narożnych budynków przy skrzyżowaniach (zamiast napisów w powietrzu)
   - [x] światło latarni na terenie, jezdniach, chodnikach i ścianach (najbliższe 40 latarni, nocą)
   - [x] dachy wg stylu budynku (kamienice, domy, powojenne, bloki z wielkiej płyty, współczesne, biura, hale)
   - [ ] drzewa z OSM (`natural=tree`, szpalery) po ponownym pobraniu danych, kosze, słupki, znaki
   - [x] budowa kafli (z obiektami) w osobnym wątku: na wątku głównym zostaje składanie (typowo ~9 ms)
   - [x] uproszczona mapa Warszawy (kwartały, ujednolicone wysokości, bez drobnicy); pełne kafle w tiles-pelne/
   - [ ] krawężniki i torowiska także w fizyce (dziś tylko wygląd)
   - [x] teren z NMT 1 m (GUGiK): import, kafle terenu 2 m, wczytywanie w grze i na serwerach, gęstsza siatka gruntu i dróg
   - [ ] wgrać prawdziwe arkusze NMT Warszawy (dane od użytkownika) i sprawdzić w znanych punktach
3. Przeanalizować https://github.com/donmutti/city (podobny kierunek gry) przed dalszymi decyzjami o silniku i stylu.
4. Bramy przejazdowe na podwórka (OSM `tunnel=building_passage`, `covered=yes`, `entrance=*`, `barrier=gate`),
   uzupełnianie brakujących przejazdów do zamkniętych podwórek, wejścia do klatek od podwórka; test dojazdu w potoku danych.
5. Wdrożenie na VPS (po otrzymaniu danych serwera).
6. Dalej wg specyfikacji: LiDAR, zieleń, landmarki, szkoły, telefon, gospodarka, ludzie i pojazdy, NPC, walka, nieruchomości.
