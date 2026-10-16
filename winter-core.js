// Winter Pack decision rules, shared by winter-pack.html and tests/winter.js.
// Pure functions only: no DOM, no network, no clock (callers pass dates in).
//
// THE RULE (one sentence the whole page hangs on):
//   A 3-digit ZIP area gets a WINTER PACK when any checkpoint in it is 35°F or
//   colder at any hour from 11am to 6pm, local time, on the delivery day.
//   When more than half of a state's ZIP areas need one, the whole state does.
//
// Why 11am-6pm: next-day air lands late morning to mid-afternoon (11am-3pm)
// and we account for about 3 hours on the porch after that.
(function (root) {
  'use strict';

  const DELIVERY_START_HOUR = 11;
  const DELIVERY_END_HOUR = 15;
  const DWELL_HOURS = 3;
  const WINDOW_END_HOUR = DELIVERY_END_HOUR + DWELL_HOURS;           // 18:00
  const WINDOW_HOURS = WINDOW_END_HOUR - DELIVERY_START_HOUR + 1;     // 8 hourly readings
  const WINTER_PACK_F = 35;   // 32°F is freezing; 3°F of room for forecast error and a shaded porch
  // A ZIP area with a checkpoint that didn't answer is still called "checked"
  // when every checkpoint that did answer is above 55°F AND the missing one is
  // no more than 1,000 ft higher than the highest one that answered: at about
  // the same elevation, a missing point in the same 3-digit ZIP area is not
  // 20°F+ colder than all of its neighbours. A missing mountain checkpoint
  // (Mammoth next to Bishop) is never covered this way; its area reads NOT
  // CHECKED, and so does any area at 55°F or below with a gap.
  const CHECK_MARGIN_F = 20;
  const CHECK_MARGIN_CLIMB_FT = 1000;
  const WHOLE_STATE_SHARE = 0.5;   // more than half the ZIP areas cold → whole state
  const PICKUP_HOUR = 16;          // carrier pickup, Central; after this "today" has shipped
  // NWS hourly forecasts run 156 hours from the current hour. Delivery day +5
  // is the last one whose 11am-6pm window is complete in every US time zone
  // (Hawaii included) whatever time the page loads.
  const LAST_DELIVERY_OFFSET = 5;
  // No pickup and no delivery (UPS). Check the carrier's holiday list each
  // year; tests/winter.js fails when this list runs out within 60 days.
  const NO_SERVICE_DATES = [
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
    '2027-01-01', // New Year's Day
    '2027-05-31', // Memorial Day
    '2027-07-05', // Independence Day (observed)
    '2027-09-06', // Labor Day
    '2027-11-25', // Thanksgiving
    '2027-12-24', // Christmas (observed; the 25th is a Saturday)
    '2027-12-25',
    '2027-12-31', // New Year's Day (observed; Jan 1 is a Saturday)
    '2028-01-01',
  ];
  const HOLIDAY_NAMES = {
    '2026-11-26': 'Thanksgiving', '2026-12-25': 'Christmas', '2027-01-01': "New Year's Day",
    '2027-05-31': 'Memorial Day', '2027-07-05': 'Independence Day', '2027-09-06': 'Labor Day',
    '2027-11-25': 'Thanksgiving', '2027-12-24': 'Christmas', '2027-12-25': 'Christmas',
    '2027-12-31': "New Year's Day", '2028-01-01': "New Year's Day",
  };

  // ---- dates (local calendar days, never UTC) ---------------------------------
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function daysBetween(a, b) {
    return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  }
  function noService(d) { return NO_SERVICE_DATES.indexOf(dateKey(d)) !== -1; }

  // Mon-Thu ship nights deliver the next weekday that has service. Friday ships
  // only Saturday-delivery items, so a Friday night exists only when Saturday
  // has service. No Saturday or Sunday ship nights.
  function deliveryFor(ship) {
    const wd = ship.getDay();
    if (wd === 0 || wd === 6 || noService(ship)) return null;
    if (wd === 5) { const sat = addDays(ship, 1); return noService(sat) ? null : sat; }
    let d = addDays(ship, 1);
    while (d.getDay() === 0 || d.getDay() === 6 || noService(d)) d = addDays(d, 1);
    return d;
  }

  // The ship nights the page can make a call for, starting today.
  function shipPlan(today) {
    const out = [];
    for (let i = 0; i <= LAST_DELIVERY_OFFSET; i++) {
      const ship = addDays(today, i);
      const deliv = deliveryFor(ship);
      if (!deliv || daysBetween(today, deliv) > LAST_DELIVERY_OFFSET) continue;
      out.push({
        ship, deliv,
        shipKey: dateKey(ship), delivKey: dateKey(deliv),
        shipOffset: i,
        transitDays: daysBetween(ship, deliv),
        saturdayOnly: ship.getDay() === 5,
      });
    }
    return out;
  }

  // Which night to show first: today until the carrier picks up, then the next.
  function defaultNight(plan, today, hourNow) {
    if (!plan.length) return 0;
    if (plan[0].shipOffset === 0 && hourNow >= PICKUP_HOUR && plan.length > 1) return 1;
    return 0;
  }

  // ---- forecasts -----------------------------------------------------------------
  // NWS sends plain °F numbers today and has announced an optional
  // {value, unitCode} form. Anything unreadable is missing, never a temperature.
  function toF(t, unit) {
    if (typeof t === 'number') return Number.isFinite(t) ? (unit === 'C' ? Math.round(t * 9 / 5 + 32) : t) : null;
    if (t && typeof t.value === 'number' && Number.isFinite(t.value)) {
      return /degC$/.test(t.unitCode || '') ? Math.round(t.value * 9 / 5 + 32) : Math.round(t.value);
    }
    return null;
  }

  // Coldest reading 11:00-18:00 on `key`, local to the forecast point (the
  // startTime carries the point's own UTC offset, so the first 10 characters are
  // its local date and characters 11-12 its local hour). Null unless all 8
  // hours are present: half a window is not a check.
  function windowLow(periods, key) {
    let n = 0, low = null;
    for (const p of periods || []) {
      if (!p || typeof p.startTime !== 'string' || p.startTime.slice(0, 10) !== key) continue;
      const h = parseInt(p.startTime.slice(11, 13), 10);
      if (!(h >= DELIVERY_START_HOUR && h <= WINDOW_END_HOUR)) continue;
      const t = toF(p.temperature, p.temperatureUnit);
      if (t === null) continue;
      n++;
      if (low === null || t < low) low = t;
    }
    return n >= WINDOW_HOURS ? low : null;
  }
  function windowLows(periods, keys) { return keys.map(k => windowLow(periods, k)); }

  // ---- the call ----------------------------------------------------------------------
  // points:  [{state, zip3, elev (ft, optional)}]
  // lows:    per point: undefined = not fetched yet, null = fetch failed,
  //          otherwise {key: lowF|null} (null for a day = window incomplete)
  // Returns one entry per state (in `states` order):
  //   {state, call, coldest, coldZips, uncheckedZips, pendingZips, areas}
  //   call: 'pending' | 'whole' | 'part' | 'standard' | 'unchecked'
  function stateCalls(states, points, lows, key) {
    const byState = {};
    states.forEach(s => { byState[s] = {}; });
    points.forEach((p, i) => {
      const areas = byState[p.state];
      if (!areas) return;
      const a = areas[p.zip3] || (areas[p.zip3] = { zip3: p.zip3, low: null, answered: 0, missing: 0, pending: 0, topAnswered: null, topMissing: null });
      const r = lows[i];
      const e = typeof p.elev === 'number' ? p.elev : null;
      if (r === undefined) { a.pending++; return; }
      const t = r === null ? null : r[key];
      if (t === null || t === undefined) {
        a.missing++;
        if (e !== null && (a.topMissing === null || e > a.topMissing)) a.topMissing = e;
        return;
      }
      a.answered++;
      if (e !== null && (a.topAnswered === null || e > a.topAnswered)) a.topAnswered = e;
      if (a.low === null || t < a.low) a.low = t;
    });
    return states.map(state => {
      const areas = Object.keys(byState[state]).sort().map(z => {
        const a = byState[state][z];
        let status;
        if (a.low !== null && a.low <= WINTER_PACK_F) status = 'cold';
        else if (a.pending) status = 'pending';
        else if (!a.missing) status = 'ok';
        else if (a.answered && a.low > WINTER_PACK_F + CHECK_MARGIN_F &&
                 !(a.topMissing !== null && a.topAnswered !== null && a.topMissing > a.topAnswered + CHECK_MARGIN_CLIMB_FT)) status = 'ok';
        else status = 'unchecked';
        return { zip3: z, status, low: a.low };
      });
      const count = st => areas.filter(a => a.status === st).length;
      // If the areas still loading or not checked could push this state past
      // half cold, none of it is standard yet: the whole state may need a pack.
      const share = areas.length * WHOLE_STATE_SHARE;
      const couldBeWhole = count('cold') <= share && count('cold') + count('pending') + count('unchecked') > share;
      if (couldBeWhole) {
        const to = count('pending') ? 'pending' : 'unchecked';
        areas.forEach(a => { if (a.status === 'ok') a.status = to; });
      }
      const pick = st => areas.filter(a => a.status === st).map(a => a.zip3);
      const coldZips = pick('cold'), pendingZips = pick('pending'), uncheckedZips = pick('unchecked');
      const lowsKnown = areas.filter(a => a.low !== null).map(a => a.low);
      const coldest = lowsKnown.length ? Math.min.apply(null, lowsKnown) : null;
      let call;
      if (!areas.length) call = 'unchecked';
      else if (coldZips.length > areas.length * WHOLE_STATE_SHARE) call = 'whole';
      else if (pendingZips.length) call = 'pending';
      else if (coldZips.length) call = 'part';
      else if (uncheckedZips.length) call = 'unchecked';
      else call = 'standard';
      return { state, call, coldest, coldZips, uncheckedZips, pendingZips, couldBeWhole,
               allUnchecked: uncheckedZips.length === areas.length,
               restUnchecked: uncheckedZips.length > 0 && coldZips.length + uncheckedZips.length === areas.length, areas };
    });
  }

  // The answer for one delivery day, which everything on screen and in the
  // copied note is built from. Nothing here may call an unchecked state
  // standard.
  //   status: 'loading'   - states still being fetched; no all-clear yet
  //           'down'      - the load finished and nothing answered at all
  //           'incomplete'- finished, some areas not checked
  //           'complete'  - every state checked
  function summarize(calls, opts) {
    opts = opts || {};
    const whole = calls.filter(c => c.call === 'whole');
    const part = calls.filter(c => c.call === 'part');
    const pending = calls.filter(c => c.call === 'pending');
    const unchecked = calls.filter(c => c.uncheckedZips.length && c.call !== 'whole');
    const answered = calls.some(c => c.coldest !== null);
    let status;
    if (pending.length && opts.loading) status = 'loading';
    else if (!answered) status = opts.loading ? 'loading' : 'down';
    else if (pending.length || unchecked.length) status = 'incomplete';
    else status = 'complete';
    return {
      status, whole, part, unchecked, pending,
      done: calls.length - pending.length, total: calls.length,
      packCount: whole.length + part.length,
    };
  }

  // ['790','791','792','794'] → '790–792, 794'
  function zipRanges(zips) {
    const n = zips.map(Number).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < n.length; i++) {
      let j = i;
      while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
      const f = x => String(x).padStart(3, '0');
      out.push(j > i ? `${f(n[i])}–${f(n[j])}` : f(n[i]));
      i = j;
    }
    return out.join(', ');
  }

  // One ZIP typed into the check box. The box can add a winter pack (this exact
  // spot reads colder than our checkpoints) but never overrule the list.
  //   area: the state's call entry; exactLow: this ZIP's own window low or null
  //   → {verdict: 'pack'|'standard'|'ask'|'wait', why}
  function zipVerdict(area, zip3, exactLow) {
    const exactCold = exactLow !== null && exactLow !== undefined && exactLow <= WINTER_PACK_F;
    if (!area) return exactCold ? { verdict: 'pack', why: 'exact' } : { verdict: 'ask', why: 'no-area' };
    const a = area.areas.find(x => x.zip3 === zip3);
    if (area.call === 'whole') return { verdict: 'pack', why: 'whole' };
    if (a && a.status === 'cold') return { verdict: 'pack', why: 'area' };
    if (exactCold) return { verdict: 'pack', why: 'exact' };
    if (!a) return { verdict: 'ask', why: 'no-area' };
    if (a.status === 'pending') return { verdict: 'wait', why: 'pending' };
    if (a.status === 'unchecked') return { verdict: 'ask', why: 'unchecked' };
    return { verdict: 'standard', why: 'area' };
  }

  const api = {
    DELIVERY_START_HOUR, DELIVERY_END_HOUR, DWELL_HOURS, WINDOW_END_HOUR, WINDOW_HOURS,
    WINTER_PACK_F, CHECK_MARGIN_F, CHECK_MARGIN_CLIMB_FT, WHOLE_STATE_SHARE, PICKUP_HOUR, LAST_DELIVERY_OFFSET, NO_SERVICE_DATES, HOLIDAY_NAMES,
    dateKey, addDays, daysBetween, deliveryFor, shipPlan, defaultNight,
    toF, windowLow, windowLows, stateCalls, summarize, zipRanges, zipVerdict,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WinterCore = api;
})(typeof window !== 'undefined' ? window : this);
