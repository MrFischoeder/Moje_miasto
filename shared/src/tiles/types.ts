// Format kafelka świata (500 × 500 m), w metrach w projekcji miasta (X na wschód, Z na południe).
// Płaskie tablice [x0, z0, x1, z1, ...] zaokrąglone do 0,1 m. Wersja formatu: TILE_VERSION.

export const TILE_VERSION = 1;
export const TILE_SIZE = 500;

export type Flat = number[];

export interface TileBuilding {
  id: number;
  /** obrys zewnętrzny */
  o: Flat;
  /** dziury (dziedzińce) */
  i?: Flat[];
  h: number; mh: number;
  /** building=* (apartments, house, ...) */
  t: string;
  lv?: number;
  /** część budynku (building:part) */
  part?: 1;
  /** adres „ulica numer” */
  a?: string;
  name?: string;
  /** wygląd z OSM (shared/osm/look.ts): kształt dachu, wysokość dachu [m], dach w poprzek, kolor dachu, kolor ścian, materiał ścian */
  rs?: string; rh?: number; ro?: 'across'; rc?: string; bc?: string; bm?: string;
  /** Wikidata (landmarki), zabytek */
  wd?: string; hist?: 1;
}

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'living' | 'pedestrian' | 'footway' | 'cycleway' | 'path' | 'steps' | 'track';

export interface TileRoad {
  id: number;
  p: Flat;
  k: RoadClass;
  /** szerokość jezdni [m] */
  w: number;
  /** liczba pasów (razem) */
  ln: number;
  /** 1 = jednokierunkowa zgodnie z kierunkiem rysowania, -1 = przeciwnie */
  ow?: 1 | -1;
  n?: string;
  /** most (warstwa) */
  br?: number;
  /**
   * most: końce całego ciągu mostu i położenie kawałka na nim:
   * [xA, zA, xB, zB, s (odległość od A pierwszego wierzchołka), kierunek (1 / -1), długość ciągu]
   * (wysokość pomostu = interpolacja terenu między końcami)
   */
  bw?: number[];
  /** tunel / przejście podziemne */
  tu?: 1;
  /** chodniki: 1 lewy, 2 prawy, 3 oba */
  sw?: number;
  /** węzły grafu: [indeks wierzchołka, id węzła OSM, ...] */
  j: number[];
}

export type AreaKind = 'park' | 'forest' | 'water' | 'parking' | 'square' | 'cemetery' | 'pitch';
export interface TileArea { id: number; k: AreaKind; o: Flat; i?: Flat[] }

export type RailKind = 'rail' | 'tram' | 'light_rail' | 'subway' | 'narrow_gauge';
export interface TileRail { id: number; k: RailKind; p: Flat; br?: number; bw?: number[] }

export type NodeKind = 'signals' | 'crossing' | 'stop' | 'give_way' | 'lamp' | 'tram_stop' | 'entrance' | 'station';
export interface TileNode {
  id: number; k: NodeKind; x: number; z: number;
  /** kierunek drogi w węźle (rad), np. dla pasów przejścia */
  d?: number;
  n?: string;
}

/** Węzeł grafu drogowego (skrzyżowanie, koniec drogi, granica kafelka). */
/** jn = skrzyżowanie (węzeł wspólny dla kilku dróg), sig = sygnalizacja, cr = przejście */
export interface GraphNode { id: number; x: number; z: number; jn?: 1; sig?: 1; cr?: 1 }

export interface TilePoi {
  id: number;
  /** shop | amenity | ... */
  c: string;
  /** wartość tagu (supermarket, convenience, pharmacy, ...) */
  t: string;
  x: number; z: number;
  n?: string; brand?: string; wd?: string;
  /** wysokość [m] (pomniki) */
  h?: number;
  /** budynek, w którym leży punkt */
  b?: number;
  a?: string;
}

export interface TileData {
  v: number; city: string; x: number; y: number; size: number;
  /** teren w wysokiej rozdzielczości dla tego kafla (dołączany przy wczytaniu, nie w pliku JSON) */
  dem?: import('../world/terrain').DemTile;
  b: TileBuilding[];
  r: TileRoad[];
  a: TileArea[];
  l: TileRail[];
  n: TileNode[];
  g: GraphNode[];
  poi: TilePoi[];
}

export interface TileIndex {
  v: number; city: string; size: number;
  /** [x, y, bajty] */
  tiles: [number, number, number][];
  generated: string;
  source: string;
}

export const tileKey = (x: number, y: number) => x + '_' + y;
export const tileOf = (x: number, z: number): [number, number] => [Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)];
