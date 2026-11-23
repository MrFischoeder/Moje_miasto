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
   - [ ] licznik wydajności (FPS, czasy części klatki, liczba rysowań i obiektów)
   - [ ] suwaki: liczba aut, pieszych, zasięg ruchu; komunikacja: zasięg i liczba rysowanych pojazdów, rodzaje osobno
   - [ ] profile jakości (niski / średni / wysoki), rozdzielczość renderowania, zasięg widzenia
   - [ ] budowa kafli w osobnym wątku, instancje aut i pieszych, scalone warstwy, uproszczone dalsze kafle, minimapa z pamięci
2. Przeanalizować https://github.com/donmutti/city (podobny kierunek gry) przed dalszymi decyzjami o silniku i stylu.
3. Bramy przejazdowe na podwórka (OSM `tunnel=building_passage`, `covered=yes`, `entrance=*`, `barrier=gate`),
   uzupełnianie brakujących przejazdów do zamkniętych podwórek, wejścia do klatek od podwórka; test dojazdu w potoku danych.
4. Wdrożenie na VPS (po otrzymaniu danych serwera).
5. Dalej wg specyfikacji: LiDAR, zieleń, landmarki, szkoły, telefon, gospodarka, ludzie i pojazdy, NPC, walka, nieruchomości.
