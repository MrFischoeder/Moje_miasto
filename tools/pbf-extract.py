"""Wyciąga z pliku OSM PBF (np. wycinek BBBike lub Geofabrik) te same obiekty, o które pyta tools/fetch-osm.ts,
i zapisuje je w paczkach 1 × 1 km w formacie odpowiedzi Overpass (out geom) w .cache/osm/<miasto>/<cx>_<cz>.json.
Potem: npm run fetch-osm -- --city <miasto> --offline [--area metro]  (buduje kafle z paczek, bez sieci)
Osobno zapisuje stacje metra i wejścia: .cache/osm/<miasto>/stations.json (dla update-stations --from).

  pip install osmium
  python3 tools/pbf-extract.py --city warszawa --pbf .cache/bbbike/Warsaw.osm.pbf
"""
import argparse, json, math, os, re, sys, time
import osmium

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CHUNK = 1000.0

ap = argparse.ArgumentParser()
ap.add_argument('--city', required=True)
ap.add_argument('--pbf', required=True)
a = ap.parse_args()
city = json.load(open(os.path.join(ROOT, 'data/cities.json'), encoding='utf-8'))[a.city]
o_lat, o_lon = city['o']
KX, KY = math.cos(math.radians(o_lat)) * 111320, 110540
def proj(lat, lon): return ((lon - o_lon) * KX, -(lat - o_lat) * KY)

# ---------- filtry (jak zapytanie Overpass w fetch-osm.ts) ----------
RAIL = {'rail', 'tram', 'light_rail', 'subway', 'narrow_gauge'}
LANDUSE = {'grass', 'forest', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'reservoir', 'basin', 'flowerbed'}
LEISURE = {'park', 'garden', 'dog_park', 'pitch', 'playground', 'track', 'sports_centre'}
NATURAL = {'water', 'wood', 'scrub', 'grassland', 'heath'}
HW_NODE = {'traffic_signals', 'crossing', 'stop', 'give_way', 'street_lamp'}

def want_way(t):
    return ('building' in t or 'building:part' in t or 'highway' in t or t.get('railway') in RAIL or t.get('landuse') in LANDUSE
            or t.get('leisure') in LEISURE or t.get('natural') in NATURAL or t.get('waterway') in ('riverbank', 'river', 'stream', 'canal', 'ditch', 'drain') or 'water' in t
            or t.get('amenity') in ('parking', 'grave_yard') or t.get('place') == 'square' or 'shop' in t or 'amenity' in t
            or t.get('historic') in ('monument', 'memorial') or t.get('tourism') == 'artwork')

def want_rel(t):
    if t.get('type') != 'multipolygon': return False
    return 'building' in t or 'landuse' in t or 'leisure' in t or 'natural' in t or 'water' in t or t.get('waterway') == 'riverbank' or t.get('place') == 'square'

def want_node(t):
    return (t.get('railway') in ('subway_entrance', 'station', 'tram_stop') or t.get('public_transport') == 'station'
            or t.get('highway') in HW_NODE or 'crossing' in t or 'shop' in t or 'amenity' in t or 'craft' in t or 'office' in t
            or 'addr:housenumber' in t or t.get('historic') in ('monument', 'memorial') or t.get('tourism') == 'artwork'
            or (t.get('natural') == 'peak' and 'ele' in t))  # szczyty z wysokością: punkty kontrolne terenu

def is_station(t):
    return ((t.get('railway') == 'station' and t.get('station') == 'subway') or (t.get('public_transport') == 'station' and t.get('subway') == 'yes')
            or (t.get('railway') == 'construction' and t.get('construction') == 'subway' and t.get('public_transport') == 'station'))

chunks = {}
def add(el, xs, zs):
    for cx in range(math.floor(min(xs) / CHUNK), math.floor(max(xs) / CHUNK) + 1):
        for cz in range(math.floor(min(zs) / CHUNK), math.floor(max(zs) / CHUNK) + 1):
            chunks.setdefault((cx, cz), []).append(el)

# ---------- przebieg 1: członkowie relacji ----------
t0 = time.time()
rel_ways = set()
class Rels(osmium.SimpleHandler):
    def relation(self, r):
        t = dict(r.tags)
        if want_rel(t):
            for m in r.members:
                if m.type == 'w': rel_ways.add(m.ref)
Rels().apply_file(a.pbf)
print(f'relacje: {len(rel_ways)} dróg członkowskich ({time.time() - t0:.0f} s)', flush=True)

# ---------- przebieg 2: węzły, drogi (z położeniami), relacje ----------
way_geom = {}
stations = []
counts = {'n': 0, 'w': 0, 'r': 0}
class Main(osmium.SimpleHandler):
    def node(self, n):
        if not n.tags: return
        t = dict(n.tags)
        if t.get('railway') == 'subway_entrance' or is_station(t):
            stations.append({'type': 'node', 'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon, 'tags': t})
        if not want_node(t): return
        x, z = proj(n.location.lat, n.location.lon)
        add({'type': 'node', 'id': n.id, 'lat': round(n.location.lat, 7), 'lon': round(n.location.lon, 7), 'tags': t}, [x], [z]); counts['n'] += 1

    def way(self, w):
        t = dict(w.tags)
        member = w.id in rel_ways
        if not (t and want_way(t)) and not member: return
        try: geom = [{'lat': round(nd.location.lat, 7), 'lon': round(nd.location.lon, 7)} for nd in w.nodes]
        except osmium.InvalidLocationError: return
        if len(geom) < 2: return
        if member: way_geom[w.id] = geom
        if t and is_station(t):
            la = sum(g['lat'] for g in geom) / len(geom); lo = sum(g['lon'] for g in geom) / len(geom)
            stations.append({'type': 'way', 'id': w.id, 'center': {'lat': la, 'lon': lo}, 'tags': t})
        if not (t and want_way(t)): return
        p = [proj(g['lat'], g['lon']) for g in geom]
        add({'type': 'way', 'id': w.id, 'nodes': [nd.ref for nd in w.nodes], 'geometry': geom, 'tags': t}, [q[0] for q in p], [q[1] for q in p]); counts['w'] += 1

    def relation(self, r):
        t = dict(r.tags)
        if not want_rel(t): return
        members, xs, zs = [], [], []
        for m in r.members:
            if m.type != 'w': continue
            g = way_geom.get(m.ref)
            if not g: continue
            members.append({'type': 'way', 'ref': m.ref, 'role': m.role, 'geometry': g})
            for q in g: x, z = proj(q['lat'], q['lon']); xs.append(x); zs.append(z)
        if not members: return
        add({'type': 'relation', 'id': r.id, 'tags': t, 'members': members}, xs, zs); counts['r'] += 1
Main().apply_file(a.pbf, locations=True, idx='flex_mem')
print(f"węzły {counts['n']}, drogi {counts['w']}, relacje {counts['r']}, paczek {len(chunks)} ({time.time() - t0:.0f} s)", flush=True)

out = os.path.join(ROOT, '.cache/osm', a.city); os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if re.match(r'^-?\d+_-?\d+\.json$', f): os.remove(os.path.join(out, f))
for (cx, cz), els in chunks.items():
    with open(os.path.join(out, f'{cx}_{cz}.json'), 'w', encoding='utf-8') as fh:
        json.dump({'version': 0.6, 'generator': 'pbf-extract.py', 'source': os.path.basename(a.pbf), 'elements': els}, fh, ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(out, 'stations.json'), 'w', encoding='utf-8') as fh:
    json.dump({'elements': stations}, fh, ensure_ascii=False)
xs = [k[0] for k in chunks]; zs = [k[1] for k in chunks]
print(f'zapisano {len(chunks)} paczek ({min(xs)}..{max(xs)}, {min(zs)}..{max(zs)}), stacji i wejść: {len(stations)} -> {out} ({time.time() - t0:.0f} s)')
