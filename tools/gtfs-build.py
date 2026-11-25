"""Rozkłady jazdy GTFS -> zwarty plik gry client/public/transit/<miasto>.json.gz.

Kurs = wzorzec trasy (linia, przystanki, kształt w metrach) + profil czasów (przesunięcia od startu) + godzina startu
+ maska typów dnia (0 = dzień powszedni, 1 = sobota, 2 = niedziela/święto, wzięte z prawdziwych dat rozkładu).
Częstotliwości (frequencies.txt, np. metro w Warszawie) są rozwijane na pojedyncze kursy.

  python3 tools/gtfs-build.py --city warszawa --feed .cache/gtfs/warsaw.zip --feed .cache/gtfs/wkd.zip --feed .cache/gtfs/polish_trains.zip
  python3 tools/gtfs-build.py --city londyn --feed .cache/gtfs/london.zip
"""
import argparse, csv, datetime as dt, gzip, io, json, math, os, re, sys, time, unicodedata, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ap = argparse.ArgumentParser()
ap.add_argument('--city', required=True)
ap.add_argument('--feed', action='append', required=True)
ap.add_argument('--margin', type=float, default=6000, help='margines wokół obszaru metra [m]')
ap.add_argument('--pbf', default=None, help='wycinek OSM PBF: dopasowanie tras do dróg i torów (tools/lib/mapmatch.py)')
ap.add_argument('--bus-radius', type=float, default=None, help='autobusy tylko w promieniu [m] od środka miasta (duże sieci)')
a = ap.parse_args()
city = json.load(open(os.path.join(ROOT, 'data/cities.json'), encoding='utf-8'))[a.city]
o_lat, o_lon = city['o']
KX, KY = math.cos(math.radians(o_lat)) * 111320, 110540
proj = lambda la, lo: ((lo - o_lon) * KX, -(la - o_lat) * KY)
# obszar: sieć metra albo pole area (miasta bez metra, np. Wrocław) – wtedy bez dodatkowego marginesu
if city.get('area'):
    s_, w_, n_, e_ = city['area']; pts = [proj(n_, w_), proj(s_, e_)]
    if a.margin == 6000: a.margin = 500
else:
    pts = [proj(s[1], s[2]) for s in city['st']]
BX0, BX1 = min(p[0] for p in pts), max(p[0] for p in pts)
BZ0, BZ1 = min(p[1] for p in pts), max(p[1] for p in pts)
def inside(x, z, m): return BX0 - m <= x <= BX1 + m and BZ0 - m <= z <= BZ1 + m

KIND = {0: 'tram', 1: 'metro', 2: 'rail', 3: 'bus', 4: 'ferry', 5: 'tram', 6: 'cable', 7: 'cable', 11: 'bus', 12: 'rail', 200: 'bus'}
def kind_of(t):
    t = int(t)
    if t in KIND: return KIND[t]
    if 100 <= t < 200: return 'rail'
    if 400 <= t < 500: return 'metro' if t in (400, 401, 402) else 'rail'
    if 700 <= t < 800: return 'bus'
    if 900 <= t < 1000: return 'tram'
    if 1000 <= t < 1100: return 'ferry'
    if 1300 <= t < 1500: return 'cable'
    return 'bus'

def sec(s):
    h, m, x = s.split(':'); return int(h) * 3600 + int(m) * 60 + int(x)

def rows(z, name):
    if name not in z.namelist(): return
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))

def norm(s):
    s = unicodedata.normalize('NFD', s); s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    s = re.sub(r'\(.*?\)|metro|underground|station|stacja|rail|dlr', '', s); return re.sub(r'[^a-z0-9]', '', s)

def simplify(p, tol=1.5):
    """Douglas-Peucker (iteracyjnie)."""
    if len(p) < 3: return p
    keep = [False] * len(p); keep[0] = keep[-1] = True; st = [(0, len(p) - 1)]
    while st:
        i, j = st.pop(); ax, az = p[i]; bx, bz = p[j]; dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz) or 1e-9
        best, bi = 0, -1
        for k in range(i + 1, j):
            d = abs((p[k][0] - ax) * dz - (p[k][1] - az) * dx) / L
            if d > best: best, bi = d, k
        if best > tol: keep[bi] = True; st += [(i, bi), (bi, j)]
    return [q for q, k in zip(p, keep) if k]

def cumdist(p):
    d = [0.0]
    for i in range(1, len(p)): d.append(d[-1] + math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]))
    return d

def project_stops(shape, cd, stops_xy):
    """Odległość każdego przystanku wzdłuż kształtu (monotonicznie)."""
    out, seg = [], 0
    for (x, z) in stops_xy:
        best, bd, bs = None, 1e18, seg
        for i in range(seg, len(shape) - 1):
            ax, az = shape[i]; bx, bz = shape[i + 1]; dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2)); px, pz = ax + dx * t, az + dz * t
            d = (px - x) ** 2 + (pz - z) ** 2
            if d < bd: bd, best, bs = d, cd[i] + math.sqrt(L2) * t, i
            if d > bd + 4e6 and i > bs + 50: break  # daleko za najlepszym
        out.append(best if best is not None else (out[-1] if out else 0)); seg = bs
    for i in range(1, len(out)): out[i] = max(out[i], out[i - 1])
    return out

NETS = None
if a.pbf:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
    import mapmatch
    m_ = a.margin + 1500; NETS = mapmatch.load(a.pbf, proj, (BX0 - m_, BZ0 - m_, BX1 + m_, BZ1 + m_))
    print('sieci OSM: ' + ', '.join(f'{k} {len(n.xy)} węzłów' for k, n in NETS.items()), flush=True)
MATCH_CACHE, MATCH_STATS = {}, {}
t0 = time.time()
DAYS = ['powszedni', 'sobota', 'niedziela']
routes_out, stops_out, stop_index = [], [], {}
patterns, pattern_index = [], {}
shape_cache = {}
day_dates = {}
total_trips = 0

for feed in a.feed:
    z = zipfile.ZipFile(feed); fname = os.path.basename(feed)
    # --- daty: usługi aktywne w wybranym dniu powszednim, sobocie, niedzieli ---
    by_date = {}
    for r in rows(z, 'calendar.txt'):
        d0, d1 = dt.datetime.strptime(r['start_date'], '%Y%m%d').date(), dt.datetime.strptime(r['end_date'], '%Y%m%d').date()
        wd = [r['monday'], r['tuesday'], r['wednesday'], r['thursday'], r['friday'], r['saturday'], r['sunday']]
        d = max(d0, dt.date.today()); end = min(d1, d + dt.timedelta(days=14))
        while d <= end:
            if wd[d.weekday()] == '1': by_date.setdefault(d, set()).add(r['service_id'])
            d += dt.timedelta(days=1)
    for r in rows(z, 'calendar_dates.txt'):
        d = dt.datetime.strptime(r['date'], '%Y%m%d').date()
        s = by_date.setdefault(d, set())
        if r['exception_type'] == '1': s.add(r['service_id'])
        else: s.discard(r['service_id'])
    dates = sorted(d for d in by_date if d >= dt.date.today() and by_date[d])
    pick = {}
    for d in dates:
        k = 0 if d.weekday() < 5 else 1 if d.weekday() == 5 else 2
        if k not in pick and (k != 0 or d.weekday() == 2 or not any(x.weekday() == 2 for x in dates)): pick[k] = d
    if not pick:
        print(f'{fname}: brak dat w rozkładzie'); continue
    day_dates[fname] = {DAYS[k]: str(d) for k, d in pick.items()}
    svc_mask = {}
    for k, d in pick.items():
        for s in by_date[d]: svc_mask[s] = svc_mask.get(s, 0) | (1 << k)
    print(f'{fname}: dni {day_dates[fname]}, usług {len(svc_mask)}', flush=True)

    # --- przystanki ---
    stop_xy, stop_name = {}, {}
    for r in rows(z, 'stops.txt'):
        try: x, zz = proj(float(r['stop_lat']), float(r['stop_lon']))
        except ValueError: continue
        stop_xy[r['stop_id']] = (x, zz); stop_name[r['stop_id']] = r['stop_name']

    # --- linie ---
    route_info = {}
    for r in rows(z, 'routes.txt'):
        route_info[r['route_id']] = (r.get('route_short_name') or r.get('route_long_name') or r['route_id'], kind_of(r['route_type']), ('#' + r['route_color']) if r.get('route_color') else '', r.get('route_long_name', ''))

    # --- kursy ---
    trips = {}
    for r in rows(z, 'trips.txt'):
        m = svc_mask.get(r['service_id'])
        if not m or r['route_id'] not in route_info: continue
        trips[r['trip_id']] = (r['route_id'], m, r.get('shape_id', ''), r.get('trip_headsign', ''))
    freqs = {}
    for r in rows(z, 'frequencies.txt'):
        if r['trip_id'] in trips: freqs.setdefault(r['trip_id'], []).append((sec(r['start_time']), sec(r['end_time']), int(r['headway_secs'])))
    print(f'  kursów w wybranych dniach: {len(trips)}; czytam stop_times… ({time.time() - t0:.0f} s)', flush=True)

    st = {}
    for r in rows(z, 'stop_times.txt'):
        tid = r['trip_id']
        if tid not in trips: continue
        arr, dep = r['arrival_time'] or r['departure_time'], r['departure_time'] or r['arrival_time']
        if not arr: continue
        st.setdefault(tid, []).append((int(r['stop_sequence']), r['stop_id'], sec(arr), sec(dep)))
    print(f'  stop_times wczytane ({time.time() - t0:.0f} s)', flush=True)

    shapes_raw = {}
    need_shapes = {v[2] for v in trips.values() if v[2]}
    for r in rows(z, 'shapes.txt'):
        if r['shape_id'] in need_shapes:
            shapes_raw.setdefault(r['shape_id'], []).append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))

    route_map = {}
    for tid, seq in st.items():
        rid, mask, shp, head = trips[tid]; name, kind, color, long = route_info[rid]
        seq.sort()
        # tylko część kursu w obszarze miasta
        if kind == 'bus' and a.bus_radius: ok = lambda xy: math.hypot(xy[0], xy[1]) <= a.bus_radius
        else: ok = lambda xy: inside(xy[0], xy[1], a.margin)
        ins = [i for i, s in enumerate(seq) if s[1] in stop_xy and ok(stop_xy[s[1]])]
        if len(ins) < 2: continue
        seq = seq[ins[0]:ins[-1] + 1]
        seq = [s for s in seq if s[1] in stop_xy]
        if len(seq) < 2: continue
        rk = (fname, rid)
        if rk not in route_map:
            route_map[rk] = len(routes_out); routes_out.append({'n': name, 't': kind, 'c': color, 'l': long})
        ri = route_map[rk]
        sids = []
        for s in seq:
            key = (fname, s[1])
            if key not in stop_index:
                stop_index[key] = len(stops_out); x, zz = stop_xy[s[1]]; stops_out.append([stop_name[s[1]], round(x, 1), round(zz, 1)])
            sids.append(stop_index[key])
        pk = (ri, tuple(sids), shp if kind != 'metro' else '', head)
        if pk not in pattern_index:
            if kind == 'metro': shape = None
            elif shp and shp in shapes_raw:
                if shp not in shape_cache:
                    sp = sorted(shapes_raw[shp]); shape_cache[shp] = simplify([proj(la, lo) for _, la, lo in sp])
                shape = shape_cache[shp]
            else: shape = None
            stops_xy = [tuple(stops_out[i][1:]) for i in sids]
            if shape is None or len(shape) < 2: shape = simplify(stops_xy, .5)
            cd = cumdist(shape)
            dist = project_stops(shape, cd, stops_xy)
            bridges_ = None
            net = NETS and NETS.get('bus' if kind == 'bus' else 'tram' if kind == 'tram' else 'rail' if kind == 'rail' else '')
            if net is not None and len(net.xy):
                new, frac, bflags = mapmatch.match(net, shape, cd, stops_xy, dist, rmax=45 if kind == 'bus' else 35, cache=MATCH_CACHE, key=kind)
                st_ = MATCH_STATS.setdefault(kind, [0, 0.0]); st_[0] += 1; st_[1] += frac
                if len(new) >= 2:
                    # przedziały mostów wzdłuż ścieżki [m], przeskalowane do długości uproszczonego kształtu
                    rc = cumdist(new); spans = []
                    for i, f in enumerate(bflags):
                        if not f: continue
                        if spans and abs(spans[-1][1] - rc[i]) < .5: spans[-1][1] = rc[i + 1]
                        else: spans.append([rc[i], rc[i + 1]])
                    shape = simplify(new, .4); cd = cumdist(shape); dist = project_stops(shape, cd, stops_xy)
                    k_ = cd[-1] / (rc[-1] or 1); bridges_ = [round(v * k_, 1) for sp in spans if sp[1] - sp[0] > 3 for v in sp]
            # kształt przycięty do części kursu (od pierwszego do ostatniego przystanku)
            pattern_index[pk] = len(patterns)
            patterns.append({'r': ri, 's': sids, 'h': head, 'shape': shape, 'cd': cd, 'd': dist, 'prof': {}, 'trips': [], 'bi': bridges_})
        p = patterns[pattern_index[pk]]
        base = seq[0][3]
        prof = tuple(v for s in seq for v in (s[2] - base, s[3] - base))
        pi = p['prof'].setdefault(prof, len(p['prof']))
        starts = [base]
        if tid in freqs:
            starts = []
            for f0, f1, hw in freqs[tid]:
                t = f0
                while t < f1: starts.append(t); t += hw
        for s0 in starts: p['trips'].append([s0, pi, mask]); total_trips += 1
    print(f'  linii {len(routes_out)}, wzorców {len(patterns)}, kursów {total_trips} ({time.time() - t0:.0f} s)', flush=True)
    for k_, (n_, f_) in MATCH_STATS.items(): print(f'  dopasowanie do sieci OSM: {k_} {n_} wzorców, średnio {100 * f_ / n_:.0f}% odcinków po drogach/torach', flush=True)
    del st, trips, shapes_raw

# --- zapis ---
def enc_flat(p):
    """Kształt jako delty w decymetrach."""
    out, px, pz = [], 0, 0
    for x, z in p:
        ix, iz = round(x * 10), round(z * 10); out += [ix - px, iz - pz]; px, pz = ix, iz
    return out

out_patterns = []
for p in patterns:
    profs = [list(k) for k, _ in sorted(p['prof'].items(), key=lambda kv: kv[1])]
    trips = sorted(p['trips'])
    out_patterns.append({'r': p['r'], 's': p['s'], 'h': p['h'], 'sh': enc_flat(p['shape']), 'd': [round(x, 1) for x in p['d']],
                         'pr': profs, 'tr': [v for t in trips for v in t], **({'bi': p['bi']} if p.get('bi') is not None else {})})
data = {'v': 1, 'city': a.city, 'days': DAYS, 'dates': day_dates, 'routes': routes_out, 'stops': stops_out, 'patterns': out_patterns,
        'source': [os.path.basename(f) for f in a.feed], 'generated': dt.datetime.now(dt.timezone.utc).isoformat()[:16]}
os.makedirs(os.path.join(ROOT, 'client/public/transit'), exist_ok=True)
fn = os.path.join(ROOT, 'client/public/transit', f'{a.city}.json.gz')
raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
with gzip.open(fn, 'wb', compresslevel=9) as f: f.write(raw)
kinds = {}
for r in routes_out: kinds[r['t']] = kinds.get(r['t'], 0) + 1
print(f'zapisano {fn}: {len(raw) / 1e6:.1f} MB JSON, {os.path.getsize(fn) / 1e6:.1f} MB gzip; linie {kinds}; kursów {total_trips} ({time.time() - t0:.0f} s)')
