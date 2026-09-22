#!/usr/bin/env python3
"""Convert the pharmacy's temperature-excursion spreadsheet into data/drugs.json.

Columns are found by header, not position, so a reordered or extended sheet
still converts. The sheet has two parts: one row per product, then (after a
blank gap) a table of manufacturer stability calculators, which is attached to
each product by manufacturer.

What a row carries, and why most rows need no help:
  Excursion Length  "Up to 77°F for no more than 14 days" -> ceiling + allowance
  Max / Min Temp    the ceiling fallback and the floor
  Storage           free text, read for return-to-fridge and cumulative wording

What needs a human decision is in OVERRIDES, each with a reason:
  * Many rows now carry TWO windows: a room-temperature allowance in Storage
    (Humalog: 86°F for 28 days) and a short manufacturer-tool excursion in
    Excursion Length (104°F for 12 hours). Those become `tiers`: the primary
    window plus a band from its ceiling up to the excursion limit, judged in
    hours on the page.
  * Some allowances only apply after first use (Ozempic's 56 days). The page
    must not clear unopened stock on those, so they are flagged by hand after
    reading the text; wording heuristics got this wrong in both directions.
  * Cold allowances below the storage floor (Avonex 23°F for 36 hours,
    Darzalex -4°F in limited episodes) are recorded as cold bands for the card
    to show. They never widen the floor, because their limits are narrower
    than the product's main allowance.

Deliberately NOT converted: the "Credit from Return?" column. It is the
pharmacy's return-credit figures, not stability data, and this repository and
the site it publishes are public.

Usage:  python3 scripts/convert-drugs.py <xlsx> [-o data/drugs.json]
"""
import argparse, json, re, sys
import openpyxl

H = lambda h: 24 * h            # days -> hours, for readability below
def T(minF, maxF, hours, note=None, useWithin=None):
    """A window. `note` is what to tell the patient after a spell in it;
    `useWithin` is the hours the label gives to use it by afterwards."""
    t = dict(minF=minF, maxF=maxF, hours=hours)
    if note: t['note'] = note
    if useWithin: t['useWithinHours'] = useWithin
    return t

LILLY = 'Lilly TempEx stability tool'
OVERRIDES = {
    # ---- two windows: room-temperature allowance + manufacturer excursion ----
    'Aimovig': dict(excursionMaxF=77, allowanceHours=H(7), returnToFridge=False,
        tiers=[T(36, 77, H(7)), T(77, 104, H(2))],
        why='77°F for 7 days at room temperature, and up to 104°F for no more than 2 days. The sheet now '
            'states the high window as "up to 104°F", so it starts at 77°F rather than 86°F.'),
    'Avsola': dict(excursionMaxF=86, allowanceHours=H(180), returnToFridge=False,
        tiers=[T(36, 86, H(180)), T(86, 104, H(30))],
        why='Up to 86°F for a single period of 6 months, or up to 104°F for a single period of 30 days. '
            'Cannot go back into refrigeration once removed.'),
    'Enbrel (all formulations)': dict(excursionMaxF=77, allowanceHours=H(30), returnToFridge=False,
        tiers=[T(36, 77, H(30)), T(77, 107.6, H(4), 'return it to the fridge, and use it within 4 days', useWithin=H(4))],
        flag='The sheet gives 30 days for all formulations. Amgen gives 30 days for the prefilled syringe and '
             'SureClick, but 14 days for the multi-dose vial and dose tray. Confirm which formulation shipped '
             'before relying on 30 days.',
        why='Storage gives 77°F for 30 days (do not return to the fridge). Excursion Length gives unopened '
            'product up to 107.6°F for 4 days, returned to the fridge and used within 4 days.'),
    'Evenity': dict(excursionMaxF=77, allowanceHours=H(30),
        tiers=[T(36, 77, H(30)), T(77, 86, H(5))],
        why='30 days at 77°F, plus up to 86°F for 5 days (120 hours) in addition.'),
    'Prolia': dict(excursionMaxF=77, allowanceHours=H(30),
        tiers=[T(36, 77, H(30)), T(77, 104, H(7), 'return it to the fridge; it keeps to its expiration date')],
        why='Storage: may reach room temperature (77°F) and must be used within 30 days. Excursion: up to '
            '104°F for 7 days, returned to storage.'),
    'Repatha': dict(excursionMaxF=77, allowanceHours=H(30), returnToFridge=False,
        tiers=[T(36, 77, H(30)), T(77, 104, H(3), 'do not return it to the fridge')],
        flag='The Storage cell on this row is Prolia\'s text (it names Prolia). The 77°F / 30-day room '
             'temperature window is carried over from the previous sheet. Confirm against the label.',
        why='Excursion: up to 104°F for 3 days, do not return to the fridge. Primary window carried over '
            'because the Storage cell was copied from Prolia.'),
    'Otezla': dict(refrigerated=False, excursionMaxF=86, allowanceHours=None, excursionMinF=59,
        tiers=[T(86, 104, H(30))],
        why='Tablets. IR: store below 86°F, excursions to 104°F for up to 30 days. ER allows 180 days; the '
            'shorter IR figure is used since the row covers both.'),
    # Lilly: Storage carries the room-temperature allowance, Excursion Length the TempEx figure.
    'Basaglar':  dict(excursionMaxF=86, allowanceHours=H(28), tiers=[T(36, 86, H(28)), T(86, 104, 4)],
        why=f'86°F for 28 days before and after opening (Storage); up to 104°F for 4 hours ({LILLY}).'),
    'Ebglyss':   dict(excursionMaxF=86, allowanceHours=H(7), tiers=[T(36, 86, H(7)), T(86, 104, 4)],
        why=f'86°F for 7 days (Storage); up to 104°F for 4 hours ({LILLY}).'),
    'Emgality':  dict(excursionMaxF=86, allowanceHours=H(7), returnToFridge=False,
        tiers=[T(36, 86, H(7)), T(86, 95, H(4))],
        why=f'86°F for 7 days, do not place back in the fridge (Storage); up to 95°F for 4 days ({LILLY}).'),
    'Forteo':    dict(excursionMaxF=77, allowanceHours=36, noExcursion=False, returnToFridge=True,
        tiers=[T(36, 77, 36), T(77, 104, 4)],
        why=f'Previously "no excursions allowed". The sheet now gives travel data of up to 77°F for 36 hours '
            f'(back in the fridge on arrival) and up to 104°F for 4 hours ({LILLY}).'),
    'Humalog/Humulin': dict(excursionMaxF=86, allowanceHours=H(28), tiers=[T(36, 86, H(28)), T(86, 104, 12)],
        why=f'86°F for 28 days before and after opening (Storage); up to 104°F for 12 hours ({LILLY}).'),
    'Humatrope': dict(excursionMaxF=104, allowanceHours=12,
        why=f'No room-temperature allowance in Storage, so the only window is the TempEx figure: up to '
            f'104°F for 12 hours ({LILLY}). Judged against elapsed hours.'),
    'Lyumjev':   dict(excursionMaxF=86, allowanceHours=H(28), tiers=[T(36, 86, H(28)), T(86, 104, 24)],
        why=f'86°F for 28 days (Storage); up to 104°F for 24 hours ({LILLY}).'),
    'Mounjaro':  dict(excursionMaxF=86, allowanceHours=H(21), cumulative=True, returnToFridge=True,
        tiers=[T(36, 86, H(21)), T(86, 104, 24)],
        why=f'21 days at room temperature, cumulative (Storage; the 86°F ceiling is carried over because '
            f'Storage names no temperature); up to 104°F for 24 hours ({LILLY}).'),
    'Taltz':     dict(excursionMaxF=86, allowanceHours=H(5), returnToFridge=False,
        tiers=[T(36, 86, H(5)), T(86, 104, 8)],
        why=f'86°F for 5 days, do not return to the fridge (Storage); up to 104°F for 8 hours ({LILLY}). '
            f'Settles the old 77°F vs 86°F conflict in favour of the label\'s 86°F.'),
    'Trulicity': dict(excursionMaxF=86, allowanceHours=H(14), cumulative=True, returnToFridge=True,
        tiers=[T(36, 86, H(14)), T(86, 104, 14)],
        why=f'14 days total out of the fridge, in and out allowed (Storage; 86°F carried over because '
            f'Storage names no temperature); up to 104°F for 14 hours ({LILLY}).'),
    'Zepbound':  dict(excursionMaxF=86, allowanceHours=H(21), cumulative=True, returnToFridge=True,
        tiers=[T(36, 86, H(21)), T(86, 104, 24)],
        why=f'86°F for a total of 21 days, may go back in the fridge (Storage); up to 104°F for 24 hours ({LILLY}).'),

    # ---- allowance applies only after first use: never clear unopened stock on it ----
    **{n: dict(inUseAllowance=True,
               flag='The room-temperature figure in the sheet applies after first use. The sheet gives no '
                    'allowance for an unopened pen in transit. Check the label or the manufacturer before '
                    'relying on it.',
               why=w) for n, w in {
        'Ozempic':  'Storage: "Once opened, can be stored in fridge or at room temp up to 56 days."',
        'Saxenda':  'Storage: "After initial use, the pen can be stored for 30 days."',
        'Victoza':  'Storage: "After initial use, the pen can be stored for 30 days."',
        'Xultophy': 'Storage: "After the first use, the pen can be stored for 21 days."',
        'Soliqua':  'Storage: refrigerate before first use; room temperature only after first use.',
        'Toujeo':   'Storage: unopened pens refrigerated until expiration; 56 days only once opened.',
        'Norditropin': 'Storage: "After first use, pens may be stored ... at room temperature (up to 77F) for 3 weeks."',
    }.items()},

    # ---- presentation-dependent rows: take the strictest figure ----
    'Novolin (N and R)': dict(excursionMaxF=77, allowanceHours=H(28),
        flag='Presentation matters: N and R vials allow 77°F for 42 days, N pens 86°F for 28 days. The '
             'strictest of each (77°F, 28 days) is used. Confirm which presentation shipped.',
        why='Three presentations with different windows in one row; strictest ceiling and duration used.'),
    'Fiasp FlexTouch cartridges': dict(excursionMaxF=86, allowanceHours=H(18),
        flag='Penfill allows 28 days, PumpCart 18 days (unopened). The shorter 18 days is used. Confirm '
             'which cartridge shipped.',
        why='Two cartridge types with different windows in one row; the shorter is used.'),
    'Retacrit': dict(flag='The 30 days at 77°F applies to the single-dose vial only. Confirm the presentation.',
        why='Excursion Length limits the allowance to the single-dose vial.'),

    # ---- single-row judgments ----
    'Tremfya': dict(excursionMaxF=77, allowanceHours=24,
        why='Up to 77°F for 4 hours in preparation for administration, or for up to 24 hours during '
            'delivery and transportation. Transit is what this tool checks, so 24 hours. The Max Temp '
            'cell (86°F) is not the excursion limit.'),
    'Skyrizi': dict(cumulative=True, returnToFridge=True,
        why='Up to 86°F for 48 hours; may go back in the fridge if the 48 hours has not expired.'),
    'Sogroya': dict(cumulative=True, returnToFridge=True,
        why='Up to 77°F for 72 hours total excursion time, may be placed back in the fridge. The sheet now '
            'states this as an excursion allowance, not only as an after-first-use discard rule.'),
    'Actemra': dict(returnToFridge=True,
        why='Up to 86°F for 2 weeks, then return to the refrigerator. Do not use if it went above 86°F.'),
    'Dupixent': dict(excursionMaxF=86, allowanceHours=H(14), excursionMinF=32, returnToFridge=True, cumulative=True,
        why='Excursions up to 86°F or down to 32°F for no more than 14 days showed no impact on quality, '
            'and it may go back in the fridge within the 14 days. The 32°F floor has the same 14-day limit '
            'as the main allowance, so it is used as the floor.'),
    'Genotropin': dict(allowanceHours=H(14),
        why='Before reconstitution: 77°F for 14 days. (Previously "no excursions allowed".)'),
    'Avonex': dict(excursionMinF=36, tiers=[T(23, 36, 36)],
        why='The Min Temp cell reads 23°F, from "transient exposure as low as 23°F for up to 36 hours had '
            'no impact on quality". That limit is far shorter than the 7-day allowance, so the floor stays '
            '36°F and 23-36°F is kept as a cold band for the card to show.'),
    'Darzalex & Darzalex Faspro': dict(noExcursion=True, excursionMaxF=46, excursionMinF=36, cumulative=False, allowanceHours=None,
        tiers=[T(-4, 34, H(9), 'no more than 3 excursions of up to 3 days each')],
        why='No excursion data above 46°F, so no warm allowance. Cold excursions of -4 to 34°F are '
            'permitted for 9 days cumulative in no more than 3 excursions; kept as a cold band, since the '
            'episode limits cannot be checked from a weather record.'),
    'Afinitor': dict(refrigerated=False,
        why='Tablets, controlled room temperature 68-77°F, brief excursions 59-86°F. Not a cold-chain product.'),
    'Monovisc':  dict(refrigerated=False, noExcursion=False, excursionMinF=None, allowanceHours=None,
        why='Room-temperature product, stored below 77°F. "No excursions" means never above 77°F.'),
    'Orthovisc': dict(refrigerated=False, noExcursion=False, excursionMinF=None, allowanceHours=None,
        why='Room-temperature product, stored below 77°F. "No excursions" means never above 77°F.'),
    'Opzelura': dict(refrigerated=False, excursionMaxF=86, allowanceHours=H(28),
        tiers=[T(59, 86, H(28)), T(86, 104, H(20)), T(-4, 59, H(4))],
        why='Room-temperature cream with three banded allowances. The 59-86°F band is the everyday one.'),
}

CALC_RE = re.compile(r'https?://\S+')
NO_EXC_RE = re.compile(r'no excursions? allowed', re.I)
# "Up to 86°F", "Up to 77° for". The degree sign or F is required, otherwise
# "up to 14 days" reads as a temperature of 14.
TEMP_RE = re.compile(r'up to\s*(\d{2,3}(?:\.\d)?)\s*(?:°\s*F?|F)\b', re.I)
DUR_RE = re.compile(r'(?:no more than|up to|within|<)?\s*(?:a total of\s*)?(\d+)\s*(hours?|hrs?|days?|ds\b|weeks?|months?)', re.I)
ONE_MONTH_RE = re.compile(r'\bone month\b', re.I)
HEADERS = {'name': ('drug', 'name', 'product'), 'manufacturer': ('manufacturer',), 'ndc': ('ndc',),
           'excursion': ('excursion',), 'max': ('max temp',), 'min': ('min temp',),
           'light': ('protect from light',), 'storage': ('storage',)}
MFR_ALIASES = {'genetech': 'genentech', 'abbvie': 'abbvie', 'sanofi / regeneron': 'sanofi'}

def duration_hours(text):
    if ONE_MONTH_RE.search(text): return 30 * 24
    m = DUR_RE.search(text)
    if not m: return None
    n, unit = int(m.group(1)), m.group(2).lower()
    if unit.startswith(('hour', 'hr')): return n
    if unit.startswith(('day', 'ds')):  return n * 24
    if unit.startswith('week'):         return n * 24 * 7
    if unit.startswith('month'):        return n * 24 * 30
    return None

def clean(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v is not None else ''

def num(v):
    """A temperature cell, which can carry a footnote marker like '86*'."""
    if v is None: return None, False
    m = re.match(r'^\s*(-?\d+(?:\.\d+)?)', str(v))
    if not m: return None, bool(str(v).strip())
    f = float(m.group(1))
    return (int(f) if f.is_integer() else f), '*' in str(v)

def header_map(row):
    cols = {}
    for i, h in enumerate(row):
        h = clean(h).lower()
        for key, names in HEADERS.items():
            if key not in cols and any(h.startswith(n) for n in names): cols[key] = i
    missing = [k for k in ('name', 'excursion', 'max', 'min', 'storage') if k not in cols]
    if missing: sys.exit(f'sheet is missing columns: {", ".join(missing)}')
    return cols

def mfr_key(s):
    k = clean(s).lower()
    return MFR_ALIASES.get(k, k)

def tiers_text(tiers):
    def dur(h):
        return f'{h} hours' if h < 24 else (f'{h // 24} days' if h % 24 == 0 else f'{h} hours')
    warm = [t for t in tiers if t['maxF'] > 40]
    return ', and '.join(f"up to {t['maxF']}°F for {dur(t['hours'])}" for t in warm) or None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx'); ap.add_argument('-o', '--out', default='data/drugs.json')
    a = ap.parse_args()
    ws = openpyxl.load_workbook(a.xlsx, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    cols = header_map(rows[0])
    get = lambda r, k: r[cols[k]] if k in cols and cols[k] < len(r) else None

    # products run until the first blank row; the calculators table follows it
    products, calcs, i = [], {}, 1
    while i < len(rows) and any(rows[i]): products.append(rows[i]); i += 1
    for r in rows[i:]:
        if r and r[0] and len(r) > 1 and r[1] and str(r[1]).startswith('http'):
            calcs[mfr_key(r[0])] = dict(name=clean(r[0]), url=clean(r[1]))

    out, notes, unused = [], [], set(OVERRIDES)
    for r in products:
        name = clean(get(r, 'name'))
        exc_text = clean(get(r, 'excursion')).replace('*F', '°F').replace('*C', '°C')
        exc_text = re.sub(r'(\d)\s*\*(?!\*)', r'\1°', exc_text)
        storage = clean(get(r, 'storage'))
        smax, max_footnote = num(get(r, 'max'))
        smin, _ = num(get(r, 'min'))
        blob = (exc_text + ' ' + storage).lower()
        mfr = clean(get(r, 'manufacturer')) or None

        d = dict(
            name=name, manufacturer=mfr, ndc=clean(get(r, 'ndc')) or None,
            storageMinF=smin, storageMaxF=smax,
            excursionMinF=smin, excursionMaxF=None,
            excursionNote=re.sub(r'\s*\*?Info obtained through stability tool:?\s*\S*', '', exc_text).rstrip('* '),
            storage=storage,
            allowanceHours=None, cumulative=False, returnToFridge=None,
            noExcursion=False, refrigerated=True, calculatorUrl=None, inUseAllowance=False,
            protectFromLight=clean(get(r, 'light')).lower().startswith('y'),
            freezeSensitive=True,
        )
        if NO_EXC_RE.search(exc_text):
            d['noExcursion'] = True
            d['excursionMaxF'] = smax
        else:
            t = TEMP_RE.search(exc_text)
            d['excursionMaxF'] = (float(t.group(1)) if '.' in t.group(1) else int(t.group(1))) if t else smax
            d['allowanceHours'] = duration_hours(exc_text)

        if 'cumulative' in blob or 'in and out' in blob or 'total excursion time' in blob:
            d['cumulative'] = True
        # Read sentence by sentence and skip in-use rules: "do not put pen back in
        # the refrigerator after first use" says nothing about unopened stock in
        # transit, and reading it as one marked four insulins wrongly.
        transit = [x for x in re.split(r'(?<=[.;)])\s+', blob)
                   if not re.search(r'first use|initial use|once opened|after opening|once open\b', x)]
        if any(re.search(r'do\s*not\s*(return|put|place).{0,20}(fridge|refrigerat)|cannot (go back|be returned)', x) for x in transit):
            d['returnToFridge'] = False
        elif any(re.search(r'(may|can) (be placed |go )?back (in)?to the |(may|can) be placed back in|may go back into', x) for x in transit):
            d['returnToFridge'] = True

        ov = dict(OVERRIDES.get(name, {}))
        unused.discard(name)
        why = ov.pop('why', None)
        d.update(ov)
        if why: d['derivation'] = why
        if max_footnote and 'derivation' not in d:
            d['flag'] = 'The Max Temp cell carries a footnote marker in the sheet — read the excursion text.'

        # a URL is only routed to "use the calculator" when the row gave no numbers at all
        url = CALC_RE.search(exc_text)
        if url and d['allowanceHours'] is None and not d['noExcursion'] and d.get('refrigerated') is not False:
            d['calculatorUrl'] = url.group(0)
        c = calcs.get(mfr_key(mfr or ''))
        if c: d['mfrCalculator'] = c
        if d.get('tiers'):
            d['excursionNote'] = (tiers_text(d['tiers']) or d['excursionNote'])
            d['excursionNote'] = d['excursionNote'][0].upper() + d['excursionNote'][1:]

        if d['excursionMaxF'] is not None and smax is not None and d['excursionMaxF'] != smax:
            notes.append(f"  {name:40} ceiling {d['excursionMaxF']}°F, sheet Max Temp says {smax}°F")
        out.append(d)

    if unused: sys.exit(f'OVERRIDES name rows not in the sheet: {", ".join(sorted(unused))}')
    out.sort(key=lambda x: x['name'].lower())
    with open(a.out, 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')

    print(f'wrote {len(out)} products to {a.out}; {len(calcs)} manufacturer calculators')
    print(f'\nceiling differs from the Max Temp column ({len(notes)}):')
    print('\n'.join(notes) or '  (none)')
    for label, pred in [('no warm excursion allowed', lambda x: x['noExcursion']),
                        ('allowance via manufacturer calculator only', lambda x: x['calculatorUrl']),
                        ('cumulative allowance', lambda x: x['cumulative']),
                        ('must NOT go back in the fridge', lambda x: x['returnToFridge'] is False),
                        ('not refrigerated', lambda x: not x['refrigerated']),
                        ('allowance is an AFTER-FIRST-USE figure', lambda x: x.get('inUseAllowance')),
                        ('banded/tiered allowance', lambda x: x.get('tiers')),
                        ('flagged for review', lambda x: x.get('flag')),
                        ('no manufacturer calculator matched', lambda x: not x.get('mfrCalculator')),
                        ('no allowance duration parsed', lambda x: x['allowanceHours'] is None and not x['noExcursion'] and not x['calculatorUrl'])]:
        hits = [x['name'] for x in out if pred(x)]
        print(f'\n{label} ({len(hits)}): {", ".join(hits) if hits else "(none)"}')

if __name__ == '__main__':
    sys.exit(main())
