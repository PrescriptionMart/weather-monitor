#!/usr/bin/env python3
"""Writes data/zip-points.txt: where to read each ZIP's forecast, where its residents live.
Run on the build server (.github/workflows/winter-forecast.yml) and never committed:
the points sit on towns, and so do the Winter Pack checkpoints, so publishing them
would let the checkpoints be matched to ZIPs.

The Winter Pack reads one forecast per ZIP. A ZIP's geographic centre is fine for
a town ZIP, but in a big mountain ZIP it can sit on a ridge thousands of feet
above the town (Idyllwild's centre is at 9,157 ft, the town at 5,318 ft), so the
ZIP read as freezing while the town didn't. This puts each ZIP's point where the
most of its residents live, from the 2020 Census (public data):

  tab20_zcta520_tabblock20_natl.txt   which ZIP (ZCTA) each census block is in
  tl_2020_SS_tabblock20.zip           each block's population and inside point
                                      (only the table inside each state's file
                                      is downloaded, not the shapes)

Each ZIP's populated blocks are binned on a 0.02° grid (about 2 km, finer than
the 2.5 km forecast grid); the ZIP's point is the population-weighted middle of
its most-populated bin, i.e. the heart of the ZIP's biggest town. A ZIP with no
residents keeps its geographic centre from data/zip-centroids.txt. Same ZIPs,
same order. Census geography only changes every ten years, so the build server
keeps the result in its cache and only works it out again when this script or
the ZIP list changes:

  pip install numpy && python3 scripts/build-zip-points.py
"""
import collections, io, os, ssl, struct, sys, urllib.request, zlib
import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BLOCKS = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt'
TIGER = 'https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_%s_tabblock20.zip'
STATES = ['01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15', '16', '17', '18', '19', '20', '21', '22', '23',
          '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '44',
          '45', '46', '47', '48', '49', '50', '51', '53', '54', '55', '56', '72']
BIN = 0.02
UA = {'User-Agent': 'PrescriptionMart weather-monitor (github.com/PrescriptionMart/weather-monitor)'}
_ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE')) if os.environ.get('SSL_CERT_FILE') else ssl.create_default_context()


def get(url, start=None, end=None):
    h = dict(UA)
    if start is not None:
        h['Range'] = 'bytes=%d-%s' % (start, '' if end is None else end)
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), context=_ctx, timeout=600) as r:
        return r.read()


def size(url):
    req = urllib.request.Request(url, headers=UA, method='HEAD')
    with urllib.request.urlopen(req, context=_ctx, timeout=60) as r:
        return int(r.headers['Content-Length'])


def zip_member(url, suffix):
    """One member of a remote zip, fetched with range requests (the central directory, then the member)."""
    n = size(url)
    tail = get(url, max(0, n - 65536))
    e = tail.rfind(b'PK\x05\x06')
    cd_size, cd_off = struct.unpack('<II', tail[e + 12:e + 20])
    cd = get(url, cd_off, cd_off + cd_size - 1)
    i = 0
    while i < len(cd):
        method, csize, nlen, xlen, clen, off = (struct.unpack('<H', cd[i + 10:i + 12])[0], struct.unpack('<I', cd[i + 20:i + 24])[0],
            *struct.unpack('<HHH', cd[i + 28:i + 34]), struct.unpack('<I', cd[i + 42:i + 46])[0])
        name = cd[i + 46:i + 46 + nlen].decode()
        if name.endswith(suffix):
            head = get(url, off, off + 29)
            lnlen, lxlen = struct.unpack('<HH', head[26:30])
            data = get(url, off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize - 1)
            return zlib.decompress(data, -15) if method == 8 else data
        i += 46 + nlen + xlen + clen
    raise ValueError('no %s in %s' % (suffix, url))


def dbf_columns(buf, names):
    """The named columns of a dBASE table, as numpy byte-string arrays."""
    nrec, hlen, rlen = struct.unpack('<IHH', buf[4:12])
    fields, pos, off = {}, 32, 1
    while buf[pos] != 0x0D:
        name = buf[pos:pos + 11].split(b'\0')[0].decode()
        width = buf[pos + 16]
        fields[name] = (off, width)
        off += width
        pos += 32
    rec = np.frombuffer(buf, dtype='S%d' % rlen, count=nrec, offset=hlen)
    raw = rec.view(np.uint8).reshape(nrec, rlen)
    out = {}
    for n in names:
        o, w = fields[n]
        out[n] = raw[:, o:o + w].copy().view('S%d' % w).ravel()
    return out


def main():
    geo = [l.strip().split(',') for l in open(os.path.join(ROOT, 'data', 'zip-centroids.txt')) if l.strip()]
    # every block's ZIP, as sorted arrays for lookup
    ids, zcta = [], []
    rows = (l.decode('utf-8-sig') for l in urllib.request.urlopen(urllib.request.Request(BLOCKS, headers=UA), context=_ctx, timeout=600))
    head = next(rows).strip().split('|')
    iz, ib = head.index('GEOID_ZCTA5_20'), head.index('GEOID_TABBLOCK_20')
    for l in rows:
        f = l.split('|')
        if f[iz]:
            ids.append(int(f[ib])); zcta.append(int(f[iz]))
    ids, zcta = np.array(ids, dtype=np.int64), np.array(zcta, dtype=np.int32)
    order = np.argsort(ids); ids, zcta = ids[order], zcta[order]
    print('blocks in a ZIP: %d' % len(ids), file=sys.stderr)
    # each ZIP's residents, binned
    bins = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for st in STATES:
        t = dbf_columns(zip_member(TIGER % st, '.dbf'), ['GEOID20', 'POP20', 'INTPTLAT20', 'INTPTLON20'])
        pop = t['POP20'].astype(np.int64)
        keep = pop > 0
        gid = t['GEOID20'][keep].astype(np.int64)
        la, lo, pop = t['INTPTLAT20'][keep].astype(float), t['INTPTLON20'][keep].astype(float), pop[keep]
        j = np.searchsorted(ids, gid)
        ok = (j < len(ids)) & (ids[np.minimum(j, len(ids) - 1)] == gid)
        for z, a, b, p in zip(zcta[j[ok]], la[ok], lo[ok], pop[ok]):
            k = (int(z), round(a / BIN), round(b / BIN))
            s = bins[k]; s[0] += int(p); s[1] += a * p; s[2] += b * p
        print('  state %s: %d populated blocks' % (st, int(ok.sum())), file=sys.stderr)
    top = {}
    for (z, _, _), (p, sa, sb) in bins.items():
        if z not in top or p > top[z][0]:
            top[z] = (p, sa / p, sb / p)
    out, moved = [], 0
    for z, la, lo in geo:
        t = top.get(int(z))
        if t:
            la, lo = '%.3f' % t[1], '%.3f' % t[2]; moved += 1
        out.append('%s,%s,%s\n' % (z, la, lo))
    path = os.path.join(ROOT, 'data', 'zip-points.txt')
    open(path + '.tmp', 'w').writelines(out)
    os.replace(path + '.tmp', path)
    print('%d of %d ZIPs now where most of their residents live; %d keep their geographic centre' % (moved, len(geo), len(geo) - moved), file=sys.stderr)


if __name__ == '__main__':
    main()
