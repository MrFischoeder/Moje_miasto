"""Lotniska z wycinka OSM PBF: pasy startowe (aeroway=runway) pogrupowane w lotniska z nazwą (aeroway=aerodrome).
Wynik: client/public/air/<miasto>.json (pasy w metrach w projekcji miasta).

  python3 tools/airports.py --city warszawa --pbf .cache/bbbike/Warsaw.osm.pbf
"""
import argparse, json, math, os
import osmium

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ap = argparse.ArgumentParser(); ap.add_argument('--city', required=True); ap.add_argument('--pbf', required=True); a = ap.parse_args()
city = json.load(open(os.path.join(ROOT, 'data/cities.json'), encoding='utf-8'))[a.city]
o_lat, o_lon = city['o']; KX, KY = math.cos(math.radians(o_lat)) * 111320, 110540
proj = lambda la, lo: ((lo - o_lon) * KX, -(la - o_lat) * KY)

runways, aerodromes = [], []
class H(osmium.SimpleHandler):
    def way(self, w):
        t = dict(w.tags)
        if t.get('aeroway') not in ('runway', 'aerodrome'): return
        try: pts = [proj(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if t['aeroway'] == 'runway' and len(pts) >= 2:
            # pas = odcinek między skrajnymi punktami
            best, bd = (pts[0], pts[-1]), 0
            for i in range(len(pts)):
                for j in range(i + 1, len(pts)):
                    d = math.dist(pts[i], pts[j])
                    if d > bd: bd, best = d, (pts[i], pts[j])
            if bd < 800 or t.get('runway') == 'displaced_threshold': return
            runways.append({'ref': t.get('ref', ''), 'a': [round(best[0][0], 1), round(best[0][1], 1)], 'b': [round(best[1][0], 1), round(best[1][1], 1)],
                            'w': float((t.get('width') or '45').split()[0].replace(',', '.') or 45), 'len': round(bd)})
    def area(self, ar):
        t = dict(ar.tags)
        if t.get('aeroway') != 'aerodrome': return
        pts = []
        try:
            for ring in ar.outer_rings(): pts += [proj(n.lat, n.lon) for n in ring]
        except osmium.InvalidLocationError: return
        if len(pts) < 3: return
        cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
        aerodromes.append({'name': t.get('name', ''), 'iata': t.get('iata', ''), 'icao': t.get('icao', ''), 'x': cx, 'z': cz,
                           'r': max(math.dist((cx, cz), p) for p in pts), 'type': t.get('aerodrome:type', t.get('aerodrome', ''))})
H().apply_file(a.pbf, locations=True, idx='flex_mem')

airports = []
for ad in aerodromes:
    if not (ad['iata'] or ad['icao']): continue
    rw = [r for r in runways if math.dist(((r['a'][0] + r['b'][0]) / 2, (r['a'][1] + r['b'][1]) / 2), (ad['x'], ad['z'])) < ad['r'] + 500 and r['len'] >= 1200]
    if not rw: continue
    airports.append({'name': ad['name'], 'iata': ad['iata'], 'icao': ad['icao'], 'x': round(ad['x']), 'z': round(ad['z']), 'runways': rw})
airports.sort(key=lambda x: -max(r['len'] for r in x['runways']))
os.makedirs(os.path.join(ROOT, 'client/public/air'), exist_ok=True)
json.dump({'v': 1, 'city': a.city, 'airports': airports}, open(os.path.join(ROOT, 'client/public/air', f'{a.city}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for x in airports: print(x['iata'] or x['icao'], x['name'], [(r['ref'], r['len']) for r in x['runways']], f"{math.hypot(x['x'], x['z']) / 1000:.1f} km od środka")
