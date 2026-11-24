"""Mosty i kładki z wycinka OSM PBF (man_made=bridge): nazwa, typ konstrukcji (bridge:structure), prostokąt opisany
w układzie gry (oś wzdłuż dłuższego boku). Wynik: data/landmarks/<miasto>-mosty.json (dla tools/landmarks.ts).

  python3 tools/bridges.py --city wroclaw --pbf .cache/pbf/Wroclaw.osm.pbf
"""
import argparse, json, math, os
import osmium

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ap = argparse.ArgumentParser(); ap.add_argument('--city', required=True); ap.add_argument('--pbf', required=True); ap.add_argument('--min', type=float, default=15); a = ap.parse_args()
city = json.load(open(os.path.join(ROOT, 'data/cities.json'), encoding='utf-8'))[a.city]
o_lat, o_lon = city['o']; KX, KY = math.cos(math.radians(o_lat)) * 111320, 110540
proj = lambda la, lo: ((lo - o_lon) * KX, -(la - o_lat) * KY)
area = city.get('area')

def obb(pts):
    """prostokąt opisany o najmniejszym polu: początek, kierunek osi (dłuższy bok), długość, szerokość"""
    best = None
    for i in range(len(pts)):
        ax, az = pts[i]; bx, bz = pts[(i + 1) % len(pts)]; L = math.hypot(bx - ax, bz - az)
        if L < .5: continue
        ux, uz = (bx - ax) / L, (bz - az) / L
        us = [x * ux + z * uz for x, z in pts]; vs = [-x * uz + z * ux for x, z in pts]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs); A = (u1 - u0) * (v1 - v0)
        if best is None or A < best[0]: best = (A, ux, uz, u0, u1, v0, v1)
    _, ux, uz, u0, u1, v0, v1 = best
    if v1 - v0 > u1 - u0: ux, uz, u0, u1, v0, v1 = -uz, ux, v0, v1, -u1, -u0  # oś wzdłuż dłuższego boku
    if ux < 0 or (abs(ux) < 1e-9 and uz < 0): ux, uz, u0, u1, v0, v1 = -ux, -uz, -u1, -u0, -v1, -v0
    W, D = u1 - u0, v1 - v0
    # początek: środek krótszego boku przy u0 (oś mostu przez środek szerokości)
    vm = (v0 + v1) / 2
    ox, oz = ux * u0 - uz * vm, uz * u0 + ux * vm
    return dict(ox=round(ox, 1), oz=round(oz, 1), ux=round(ux, 5), uz=round(uz, 5), W=round(W, 1), D=round(D, 1))

out = []
class H(osmium.SimpleHandler):
    def way(self, w):
        t = dict(w.tags)
        if t.get('man_made') != 'bridge': return
        try: pts = [proj(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(pts) < 4: return
        if pts[0] == pts[-1]: pts = pts[:-1]
        if area:
            la = o_lat - sum(p[1] for p in pts) / len(pts) / KY; lo = o_lon + sum(p[0] for p in pts) / len(pts) / KX
            if not (area[0] <= la <= area[2] and area[1] <= lo <= area[3]): return
        f = obb(pts)
        if f['W'] < a.min: return
        out.append(dict(name=t.get('name', ''), s=t.get('bridge:structure', ''), id=w.id, frame=f))
H().apply_file(a.pbf, locations=True)
out.sort(key=lambda b: -b['frame']['W'])
json.dump(out, open(os.path.join(ROOT, 'data/landmarks', a.city + '-mosty.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f"mosty: {len(out)} (nazwane {sum(1 for b in out if b['name'])}), najdłuższy {out[0]['name']} {out[0]['frame']['W']} m")
