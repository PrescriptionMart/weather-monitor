#!/usr/bin/env python3
"""Builds data/winter-forecast.json, the Winter Pack page's forecast, once an hour
(.github/workflows/winter-forecast.yml, which then starts the Pages deploy).

Without it the page fetches the NWS hourly forecast for each of its 2,737
checkpoint gridpoints itself: about 2 minutes and some 450 MB of JSON per load,
on every station, every hour. This builds the same thing once an hour,
server-side, and the page reads one file:

  lows     each checkpoint's 5-hour low for each delivery day, from the same
           api.weather.gov hourly forecast the page reads live, worked out with
           the page's own rule (winter-core.js), so the page's calls don't change
  zipLows  each ZIP's 5-hour low from the NWS national forecast grid (NDFD,
           2.5 km, the grid api.weather.gov serves), read where most of the
           ZIP's residents live (data/zip-points.txt, from the 2020 Census, made
           on the build server by scripts/build-zip-points.py), lower 48:
           ~33,000 readings a day instead of ~2,700.
  zipHours the 11am-6pm readings behind each of those lows, for the ZIP box. The grid is hourly for
           about 36 hours, then 3-hourly; hours inside a 3-hour step are read
           in a straight line between its ends. A 3-digit area's ZIPs are
           written for a day only when every one of them has its full window,
           so the page can let an area's ZIPs decide (see winter-core.js).

The page uses this file only while it is under 2 hours old and matches its own
data; otherwise it loads live from api.weather.gov as before.

  pip install -r scripts/winter-forecast-requirements.txt
  python3 scripts/build-winter-forecast.py --out data/winter-forecast.json
"""
import argparse, concurrent.futures as cf, datetime as dt, gzip, http.client, json, math, os, re, ssl, sys, tempfile, threading, time
import urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
UA = 'PrescriptionMart weather-monitor (github.com/PrescriptionMart/weather-monitor)'
BENCH_TZ = ZoneInfo('America/Chicago')   # "today" is Beaumont time, as on the page
NDFD_URLS = [   # the same file, from the NWS and from its AWS mirror
    'https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/AR.conus/VP.001-003/ds.temp.bin',
    'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.conus/VP.001-003/ds.temp.bin',
]
API_MINUTES = 6        # the api.weather.gov pass stops after this long (a slow or throttled day): the
                       # grid still gets read, and the page fetches whatever is missing itself
MAX_STEP_HOURS = 3     # an hour between two grid times at most this far apart is read in between them
# Checked against api.weather.gov's own hourly forecast at the checkpoints: a
# day read partly through 3-hour steps had its 5-hour lows within 2°F 99.8% of
# the time (a little colder on average, never warmer across the freezing
# line); a day read through 6-hour steps was within 2°F only 43% of the time,
# so those are left out.


def core_constants(path):
    """The rule's numbers, read from winter-core.js so this script can't drift from the page."""
    src = open(path).read()
    num = lambda name: int(re.search(r'const %s = (\d+);' % name, src).group(1))
    return {'start': num('DELIVERY_START_HOUR'), 'end': num('DELIVERY_END_HOUR') + num('DWELL_HOURS'),
            'cold_hours': num('COLD_HOURS'), 'days_ahead': num('LAST_DELIVERY_OFFSET'), 'version': num('VERSION')}


def js_round(x):
    return math.floor(x + 0.5)   # Math.round, as the page rounds


def to_f(t, unit):
    """winter-core.js toF: a reading in °F, or None."""
    if isinstance(t, (int, float)) and not isinstance(t, bool):
        return (js_round(t * 9 / 5 + 32) if unit == 'C' else t) if math.isfinite(t) else None
    if isinstance(t, dict) and isinstance(t.get('value'), (int, float)) and math.isfinite(t['value']):
        return js_round(t['value'] * 9 / 5 + 32) if str(t.get('unitCode', '')).endswith('degC') else js_round(t['value'])
    return None


def window_temps(periods, key, k):
    """winter-core.js windowTemps: the start..end hour readings on local date `key`, or None if one is missing."""
    by_hour = {}
    for p in periods or []:
        st = p.get('startTime') if isinstance(p, dict) else None
        if not isinstance(st, str) or st[:10] != key:
            continue
        h = int(st[11:13])
        if not k['start'] <= h <= k['end']:
            continue
        t = to_f(p.get('temperature'), p.get('temperatureUnit'))
        if t is not None:
            by_hour[h] = t if h not in by_hour else min(by_hour[h], t)
    out = [by_hour.get(h) for h in range(k['start'], k['end'] + 1)]
    return None if None in out else out


def spell_temp(temps, hours):
    """winter-core.js spellTemp: the warmest reading of the coldest `hours` readings in a row."""
    if not temps or len(temps) < hours:
        return None
    return min(max(temps[i:i + hours]) for i in range(len(temps) - hours + 1))


_local, _ctx = threading.local(), ssl.create_default_context()


def _connection(host):
    """One kept-alive HTTPS connection per worker thread and host (through HTTPS_PROXY if set)."""
    conns = _local.__dict__.setdefault('conns', {})
    if host not in conns:
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
        if proxy:
            pu = urllib.parse.urlsplit(proxy)
            conns[host] = http.client.HTTPSConnection(pu.hostname, pu.port, timeout=25, context=_ctx)
            conns[host].set_tunnel(host, 443)
        else:
            conns[host] = http.client.HTTPSConnection(host, timeout=25, context=_ctx)
    return conns[host]


_deadline = [float('inf')]   # time.time() after which fetch gives up at once (see API_MINUTES)


def fetch(url, tries=3):
    """JSON from api.weather.gov (gzip), 404 for a retired gridpoint, or None after retries
    (or once the API pass is out of time)."""
    u = urllib.parse.urlsplit(url)
    path = u.path + ('?' + u.query if u.query else '')
    for a in range(tries):
        if time.time() > _deadline[0]:
            return None
        if a:
            time.sleep(3 * a)
        c = _connection(u.hostname)
        try:
            c.request('GET', path, headers={'User-Agent': UA, 'Accept': 'application/geo+json', 'Accept-Encoding': 'gzip'})
            r = c.getresponse()
            body = r.read()
            if r.status == 404:
                return 404
            if r.status == 200:
                return json.loads(gzip.decompress(body) if r.getheader('Content-Encoding') == 'gzip' else body)
        except Exception:
            c.close()
            _local.conns.pop(u.hostname, None)
    return None


def coord(v):
    """A coordinate for /points without trailing zeros (NWS redirects 38.0440 to 38.044)."""
    return ('%.4f' % v).rstrip('0').rstrip('.')


def checkpoint_lows(points, days, k, workers):
    """Every checkpoint's 5-hour low per day from api.weather.gov; one request per gridpoint, as the page makes."""
    def one(g, lat, lon):
        try:
            return lows_for(g, lat, lon)
        except Exception:
            return None   # a malformed answer counts as not checked, as on the page
    def lows_for(g, lat, lon):
        body = fetch('https://api.weather.gov/gridpoints/%s/forecast/hourly' % g)
        if body == 404:   # NWS retired the gridpoint: look the place up again, as the page does
            pt = fetch('https://api.weather.gov/points/%s,%s' % (coord(lat), coord(lon)))
            url = pt.get('properties', {}).get('forecastHourly') if isinstance(pt, dict) else None
            body = fetch(url) if url else None
        if not isinstance(body, dict):
            return None
        periods = body.get('properties', {}).get('periods')
        return [spell_temp(window_temps(periods, d, k), k['cold_hours']) for d in days]
    grids = {}
    for p in points:
        grids.setdefault(p['g'], (p['lat'], p['lon']))
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        res = dict(zip(grids, ex.map(lambda g: one(g, *grids[g]), grids)))
    return [res.get(p['g']) for p in points]


def download(urls, dest):
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
                f.write(r.read())
            return u
        except Exception as e:
            print('  NDFD download failed from %s: %s' % (u, e), file=sys.stderr)
    return None


def grid_reader(grids, max_step_hours=MAX_STEP_HOURS):
    """(t, cells) → the grid's values (°F) at those cells at time t, read in a straight line
    inside a step of up to max_step_hours; None outside the grid's times or in a longer step."""
    import bisect
    times = sorted(grids)
    def at(t, cells):
        if t in grids:
            return grids[t][cells]
        j = bisect.bisect_left(times, t)
        if j == 0 or j == len(times) or (times[j] - times[j - 1]).total_seconds() > max_step_hours * 3600:
            return None
        a, b = times[j - 1], times[j]
        w = (t - a).total_seconds() / (b - a).total_seconds()
        return grids[a][cells] * (1 - w) + grids[b][cells] * w
    return at


def grid_lows(places, days, k, grib_path, want_hours=False):
    """5-hour lows per day at each (lat, lon) from the NDFD temperature grid; None where the
    grid has no full window (past its 3-hourly part, or outside the lower 48). With
    want_hours, also each place's window readings per day (start..end hour, °F)."""
    import numpy as np, pygrib
    from scipy.spatial import cKDTree
    from timezonefinder import TimezoneFinder
    grids, latlons, issued = {}, None, None
    for m in pygrib.open(grib_path):
        v = np.ma.filled(m.values.astype('float64'), np.nan)
        grids[m.validDate.replace(tzinfo=dt.timezone.utc)] = ((v - 273.15) * 9 / 5 + 32).ravel()
        if latlons is None:
            latlons, issued = m.latlons(), m.analDate.replace(tzinfo=dt.timezone.utc)
    at = grid_reader(grids)
    land = np.flatnonzero(~np.isnan(next(iter(grids.values()))))
    def xyz(lat, lon):
        la, lo = np.radians(lat), np.radians(lon)
        return np.c_[np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]
    tree = cKDTree(xyz(latlons[0].ravel()[land], latlons[1].ravel()[land]))
    lat = np.array([p[0] for p in places]); lon = np.array([p[1] for p in places])
    dist, idx = tree.query(xyz(lat, lon))
    cell = land[idx]
    inside = dist * 6371 < 3.0          # within ~a grid cell of land on this grid (not AK, HI, offshore)
    tf = TimezoneFinder()
    tz = [tf.timezone_at(lat=a, lng=b) or tf.closest_timezone_at(lat=a, lng=b) for a, b in zip(lat, lon)]
    hours = list(range(k['start'], k['end'] + 1))
    out = [[None] * len(days) for _ in places]
    hrs = [[None] * len(days) for _ in places]
    for zone in set(tz):
        sel = np.array([i for i, t in enumerate(tz) if t == zone and inside[i]], dtype=int)
        if not len(sel):
            continue
        z = ZoneInfo(zone)
        for di, day in enumerate(days):
            y, mo, d = map(int, day.split('-'))
            cols = []
            for h in hours:
                g = at(dt.datetime(y, mo, d, h, tzinfo=z).astimezone(dt.timezone.utc), cell[sel])
                if g is None:
                    break
                cols.append(np.floor(g + 0.5))
            if len(cols) != len(hours):
                continue
            t = np.stack(cols, axis=1)                                  # places x hours
            runs = np.stack([t[:, i:i + k['cold_hours']].max(axis=1) for i in range(len(hours) - k['cold_hours'] + 1)], axis=1)
            low = runs.min(axis=1)
            for j, (i, v) in enumerate(zip(sel, low)):
                if not np.isnan(v):
                    out[i][di] = int(v)
                    if want_hours:
                        hrs[i][di] = [int(x) for x in t[j]]
    return (out, issued, inside, hrs) if want_hours else (out, issued, inside)


def zip_readings(zips, inside, vals, days):
    """{day: {ZIP: 5-hour low}}, a 3-digit area's ZIPs all together or not at all: the page lets
    an area's ZIPs decide for it, so it must have every one of them (those on the grid)."""
    areas = {}
    for i, z in enumerate(zips):
        if inside[i]:
            areas.setdefault(z[:3], []).append(i)
    out = {}
    for di, day in enumerate(days):
        got = {zips[i]: vals[i][di] for m in areas.values() if all(vals[i][di] is not None for i in m) for i in m}
        if got:
            out[day] = got
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--api-minutes', type=float, default=API_MINUTES, help='time allowed for the api.weather.gov pass')
    ap.add_argument('--grib', help='a local NDFD ds.temp.bin instead of downloading one')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    k = core_constants(os.path.join(ROOT, 'winter-core.js'))
    ck = json.load(open(os.path.join(ROOT, 'data', 'winter-checkpoints.json')))
    col = {c: i for i, c in enumerate(ck['columns'])}
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(BENCH_TZ).date()
    days = [(today + dt.timedelta(days=i)).isoformat() for i in range(1, k['days_ahead'] + 1)]   # delivery days: tomorrow on
    points = [{'g': r[col['gridpoint']], 'lat': r[col['lat']], 'lon': r[col['lon']]} for r in ck['points']]
    t0 = time.time()
    _deadline[0] = t0 + 60 * a.api_minutes
    lows = checkpoint_lows(points, days, k, a.workers)
    api_ok = sum(1 for v in lows if v is not None)
    print('api.weather.gov: %d of %d checkpoints in %.0fs' % (api_ok, len(points), time.time() - t0))
    # A checkpoint the API missed stays null, so the page fetches it live. (The grid
    # could fill its next day or two, but there the area's ZIPs decide anyway, and a
    # half-filled checkpoint would leave the later days unread.)
    # where to read each ZIP: where its residents live (data/zip-points.txt, worked out on
    # the build server and never published: those points sit on towns, and so do the
    # checkpoints, so publishing them would let the checkpoints be matched to ZIPs), or
    # failing that its geographic centre
    pts = os.path.join(ROOT, 'data', 'zip-points.txt')
    zips = [l.strip().split(',') for l in open(pts if os.path.exists(pts) else os.path.join(ROOT, 'data', 'zip-centroids.txt')) if l.strip()]
    print('ZIP points: %s' % ('where residents live' if os.path.exists(pts) else 'geographic centres (no data/zip-points.txt)'))
    grib, tmp, zip_lows, zip_hours, issued = a.grib, None, {}, {}, None
    if not grib:
        tmp = tempfile.NamedTemporaryFile(suffix='.grib2', delete=False).name
        grib = tmp if download(NDFD_URLS, tmp) else None
    if grib:
        try:
            t1 = time.time()
            vals, issued, inside, hrs = grid_lows([(float(z[1]), float(z[2])) for z in zips], days, k, grib, want_hours=True)
            zip_lows = zip_readings([z[0] for z in zips], inside, vals, days)
            row = {z[0]: i for i, z in enumerate(zips)}
            zip_hours = {d: {z: hrs[row[z]][days.index(d)] for z in got} for d, got in zip_lows.items()}   # for the ZIP box
            print('NDFD grid (issued %s): %d ZIPs on the grid; ZIP readings by day %s; %.0fs'
                  % (issued.isoformat() if issued else '?', int(inside.sum()), {d: len(v) for d, v in zip_lows.items()}, time.time() - t1))
        except Exception as e:
            print('  NDFD grid unusable: %s' % e, file=sys.stderr)
        finally:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
    if api_ok < 0.5 * len(points) and not zip_lows:
        print('too little of the forecast came through; not writing a file (the page loads live)', file=sys.stderr)
        return 1
    doc = {'built': now.replace(microsecond=0).isoformat(), 'core': k['version'], 'checkpoints': ck['version'],
           'grid': issued.replace(microsecond=0).isoformat() if issued else None,
           'sources': {'api': api_ok, 'missing': len(lows) - api_ok},
           'days': days, 'lows': lows, 'zipLows': zip_lows, 'zipHours': zip_hours}
    tmp_out = a.out + '.tmp'
    with open(tmp_out, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(tmp_out, a.out)
    print('wrote %s: %.0f KB' % (a.out, os.path.getsize(a.out) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
