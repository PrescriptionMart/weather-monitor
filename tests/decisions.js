// Decision-logic regression tests for the Excursion Check.
//
// These lock down the rules a pharmacist relies on: a heat excursion must
// never clear, an allowance must be measured in the units the label uses, and
// physical evidence that could point two ways must not be read as the
// innocent one. Run by .claude/hooks/check.sh.
//
//   python3 scripts/extract-core.py && node tests/decisions.js
const C = require('./_core.generated.js');
const fs = require('fs'), path = require('path');
const ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'drugs.json'), 'utf8'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra && !cond ? '  — ' + extra : ''));
  if (!cond) failed++;
};
const drug = (n) => { const d = ROWS.find(r => r.name === n); if (!d) throw new Error('no drug ' + n); return d; };

const TZ = 'America/Chicago', F2C = (f) => (f - 32) * 5 / 9;
// A window of whole local days with a realistic diurnal swing, peaking at 3pm.
function weather(nDays, lowF, highF, opts = {}) {
  const s = C.zonedInstant(2026, 7, 6, 0, TZ).getTime(), obs = [];
  for (let h = 0; h < nDays * 24; h++) {
    const hr = h % 24, frac = (Math.cos((hr - 15) / 24 * 2 * Math.PI) + 1) / 2;
    let f = lowF + (highF - lowF) * frac;
    if (opts.dipAt === h) f = opts.dip;
    if (opts.skip && opts.skip(hr)) continue;
    obs.push({ t: new Date(s + h * 3600000), c: F2C(f) });
  }
  return { obs, tz: TZ, start: new Date(2026, 6, 6), end: new Date(s + nDays * 24 * 3600000),
           station: { name: 'KHOU', id: 'KHOU', miles: opts.miles == null ? 3 : opts.miles },
           loc: { name: 'Houston' }, place: { city: 'Houston', state: 'TX' }, zip: '77002' };
}
// shipped Jul 6, received `n` days later
const dates = (n) => C.setDates('2026-07-06', '2026-07-' + String(6 + n).padStart(2, '0'));
function call(d, pack, w, days) {
  if (days == null) days = w ? Math.round((w.end - w.start) / 86400000) : 1;
  dates(days);
  C.setDrug(d); C.onDrugChange(); C.setPack(pack); C.setFrozen(false); C.setResult(w); C.decide();
  return C.verdict();
}

console.log('--- freeze sensitivity is a product property, not a wording accident ---');
const notFS = ROWS.filter(r => r.refrigerated !== false && !r.freezeSensitive);
ok('every refrigerated product is treated as freeze-sensitive', notFS.length === 0, notFS.map(r => r.name).join(', '));
ok('the two Mounjaro rows agree', drug('Mounjaro').freezeSensitive === drug('Mounjaro vials / KwikPen').freezeSensitive);
['Dupixent', 'Humira** verify with mfg', 'Ozempic', 'Novolog vials', 'Enbrel** all formulations', 'Trulicity'].forEach(n => {
  const v = call(drug(n), 'frozen', null, 1);
  ok(`${n}: frozen packs raise the freeze question`, v.cls !== 'ok', `got ${v.cls} "${v.big}"`);
});

ok('every product on the list is freeze-sensitive',
   ROWS.filter(r => !r.freezeSensitive).length === 0,
   ROWS.filter(r => !r.freezeSensitive).map(r => r.name).join(', '));

console.log('\n--- room-temperature products are not cleared by cold packs ---');
// These reach the pack branches only once weather is loaded; before that the
// page sends them straight to the temperature check.
['Afinitor 10mg', 'Opzelura', 'Monovisc'].forEach(n => {
  const d = drug(n);
  const froz = call(d, 'frozen', weather(1, 70, 80), 1);
  ok(`${n}: frozen packs do not clear it`, froz.cls !== 'ok', `got ${froz.cls} "${froz.big}"`);
  const slush = call(d, 'slushy', weather(1, 70, 80), 1);
  ok(`${n}: slushy packs do not clear it`, slush.cls !== 'ok', `got ${slush.cls} "${slush.big}"`);
  ok(`  ${n}: the card says it ran colder than its range`, /colder than its range/.test(slush.big), slush.big);
});
const afi = call(drug('Afinitor 10mg'), 'slushy', weather(1, 70, 80), 1);
ok('  Afinitor: names the 32F box temperature', /32/.test(afi.text));
ok('  Afinitor: names its own 59F floor', /59/.test(afi.text), afi.text.slice(0, 180));
const opz = call(drug('Opzelura'), 'slushy', weather(1, 70, 80), 1);
ok('  Opzelura: credits its cold window rather than just flagging it',
   /label does cover this range/.test(opz.text), opz.text.slice(0, 200));
ok('a refrigerated product with slushy packs still clears',
   call(drug('Dupixent'), 'slushy', weather(3, 80, 98), 3).cls === 'ok');

console.log('\n--- solid packs past the pack-out rating ---');
ok('rating is 48 hours', C.PACKOUT_RATING_HOURS === 48);
const within = call(drug('Dupixent'), 'frozen', null, 1);
ok('inside the rating: still the ordinary freeze question', /CHECK FOR FREEZING FIRST/.test(within.big), within.big);
[3, 5, 10, 30].forEach(n => {
  const v = call(drug('Dupixent'), 'frozen', weather(n, 79, 97), n);
  ok(`${n} days with solid packs never clears`, v.cls !== 'ok', `got ${v.cls} "${v.big}"`);
  if (n === 3) {
    ok('  it names the re-freeze possibility', /re-frozen/.test(v.text), v.text.slice(0, 120));
    ok('  it asks where the box was held', /hub hold|cold-storage/.test(v.text));
    ok('  it asks about the pack shape', /moulded|slumped|void/.test(v.text));
  }
});

console.log('\n--- allowances shorter than a day are counted in hours ---');
ok('Tremfya allowance is 4 hours', drug('Tremfya').allowanceHours === 4);
const t1 = call(drug('Tremfya'), 'warm', weather(1, 68, 75), 1);
ok('a full day out does not clear a 4-hour allowance', t1.cls !== 'ok', `got ${t1.cls} "${t1.big}"`);
ok('  the card counts hours, not days', /hours more|of 4 hours/.test(t1.text), t1.text.slice(0, 200));
ok('  no "well within its limit" script', !/well within its limit/.test(t1.text));
const o1 = call(drug('Orencia Clickjet 125mg/mL'), 'warm', weather(1, 68, 72), 1);
ok('Orencia, 6-hour allowance, one day out does not clear', o1.cls !== 'ok', `got ${o1.cls} "${o1.big}"`);
ok('durationOk is false for a day against 4 hours', C.durationOk(drug('Tremfya'), 1) === false);
ok('durationOk is true for 3 days against 14', C.durationOk(drug('Dupixent'), 3) === true);

console.log('\n--- Tremfya ceiling is marked unverified ---');
ok('Tremfya carries a flag', !!drug('Tremfya').flag);
ok('so it gets the wider margin', C.ceilingMargin(drug('Tremfya')) === C.CEILING_MARGIN_UNCERTAIN_F);
ok('an ordinary row keeps the normal margin', C.ceilingMargin(drug('Dupixent')) === C.CEILING_MARGIN_F);

console.log('\n--- a trip that broke both ends reports both ---');
const both = call(drug('Dupixent'), 'warm', weather(3, 75, 95, { dipAt: 5, dip: 20 }), 3);
ok('headline names both', /cold and heat/i.test(both.big), both.big);
ok('  the 95F peak is shown', /95/.test(both.text));
ok('  the 20F low is shown', /20/.test(both.text));
const coldOnly = call(drug('Dupixent'), 'warm', weather(3, 45, 60, { dipAt: 5, dip: 20 }), 3);
ok('cold alone still reads as cold exposure', /cold exposure/i.test(coldOnly.big), coldOnly.big);

console.log('\n--- the summer heat path still holds ---');
[[70, 78], [75, 85], [80, 98], [85, 105]].forEach(([lo, hi]) => {
  const v = call(drug('Dupixent'), 'warm', weather(3, lo, hi), 3);
  ok(`${lo}-${hi}F never clears`, v.cls !== 'ok', `got ${v.cls}`);
});
ok('7F of headroom clears', call(drug('Dupixent'), 'warm', weather(2, 60, 70), 2).cls === 'ok');
ok('3F of headroom does not', call(drug('Dupixent'), 'warm', weather(2, 60, 74), 2).cls !== 'ok');
ok('14 days at 62-72F clears', call(drug('Dupixent'), 'warm', weather(14, 62, 72), 14).cls === 'ok');
ok('15 days does not', call(drug('Dupixent'), 'warm', weather(15, 62, 72), 15).cls !== 'ok');
ok('a station 41 mi away cannot clear', call(drug('Dupixent'), 'warm', weather(3, 60, 70, { miles: 41 }), 3).cls !== 'ok');
ok('overnight-only readings cannot clear',
   call(drug('Dupixent'), 'warm', weather(3, 60, 70, { skip: (h) => h >= 9 && h <= 20 }), 3).cls !== 'ok');

console.log('\n--- banded products ---');
ok('Aimovig 2 days peaking 90F is covered by its second window',
   call(drug('Aimovig'), 'warm', weather(2, 70, 90), 2).cls === 'ok');
ok('  4 days at 90F is past that window',
   call(drug('Aimovig'), 'warm', weather(4, 70, 90), 4).cls !== 'ok');
ok('  80F falls in the gap between windows',
   /between the published windows/.test(call(drug('Aimovig'), 'warm', weather(2, 70, 80), 2).big));

console.log(failed ? `\n${failed} DECISION TEST(S) FAILED` : '\nAll decision tests passed.');
process.exit(failed ? 1 : 0);
