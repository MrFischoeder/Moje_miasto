"""Dopasowanie tras komunikacji do sieci z OSM (map matching).

Kształty tras w rozkładach GTFS bywają zgrubne (proste odcinki po kilkaset metrów), więc pojazd jechałby na skos.
Tu trasa między kolejnymi przystankami jest wyznaczana najkrótszą drogą po właściwej sieci:
  - autobus: drogi dla pojazdów (bez chodników, ścieżek, schodów), z kierunkami jednokierunkowych
    (chyba że oneway:bus / oneway:psv = no), także busway i drogi serwisowe pętli,
  - tramwaj: tory tramwajowe (railway=tram / light_rail),
  - pociąg: tory kolejowe (railway=rail / light_rail / subway).
Koszt odcinka rośnie z odległością od kształtu z GTFS (kształt jest wskazówką „którędy”), więc wybrana zostaje
droga zgodna z rozkładem, a nie dowolny skrót. Gdy dopasowanie się nie uda, zostaje odcinek kształtu z GTFS.
"""
import heapq, math
import osmium

BUS_HW = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
          'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'busway', 'bus_guideway', 'road'}
RAIL = {'tram': {'tram', 'light_rail'}, 'rail': {'rail', 'light_rail', 'subway', 'narrow_gauge'}}
CELL = 50.0


class Net:
    """Graf jednej sieci: węzły (id OSM -> x, z), krawędzie skierowane, siatka odcinków do przyciągania przystanków."""
    def __init__(self):
        self.xy = {}; self.adj = {}; self.grid = {}; self.br = set()
    def add_seg(self, a, b, both, br=False):
        (ax, az), (bx, bz) = self.xy[a], self.xy[b]; L = math.hypot(bx - ax, bz - az)
        if L < 1e-6: return
        if br: self.br.add((a, b)); self.br.add((b, a))
        self.adj.setdefault(a, []).append((b, L))
        if both: self.adj.setdefault(b, []).append((a, L))
        seg = (a, b, both)
        for cx in range(int(math.floor(min(ax, bx) / CELL)), int(math.floor(max(ax, bx) / CELL)) + 1):
            for cz in range(int(math.floor(min(az, bz) / CELL)), int(math.floor(max(az, bz) / CELL)) + 1):
                self.grid.setdefault((cx, cz), []).append(seg)


def load(pbf, proj, bbox):
    """Sieci 'bus', 'tram', 'rail' z pliku PBF (tylko w prostokącie bbox [x0, z0, x1, z1] w układzie gry)."""
    nets = {'bus': Net(), 'tram': Net(), 'rail': Net()}
    x0, z0, x1, z1 = bbox

    class H(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags; hw = t.get('highway'); rw = t.get('railway')
            kinds = []
            if hw in BUS_HW and t.get('area') != 'yes' and t.get('access') not in ('no', 'private') or t.get('bus') in ('yes', 'designated') or t.get('psv') in ('yes', 'designated'):
                if hw is not None or t.get('bus') or t.get('psv'): kinds.append('bus')
            if rw in RAIL['tram']: kinds.append('tram')
            if rw in RAIL['rail']: kinds.append('rail')
            if not kinds: return
            try: pts = [(n.ref, proj(n.location.lat, n.location.lon)) for n in w.nodes]
            except osmium.InvalidLocationError: return
            if all(not (x0 <= x <= x1 and z0 <= z <= z1) for _, (x, z) in pts): return
            for k in kinds:
                N = nets[k]
                if k == 'bus':
                    ow = t.get('oneway'); rev = ow == '-1'
                    one = (ow in ('yes', '1', 'true', '-1') or t.get('junction') in ('roundabout', 'circular') or hw in ('motorway',)) and t.get('oneway:bus') != 'no' and t.get('oneway:psv') != 'no'
                else: rev, one = False, False
                seq = list(reversed(pts)) if rev else pts
                for ref, xy in seq: N.xy[ref] = xy
                br = t.get('bridge') not in (None, 'no')
                for (a, _), (b, _) in zip(seq, seq[1:]): N.add_seg(a, b, not one, br)
    H().apply_file(pbf, locations=True)
    return nets


def _proj_seg(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    return t, ax + dx * t, az + dz * t


def _snap(N, x, z, dirx, dirz, rmax):
    """Najlepszy odcinek przy przystanku: blisko i zgodny z kierunkiem jazdy (jednokierunkowe tylko zgodnie)."""
    best = None; r = int(math.ceil(rmax / CELL)); cx, cz = int(math.floor(x / CELL)), int(math.floor(z / CELL)); seen = set()
    for i in range(cx - r, cx + r + 1):
        for j in range(cz - r, cz + r + 1):
            for seg in N.grid.get((i, j), ()):
                if seg in seen: continue
                seen.add(seg); a, b, both = seg; (ax, az), (bx, bz) = N.xy[a], N.xy[b]
                t, px, pz = _proj_seg(x, z, ax, az, bx, bz); d = math.hypot(px - x, pz - z)
                if d > rmax: continue
                L = math.hypot(bx - ax, bz - az) or 1e-9; c = ((bx - ax) * dirx + (bz - az) * dirz) / L
                if not both and c < -.3: continue
                score = d + 25 * (1 - abs(c))
                if best is None or score < best[0]: best = (score, a, b, both, t, px, pz)
    return best


class Guide:
    """Odległość od kształtu GTFS (próbki co ~10 m w siatce 25 m)."""
    def __init__(self, pts):
        self.g = {}
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) / 10))
            for k in range(n + 1):
                x, z = ax + (bx - ax) * k / n, az + (bz - az) * k / n
                self.g.setdefault((int(x // 25), int(z // 25)), []).append((x, z))
        self.cache = {}
    def dist(self, x, z):
        key = (int(x // 5), int(z // 5))
        if key in self.cache: return self.cache[key]
        cx, cz = int(x // 25), int(z // 25); best = 120.0
        for i in range(cx - 4, cx + 5):
            for j in range(cz - 4, cz + 5):
                for (px, pz) in self.g.get((i, j), ()):
                    d = math.hypot(px - x, pz - z)
                    if d < best: best = d
        self.cache[key] = best; return best


def _route(N, A, B, guide, box, max_nodes=60000):
    """Dijkstra między punktami przyciągniętymi do odcinków A, B (krotki z _snap); koszt zależny od odległości od kształtu."""
    _, a1, b1, both1, _, sx, sz = A; _, a2, b2, both2, _, ex, ez = B
    S, E = ('S',), ('E',)
    xy = dict(); xy[S] = (sx, sz); xy[E] = (ex, ez)
    def P(n): return xy[n] if n in xy else N.xy[n]
    extra = {S: [(b1, math.dist((sx, sz), N.xy[b1]))] + ([(a1, math.dist((sx, sz), N.xy[a1]))] if both1 else [])}
    into_E = {a2: math.dist(N.xy[a2], (ex, ez))}
    if both2: into_E[b2] = math.dist(N.xy[b2], (ex, ez))
    # ten sam odcinek: bezpośrednio, jeśli kolejność zgodna
    direct = None
    if (a1, b1) == (a2, b2):
        L = math.hypot(N.xy[b1][0] - N.xy[a1][0], N.xy[b1][1] - N.xy[a1][1])
        if B[4] >= A[4] or both1: direct = abs(B[4] - A[4]) * L
    pen = lambda x, z: 1 + min(30.0, (guide.dist(x, z) / 30.0) ** 2)
    x0, z0, x1, z1 = box
    dist = {S: 0.0}; prev = {}; pq = [(0.0, 0, S)]; cnt = 0; tick = 0; done = set()
    if direct is not None: dist[E] = direct; prev[E] = S
    while pq:
        d, _, n = heapq.heappop(pq)
        if n in done: continue
        done.add(n)
        if n == E: break
        cnt += 1
        if cnt > max_nodes: return None
        nx_, nz_ = P(n)
        nb = extra.get(n) or N.adj.get(n, ())
        out = list(nb)
        if n in into_E: out.append((E, into_E[n]))
        for m, L in out:
            mx, mz = P(m)
            if not (x0 <= mx <= x1 and z0 <= mz <= z1): continue
            c = d + L * pen((nx_ + mx) / 2, (nz_ + mz) / 2)
            if c < dist.get(m, 1e18): dist[m] = c; prev[m] = n; tick += 1; heapq.heappush(pq, (c, tick, m))
    if E not in prev: return None
    path = [E]
    while path[-1] != S: path.append(prev[path[-1]])
    path.reverse()
    # most na odcinku: krawędź sieci z tagiem bridge (odcinki do punktów przyciągnięcia: z krawędzi przystanku)
    brA, brB = (a1, b1) in N.br, (a2, b2) in N.br
    flags = []
    for u, v in zip(path, path[1:]):
        if u == S: flags.append(brA)
        elif v == E: flags.append(brB)
        else: flags.append((u, v) in N.br)
    return [P(n) for n in path], flags


def _slice(shape, cd, d0, d1):
    out = []
    for i in range(len(shape) - 1):
        if cd[i + 1] < d0 or cd[i] > d1: continue
        (ax, az), (bx, bz) = shape[i], shape[i + 1]; L = cd[i + 1] - cd[i] or 1e-9
        t0, t1 = max(0, (d0 - cd[i]) / L), min(1, (d1 - cd[i]) / L)
        p0 = (ax + (bx - ax) * t0, az + (bz - az) * t0); p1 = (ax + (bx - ax) * t1, az + (bz - az) * t1)
        if not out: out.append(p0)
        out.append(p1)
    return out


def match(N, shape, cd, stops_xy, stop_d, rmax=45, cache=None, key=None):
    """Nowy kształt trasy po sieci N. Zwraca (kształt, odsetek dopasowanych odcinków)."""
    out = []; ok = 0; flags = []
    snaps = []
    for i, (x, z) in enumerate(stops_xy):
        # kierunek jazdy przy przystanku: z kształtu GTFS
        d = stop_d[i]; sl = _slice(shape, cd, max(0, d - 25), d + 25)
        if len(sl) >= 2: dx, dz = sl[-1][0] - sl[0][0], sl[-1][1] - sl[0][1]
        else:
            j = min(i + 1, len(stops_xy) - 1); k = max(0, j - 1); dx, dz = stops_xy[j][0] - stops_xy[k][0], stops_xy[j][1] - stops_xy[k][1]
        L = math.hypot(dx, dz) or 1; snaps.append(_snap(N, x, z, dx / L, dz / L, rmax))
    for i in range(len(stops_xy) - 1):
        seg = _slice(shape, cd, stop_d[i], stop_d[i + 1])
        if len(seg) < 2: seg = [stops_xy[i], stops_xy[i + 1]]
        A, B = snaps[i], snaps[i + 1]; res = None
        if A and B:
            ck = (key, stops_xy[i], stops_xy[i + 1], tuple(round(v) for p in seg[::max(1, len(seg) // 6)] for v in p)) if cache is not None else None
            if ck is not None and ck in cache: res = cache[ck]
            else:
                xs = [p[0] for p in seg] + [A[5], B[5]]; zs = [p[1] for p in seg] + [A[6], B[6]]
                box = (min(xs) - 400, min(zs) - 400, max(xs) + 400, max(zs) + 400)
                res = _route(N, A, B, Guide(seg), box)
                if res:
                    pts_ = res[0]; Lr = sum(math.dist(p, q) for p, q in zip(pts_, pts_[1:])); Ls = sum(math.dist(p, q) for p, q in zip(seg, seg[1:]))
                    if Lr > 2.2 * Ls + 250: res = None  # objazd: dopasowanie niewiarygodne
                if ck is not None: cache[ck] = res
        if res: ok += 1
        part, pf = (res[0], list(res[1])) if res else (seg, [False] * (len(seg) - 1))
        # flags[i]: odcinek out[i] -> out[i + 1] na moście
        if not out: out.extend(part); flags.extend(pf)
        elif math.dist(out[-1], part[0]) < .05: out.extend(part[1:]); flags.extend(pf)
        else: flags.append(False); out.extend(part); flags.extend(pf)
    return out, ok / max(1, len(stops_xy) - 1), flags
