// Decision-logic regression tests for the Excursion Check.
//
// These lock down the rules a pharmacist relies on: a heat excursion must
// never clear, an allowance is measured in the units the label uses, a
// manufacturer window is judged in hours, and physical evidence that could
// point two ways is never read as the innocent one. Where a rule should hold
// for every product it is checked across the whole sheet, not a sample.
// Run by .claude/hooks/check.sh:
//
//   python3 scripts/extract-core.py && node tests/decisions.js
const C = require('./_core.generated.js');
const fs = require('fs'), path = require('path');
const ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'drugs.json'), 'utf8'));

let failed = 0, passed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) passed++; else failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra && !cond ? '  — ' + extra : ''));
};
const drug = (n) => { const d = ROWS.find(r => r.name === n); if (!d) throw new Error('no drug ' + n); return d; };

const TZ = 'America/Chicago', F2C = (f) => (f - 32) * 5 / 9;
const S0 = () => C.zonedInstant(2026, 7, 6, 0, TZ).getTime();
function result(nDays, obs, miles = 3) {
  return { obs, tz: TZ, start: new Date(2026, 6, 6), end: new Date(S0() + nDays * 24 * 3600000),
           station: { name: 'KHOU', id: 'KHOU', miles }, loc: { name: 'Houston' },
           place: { city: 'Houston', state: 'TX' }, zip: '77002' };
}
// whole local days with a diurnal swing that peaks at 3pm
function weather(nDays, lowF, highF, opts = {}) {
  const obs = [];
  for (let h = 0; h < nDays * 24; h++) {
    const hr = h % 24, frac = (Math.cos((hr - 15) / 24 * 2 * Math.PI) + 1) / 2;
    let f = lowF + (highF - lowF) * frac;
    if (opts.dipAt === h) f = opts.dip;
    if (opts.dipFrom != null && h >= opts.dipFrom && h < opts.dipFrom + opts.dipHours) f = opts.dip;
    if (opts.skip && opts.skip(hr)) continue;
    obs.push({ t: new Date(S0() + h * 3600000), c: F2C(f) });
  }
  return result(nDays, obs, opts.miles == null ? 3 : opts.miles);
}
// flat base temperature with exactly `hot` hours at `hotF`, each afternoon
function hotHours(nDays, baseF, hot, hotF) {
  const obs = []; let left = hot;
  for (let h = 0; h < nDays * 24; h++) {
    const hr = h % 24;
    const f = (left > 0 && hr >= 24 - Math.ceil(hot / nDays)) ? (left--, hotF) : baseF;
    obs.push({ t: new Date(S0() + h * 3600000), c: F2C(f) });
  }
  return result(nDays, obs);
}
{
  const w = hotHours(1, 70, 16, 95), n = C.summarize(w.obs, TZ, 86, 36, w).reduce((a, x) => a + x.above, 0);
  if (n !== 16) { console.log(`FAIL fixture: hotHours(1, 70, 16, 95) gave ${n} hot hours`); process.exit(1); }
}
// shipped Jul 6, received n days later
const dates = (n) => C.setDates('2026-07-06', '2026-07-' + String(6 + n).padStart(2, '0'));
function call(d, pack, w, days) {
  if (days == null) days = w ? Math.round((w.end - w.start) / 86400000) : 1;
  dates(days);
  C.setDrug(d); C.onDrugChange(); C.setPack(pack); C.setFrozen(false); C.setResult(w); C.decide();
  return C.verdict();
}
const REFRIG = ROWS.filter(r => r.refrigerated !== false), ROOM = ROWS.filter(r => r.refrigerated === false);

console.log('--- the data itself ---');
ok('64 products', ROWS.length === 64, String(ROWS.length));
ok('names are unique', new Set(ROWS.map(r => r.name)).size === ROWS.length);
ok('no return-credit figures published', ROWS.every(r => !Object.keys(r).some(k => /credit/i.test(k))));
ok('nothing is routed to "use the calculator" when the sheet gives numbers', ROWS.every(r => !r.calculatorUrl));
ok('every Lilly row links the TempEx calculator',
   ROWS.filter(r => r.manufacturer === 'Eli Lilly').every(r => r.mfrCalculator && /tempex\.lilly/.test(r.mfrCalculator.url)));
ok('every warm window starts at the main ceiling (no uncovered gap)',
   ROWS.every(r => C.warmBands(r).every(t => t.minF <= r.excursionMaxF)),
   ROWS.filter(r => C.warmBands(r).some(t => t.minF > r.excursionMaxF)).map(r => r.name).join(', '));
ok('Repatha carries its data-error flag', /Prolia/.test(drug('Repatha').flag || ''));
ok('Tremfya: 77°F for 24 hours, no longer flagged',
   drug('Tremfya').excursionMaxF === 77 && drug('Tremfya').allowanceHours === 24 && !drug('Tremfya').flag);

console.log('\n--- freezing ---');
ok('every product is freeze-sensitive', ROWS.every(r => r.freezeSensitive));
{
  const cleared = ROWS.filter(r => call(r, 'frozen', r.refrigerated === false ? weather(1, 70, 80) : null, 1).cls === 'ok');
  ok('frozen packs clear no product at all', cleared.length === 0, cleared.map(r => r.name).join(', '));
}
{
  const cleared = REFRIG.filter(r => call(r, 'frozen', weather(3, 79, 97), 3).cls === 'ok');
  ok('solid packs after 3 days clear no refrigerated product', cleared.length === 0, cleared.map(r => r.name).join(', '));
  const v = call(drug('Humira'), 'frozen', weather(3, 79, 97), 3);
  ok('  the card names re-freezing, the hold and the pack shape',
     /re-frozen/.test(v.text) && /hub hold|cold-storage/.test(v.text) && /moulded|slumped|void/.test(v.text));
}
const darz = call(drug('Darzalex & Darzalex Faspro'), 'frozen', null, 1);
ok('Darzalex frozen packs: freeze question, crediting its cold data', darz.cls !== 'ok' && /-4°F to 34°F/.test(darz.text), darz.text.slice(0, 200));

console.log('\n--- room-temperature products ---');
ROOM.forEach(r => {
  const sl = call(r, 'slushy', weather(1, 70, 80), 1);
  ok(`${r.name}: slushy packs do not clear it`, sl.cls !== 'ok' && /colder than its range/.test(sl.big), sl.big);
});
ok('  Opzelura credits its cold window', /label does cover this range/.test(call(drug('Opzelura'), 'slushy', weather(1, 70, 80), 1).text));
ok('  Monovisc is never "no allowance to spend"', !/no allowance/.test(call(drug('Monovisc'), 'warm', weather(1, 60, 70), 1).big));
ok('a refrigerated product with slushy packs still clears', call(drug('Humira'), 'slushy', weather(3, 80, 98), 3).cls === 'ok');

console.log('\n--- after-first-use figures never clear unopened stock ---');
ROWS.filter(r => r.inUseAllowance).forEach(r => {
  const v = call(r, 'warm', weather(2, 55, 65), 2);
  ok(`${r.name}: clean trip is still a judgment call`, v.cls !== 'ok' && /may not apply/.test(v.big), v.big);
});

console.log('\n--- no warm allowance ---');
['Omnitrope', 'Darzalex & Darzalex Faspro'].forEach(n => {
  ok(`${n}: thawed packs mean "no allowance to spend"`, /no allowance/.test(call(drug(n), 'warm', weather(1, 60, 70), 1).big));
});

console.log('\n--- short allowances are measured in hours ---');
ok('under three days counts as short', C.SHORT_ALLOWANCE_HOURS === 72);
ok('Tremfya, next-day delivery, cool air: clears on its 24-hour transit window',
   call(drug('Tremfya'), 'warm', weather(1, 55, 65), 1).cls === 'ok');
{
  const v = call(drug('Tremfya'), 'warm', weather(2, 55, 65), 2);
  ok('Tremfya, two days: past 24 hours, a duration call', /duration/.test(v.big), v.big);
  ok('  counted in hours', /of 24 hours|hours more/.test(v.text), v.text.slice(0, 220));
}
ok('Tremfya, 3 days with packs still cool: only the hours past the pack-out count, so it clears',
   call(drug('Tremfya'), 'cool', weather(3, 55, 65), 3).cls === 'ok');
ok('Humatrope (12 hours) does not clear a next-day delivery', call(drug('Humatrope'), 'warm', weather(1, 55, 65), 1).cls !== 'ok');
ok('Forteo (36 hours) clears next-day, not two days',
   call(drug('Forteo'), 'warm', weather(1, 55, 65), 1).cls === 'ok' && call(drug('Forteo'), 'warm', weather(2, 55, 65), 2).cls !== 'ok');
ok('Forteo displays 36 hours, not "2 days"', C.allowanceText(drug('Forteo')) === '36 hours');

console.log('\n--- how late is too late, in hours ---');
[['Humira', 15], ['Tremfya', 2], ['Forteo', 2], ['Humatrope', 1], ['Skyrizi', 3], ['Omnitrope', 0]].forEach(([n, want]) => {
  ok(`${n}: inside the allowance up to ${want} day(s) late`, C.maxDaysLate(drug(n)) === want, String(C.maxDaysLate(drug(n))));
});
ok('whole-day allowances keep the old "allowance + 1" answer',
   ROWS.filter(r => r.allowanceHours && r.allowanceHours % 24 === 0 && !r.noExcursion)
       .every(r => C.maxDaysLate(r) === r.allowanceHours / 24 + 1));

console.log('\n--- manufacturer windows are judged in hours ---');
ok('Humalog: 10 hours at 95°F in a day is inside its 12-hour window', call(drug('Humalog/Humulin'), 'warm', hotHours(1, 70, 10, 95), 1).cls === 'ok');
{
  const v = call(drug('Humalog/Humulin'), 'warm', hotHours(1, 70, 16, 95), 1);
  ok('Humalog: 16 hours at 95°F is past it', /past the high-temperature window/.test(v.big), v.big);
  ok('  and says how many hours against how many', /16 hours/.test(v.text) && /12 hours/.test(v.text), v.text.slice(0, 200));
}
ok('Basaglar: a full day with 10 hot hours does NOT clear a 4-hour window',
   call(drug('Basaglar'), 'warm', hotHours(1, 70, 10, 95), 1).cls !== 'ok');
ok('Humalog: 106°F is outside every published window',
   /outside the published windows/.test(call(drug('Humalog/Humulin'), 'warm', hotHours(1, 70, 3, 106), 1).big));
ok('Humalog: the main 28-day allowance still applies inside the window',
   call(drug('Humalog/Humulin'), 'warm', hotHours(30, 70, 4, 95), 30).cls !== 'ok');
{
  const v = call(drug('Enbrel (all formulations)'), 'warm', hotHours(2, 70, 20, 100), 2);
  ok('Enbrel: 20 hours at 100°F sits in its 4-day window', v.cls === 'ok', v.big);
  ok('  and the card gives its own instruction, not the everyday one',
     /use it within 4 days/.test(v.text) && !/Do not put it back/.test(v.text), v.text.slice(0, 300));
}
ok('Aimovig: 80°F is inside its window now (no gap below 86°F)', call(drug('Aimovig'), 'warm', hotHours(2, 70, 10, 80), 2).cls === 'ok');
ok('Avonex (cold data only) gets the ordinary heat card', /possible heat excursion/.test(call(drug('Avonex'), 'warm', weather(3, 75, 95), 3).big));
{
  const gap = Object.assign({}, drug('Humira'), { name: 'Gap test', excursionMaxF: 77, tiers: [{ minF: 86, maxF: 104, hours: 48 }] });
  ok('a window that leaves a gap below it never clears across the gap',
     call(gap, 'warm', hotHours(1, 70, 4, 90), 1).cls !== 'ok');
}

console.log('\n--- cold data below the floor ---');
{
  const inside = call(drug('Avonex'), 'warm', weather(2, 45, 60, { dipFrom: 3, dipHours: 5, dip: 25 }), 2);
  ok('Avonex, 5 hours at 25°F: a judgment call that says it sits inside the cold data',
     inside.cls !== 'ok' && /sits inside/.test(inside.text), inside.text.slice(0, 240));
  const long = call(drug('Avonex'), 'warm', weather(3, 45, 60, { dipFrom: 0, dipHours: 40, dip: 25 }), 3);
  ok('Avonex, 40 hours at 25°F: longer than the cold data covers', /longer than that covers/.test(long.text));
  const below = call(drug('Avonex'), 'warm', weather(2, 45, 60, { dipAt: 5, dip: 15 }), 2);
  ok('Avonex, 15°F: below its cold data as well', /below .*cold data as well/.test(below.text));
}

console.log('\n--- unverified ceilings get the wider margin ---');
ROWS.filter(r => r.flag).forEach(r => ok(`${r.name}: ${C.CEILING_MARGIN_UNCERTAIN_F}°F margin`, C.ceilingMargin(r) === C.CEILING_MARGIN_UNCERTAIN_F));
ok('an ordinary row keeps the normal margin', C.ceilingMargin(drug('Humira')) === C.CEILING_MARGIN_F);

console.log('\n--- a trip that broke both ends reports both ---');
{
  const both = call(drug('Humira'), 'warm', weather(3, 75, 95, { dipAt: 5, dip: 20 }), 3);
  ok('headline names both', /cold and heat/i.test(both.big), both.big);
  ok('  both numbers shown', /95/.test(both.text) && /20/.test(both.text));
  ok('cold alone reads as cold exposure', /cold exposure/i.test(call(drug('Humira'), 'warm', weather(3, 45, 60, { dipAt: 5, dip: 20 }), 3).big));
}

console.log('\n--- the summer heat path (Humira: 77°F, 14 days) ---');
[[70, 78], [75, 85], [80, 98], [85, 105]].forEach(([lo, hi]) => {
  ok(`${lo}-${hi}°F never clears`, call(drug('Humira'), 'warm', weather(3, lo, hi), 3).cls !== 'ok');
});
{
  const cleared = ROWS.filter(r => !C.warmBands(r).length && r.excursionMaxF != null && r.refrigerated !== false)
                      .filter(r => call(r, 'warm', weather(2, r.excursionMaxF - 5, r.excursionMaxF + 12), 2).cls === 'ok');
  ok('no single-window product clears air 12°F over its ceiling', cleared.length === 0, cleared.map(r => r.name).join(', '));
}
ok('7°F of headroom clears', call(drug('Humira'), 'warm', weather(2, 60, 70), 2).cls === 'ok');
ok('3°F of headroom does not', call(drug('Humira'), 'warm', weather(2, 60, 74), 2).cls !== 'ok');
ok('14 days at 62-72°F clears', call(drug('Humira'), 'warm', weather(14, 62, 72), 14).cls === 'ok');
ok('15 days does not', call(drug('Humira'), 'warm', weather(15, 62, 72), 15).cls !== 'ok');
ok('a station 41 mi away is inside the 100-mile radius and clears', call(drug('Humira'), 'warm', weather(3, 60, 70, { miles: 41 }), 3).cls === 'ok');
ok('a station 99 mi away clears', call(drug('Humira'), 'warm', weather(3, 60, 70, { miles: 99 }), 3).cls === 'ok');
ok('a station 130 mi away cannot clear', call(drug('Humira'), 'warm', weather(3, 60, 70, { miles: 130 }), 3).cls !== 'ok');
ok('overnight-only readings cannot clear',
   call(drug('Humira'), 'warm', weather(3, 60, 70, { skip: (h) => h >= 9 && h <= 20 }), 3).cls !== 'ok');

console.log('\n--- gaps filled from stations within 100 miles ---');
{
  const H = 3600000, t0 = S0();
  const obsAt = (hours, f) => hours.map(h => ({ t: new Date(t0 + h * H), c: F2C(f) }));
  const all = [...Array(72).keys()];
  const primary = { id: 'KHOU', name: 'Hobby', miles: 8, elevFt: 40 };
  const pObs = obsAt(all.filter(h => h % 24 < 9 || h % 24 > 20), 70);            // afternoons missing
  const near = { station: { id: 'KIAH', name: 'Bush', miles: 22, elevFt: 90 }, obs: obsAt(all, 96) };
  const far = { station: { id: 'KAUS', name: 'Austin', miles: 146, elevFt: 540 }, obs: obsAt(all, 60) };
  const high = { station: { id: 'KHIL', name: 'Hilltop', miles: 60, elevFt: 2400 }, obs: obsAt(all, 60) };

  ok('the gappy primary has holes', C.gapHours(pObs, new Date(t0), new Date(t0 + 71 * H)) > 0);
  const m = C.fillGaps(primary, pObs, [high, far, near]);
  ok('holes are filled from the station within the radius', C.gapHours(m.obs, new Date(t0), new Date(t0 + 71 * H)) === 0);
  ok('  from KIAH only', m.fill.length === 1 && m.fill[0].station.id === 'KIAH', JSON.stringify(m.fill.map(f => f.station.id)));
  ok('  a station 146 mi away is never used', !m.fill.some(f => f.station.id === 'KAUS'));
  ok('  a station 2,360 ft higher is never used', !m.fill.some(f => f.station.id === 'KHIL'));
  ok('  the primary\'s own hours are never overwritten',
     pObs.every(o => m.obs.filter(x => Math.floor(x.t / H) === Math.floor(o.t / H)).every(x => x.c === o.c)));
  ok('  no hour is double-counted', new Set(m.obs.map(o => Math.floor(o.t / H))).size === m.obs.length);

  const unfilled = result(3, pObs);
  const filled = Object.assign(result(3, m.obs), { fill: m.fill });
  ok('before filling, the record is too thin to clear', call(drug('Humira'), 'warm', unfilled, 3).cls !== 'ok');
  const v = call(drug('Humira'), 'warm', filled, 3);
  ok('after filling, the hot afternoons it was missing are seen: 96°F is flagged',
     /possible heat excursion/.test(v.big) && /96/.test(v.text), v.big);
  ok('  and the evidence names the station that filled in', /filled from Bush \(22 mi\)/.test(v.text), v.text.slice(-240));

  const cool = C.fillGaps(primary, pObs, [{ station: near.station, obs: obsAt(all, 66) }]);
  ok('a filled record with nothing hot clears', call(drug('Humira'), 'warm', Object.assign(result(3, cool.obs), { fill: cool.fill }), 3).cls === 'ok');
}

console.log('\n--- the last tenth of a high-heat window is a judgment call, never a replace ---');
ok('margin is 10% of the window, at least an hour',
   Math.abs(C.bandMargin({ hours: 48 }) - 4.8) < 1e-9 && C.bandMargin({ hours: 4 }) === 1 && Math.abs(C.bandMargin({ hours: 12 }) - 1.2) < 1e-9);
[['Aimovig', 43, 'ok'], ['Aimovig', 44, 'near'], ['Aimovig', 45, 'near'], ['Aimovig', 49, 'past'],
 ['Humalog/Humulin', 10, 'ok'], ['Humalog/Humulin', 11, 'near'], ['Humalog/Humulin', 13, 'past'],
 ['Basaglar', 3, 'ok'], ['Basaglar', 4, 'near'], ['Basaglar', 5, 'past']].forEach(([n, h, want]) => {
  const d = drug(n), days = h > 20 ? 3 : 1;
  const v = call(d, 'warm', hotHours(days, 60, h, 95), days);
  const got = v.cls === 'ok' ? 'ok' : /near the end/.test(v.big) ? 'near' : /past the high-temperature/.test(v.big) ? 'past' : v.big;
  ok(`${n}: ${h} hours above ${d.excursionMaxF}°F -> ${want}`, got === want, `got ${got}`);
});
{
  const v = call(drug('Aimovig'), 'warm', hotHours(3, 60, 45, 97), 3);
  ok('the screenshot case, Aimovig at 45 of 48 hours, is now a judgment call', /near the end of the high-heat window/.test(v.big), v.big);
  ok('  that says it is covered on the numbers', /On the numbers it is covered/.test(v.text));
  ok('  and still gives the keep script', /stayed within what Aimovig's own stability data covers/.test(v.text));
  ok('  a clear with room to spare says how much', /with 5 hours to spare/.test(call(drug('Aimovig'), 'warm', hotHours(3, 60, 43, 97), 3).text));
}
{
  const bad = ROWS.filter(r => C.warmBands(r).length && r.refrigerated !== false).filter(r => {
    const b = C.warmBands(r)[0], h = Math.max(1, Math.floor(b.hours - C.bandMargin(b) / 2)), days = Math.max(1, Math.ceil(h / 12));
    return /replace/.test(call(r, 'warm', hotHours(days, 60, h, Math.min(b.maxF - 1, r.excursionMaxF + 8)), days).cls);
  });
  ok('no product ever gets REPLACE from the margin', bad.length === 0, bad.map(r => r.name).join(', '));
}

console.log('\n--- use-by date for product that cannot go back in the fridge ---');
{
  const a = call(drug('Aimovig'), 'warm', hotHours(3, 60, 40, 97), 3);
  ok('Aimovig shipped Mon Jul 6, 7 days: use by Sun, Jul 12', /Use it by Sun, Jul 12/.test(a.text), a.text.slice(-320));
  ok('  and says the clock started at the pharmacy', /left the pharmacy on Mon, Jul 6/.test(a.text));
  const e = call(drug('Enbrel (all formulations)'), 'warm', hotHours(2, 70, 20, 100), 2);
  ok('Enbrel after its 107.6°F window: its own 4 days, use by Thu, Jul 9', /Use it by Thu, Jul 9/.test(e.text), e.text.slice(-300));
  const r = call(drug('Repatha'), 'warm', hotHours(2, 60, 10, 90), 2);
  ok('Repatha: its window says do not refrigerate, so the 30 days sets the date', /Use it by Tue, Aug 4/.test(r.text) && /do not return it to the fridge/.test(r.text), r.text.slice(-300));
  ok('Humira, which may go back in the fridge, gets no use-by date', !/Use it by/.test(call(drug('Humira'), 'warm', weather(2, 60, 70), 2).text));
  const t = call(drug('Aimovig'), 'warm', weather(7, 55, 65), 6);
  ok('delivered on its last day: "use it today"', /Use it today, Sun, Jul 12/.test(t.text), t.text.slice(-260));
  const c = call(drug('Cimzia'), 'warm', weather(10, 60, 70), 9);
  ok('Cimzia 9 days out on a 7-day allowance: says the time has run out', /already run out/.test(c.text) && !/Use it by/.test(c.text));
}
{
  call(drug('Aimovig'), 'warm', hotHours(3, 60, 40, 97), 3);
  ok('NewLeaf note on an OK: "Use by 7/12"', /OK TO USE\. Use by 7\/12, not back in fridge\./.test(C.noteText()), C.noteText());
  call(drug('Aimovig'), 'warm', hotHours(3, 60, 45, 97), 3);
  ok('NewLeaf note on a judgment call: "If kept, use by 7/12"', /If kept, use by 7\/12/.test(C.noteText()), C.noteText());
  call(drug('Humira'), 'warm', weather(2, 60, 70), 2);
  ok('no use-by in the note when it may go back in the fridge', !/use by/i.test(C.noteText()));
}

console.log(failed ? `\n${failed} DECISION TEST(S) FAILED, ${passed} passed` : `\nAll ${passed} decision tests passed.`);
process.exit(failed ? 1 : 0);
