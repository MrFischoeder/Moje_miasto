# Raport: test obciążenia serwera (boty)

Wygenerowany: 2026-11-20 18:44 UTC, `npm run bots` (12 s na scenariusz, po 3 s rozgrzewki).
Maszyna: linux, Node v22.23.5. Serwer w osobnym procesie, boty przez prawdziwe WebSockety na tym samym komputerze.
Świat: Warszawa z terenem, bez kafelków OSM (zablokowane pobieranie), więc kolizje z budynkami nie obciążają kroku.

Boty: 1/3 jeździ autem, 1/3 lata helikopterem, 1/3 chodzi; wejście 30 Hz jak prawdziwy klient.
„Rozproszeni” = każdy przy innej stacji; „skupieni” = wszyscy przy Świętokrzyskiej (najgorszy przypadek dla zarządzania zainteresowaniem).

| scenariusz | graczy | krok śr. [ms] | krok maks. [ms] | budżet kroku 33 ms | w dół [KB/s/gracza] | w górę [KB/s/gracza] | migawki/s | byty |
|---|---|---|---|---|---|---|---|---|
| rozproszeni | 8 | 0.26 | 1.5 | 0.8% | 0.6 | 0.4 | 15.1 | 14 |
| rozproszeni | 16 | 0.30 | 1.5 | 0.9% | 0.8 | 0.4 | 15.1 | 27 |
| rozproszeni | 32 | 0.51 | 14.1 | 1.5% | 1.3 | 0.4 | 15.1 | 54 |
| rozproszeni | 64 | 0.85 | 10.7 | 2.5% | 2.4 | 0.4 | 15.0 | 107 |
| skupieni | 8 | 0.17 | 1.6 | 0.5% | 3.7 | 0.4 | 15.0 | 14 |
| skupieni | 16 | 0.31 | 0.8 | 0.9% | 6.8 | 0.4 | 15.1 | 27 |
| skupieni | 32 | 0.66 | 2.7 | 2.0% | 13.6 | 0.4 | 15.1 | 54 |
| skupieni | 64 | 1.90 | 12.7 | 5.7% | 26.3 | 0.4 | 15.0 | 107 |

## Wnioski

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
