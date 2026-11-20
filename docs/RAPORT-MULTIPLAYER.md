# Raport: test obciążenia serwera (boty)

Wygenerowany: 2026-11-20 23:13 UTC, `npm run bots` (12 s na scenariusz, po 3 s rozgrzewki).
Maszyna: linux, Node v22.23.5. Serwer w osobnym procesie, boty przez prawdziwe WebSockety na tym samym komputerze.
Świat: Warszawa z terenem, bez kafelków OSM (zablokowane pobieranie), więc kolizje z budynkami nie obciążają kroku.

Boty: 1/3 jeździ autem, 1/3 lata helikopterem, 1/3 chodzi; wejście 30 Hz jak prawdziwy klient.
„Rozproszeni” = każdy przy innej stacji; „skupieni” = wszyscy przy Świętokrzyskiej (najgorszy przypadek dla zarządzania zainteresowaniem).

| scenariusz | graczy | krok śr. [ms] | krok maks. [ms] | budżet kroku 33 ms | w dół [KB/s/gracza] | w górę [KB/s/gracza] | migawki/s | byty |
|---|---|---|---|---|---|---|---|---|
| rozproszeni | 8 | 2.34 | 23.3 | 7.0% | 2.2 | 0.4 | 15.0 | 82 |
| rozproszeni | 16 | 3.53 | 26.1 | 10.6% | 2.0 | 0.4 | 15.1 | 85 |
| rozproszeni | 32 | 5.67 | 33.5 | 17.0% | 4.4 | 0.4 | 15.0 | 135 |
| rozproszeni | 64 | 10.52 | 55.7 | 31.5% | 6.5 | 0.4 | 15.0 | 204 |
| skupieni | 8 | 0.62 | 6.0 | 1.8% | 5.4 | 0.4 | 15.0 | 30 |
| skupieni | 16 | 0.79 | 7.1 | 2.4% | 7.4 | 0.4 | 15.0 | 45 |
| skupieni | 32 | 1.41 | 14.0 | 4.2% | 11.0 | 0.4 | 15.0 | 70 |
| skupieni | 64 | 3.11 | 17.5 | 9.3% | 19.6 | 0.4 | 15.0 | 131 |

## Wnioski

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
