#!/usr/bin/env python3
"""Convert the Temperature Sensitive Stabilities spreadsheet into data/drugs.json.

The sheet's "Max Temp (F)" column is not consistently one thing: for some rows
it is the refrigerated storage ceiling (Nivestym 46) and for others it is the
room-temperature excursion ceiling (Dupixent 77). The page needs the excursion
ceiling, so that is parsed out of the excursion text and the column is kept
separately as the storage ceiling. Every row where the two disagree is printed
for review.

Usage:  python3 scripts/convert-drugs.py <xlsx> [-o data/drugs.json]
"""
import argparse, json, re, sys
import openpyxl

# Rows needing a human decision the text alone can't supply. Each entry says why.
OVERRIDES = {
    'Afinitor 10mg': dict(refrigerated=False,
        why='Tablets, controlled room temperature 68-77F. Not a cold-chain product.'),
    'Monovisc': dict(refrigerated=False, excursionMinF=None,
        why='Room-temperature product, stored below 77F. The blank Min Temp cell is correct, not missing.'),
    'Aimovig': dict(excursionMaxF=77, allowanceHours=7*24, returnToFridge=False,
        tiers=[dict(minF=36, maxF=77, hours=7*24), dict(minF=86, maxF=104, hours=2*24)],
        why='Max Temp cell carries a footnote marker (104**). Label allowance is 77F for 7 days, '
            'with separate data showing 2 days at 86-104F. Do not return to the fridge.'),
    'Mounjaro': dict(excursionMaxF=86, excursionMinF=36, storageMinF=36, storageMaxF=46,
        allowanceHours=21*24, cumulative=True, returnToFridge=True,
        why='Both temperature cells are blank in the sheet. 86F/21 days taken from the excursion text '
            '(single-use autoinjector); vials and KwikPens get 30 days, split into their own row.'),
    'Skyrizi': dict(excursionMaxF=77, allowanceHours=24, returnToFridge=True,
        why='Max Temp cell still reads 46 (the fridge ceiling). The excursion text gives 77F for 24 hours.'),
    'Sogroya 10mg/1.5mL': dict(excursionMaxF=77, allowanceHours=72, cumulative=True, returnToFridge=True,
        inUseAllowance=True,
        flag='The 72 hours is tied to first use — the sheet reads "discarded 6 weeks after first use if '
             'refrigerated while not in use, or in 72 hours if kept at room temperature." The allowance for '
             'an unopened pen in transit may differ. Verify against the label.',
        why='Max Temp cell reads 86, which is the hard discard limit. The allowance ceiling is 77F.'),
    'Sogroya 15mg/1.5mL': dict(excursionMaxF=77, allowanceHours=72, cumulative=True, returnToFridge=True,
        inUseAllowance=True,
        flag='The 72 hours is tied to first use — the sheet reads "discarded 6 weeks after first use if '
             'refrigerated while not in use, or in 72 hours if kept at room temperature." The allowance for '
             'an unopened pen in transit may differ. Verify against the label.',
        why='Max Temp cell reads 86, which is the hard discard limit. The allowance ceiling is 77F.'),
    # The sheet's allowance here is an AFTER-FIRST-USE figure, not an allowance for
    # unopened stock in transit — which is what this tool always looks at. Flagged
    # rather than changed: the unopened allowance could not be verified from here.
    'Norditropin FP': dict(inUseAllowance=True,
        flag='The 21 days at 77F is an AFTER-FIRST-USE figure. The sheet\'s own storage note reads '
             '"After first use, pens may be stored in the refrigerator for 4 weeks or at room '
             'temperature (up to 77F) for 3 weeks." An unopened pen in transit may have no '
             'room-temperature allowance at all. Verify against the label before relying on 21 days.'),
    'Enbrel** all formulations': dict(
        flag='The sheet gives 30 days for all formulations. Amgen gives 30 days for the prefilled '
             'syringe and SureClick, but 14 days for the multi-dose vial and dose tray. Confirm which '
             'formulation shipped before relying on 30 days.'),
    'Taltz': dict(excursionMaxF=77,
        flag='The sheet disagrees with itself: the excursion column says 77°F, the storage note says 86°F. '
             'The stricter 77°F is used. Lilly\'s label says 86°F for 5 days, so confirm before relying on it.',
        why='Excursion column (77°F) taken over the storage note (86°F) as the conservative reading.'),
    'Opzelura': dict(refrigerated=False, excursionMaxF=86, allowanceHours=28*24,
        tiers=[dict(minF=59, maxF=86, hours=28*24), dict(minF=86, maxF=104, hours=20*24),
               dict(minF=-4, maxF=59, hours=4*24)],
        why='Room-temperature cream with three banded allowances. The 59-86°F band is the everyday one.'),
    'Tremfya': dict(
        flag='The sheet publishes no room-temperature ceiling for Tremfya: the excursion column reads '
             'only "< 4hrs". The 86°F used here is the sheet\'s own Max Temp cell, not a label excursion '
             'limit, so the ceiling gets the wider margin. Confirm against the label before relying on it.',
        why='Excursion text carries a duration but no temperature. The ceiling is inherited from the '
            'Max Temp cell and is not label-verified.'),
    'Trulicity': dict(cumulative=True, returnToFridge=True,
        why='Label allows going in and out of the fridge so long as total time out stays under 14 days.'),
    'Zepbound': dict(cumulative=True, returnToFridge=True,
        why='Single-use autoinjector; may be returned to the fridge, 21 days total.'),
}

# Extra rows the sheet folds into one line.
EXTRA_ROWS = [
    dict(after='Mounjaro', name='Mounjaro vials / KwikPen', ndc=None,
         excursionText='Up to 86°F for no more than a total of 30 days',
         storage='May store up to 30 days at room temperature (may go in and out of the fridge; 30 days cumulative).',
         storageMinF=36, storageMaxF=46, excursionMaxF=86, excursionMinF=36,
         allowanceHours=30*24, cumulative=True, returnToFridge=True, refrigerated=True,
         protectFromLight=True, freezeSensitive=True,
         why='Split from the Mounjaro row, which states 21 days for the autoinjector and 30 for vials/KwikPens.'),
]

CALC_RE = re.compile(r'https?://\S+')
NO_EXC_RE = re.compile(r'no excursions? allowed', re.I)
# "Up to 86°F", "Up to 77° for". The degree sign or F is required, otherwise
# "up to 14 days" reads as a temperature of 14.
TEMP_RE = re.compile(r'up to\s*(\d{2,3})\s*(?:°\s*F?|F)\b', re.I)
DUR_RE = re.compile(r'(?:no more than|up to|within|<)?\s*(?:a total of\s*)?(\d+)\s*(hours?|hrs?|days?|ds\b|weeks?|months?)', re.I)
ONE_MONTH_RE = re.compile(r'\bone month\b', re.I)

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

def norm_temp(v):
    """Sheet temperatures can carry footnote markers like '104**'."""
    if v is None: return None, False
    m = re.match(r'^\s*(-?\d+)', str(v))
    if not m: return None, True
    return int(m.group(1)), bool(re.search(r'\*', str(v)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx'); ap.add_argument('-o', '--out', default='data/drugs.json')
    a = ap.parse_args()
    ws = openpyxl.load_workbook(a.xlsx, data_only=True)['Sheet1']
    rows = [r for r in ws.iter_rows(values_only=True) if r and r[0]]

    out, notes = [], []
    for r in rows[1:]:
        name = clean(r[0])
        exc_text = clean(r[2]).replace('*F', '°F').replace('*C', '°C')
        exc_text = re.sub(r'(\d)\s*\*(?!\*)', r'\1°', exc_text)
        storage = clean(r[6])
        smax, max_footnote = norm_temp(r[3])
        smin, _ = norm_temp(r[4])
        blob = exc_text + ' ' + storage

        d = dict(
            name=name, ndc=clean(r[1]) or None,
            storageMinF=smin, storageMaxF=smax,
            excursionMinF=smin, excursionMaxF=None,
            excursionNote=exc_text, storage=storage,
            allowanceHours=None, cumulative=False, returnToFridge=None,
            noExcursion=False, refrigerated=True, calculatorUrl=None, inUseAllowance=False,
            protectFromLight=clean(r[5]).lower().startswith('y'),
            # provisional: replaced below for every refrigerated product
            freezeSensitive='do not freeze' in blob.lower() or 'avoid freezing' in blob.lower(),
        )

        if NO_EXC_RE.search(exc_text):
            d['noExcursion'] = True
            d['excursionMaxF'] = smax
        else:
            url = CALC_RE.search(exc_text)
            if url:
                d['calculatorUrl'] = url.group(0)
                d['excursionNote'] = 'Allowance varies by product and whether the pen has been used — check the manufacturer calculator.'
                d['excursionMaxF'] = smax
            else:
                t = TEMP_RE.search(exc_text)
                d['excursionMaxF'] = t and int(t.group(1)) or smax
                d['allowanceHours'] = duration_hours(exc_text)

        low = blob.lower()
        if 'cumulative' in low or 'in and out' in low or 'total excursion time' in low:
            d['cumulative'] = True
        if re.search(r'do\s*not\s*(return|put).{0,20}(fridge|refrigerat)', low):
            d['returnToFridge'] = False
        elif re.search(r'may (be placed |go )?back (in)?to the |may be placed back in|can be placed back in|may go back into', low):
            d['returnToFridge'] = True

        ov = OVERRIDES.get(name, {})
        why = ov.pop('why', None) if ov else None
        if ov: d.update(ov)
        if why: d['derivation'] = why

        # Freeze sensitivity is a property of the product, not of how the sheet
        # happens to be worded. Deriving it from the phrase "do not freeze" made
        # it an accident of transcription: the Mounjaro autoinjector row came out
        # false and the vial/KwikPen row true, for the same molecule. Every
        # refrigerated product in this catalogue is a protein or peptide
        # injectable that freezing damages irreversibly, and the damage is not
        # reliably visible, so the flag is set from the product type instead.
        if d.get('refrigerated') is not False:
            d['freezeSensitive'] = True
        if max_footnote and 'derivation' not in d:
            d['flag'] = 'The Max Temp cell carries a footnote marker in the sheet — read the excursion text.'

        if d['excursionMaxF'] is not None and smax is not None and d['excursionMaxF'] != smax:
            notes.append(f"  {name:44} ceiling {d['excursionMaxF']}°F from text, sheet Max Temp says {smax}°F")
        out.append(d)

        for extra in EXTRA_ROWS:
            if extra.get('after') == name:
                e = {k: v for k, v in extra.items() if k != 'after'}
                e['derivation'] = e.pop('why', None)
                e.setdefault('noExcursion', False); e.setdefault('calculatorUrl', None)
                e['excursionNote'] = e.pop('excursionText')
                out.append(e)

    out.sort(key=lambda x: x['name'].lower())
    with open(a.out, 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')

    print(f'wrote {len(out)} products to {a.out}')
    print(f'\nceiling taken from the excursion text rather than the Max Temp column ({len(notes)}):')
    print('\n'.join(notes) or '  (none)')
    for label, pred in [('no excursion allowed', lambda x: x['noExcursion']),
                        ('allowance via manufacturer calculator', lambda x: x['calculatorUrl']),
                        ('cumulative allowance', lambda x: x['cumulative']),
                        ('must NOT go back in the fridge', lambda x: x['returnToFridge'] is False),
                        ('not refrigerated', lambda x: not x['refrigerated']),
                        ('allowance is an AFTER-FIRST-USE figure', lambda x: x.get('inUseAllowance')),
                        ('banded/tiered allowance', lambda x: x.get('tiers')),
                        ('no allowance duration parsed', lambda x: x['allowanceHours'] is None and not x['noExcursion'] and not x['calculatorUrl'])]:
        hits = [x['name'] for x in out if pred(x)]
        print(f'\n{label} ({len(hits)}): {", ".join(hits) if hits else "(none)"}')

if __name__ == '__main__':
    sys.exit(main())
