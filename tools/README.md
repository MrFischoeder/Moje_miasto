# tools/

Przetwarzanie danych miasta, niezależne od silnika gry. Wynik to pliki JSON / binarne w metrach
w projekcji miasta (`shared/src/data/projection.ts`).

Plan (etap 2): `fetch-osm.mjs` pobierający z Overpass API budynki, ulice, stacje i wejścia metra
i zapisujący je w kafelkach `public/tiles/<miasto>/<x>_<y>.json`.

Dane metra (`data/cities.json`) buduje na razie `data/prep.py` (uruchamiany z katalogu `data/`).
