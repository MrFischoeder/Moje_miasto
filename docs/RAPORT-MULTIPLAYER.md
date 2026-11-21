# Raport: test obciążenia serwera (boty)

Wygenerowany: 2026-11-21 09:16 UTC, `npm run bots` (12 s na scenariusz, po 3 s rozgrzewki).
Maszyna: linux, Node v22.23.5. Serwer w osobnym procesie, boty przez prawdziwe WebSockety na tym samym komputerze.
Świat: Warszawa z terenem, bez kafelków OSM (zablokowane pobieranie), więc kolizje z budynkami nie obciążają kroku.

Boty: 1/3 jeździ autem, 1/3 lata helikopterem, 1/3 chodzi; wejście 30 Hz jak prawdziwy klient.
„Rozproszeni” = każdy przy innej stacji; „skupieni” = wszyscy przy Świętokrzyskiej (najgorszy przypadek dla zarządzania zainteresowaniem).

| scenariusz | graczy | krok śr. [ms] | krok maks. [ms] | budżet kroku 33 ms | w dół [KB/s/gracza] | w górę [KB/s/gracza] | migawki/s | byty |
|---|---|---|---|---|---|---|---|---|
| rozproszeni | 8 | 5.12 | 52.6 | 15.4% | 10.0 | 0.4 | 15.0 | 428 |
| rozproszeni | 16 | 5.58 | 76.3 | 16.7% | 7.7 | 0.4 | 15.0 | 391 |
| rozproszeni | 32 | 8.32 | 57.5 | 25.0% | 11.3 | 0.4 | 15.0 | 545 |
| rozproszeni | 64 | 14.70 | 59.1 | 44.1% | 14.0 | 0.4 | 15.0 | 720 |
| skupieni | 8 | 1.87 | 26.4 | 5.6% | 24.6 | 0.4 | 15.0 | 130 |
| skupieni | 16 | 2.16 | 24.5 | 6.5% | 25.4 | 0.4 | 15.0 | 138 |
| skupieni | 32 | 3.30 | 32.9 | 9.9% | 29.5 | 0.4 | 15.0 | 171 |
| skupieni | 64 | 6.80 | 34.2 | 20.4% | 45.2 | 0.4 | 15.0 | 265 |

## Wnioski

**Wnętrza budynków (od wersji z wnętrzami):** serwer składa plany budynków w promieniu 45 m od każdego gracza i piętra wokół niego.
Pomiar z 21.11.2026 o porze szczytu (dużo aut NPC): przy 64 rozproszonych graczach krok średnio 14,7 ms z wnętrzami
i 12,4 ms bez nich (+2 ms), szczyty do ok. 60–75 ms (bez wnętrz ok. 40 ms) przy wejściu w nową okolicę. Pomogły: osobna siatka 8 m
dla regionów i mebli wnętrz, budżet 4 ms na synchronizację wnętrz, rzadsza siatka dla dużych obrysów, jedno sprawdzenie przejścia
w dużych sklepach. Dalej: składanie planów w osobnym wątku (Worker) albo z wyprzedzeniem na trasie gracza.
Uwaga: liczby w tabeli zależą od godziny (natężenie ruchu), porównuj pomiary z tej samej pory.

**Ruch uliczny (od wersji z autami NPC):** to on dominuje teraz koszt kroku: przy 64 rozproszonych graczach każdy ma wokół
siebie własny ruch (ok. 200 bytów razem), co daje ok. 4 ms średnio i do ~15 ms w szczytach (doładowanie kafli i grafu pasów).
Graf pasów jest przyrostowy (dokładane / usuwane tylko zmienione kafle). Komunikacja miejska i samoloty nic nie kosztują
serwera ani sieci: są funkcją rozkładu i zegara, liczoną u każdego klienta. Dalsze kroki dla ruchu: aktualizacja aut
dalej od graczy rzadziej (co 2.–3. krok), wspólne obszary ruchu dla graczy blisko siebie, siatka przestrzenna przeszkód.


**Do 64 graczy wystarczy jeden proces serwera.** Nawet w najgorszym przypadku (64 graczy w jednym miejscu) krok symulacji
zajmuje średnio ok. 2 ms z budżetu 33 ms (30 Hz); szczyty do ok. 10 ms to prawdopodobnie odśmiecanie pamięci w Node
i boty działające na tym samym komputerze (nie mierzyłem tego osobno). W grze rozproszonej po mieście koszt rośnie prawie liniowo.

**Wąskie gardło: przepustowość przy skupieniu graczy.** Gdy wszyscy są w jednym miejscu, każdy dostaje stan wszystkich
(zarządzanie zainteresowaniem nic nie odcina), więc ruch rośnie z kwadratem liczby graczy: przy 64 graczach ok. 26 KB/s
na gracza w dół (ok. 210 kbit/s, bez problemu na łączu domowym), ale ok. 1,7 MB/s (ok. 14 Mbit/s) wysyłane z serwera.
W górę każdy gracz wysyła stałe 0,4 KB/s (13 bajtów wejścia × 30 Hz).

Co już działa na korzyść skalowania:
- migawki 15 Hz, tylko zmienione pola (maska 16 bitów), pozycje w cm jako liczby całkowite, kąty int16;
- stojące byty nic nie kosztują (pusta maska = brak wpisu);
- zarządzanie zainteresowaniem w promieniu 1 km (helikopter 2,5 km); ruch uliczny i NPC będą symulowane tylko przy graczach;
- symulacja i świat statyczny są deterministyczne, więc budynki, ulice i metro nie idą przez sieć.

**Co zmienić, żeby 64 graczy (i ruch uliczny) było tanie:**
1. *Priorytety i częstotliwość według odległości*: byty dalej niż ~150 m wysyłać co 2.–4. migawkę, poza 500 m tylko pozycję
   (bez prędkości i przechyłów). Szacunkowo 3–4 × mniej danych w scenariuszu „skupieni”.
2. *Siatka przestrzenna do wyboru bytów* zamiast przeglądania wszystkich bytów dla każdego gracza (dziś O(gracze × byty));
   kafelki 500 m już istnieją, wystarczy indeks bytów po kafelku. Konieczne, gdy dojdą setki aut i pieszych NPC.
3. *Pozycje względem kafelka* (int16 w cm zamiast int32): −6 bajtów na pełny stan bytu.
4. *Kanał zawodny* (WebTransport datagramy) dla migawek: dziś różnice liczone są względem ostatnio wysłanego stanu, co jest
   poprawne tylko na uporządkowanym, niezawodnym WebSockecie. Przy datagramach trzeba liczyć różnice względem ostatniego
   stanu *potwierdzonego* przez klienta (numer migawki w wejściu). Warstwa transportu jest już oddzielona interfejsem.
5. *Osobny proces (worker_threads) na sesję*, gdy serwer ma obsługiwać wiele miast naraz.

Czego test nie mierzy: kolizji z budynkami z kafelków OSM (kafelków jeszcze nie ma; to kilka testów punkt-w-wielokącie
na auto na krok, mało), prawdziwych opóźnień sieci (localhost) i kosztu po stronie klienta.
