# tools/

Przetwarzanie danych miasta, niezależne od silnika gry (wynik: JSON / binarne pliki w metrach w projekcji miasta).
Opis poleceń: README w katalogu głównym, sekcja „Dane miasta”.

- `fetch-osm.ts` – Overpass API -> kafelki `client/public/tiles/<miasto>/`
- `build-tiles.ts` – lokalny plik OSM (Overpass JSON / GeoJSON) -> kafelki
- `update-stations.ts` – prawdziwe pozycje stacji metra i wejść w `data/cities.json` (uruchamiać po `data/prep.py`)
- `fetch-dem.ts` – Copernicus DEM -> `client/public/terrain/<miasto>.bin.gz`
- `pbf-extract.py` – wycinek OSM PBF (BBBike / Geofabrik) -> paczki 1 km w `.cache/osm/<miasto>/` dla `fetch-osm --offline`
