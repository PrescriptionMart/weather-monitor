// Decision-logic regression tests for the Winter Pack page (winter-core.js).
//
// These lock down what a packer acts on: which ship nights exist, which hours
// count, when a ZIP area or a whole state gets a winter pack, and above all
// that nothing unchecked is ever reported as standard.
// Run by .claude/hooks/check.sh:
//
//   node tests/winter.js
const W = require('../winter-core.js');
const F = W.WINTER_PACK_F;                       // the trigger temperature (32°F)
const M = W.WINTER_PACK_F + W.CHECK_MARGIN_F;    // "clearly warm" for the missing-checkpoint margin

let failed = 0, passed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) passed++; else failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra && !cond ? '  — ' + extra : ''));
};
const day = (y, m, d) => new Date(y, m - 1, d);
const nights = (plan) => plan.map(n => `${n.shipKey}>${n.delivKey}`).join(' ');

// ---- ship nights ---------------------------------------------------------------
{
  const p = W.shipPlan(day(2026, 10, 15));   // Thursday
  ok('Thu Oct 15: tonight, Friday (Saturday delivery), next Monday — no weekend nights',
     nights(p) === '2026-10-15>2026-10-16 2026-10-16>2026-10-17 2026-10-19>2026-10-20', nights(p));
  ok('  Friday night is marked Saturday-delivery only', p[1].saturdayOnly && !p[0].saturdayOnly && !p[2].saturdayOnly);
  ok('  every night ships Mon-Fri', p.every(n => n.ship.getDay() >= 1 && n.ship.getDay() <= 5));
  ok('  no night delivers on a Sunday', p.every(n => n.deliv.getDay() !== 0));

  const m = W.shipPlan(day(2026, 11, 16));   // Monday
  ok('Mon Nov 16: Mon-Thu next day, Fri to Sat',
     nights(m) === '2026-11-16>2026-11-17 2026-11-17>2026-11-18 2026-11-18>2026-11-19 2026-11-19>2026-11-20 2026-11-20>2026-11-21', nights(m));

  const t = W.shipPlan(day(2026, 11, 23));   // Thanksgiving week
  ok('Thanksgiving week: Wednesday delivers Friday, no Thursday night',
     nights(t) === '2026-11-23>2026-11-24 2026-11-24>2026-11-25 2026-11-25>2026-11-27 2026-11-27>2026-11-28', nights(t));
  ok('  the Wednesday night is a 2-day trip', t[2].transitDays === 2);

  const x = W.shipPlan(day(2026, 12, 23));   // Wed before Christmas
  ok('Christmas: Thu Dec 24 delivers Mon Dec 28, no Friday night',
     nights(x) === '2026-12-23>2026-12-24 2026-12-24>2026-12-28', nights(x));
  ok('  the Christmas Eve night is a 4-day trip', x[1].transitDays === 4);

  const s = W.shipPlan(day(2026, 11, 21));   // Saturday
  ok('opened on a Saturday: the next ship nights whose delivery is in the forecast',
     nights(s) === '2026-11-23>2026-11-24 2026-11-24>2026-11-25', nights(s));

  const ny = W.shipPlan(day(2026, 12, 30));
  ok('New Year: Thu Dec 31 delivers Mon Jan 4; no night on the holiday Friday',
     nights(ny) === '2026-12-30>2026-12-31 2026-12-31>2027-01-04', nights(ny));

  ok('no delivery more than 5 days out (the forecast does not cover it)',
     [day(2026, 10, 15), day(2026, 11, 16), day(2026, 12, 23), day(2027, 1, 4)].every(d =>
       W.shipPlan(d).every(n => W.daysBetween(d, n.deliv) <= W.LAST_DELIVERY_OFFSET)));

  ok('before the 4pm pickup, today is shown first', W.defaultNight(m, day(2026, 11, 16), 15) === 0);
  ok('after the 4pm pickup, tomorrow is shown first', W.defaultNight(m, day(2026, 11, 16), 16) === 1);
  ok('on a weekend the first ship night is shown first', W.defaultNight(s, day(2026, 11, 21), 18) === 0);
}

// ---- the 11am-6pm window -------------------------------------------------------
// hourly NWS-style periods for one local date: tempAt(hour) → °F
function periods(key, offset, tempAt, from = 0, to = 23) {
  const out = [];
  for (let h = from; h <= to; h++) {
    const t = tempAt(h);
    out.push({ startTime: `${key}T${String(h).padStart(2, '0')}:00:00${offset}`, temperature: t, temperatureUnit: 'F' });
  }
  return out;
}
{
  const K = '2026-12-08';
  const at = (hours, cold, warm = 50) => (h) => hours.includes(h) ? cold : warm;   // tempAt for a few cold hours
  const spell = (tempAt, offset = '-06:00') => W.coldSpell(periods(K, offset, tempAt), K);
  const cold = (h) => (h < 11 || h > 18) ? 10 : 40;
  ok('only 11am-6pm counts: 10°F before 11am and after 6pm is ignored', spell(cold) === 40);
  // the 4-hour rule: a brief dip doesn't make a winter pack
  ok('a 1-hour dip to 20°F does not count (4-hour low stays 50°F)', spell(at([14], 20)) === 50);
  ok('a 3-hour stretch at 30°F does not count', spell(at([12, 13, 14], 30)) === 50);
  ok('4 hours in a row at 30°F counts (4-hour low 30°F)', spell(at([12, 13, 14, 15], 30)) === 30);
  ok('4 cold hours that are not in a row do not count', spell(at([11, 12, 17, 18], 30)) === 50);
  ok('the 4-hour low is the warmest reading of the coldest 4 hours in a row',
     spell(h => ({ 11: 28, 12: 31, 13: 34, 14: 35, 15: 38, 16: 40, 17: 41, 18: 42 })[h]) === 35);
  ok('a cold morning that warms up by 2pm does not count',
     spell(h => ({ 11: 29, 12: 32, 13: 34, 14: 37, 15: 40, 16: 41, 17: 40, 18: 38 })[h]) === 37);
  ok(`${F}°F for exactly 4 hours counts; ${F + 1}°F does not`,
     spell(at([15, 16, 17, 18], F)) <= F && spell(at([15, 16, 17, 18], F + 1)) > F);
  ok('the trigger is actual freezing, 32°F', F === 32);
  ok('33°F for the whole window is not a winter pack', spell(() => 33) > F);
  ok('11am-2pm is the first 4-hour stretch, 3pm-6pm the last',
     spell(at([11, 12, 13, 14], 33)) === 33 && spell(at([15, 16, 17, 18], 33)) === 33);
  ok('cold hours outside the window do not help a stretch inside it (9am-12pm cold → no)', spell(at([9, 10, 11, 12], 30)) === 50);
  ok('a missing hour makes the window incomplete (null), never a guess',
     W.coldSpell(periods(K, '-06:00', () => 50).filter(p => !p.startTime.includes('T15')), K) === null);
  ok('a window cut off by the end of the forecast is incomplete', W.coldSpell(periods(K, '-10:00', () => 50, 0, 15), K) === null);
  ok('local hours are read from each point\'s own offset (Pacific)', spell(at([11, 12, 13, 14], 30), '-08:00') === 30);
  ok('other dates are ignored', W.coldSpell(periods('2026-12-09', '-06:00', () => 0), K) === null);
  // Nov 1 2026: clocks fall back at 2am; 1am appears twice, the window is untouched
  const dst = periods('2026-11-01', '-05:00', () => 45, 0, 1).concat(periods('2026-11-01', '-06:00', () => 45, 1, 23));
  ok('the fall-back day still has a complete window', W.coldSpell(dst, '2026-11-01') === 45);
  // temperatures in the announced {value, unitCode} form, and junk
  const qv = periods(K, '-06:00', () => 50).map(p => ({ ...p, temperature: { value: /T1[3-6]/.test(p.startTime) ? 0 : 10, unitCode: 'wmoUnit:degC' } }));
  ok('Celsius values are converted (0°C = 32°F)', W.coldSpell(qv, K) === 32);
  ok('a null temperature is missing, not 0°F', W.coldSpell(periods(K, '-06:00', h => h === 14 ? null : 50), K) === null);
  ok('a non-number temperature is missing, not a reading', W.coldSpell(periods(K, '-06:00', h => h === 14 ? 'cold' : 50), K) === null);
  ok('a warmer duplicate hour does not hide a cold stretch',
     W.coldSpell(periods(K, '-06:00', at([12, 13, 14, 15], 30)).concat([{ startTime: K + 'T13:00:00-06:00', temperature: 60, temperatureUnit: 'F' }]), K) === 30);
  // the stretch length is one constant; every window has 5 possible 4-hour stretches
  ok('the rule is 4 hours in a row', W.COLD_HOURS === 4);
  ok('the missing-checkpoint margin is 52°F', M === 52);
  ok('spellTemp takes the stretch length (3 hours here)', W.spellTemp([30, 30, 30, 50], 3) === 30 && W.spellTemp([30, 30, 30, 50], 4) === 50);
  ok('a stretch can never be longer than the window', W.spellTemp([30, 30, 30], 4) === null);
  ok('NaN is missing', W.toF(NaN) === null && W.toF({ value: NaN, unitCode: 'wmoUnit:degF' }) === null);
}

// ---- ZIP areas and states ---------------------------------------------------------
const K = '2026-12-08';
const pt = (state, zip3) => ({ state, zip3 });
const lowsOf = (vals) => vals.map(v => v === undefined ? undefined : v === null ? null : { [K]: v });
const callFor = (states, pts, vals) => W.stateCalls(states, pts, lowsOf(vals), K);
{
  // California: 960 cold at one of its two points; 900 and 921 warm
  const pts = [pt('CA', '960'), pt('CA', '960'), pt('CA', '900'), pt('CA', '900'), pt('CA', '921')];
  const [ca] = callFor(['CA'], pts, [31, 44, 60, 62, 65]);
  ok('one cold checkpoint makes its ZIP area winter pack, not the whole state', ca.call === 'part' && ca.coldZips.join() === '960', JSON.stringify(ca));
  ok('  coldest reading reported', ca.coldest === 31);
  ok(`${F}°F exactly is winter pack`, callFor(['CA'], [pt('CA', '960'), pt('CA', '900')], [F, 60])[0].coldZips.join() === '960');
  ok(`${F + 1}°F is not`, callFor(['CA'], [pt('CA', '960'), pt('CA', '900')], [F + 1, 60])[0].call === 'standard');

  const mn = callFor(['MN'], [pt('MN', '550'), pt('MN', '551'), pt('MN', '556')], [20, 30, 33])[0];
  ok('every ZIP area cold: whole state', mn.call === 'whole');
  const tx = callFor(['TX'], [pt('TX', '790'), pt('TX', '791'), pt('TX', '770')], [30, 31, 60])[0];
  ok('more than half the ZIP areas cold: whole state', tx.call === 'whole');
  const half = callFor(['TX'], [pt('TX', '790'), pt('TX', '791'), pt('TX', '770'), pt('TX', '787')], [30, 31, 60, 61])[0];
  ok('exactly half: only those ZIP areas', half.call === 'part' && half.coldZips.join() === '790,791');

  // missing checkpoints
  const warmGap = callFor(['FL'], [pt('FL', '331'), pt('FL', '331')], [null, 72])[0];
  ok(`a missing checkpoint in a warm area (all others above ${M}°F) is still checked`, warmGap.call === 'standard');
  const coolGap = callFor(['GA'], [pt('GA', '305'), pt('GA', '305')], [null, 45])[0];
  ok(`a missing checkpoint where the others are ${M}°F or below: NOT CHECKED`, coolGap.call === 'unchecked' && coolGap.uncheckedZips.join() === '305');
  ok(`  ${M}°F exactly is not enough margin`, callFor(['GA'], [pt('GA', '305'), pt('GA', '305')], [null, M])[0].call === 'unchecked');
  ok(`  ${M + 1}°F is`, callFor(['GA'], [pt('GA', '305'), pt('GA', '305')], [null, M + 1])[0].call === 'standard');
  const allGone = callFor(['ND'], [pt('ND', '580'), pt('ND', '581')], [null, null])[0];
  ok('nothing answered: NOT CHECKED, the whole state', allGone.call === 'unchecked' && allGone.allUnchecked && allGone.coldest === null);
  const coldGap = callFor(['MT'], [pt('MT', '590'), pt('MT', '590'), pt('MT', '591')], [null, 30, 60])[0];
  ok('a missing checkpoint cannot undo a cold one in the same area', coldGap.coldZips.join() === '590');
  const incompleteDay = W.stateCalls(['WA'], [pt('WA', '988'), pt('WA', '988')], [{ [K]: null }, { [K]: 40 }], K)[0];
  ok('an incomplete window counts as missing, not as warm', incompleteDay.call === 'unchecked');

  // still loading
  const loading = callFor(['WI'], [pt('WI', '530'), pt('WI', '545')], [60, undefined])[0];
  ok('a state with a checkpoint not fetched yet is pending, not standard', loading.call === 'pending');
  const earlyWhole = callFor(['WI'], [pt('WI', '530'), pt('WI', '531'), pt('WI', '545')], [20, 22, undefined])[0];
  ok('already more than half cold while loading: whole state straight away', earlyWhole.call === 'whole');

  // the page's own path: NWS periods → coldSpells (one 4-hour low per delivery day) → stateCalls
  const K2 = '2026-12-09', K3 = '2026-12-10';
  const two = periods(K, '-06:00', h => h === 14 ? 20 : 50).concat(periods(K2, '-06:00', h => h >= 12 && h <= 15 ? 30 : 50));
  const spells = W.coldSpells(two, [K, K2, K3]);
  ok('coldSpells gives each delivery day its 4-hour low (null for a day with no forecast)', JSON.stringify(spells) === '[50,30,null]', JSON.stringify(spells));
  ok('page path: a 1-hour dip to 20°F is standard, 4 hours at 30°F is a winter pack',
     W.stateCalls(['CA'], [pt('CA', '960')], [spells], 0)[0].call === 'standard' && W.stateCalls(['CA'], [pt('CA', '960')], [spells], 1)[0].call === 'whole');
}

// ---- a state that could still turn out "whole state" ----------------------------------
{
  const nine = ['050', '051', '052', '053', '054', '055', '056', '057', '058'].map(z => pt('VT', z));
  // 3 cold, 3 not checked, 3 warm: if the 3 gaps are cold too, it's 6 of 9 → whole state
  const [vt] = callFor(['VT'], nine, [25, 26, 27, null, null, null, 40, 41, 42]);
  ok('gaps that could tip a state to "whole state": nothing in it is standard yet',
     vt.call === 'part' && vt.uncheckedZips.join() === '053,054,055,056,057,058' && vt.couldBeWhole && vt.restUnchecked, JSON.stringify(vt));
  ok('  a warm ZIP there reads "ask a pharmacist", not standard', W.zipVerdict(vt, '056', 40).verdict === 'ask');
  const [mid] = callFor(['VT'], nine, [25, 26, 27, undefined, undefined, undefined, 40, 41, 42]);
  ok('the same while loading: the state is still checking', mid.call === 'pending');
  ok('  and a warm ZIP there says wait', W.zipVerdict(mid, '056', 40).verdict === 'wait');
  const [cant] = callFor(['VT'], nine, [25, null, 40, 41, 42, 43, 44, 45, 46]);
  ok('gaps that cannot tip it: the warm areas stay standard', cant.call === 'part' && W.zipVerdict(cant, '058', 46).verdict === 'standard' && !cant.couldBeWhole);
}

// ---- the missing-checkpoint margin and elevation ------------------------------------------
{
  const mammoth = { state: 'CA', zip3: '935', elev: 8300 }, bishop = { state: 'CA', zip3: '935', elev: 4140 };
  const [ca] = callFor(['CA'], [mammoth, bishop], [null, 65]);
  ok('a missing mountain checkpoint is never covered by a warm valley one', ca.call === 'unchecked', JSON.stringify(ca));
  const near = { state: 'CA', zip3: '935', elev: 4900 };
  ok('  a missing one within 1,000 ft of the highest answer is', callFor(['CA'], [near, bishop], [null, 65])[0].call === 'standard');
}

// ---- carrier holidays don't run out -----------------------------------------------------------
{
  const last = W.NO_SERVICE_DATES[W.NO_SERVICE_DATES.length - 1];
  const soon = W.dateKey(W.addDays(new Date(), 60));
  ok(`carrier holiday list runs at least 60 days ahead (last: ${last}) — add next year's UPS holidays`, last >= soon);
  ok('every carrier holiday has a name for the ship-night note', W.NO_SERVICE_DATES.every(d => W.HOLIDAY_NAMES[d]));
}

// ---- the answer for the day ------------------------------------------------------------
{
  const states = ['CA', 'MN', 'TX', 'ND'];
  const pts = [pt('CA', '960'), pt('CA', '900'), pt('MN', '550'), pt('TX', '770'), pt('ND', '580')];
  const sum = (vals, loading) => W.summarize(W.stateCalls(states, pts, lowsOf(vals), K), { loading });

  const loading = sum([31, 60, 20, undefined, undefined], true);
  ok('while loading the status is loading, whatever has arrived', loading.status === 'loading' && loading.done === 2 && loading.total === 4, JSON.stringify(loading.status));
  ok('  the pack calls found so far are kept', loading.whole.length === 1 && loading.part.length === 1);
  ok('no answers at all after loading: weather service down', sum([null, null, null, null, null], false).status === 'down');
  ok('no answers yet while loading: still loading, not down', sum([undefined, undefined, undefined, undefined, undefined], true).status === 'loading');
  const gap = sum([60, 61, 62, 63, null], false);
  ok('one state not checked: incomplete, never complete', gap.status === 'incomplete' && gap.unchecked.map(c => c.state).join() === 'ND');
  ok('  and nothing is called winter pack', gap.packCount === 0);
  const done = sum([31, 60, 20, 63, 64], false);
  ok('everything answered: complete', done.status === 'complete' && done.whole.map(c => c.state).join() === 'MN' && done.part.map(c => c.state).join() === 'CA');
  const allClear = sum([60, 61, 62, 63, 64], false);
  ok('all warm and all answered: complete with no packs', allClear.status === 'complete' && allClear.packCount === 0);
  ok('a whole-state winter pack is not also listed as not checked',
     W.summarize(W.stateCalls(['MN'], [pt('MN', '550'), pt('MN', '551'), pt('MN', '556')], lowsOf([20, 21, null]), K), {}).unchecked.length === 0);
}

// Random loads: whatever arrives, fails or is still pending, "complete" is only
// said when the checkpoints still loading can't change any call, a checkpoint at or below the trigger always makes a winter
// pack, and losing an answer never turns a winter pack into standard.
// Temperatures are realistic: checkpoints in one ZIP area sit within ±9°F of
// each other (the 20°F margin rule assumes no more than that).
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const states = ['AA', 'BB', 'CC'];
  let badComplete = 0, flipped = 0, standardWithCold = 0;
  for (let run = 0; run < 3000; run++) {
    const pts = [], vals = [], base = {};
    for (let i = 0; i < 12; i++) {
      const p = pt(states[i % 3], String(100 + Math.floor(rnd() * 4)));
      const key = p.state + p.zip3;
      if (base[key] === undefined) base[key] = 15 + rnd() * 60;
      pts.push(p);
      const r = rnd();
      vals.push(r < 0.1 ? undefined : r < 0.2 ? null : Math.round(base[key] + (rnd() * 18 - 9)));
    }
    const calls = W.stateCalls(states, pts, lowsOf(vals), K);
    const s = W.summarize(calls, { loading: vals.includes(undefined) });
    // "complete" must be final: however the checkpoints still loading turn out
    // (all 0°F or all 90°F), no state's call may change
    if (s.status === 'complete' && vals.includes(undefined)) {
      [0, 90].forEach(f => {
        const filled = W.stateCalls(states, pts, lowsOf(vals.map(v => v === undefined ? f : v)), K);
        if (filled.some((c, k) => c.call !== calls[k].call || (c.call === 'part' && c.coldZips.join() !== calls[k].coldZips.join()))) badComplete++;
      });
    }
    calls.forEach(c => {
      if (c.call === 'standard' && pts.some((p, i) => p.state === c.state && typeof vals[i] === 'number' && vals[i] <= F)) standardWithCold++;
    });
    // knock out one more answer: no state may go from a pack to standard
    const j = Math.floor(rnd() * vals.length);
    const less = vals.slice(); less[j] = null;
    const after = W.stateCalls(states, pts, lowsOf(less), K);
    calls.forEach((c, k) => { if ((c.call === 'whole' || c.call === 'part') && after[k].call === 'standard') flipped++; });
  }
  // the ZIP box: a ZIP area called standard must still be standard once every
  // checkpoint's real temperature is known
  {
    let seed2 = 11, wrong = 0;
    const r2 = () => (seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 3000; run++) {
      const pts = [], truth = [], seen = [], base = {};
      for (let i = 0; i < 14; i++) {
        const p = pt(states[i % 3], String(100 + Math.floor(r2() * 5)));
        const key = p.state + p.zip3;
        if (base[key] === undefined) base[key] = 15 + r2() * 60;
        const t = Math.round(base[key] + (r2() * 18 - 9));
        pts.push(p); truth.push(t);
        const r = r2();
        seen.push(r < 0.12 ? undefined : r < 0.25 ? null : t);
      }
      const before = W.stateCalls(states, pts, lowsOf(seen), K), after = W.stateCalls(states, pts, lowsOf(truth), K);
      before.forEach((c, k) => c.areas.forEach(a => {
        if (W.zipVerdict(c, a.zip3, null).verdict === 'standard' && W.zipVerdict(after[k], a.zip3, null).verdict !== 'standard') wrong++;
      }));
    }
    ok('3000 random loads: a ZIP called standard is still standard once every checkpoint is known', wrong === 0, String(wrong));
  }
  ok('3000 random loads: "complete" is final — the checkpoints still loading cannot change it', badComplete === 0, String(badComplete));
  ok(`3000 random loads: a state with a checkpoint at ${F}°F or below is never standard`, standardWithCold === 0, String(standardWithCold));
  ok('3000 random loads: losing an answer never turns a winter pack into standard', flipped === 0, String(flipped));
}

// ---- ZIP lists and the ZIP box ------------------------------------------------------
{
  ok('ZIP ranges are joined', W.zipRanges(['794', '790', '791', '792']) === '790–792, 794');
  ok('  leading zeros kept', W.zipRanges(['010', '011', '014']) === '010–011, 014');
  ok('  a single area', W.zipRanges(['961']) === '961');

  const pts = [pt('CA', '960'), pt('CA', '900'), pt('CA', '921'), pt('CA', '940')];
  const [ca] = callFor(['CA'], pts, [31, 60, 61, 62]);
  ok('ZIP in a cold area: winter pack', W.zipVerdict(ca, '960', 45).verdict === 'pack');
  ok('ZIP in a warm area: standard', W.zipVerdict(ca, '900', 58).verdict === 'standard');
  ok(`ZIP in a warm area that reads ${F}°F itself: winter pack (the box can add a pack)`, W.zipVerdict(ca, '900', F).verdict === 'pack');
  ok('ZIP in a cold area that reads warm itself: still winter pack (the box never overrules the list)', W.zipVerdict(ca, '960', 50).verdict === 'pack');
  const [mn] = callFor(['MN'], [pt('MN', '550'), pt('MN', '551'), pt('MN', '556')], [20, 30, 50]);
  ok('ZIP in a whole-state winter pack: winter pack even if its own area is warm', W.zipVerdict(mn, '556', 50).verdict === 'pack');
  const [gap] = callFor(['GA'], [pt('GA', '305'), pt('GA', '305'), pt('GA', '300')], [null, 45, 70]);
  ok('ZIP in a not-checked area: ask a pharmacist', W.zipVerdict(gap, '305', 44).verdict === 'ask');
  ok('  unless it reads cold itself', W.zipVerdict(gap, '305', 30).verdict === 'pack');
  const [wait] = callFor(['GA'], [pt('GA', '305'), pt('GA', '300')], [undefined, 70]);
  ok('ZIP in an area still loading: wait', W.zipVerdict(wait, '305', 60).verdict === 'wait');
  ok('ZIP area we have no checkpoint for: ask', W.zipVerdict(ca, '999', null).verdict === 'ask');
  ok('no state at all (outside the 50 states): ask, or pack if it reads cold', W.zipVerdict(null, '006', null).verdict === 'ask' && W.zipVerdict(null, '006', 20).verdict === 'pack');
}

// ---- the files the page loads ------------------------------------------------------
{
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'winter-pack.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const v = (html.match(/<script src="winter-core\.js\?v=(\d+)"><\/script>/) || [])[1];
  const pv = (html.match(/const PAGE_VERSION = (\d+);/) || [])[1];
  ok('page, core and service worker agree on one version (core ?v=, PAGE_VERSION, VERSION, SHELL)',
     !!v && v === pv && +v === W.VERSION && sw.includes(`'./winter-core.js?v=${v}'`) && sw.includes(`'./data/us-states.json?v=${v}'`),
     `script ?v=${v}, PAGE_VERSION ${pv}, core ${W.VERSION}`);
  ok('the service worker installs from the network, not the 10-minute HTTP cache', /new Request\(u, \{ cache: 'reload' \}\)/.test(sw));
  ok('ZIP lists use markup, not invisible characters, to stay in one piece', !html.includes('\\u2060') && html.includes('class="nw"'));
  ok('the page stops on a missing or mismatched core, and loads the map file by version',
     html.includes('if (!C || C.VERSION !== PAGE_VERSION)') && html.includes("fetch('data/us-states.json?v=' + PAGE_VERSION)"));
  // the page's fixed wording matches the constants it describes
  const hourWords = [...html.matchAll(/(\d+)-hour low/g)].map(m => +m[1]);
  ok(`every "N-hour low" on the page says ${W.COLD_HOURS}`, hourWords.length > 0 && hourWords.every(n => n === W.COLD_HOURS), hourWords.join());
  ok('the How text starts from the right numbers before the script fills them',
     html.includes(`<span class="v-pack">${W.WINTER_PACK_F}</span>`) && html.includes(`<span class="v-hours">${W.COLD_HOURS}</span>`) && html.includes(`<span class="v-margin">${M}</span>`));
  ok('"freezing" is only said while the trigger is 32°F', W.WINTER_PACK_F === 32 || !/\(freezing\)|dip to freezing/.test(html));

  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'winter-checkpoints.json'), 'utf8'));
  const cols = d.columns.join();
  ok('checkpoint file columns are what the page reads', cols === 'state,zip3,lat,lon,elev_ft,gridpoint,x,y', cols);
  ok('checkpoint file has a version for the saved-forecast check', /^[0-9a-f]{12}$/.test(d.version || ''));
  const areaState = {};
  let split = 0;
  d.points.forEach(r => { if (areaState[r[1]] && areaState[r[1]] !== r[0]) split++; areaState[r[1]] = r[0]; });
  ok('every ZIP area is filed under exactly one state', split === 0, String(split));
  const codes = new Set(d.points.map(r => r[0]));
  ok('all 50 states and DC have checkpoints', d.states.length === 51 && d.states.every(([c]) => codes.has(c)));
  ok('every checkpoint has a 3-digit ZIP area and an NWS gridpoint', d.points.every(r => /^\d{3}$/.test(r[1]) && /^[A-Z]{3}\/\d+,\d+$/.test(r[5])));
  const zips = new Set(fs.readFileSync(path.join(__dirname, '..', 'data', 'zip-centroids.txt'), 'utf8').split('\n').filter(Boolean).map(l => l.slice(0, 3)));
  const missing = [...zips].filter(z => !(z in areaState));
  ok('every ZIP area in the ZIP list has a checkpoint', missing.length === 0, missing.join(','));
  // Privacy: checkpoints sit on town centres, never on ZIP centres, so the
  // published file can't be joined with the public ZIP list to recover where
  // we ship. Allow chance coincidences only (a 0.05° shift of the same points
  // lands near a ZIP centre about 2% of the time).
  const zc = {};
  fs.readFileSync(path.join(__dirname, '..', 'data', 'zip-centroids.txt'), 'utf8').split('\n').filter(Boolean).forEach(l => {
    const [, a, b] = l.split(',').map(Number); const k = Math.round(a * 10) + ',' + Math.round(b * 10); (zc[k] ||= []).push([a, b]);
  });
  const onZip = (la, lo) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [a, b] of zc[(Math.round(la * 10) + i) + ',' + (Math.round(lo * 10) + j)] || []) if (Math.abs(a - la) <= 0.0071 && Math.abs(b - lo) <= 0.0071) return true; return false; };
  const share = d.points.filter(r => onZip(r[2], r[3])).length / d.points.length;
  ok(`checkpoints don't sit on ZIP centres (${(100 * share).toFixed(1)}% near one; chance is ~2%)`, share < 0.04);
}

console.log(failed ? `\n${failed} WINTER TEST(S) FAILED, ${passed} passed` : `\nAll ${passed} winter tests passed.`);
process.exit(failed ? 1 : 0);
