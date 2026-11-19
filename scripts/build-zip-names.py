#!/usr/bin/env python3
"""Writes data/zip-names.txt: each US ZIP's post-office city ("95301,Atwater,CA"), so the
Winter Pack's label check can say which place a ZIP is.

From the GeoNames postal-code list (https://download.geonames.org/export/zip/US.zip),
licensed CC BY 4.0: the page credits GeoNames. It covers every ZIP, PO-box and company
ZIPs too. Names are kept to letters, spaces and . ' - so the file can't carry markup.
ZIP names barely change, so this is run by hand:

  python3 scripts/build-zip-names.py
"""
import csv, io, os, re, ssl, sys, urllib.request, zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
URL = 'https://download.geonames.org/export/zip/US.zip'
UA = {'User-Agent': 'PrescriptionMart weather-monitor (github.com/PrescriptionMart/weather-monitor)'}


def main():
    cafile = os.environ.get('SSL_CERT_FILE')
    ctx = ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()
    with urllib.request.urlopen(urllib.request.Request(URL, headers=UA), context=ctx, timeout=120) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    names = {}
    for row in csv.reader(io.TextIOWrapper(z.open('US.txt'), encoding='utf-8'), delimiter='\t'):
        zip5, city, st = row[1], row[2].strip(), row[4].strip()
        if re.fullmatch(r'\d{5}', zip5) and re.fullmatch(r'[A-Z]{2}', st) and re.fullmatch(r"[^\W\d_][\w .'-]*", city) and '_' not in city:
            names[zip5] = '%s,%s,%s\n' % (zip5, city, st)
    path = os.path.join(ROOT, 'data', 'zip-names.txt')
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        f.writelines(names[k] for k in sorted(names))
    os.replace(path + '.tmp', path)
    print('%d ZIP names' % len(names), file=sys.stderr)


if __name__ == '__main__':
    main()
