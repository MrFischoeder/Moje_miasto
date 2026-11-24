# tools/

Przetwarzanie danych miasta, niezależne od silnika gry (wynik: JSON / binarne pliki w metrach w projekcji miasta).
Opis poleceń: README w katalogu głównym, sekcja „Dane miasta”.

- `fetch-osm.ts` – Overpass API -> kafelki `client/public/tiles/<miasto>/`
- `build-tiles.ts` – lokalny plik OSM (Overpass JSON / GeoJSON) -> kafelki
- `update-stations.ts` – prawdziwe pozycje stacji metra i wejść w `data/cities.json` (uruchamiać po `data/prep.py`)
- `fetch-dem.ts` – Copernicus DEM -> `client/public/terrain/<miasto>.bin.gz`
- `pbf-extract.py` – wycinek OSM PBF (BBBike / Geofabrik) -> paczki 1 km w `.cache/osm/<miasto>/` dla `fetch-osm --offline`

## Wnętrza: pokaz szablonów

```bash
npx tsx tools/pokaz-wnetrz.ts > docs/wnetrza/pokaz.json      # prawdziwe budynki dla każdego szablonu
npx tsx tools/plany-wnetrz.ts docs/wnetrza/pokaz.json docs/wnetrza/plany.html   # plany pięter (SVG)
```

## Teren bez NMT: Copernicus z maską OSM (tools/dem-refine.ts)

```bash
npm run fetch-dem -- --city wroclaw          # rastry Copernicus do .cache/dem
npx tsx tools/dem-refine.ts --city wroclaw   # model zgrubny 30 m + dokładne kafle 5 m przy wodzie i na Starym Mieście
```

Budynki i lasy z OSM są maskowane (teren pod nimi uzupełniany z otwartych miejsc), w gęstej zabudowie mocniejsze
odcięcie dachów, w parkach słabsze (wzgórza zostają). Szczyty z OSM (natural=peak z ele) są punktami kontrolnymi.
Rzeki i kanały: lustro wody z pomiaru nad wodą, co najmniej 2,5 m poniżej brzegu, skarpa przy linii brzegu.

## Teren z NMT (GUGiK, LiDAR, siatka 1 m)

Dokładny teren dla gry: kafle 500 m z wysokościami co 2 m (dokładność rzędu centymetrów) w `client/public/terrain/<miasto>/`.
Gra, lokalny serwer i serwer sieciowy dołączają je do kafli mapy; tam, gdzie ich nie ma, działa model zgrubny (Copernicus 30 m).

1. Pobierz arkusze NMT 1 m z Geoportalu (geoportal.gov.pl → Pobieranie danych → NMT; formaty ASC, XYZ albo GeoTIFF, układ PL-1992 / EPSG:2180)
   dla obszaru kafli Warszawy: PL-1992 E 627 149–642 736, N 474 433–495 433 (WGS84 52,121–52,307 N, 20,866–21,086 E), z zapasem.
2. Zaimportuj (rozpozna obie kolejności osi, przeliczy na układ gry, uzupełni luki modelem zgrubnym i odświeży model zgrubny z NMT):

```bash
npx tsx tools/nmt-import.ts --city warszawa --src /ścieżka/do/arkuszy --step 2
```

Opcje: `--step 1|2|2.5|4|5` (krok siatki w grze, domyślnie 2 m), `--min-cover 0.5` (najmniejsze pokrycie kafla danymi),
`--out katalog` i `--no-coarse` (zapis gdzie indziej, bez zmiany modelu zgrubnego; do prób).

## Uproszczona mapa (szybsza gra)

Gra i serwery czytają kafle z `client/public/tiles/<miasto>/`. Dla Warszawy to wersja uproszczona; pełne kafle są w
`client/public/tiles-pelne/<miasto>/` (po ponownym pobraniu danych z OSM zapisuj je tam i uruchom upraszczanie):

```bash
npx tsx tools/simplify-tiles.ts --city warszawa
```

Co robi: zostawia z prawdziwym kształtem ważne budynki (wysokie od 35 m, z nazwą, zabytki i świątynie, szkoły, szpitale,
dworce, budynki publiczne, duże powyżej 6000 m², sklepy z wnętrzami); pozostałe stykające się budynki łączy w bryły kwartałów
(wysokość: mediana, liczba kondygnacji w pasmach 1, 2, 3, 5, 8, 11, 14, 18, 24), usuwa drobnicę (poniżej 30 m², garaże,
komórki), wygładza obrysy (1,5 m), usuwa krótkie ślepe ścieżki i dojazdy oraz małe tereny, upraszcza linie dróg (węzły zostają).
Warszawa: budynki 127 tys. → 67 tys., wierzchołki budynków −59%, tereny −70%, dane 31,8 → 19,7 MB.
