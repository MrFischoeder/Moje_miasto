"""Syntetyczne pliki OSM (Overpass JSON) do testów, wokół stacji Świętokrzyska.
Uruchom: python3 tests/fixtures/make_fixtures.py"""
import json, math, random, os
HERE = os.path.dirname(__file__)
lat0, lon0 = 52.2355, 21.0082
kx = 1 / (111320 * math.cos(math.radians(lat0))); ky = 1 / 110540
def ll(x, z): return {"lat": round(lat0 - z * ky, 7), "lon": round(lon0 + x * kx, 7)}

def swietokrzyska():
    random.seed(7); els = []; wid = 1
    types = [{"building": "apartments", "building:levels": "5"}, {"building": "yes", "height": "24"}, {"building": "office", "building:levels": "12"}, {"building": "house"}, {"building": "retail"}, {"building": "yes"}]
    for i in range(-3, 4):
        for j in range(-3, 4):
            if abs(i) <= 1 and abs(j) <= 1: continue
            cx, cz = i * 60, j * 60; w = random.uniform(16, 34); d = random.uniform(16, 34)
            pts = [(cx - w / 2, cz - d / 2), (cx + w / 2, cz - d / 2), (cx + w / 2, cz + d / 2), (cx - w / 2, cz + d / 2), (cx - w / 2, cz - d / 2)]
            els.append({"type": "way", "id": wid, "tags": dict(types[(i * 7 + j) % len(types)]), "geometry": [ll(*p) for p in pts]}); wid += 1
    for k in range(-3, 4):
        els.append({"type": "way", "id": wid, "tags": {"highway": "residential", "name": f"Ulica {k}"}, "geometry": [ll(k * 60 + 30, -200), ll(k * 60 + 30, 200)]}); wid += 1
        els.append({"type": "way", "id": wid, "tags": {"highway": "secondary"}, "geometry": [ll(-200, k * 60 + 30), ll(200, k * 60 + 30)]}); wid += 1
    els.append({"type": "node", "id": 900001, **ll(15, -10), "tags": {"railway": "station", "station": "subway", "name": "Metro Świętokrzyska"}})
    for n, (x, z) in enumerate([(40, 25), (-35, -30)]):
        els.append({"type": "node", "id": 900010 + n, **ll(x, z), "tags": {"railway": "subway_entrance"}})
    return {"version": 0.6, "elements": els}

def miasto():
    """Siatka ulic z węzłami (graf), kamienice z dziedzińcami, park, rzeka z mostem, tramwaj, sklepy."""
    random.seed(11); els = []; nodes = {}; nid = [1000]
    def node(x, z, tags=None):
        key = (round(x, 1), round(z, 1))
        if key in nodes:
            if tags: nodes[key]["tags"] = {**nodes[key].get("tags", {}), **tags}
            return nodes[key]["id"]
        nid[0] += 1; n = {"type": "node", "id": nid[0], **ll(x, z)}
        if tags: n["tags"] = tags
        nodes[key] = n; return n["id"]
    wid = [1]
    def way(pts, tags, close=False):
        ids = [node(x, z) for x, z in pts] + ([None] if close else [])
        if close: ids[-1] = ids[0]
        wid[0] += 1; els.append({"type": "way", "id": wid[0], "nodes": ids, "tags": tags}); return wid[0]
    xs = [-300, -150, 0, 150]; zs = [-300, -150, 0, 150, 300]
    for x in xs:  # ulice północ-południe
        cls = "primary" if x == 0 else "residential"
        tags = {"highway": cls, "name": "Marszałkowska" if x == 0 else f"Testowa {x}", **({"lanes": "4", "sidewalk": "both"} if x == 0 else {"sidewalk": "both"})}
        way([(x, z) for z in sorted(zs + ([-75] if x == 0 else []))], tags)
    for z in zs:  # ulice wschód-zachód (główna przez most)
        if z == 0:
            way([(x, 0) for x in sorted(xs + [-75])] + [(250, 0)], {"highway": "secondary", "name": "Świętokrzyska", "lanes": "4", "sidewalk": "both"})
            way([(250, 0), (300, 0), (380, 0), (450, 0), (500, 0)], {"highway": "secondary", "name": "Most Testowy", "lanes": "4", "bridge": "yes", "layer": "1", "sidewalk": "both"})
            way([(500, 0), (650, 0)], {"highway": "secondary", "name": "Świętokrzyska", "lanes": "4"})
        else:
            way([(x, z) for x in xs], {"highway": "residential", "name": f"Poprzeczna {z}", **({"oneway": "yes"} if z == 150 else {})})
    for x in xs:  # sygnalizacja i przejścia na głównych skrzyżowaniach
        node(x, 0, {"highway": "traffic_signals"})
    for z in zs:
        node(0, z, {"highway": "traffic_signals"})
    node(-75, 0, {"highway": "crossing", "crossing": "zebra"}); node(0, -75, {"highway": "crossing", "crossing": "zebra"})
    # tory tramwajowe wzdłuż Marszałkowskiej
    for s in (-1.6, 1.6):
        way([(s, z) for z in zs], {"railway": "tram"})
    node(0, -220, {"railway": "tram_stop", "name": "Testowy przystanek"})
    # kamienice w kwartałach: obwódka z dziedzińcem (relacja multipolygon)
    rid = 5000
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            x0, x1, z0, z1 = xs[i] + 14, xs[i + 1] - 14, zs[j] + 14, zs[j + 1] - 14
            if i == 0 and j == 0:  # park
                way([(x0, z0), (x1, z0), (x1, z1), (x0, z1)], {"leisure": "park", "name": "Park Testowy"}, close=True); continue
            outer = way([(x0, z0), (x1, z0), (x1, z1), (x0, z1)], {}, close=True)
            inner = way([(x0 + 18, z0 + 18), (x1 - 18, z0 + 18), (x1 - 18, z1 - 18), (x0 + 18, z1 - 18)], {}, close=True)
            rid += 1; lv = random.choice([4, 5, 6, 7])
            els.append({"type": "relation", "id": rid, "tags": {"type": "multipolygon", "building": "apartments", "building:levels": str(lv), "addr:street": "Marszałkowska", "addr:housenumber": str(rid - 5000)},
                        "members": [{"type": "way", "ref": outer, "role": "outer"}, {"type": "way", "ref": inner, "role": "inner"}]})
    # rzeka (pas wody z wyspą jako relacja) i bulwar
    way([(300, -400), (450, -400), (450, 400), (300, 400)], {"natural": "water", "water": "river", "name": "Rzeka Testowa"}, close=True)
    way([(260, -400), (295, -400), (295, 400), (260, 400)], {"leisure": "park"}, close=True)
    # sklepy i usługi w parterach
    for k, (x, z, t, name) in enumerate([(-20, -40, {"shop": "convenience", "brand": "Żabka"}, "Żabka"), (20, -100, {"shop": "supermarket", "brand": "Lidl"}, "Lidl"),
                                         (-20, 60, {"amenity": "pharmacy"}, "Apteka Testowa"), (20, 110, {"amenity": "cafe"}, None), (-130, 20, {"shop": "bakery"}, "Piekarnia")]):
        tags = {**t, "addr:street": "Marszałkowska", "addr:housenumber": str(100 + k)}
        if name: tags["name"] = name
        node(x, z, tags)
    node(15, -10, {"railway": "station", "station": "subway", "name": "Świętokrzyska"})
    node(20, 18, {"railway": "subway_entrance"}); node(-18, -16, {"railway": "subway_entrance"})
    return {"version": 0.6, "elements": list(nodes.values()) + els}

for name, data in [("swietokrzyska.json", swietokrzyska()), ("miasto-testowe.json", miasto())]:
    json.dump(data, open(os.path.join(HERE, name), "w"), ensure_ascii=False)
    print(name, len(data["elements"]))
