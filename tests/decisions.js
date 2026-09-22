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
// THE CLOCK, in hours from midnight on the ship date, Mon Jul 6: the carrier
// picks up at hour 16, the 48-hour mark is hour 64, and a trip of n days is
// delivered about midday on day n, hour 24n + 12. Heat and dips are placed at
// explicit hours so each test says which part of the timeline it exercises.
const PICK = 16, MARK = 64, arrive = (n) => 24 * n + 12;
const late = (n) => arrive(n) - PICK > 48;
// where counting starts for a trip of n days: warm packs on time count from
// pick-up, everything else from the 48-hour mark
const countFrom = (n, pack) => (pack === 'warm' && !late(n)) ? PICK : MARK;
function result(nDays, obs, miles = 3) {
  return { obs, tz: TZ, start: new Date(2026, 6, 6), end: new Date(S0() + arrive(nDays) * 3600000),
           station: { name: 'KHOU', id: 'KHOU', miles }, loc: { name: 'Houston' },
           place: { city: 'Houston', state: 'TX' }, zip: '77002' };
}
// ship day midnight to delivery, with a diurnal swing that peaks at 3pm
function weather(nDays, lowF, highF, opts = {}) {
  const obs = [];
  for (let h = 0; h <= arrive(nDays); h++) {
    const hr = h % 24, frac = (Math.cos((hr - 15) / 24 * 2 * Math.PI) + 1) / 2;
    let f = lowF + (highF - lowF) * frac;
    if (opts.dipAt === h) f = opts.dip;
    if (opts.dipFrom != null && h >= opts.dipFrom && h < opts.dipFrom + opts.dipHours) f = opts.dip;
    if (opts.skip && opts.skip(hr)) continue;
    if (opts.skipAbs && opts.skipAbs(h)) continue;
    obs.push({ t: new Date(S0() + h * 3600000), c: F2C(f) });
  }
  return result(nDays, obs, opts.miles == null ? 3 : opts.miles);
}
// flat base temperature with exactly `hot` consecutive hours at `hotF`,
// starting at hour `from` (default: where warm packs start counting)
function hotHours(nDays, baseF, hot, hotF, from) {
  if (from == null) from = countFrom(nDays, 'warm');
  const obs = [];
  for (let h = 0; h <= arrive(nDays); h++)
    obs.push({ t: new Date(S0() + h * 3600000), c: F2C(h >= from && h < from + hot ? hotF : baseF) });
  return result(nDays, obs);
}
{
  const w = hotHours(1, 70, 16, 95), n = C.summarize(w.obs, TZ, 86, 36, w).reduce((a, x) => a + x.above, 0);
  if (n !== 16) { console.log(`FAIL fixture: hotHours(1, 70, 16, 95) gave ${n} hot hours`); process.exit(1); }
}
// shipped Mon Jul 6, received n days later
const dates = (n) => { const d = new Date(Date.UTC(2026, 6, 6 + n)); C.setDates('2026-07-06', d.toISOString().slice(0, 10)); };
function call(d, pack, w, days) {
  if (days == null) days = w ? Math.round((w.end - S0()) / 86400000 - 0.5) : 1;
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
   call(drug('Humalog/Humulin'), 'warm', hotHours(31, 70, 4, 95), 31).cls !== 'ok');
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
  const inside = call(drug('Avonex'), 'warm', weather(2, 45, 60, { dipFrom: 20, dipHours: 5, dip: 25 }), 2);
  ok('Avonex, 5 hours at 25°F: a judgment call that says it sits inside the cold data',
     inside.cls !== 'ok' && /sits inside/.test(inside.text), inside.text.slice(0, 240));
  const long = call(drug('Avonex'), 'warm', weather(4, 45, 60, { dipFrom: MARK, dipHours: 40, dip: 25 }), 4);
  ok('Avonex, 40 hours at 25°F: longer than the cold data covers', /longer than that covers/.test(long.text));
  const below = call(drug('Avonex'), 'warm', weather(2, 45, 60, { dipAt: 20, dip: 15 }), 2);
  ok('Avonex, 15°F: below its cold data as well', /below .*cold data as well/.test(below.text));
}

console.log('\n--- unverified ceilings get the wider margin ---');
ROWS.filter(r => r.flag).forEach(r => ok(`${r.name}: ${C.CEILING_MARGIN_UNCERTAIN_F}°F margin`, C.ceilingMargin(r) === C.CEILING_MARGIN_UNCERTAIN_F));
ok('an ordinary row keeps the normal margin', C.ceilingMargin(drug('Humira')) === C.CEILING_MARGIN_F);

console.log('\n--- a trip that broke both ends reports both ---');
{
  const both = call(drug('Humira'), 'warm', weather(3, 75, 95, { dipAt: 70, dip: 20 }), 3);
  ok('headline names both', /cold and heat/i.test(both.big), both.big);
  ok('  both numbers shown', /95/.test(both.text) && /20/.test(both.text));
  ok('cold alone reads as cold exposure', /cold exposure/i.test(call(drug('Humira'), 'warm', weather(3, 45, 60, { dipAt: 70, dip: 20 }), 3).big));
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
ok('15 days late with cool packs, 62-72°F: clears on its 14 days, as the delay reference says',
   call(drug('Humira'), 'cool', weather(16, 62, 72), 16).cls === 'ok');
ok('16 days late does not', /duration/.test(call(drug('Humira'), 'cool', weather(17, 62, 72), 17).big));
ok('15 days late with WARM packs clears only on the 48-hour rule: a judgment call',
   /clears only on the 48-hour rule/.test(call(drug('Humira'), 'warm', weather(16, 62, 72), 16).big));
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
  const d = drug(n), days = h > 20 ? 5 : 1;
  const v = call(d, 'warm', hotHours(days, 60, h, 95), days);
  const got = v.cls === 'ok' ? 'ok' : /near the end/.test(v.big) ? 'near' : /past the high-temperature/.test(v.big) ? 'past' : v.big;
  ok(`${n}: ${h} hours above ${d.excursionMaxF}°F -> ${want}`, got === want, `got ${got}`);
});
{
  const v = call(drug('Aimovig'), 'warm', hotHours(5, 60, 45, 97), 5);
  ok('the screenshot case, Aimovig at 45 of 48 hours, is now a judgment call', /near the end of the high-heat window/.test(v.big), v.big);
  ok('  that says it is covered on the numbers', /On the numbers it is covered/.test(v.text));
  ok('  and still gives the keep script', /stayed within what Aimovig's own stability data covers/.test(v.text));
  ok('  a clear with room to spare says how much', /with 5 hours to spare/.test(call(drug('Aimovig'), 'warm', hotHours(5, 60, 43, 97), 5).text));
}
{
  const bad = ROWS.filter(r => C.warmBands(r).length && r.refrigerated !== false).filter(r => {
    const b = C.warmBands(r)[0], h = Math.max(1, Math.floor(b.hours - C.bandMargin(b) / 2)), days = Math.max(3, Math.ceil((h + MARK) / 24));
    return /replace/.test(call(r, 'warm', hotHours(days, 60, h, Math.min(b.maxF - 1, r.excursionMaxF + 8)), days).cls);
  });
  ok('no product ever gets REPLACE from the margin', bad.length === 0, bad.map(r => r.name).join(', '));
}

console.log('\n--- use-by date for product that cannot go back in the fridge ---');
{
  const a = call(drug('Aimovig'), 'warm', hotHours(1, 60, 10, 97), 1);
  ok('Aimovig, warm packs on time: counts from the pick-up, use by Sun, Jul 12', /Use it by Sun, Jul 12/.test(a.text), a.text.slice(-320));
  ok('  and says the clock started when it left the pharmacy', /when it left the pharmacy on Mon, Jul 6/.test(a.text));
  const c = call(drug('Aimovig'), 'cool', weather(3, 55, 65), 3);
  ok('Aimovig, cool packs 2 days late: counts from the 48-hour mark, use by Tue, Jul 14', /Use it by Tue, Jul 14/.test(c.text), c.text.slice(-320));
  ok('  and says the clock started 48 hours after pick-up', /48 hours after it left the pharmacy/.test(c.text));
  const e = call(drug('Enbrel (all formulations)'), 'warm', hotHours(2, 70, 20, 100), 2);
  ok('Enbrel after its 107.6°F window: its own 4 days, use by Thu, Jul 9', /Use it by Thu, Jul 9/.test(e.text), e.text.slice(-300));
  const r = call(drug('Repatha'), 'warm', hotHours(2, 60, 10, 90), 2);
  ok('Repatha: its window says do not refrigerate, so the 30 days sets the date', /Use it by Tue, Aug 4/.test(r.text) && /do not return it to the fridge/.test(r.text), r.text.slice(-300));
  ok('Humira, which may go back in the fridge, gets no use-by date', !/Use it by/.test(call(drug('Humira'), 'warm', weather(2, 60, 70), 2).text));
  const t = call(drug('Aimovig'), 'cool', weather(8, 55, 65), 8);
  ok('delivered on its last day: "use it today"', /Use it today, Tue, Jul 14/.test(t.text), t.text.slice(-260));
  const y = call(drug('Cimzia'), 'cool', weather(9, 55, 65), 9);
  ok('Cimzia delivered the morning its 7 days end: OK and "use it today", not "run out"',
     y.cls === 'ok' && /Use it today/.test(y.text) && !/run out/.test(y.text), y.big + ' | ' + y.text.slice(-240));
  const x = call(drug('Cimzia'), 'cool', weather(10, 55, 65), 10);
  ok('Cimzia delivered after its 7 days ran out: says so', /already run out/.test(x.text) && !/Use it by/.test(x.text));
}
{
  call(drug('Aimovig'), 'warm', hotHours(1, 60, 10, 97), 1);
  ok('NewLeaf note on an OK: "Use by 7/12"', /OK TO USE\. Use by 7\/12, not back in fridge\./.test(C.noteText()), C.noteText());
  call(drug('Aimovig'), 'cool', hotHours(5, 60, 45, 97, MARK), 5);
  ok('NewLeaf note on a judgment call: "If kept, use by 7/14"', /If kept, use by 7\/14/.test(C.noteText()), C.noteText());
  call(drug('Humira'), 'warm', weather(2, 60, 70), 2);
  ok('no use-by in the note when it may go back in the fridge', !/use by/i.test(C.noteText()));
}

console.log('\n--- the clock: out of the fridge 48 hours after pick-up (Aimovig, shipped Mon Jul 6) ---');
{
  const t1 = call(drug('Aimovig'), 'slushy', weather(1, 60, 70), 1);
  ok('delivered on time, slushy: OK, into the fridge as normal', t1.cls === 'ok' && /Into the fridge as normal/.test(t1.text));
  ok('  no use-by date and no "do not put it back"', !/Use it by/.test(t1.text) && !/Do not put it back/.test(t1.text), t1.text.slice(-260));
  const f1 = call(drug('Aimovig'), 'frozen', null, 1);
  ok('delivered on time, frozen solid: the keep path says fridge as normal too', /Into the fridge as normal/.test(f1.text) && !/Use it by/.test(f1.text));
  const t2 = call(drug('Aimovig'), 'cool', weather(2, 60, 70), 2);
  ok('1 day late, cool: still inside the 48 hours, nothing counted', t2.cls === 'ok' && /pack-out's 48-hour rating/.test(t2.text) && !/Use it by/.test(t2.text));
  C.setDrug(drug('Aimovig')); C.setPack('cool'); dates(3);
  ok('2 days late, cool: counted from the 48-hour mark to midday, 20 hours', C.exposureHours() === 20);
  C.setPack('warm'); dates(3);
  ok('2 days late, warm: the same 20 hours', C.exposureHours() === 20 && C.creditApplies());
  dates(1);
  ok('on time, warm: counted from the pick-up, 20 hours, no credit', C.exposureHours() === 20 && !C.creditApplies()
     && C.exposureStart().getTime() === C.zonedInstant(2026, 7, 6, 16, TZ).getTime());
  const w1 = call(drug('Aimovig'), 'warm', weather(1, 60, 70), 1);
  ok('  and the evidence says why', /packs were already warm on an on-time delivery/.test(w1.text), w1.text.slice(-300));
}
{
  // heat only on Tue afternoon, before the 48-hour mark: the rule alone clears it
  const w = hotHours(3, 65, 7, 85, 38);
  const v = call(drug('Humira'), 'warm', w, 3);
  ok('warm, 2 days late, heat only before the 48-hour mark: the safeguard makes it a judgment call',
     /clears only on the 48-hour rule/.test(v.big), v.big);
  ok('  and it says what counting from pick-up would show', /7 hours above 77°F/.test(v.text), v.text.slice(0, 400));
  ok('  the same trip with cool packs just clears', call(drug('Humira'), 'cool', w, 3).cls === 'ok');
  ok('  warm with no heat anywhere just clears', call(drug('Humira'), 'warm', weather(3, 60, 70), 3).cls === 'ok');
}
{
  // Aimovig has a 48-hour window up to 104°F, so the safeguard card says how
  // the hours counted from pick-up sit against it
  const sg = (hot) => call(drug('Aimovig'), 'warm', hotHours(3, 65, hot, 88, PICK), 3);
  const all = sg(48);
  ok('Aimovig safeguard, 48 hot hours before the mark: "all of its 48-hour high-heat window"',
     /clears only on the 48-hour rule/.test(all.big) && /48 hours above 77°F, all of its 48-hour high-heat window/.test(all.text), all.text.slice(0, 400));
  ok('  50 hours: "more than its 48-hour high-heat window"', /50 hours above 77°F, more than its 48-hour high-heat window/.test(sg(50).text));
  ok('  45 hours: "too close to the end to clear"', /45 of the 48 hours in its high-heat window, too close to the end to clear/.test(sg(45).text));
  ok('  40 hours clears either way, so no safeguard card', sg(40).cls === 'ok');
}
{
  ok('hours before the 4pm pick-up are never counted', call(drug('Humira'), 'warm', hotHours(1, 65, 8, 90, 8), 1).cls === 'ok');
  const after = hotHours(1, 65, 0, 90); for (let h = 38; h < 45; h++) after.obs.push({ t: new Date(S0() + h * 3600000), c: F2C(95) });
  ok('hours after the midday delivery are never counted', call(drug('Humira'), 'warm', after, 1).cls === 'ok');
  const gap = weather(3, 60, 70, { skipAbs: (h) => h >= 60 });
  ok('no readings at all in the counted stretch is not a pass', call(drug('Humira'), 'warm', gap, 3).cls !== 'ok');
  C.setDrug(drug('Afinitor')); C.setPack('cool'); dates(3);
  ok('room-temperature products count from the pick-up', C.exposureStart().getTime() === C.zonedInstant(2026, 7, 6, 16, TZ).getTime());
}
{
  // the card and the delay reference agree for every product
  const off = ROWS.filter(r => r.refrigerated !== false && !r.noExcursion && r.allowanceHours != null).filter(r => {
    C.setDrug(r); C.setPack('cool'); const m = C.maxDaysLate(r);
    dates(m + 1); const inside = C.durationOk(r, 0);
    dates(m + 2); const outside = !C.durationOk(r, 0);
    return !(inside && outside);
  });
  ok('for every product, "N days late" on the delay reference matches the card', off.length === 0, off.map(r => r.name).join(', '));
}

console.log(failed ? `\n${failed} DECISION TEST(S) FAILED, ${passed} passed` : `\nAll ${passed} decision tests passed.`);
process.exit(failed ? 1 : 0);
