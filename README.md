# Prescription Mart — Overnight Shipping Weather Monitor

A zero-backend dashboard that helps the shipping team decide whether to send
next-day-air specialty pharma overnight. It evaluates the **10pm–4am sort
window** at the carrier hubs we depend on and surfaces anything that would
delay the overnight package sort.

Live dashboard: `https://prescriptionmart.github.io/weather-monitor`

---

## What it shows

The site is three pages (tabs at the top):

**Hub Forecasts (`index.html`)**
- Next 3 sort windows at our **Houston (IAH) origin** — where every package
  leaves from — plus the carrier hubs: **FedEx Memphis (MEM)**, **UPS Louisville
  (SDF)**, and **UPS Indianapolis (IND)** — each evaluated in its own local time.
- A combined recommendation ("hold next-day air", "ship with caution", etc.)
  plus one-click **email** and **team-message** drafts.
- **Live FAA delays** (ground stops / ground delay programs) at IAH and the three hubs.
- **Delivery destination check** — enter a ZIP to see weather where the package lands over the next two days (a clear hub doesn't help if the destination is socked in).
- Regional watch zones (ORD, DFW, ATL, DEN, LAX, JFK) for situational awareness.
- Links out to FedEx/UPS service alerts and the FAA National Status board.

Both pages are a **PWA** — open the site on a phone and "Add to Home Screen" for an app-like, installable shortcut that still shows the last-loaded data when offline.

**Winter Packing Map (`winter-pack.html`)**
- One decision per state per ship night: **WINTER PACK or STANDARD**.
  Packages ship overnight, are delivered around midday the next day, and sit
  on the porch for a few hours — so the rule is: **winter pack if the coldest
  hour between 11am and 6pm on delivery day is ≤35°F at any town we actually
  ship to in that state** (NWS hourly forecast). 32°F is freezing; the extra
  3°F absorbs hourly-forecast error and a shaded porch.
- **Two kinds of sampled towns** (≈2,300 total). *Ship-to towns* (`ship: true`,
  ~1,950) are our real delivery footprint — every town with 2+ shipments in a
  month of our own shipment history plus a top-10 floor per state, thinned so
  no two are within 8 km — and they **drive the call**. *Coverage towns*
  (~370: vetted cities plus cold corners) can't flip a
  state on their own; if one is ≤35°F while the footprint is fine, the state
  is shown as **standard with cold-pocket exceptions** — winter pack only if
  the label is going to one of the listed towns. (Only town names and
  coordinates are stored — no shipment counts, ZIPs, or customer data.)
- States at **≤15°F** at a ship-to town are still "winter pack" but tagged
  **severe** so ops can also cut dwell (hold-at-location / signature) — beyond
  a standard winter shipper's qualification.
- A big banner gives the day's answer, solid dots mark the ship-to town
  driving each winter-pack state, hollow dots mark cold pockets, and
  **Copy pack-out note** produces a paste-ready list including the exceptions.
  Overnight and hub lows are shown for context only.
- **Refresh.** Forecasts are cached for an hour, so the map card shows how old
  the data is ("Forecasts fetched 20 minutes ago") and a **Refresh** button
  discards the cache and pulls fresh ones. It is disabled while a load runs,
  and overlapping loads (refresh vs. retry-incomplete) are guarded.
- **Load behaviour.** A cold load needs a forecast for ~2,300 towns (two NWS
  calls each). Requests go through a bounded queue (`MAX_INFLIGHT = 10`) and
  every call — including the `/points/` lookup — retries throttling and outages
  four times with exponential backoff. States that return nothing render grey
  (never as "standard"), states that answered on only part of their footprint
  are named, and a banner offers a one-click retry of just those. A partial
  load is cached for 5 minutes instead of an hour so it self-heals.
- Window, dwell and thresholds are named constants at the top of
  `winter-pack.html` (`DELIVERY_START_HOUR`, `DELIVERY_END_HOUR`,
  `DWELL_HOURS`, `WINTER_PACK_F`, `SEVERE_F`). To refresh the footprint, mark
  towns `ship: true` in `STATES_BY_FIPS` (the generic list needs no change).

**Excursion Check (`excursion.html`)**
- A phone script for the "my medication arrived warm / half-frozen" call, with
  one verdict: **OK TO USE / JUDGMENT CALL / REPLACE**, one sentence why, and
  a ready script for the patient. The pharmacist uses it directly; judgment
  cases show the factors to weigh plus a keep-it script and a replace-it script.
  1. Pick the product (allowance shown in one line: *up to 77°F for 14 days ·
     not below 36°F · do not freeze* — from `data/drugs.json`, converted from
     the pharmacy's Temperature Sensitive Stabilities spreadsheet).
  2. Ask how the ice packs felt: **slushy** → the cold chain held → OK.
     **Frozen solid** → the box never warmed, but solid ice raises the freeze
     question instead (see *Freezing* below). **Thawed but cool** or
     **thawed and warm** → the air is scored over the stretch the product
     counted as out of the fridge (see *The clock* below). A product that
     itself looks frozen / has ice crystals / looks different → REPLACE
     regardless.
  3. ZIP (city and state appear as soon as five digits are typed; sort-hub
     ZIPs via chips) + shipped/received dates → observed
     outdoor temperature from the nearest NWS station, scored worst-case
     (outdoor air the whole time) against the product's ceiling, floor (the
     sheet's Min Temp, 36°F for refrigerated) and allowance length. Never
     exceeded and inside the allowance days → OK; exceeded, below the floor,
     or too many days → JUDGMENT CALL with the numbers and the factors to weigh.
- JUDGMENT CALL cards read as bullets: *What we know* (the numbers) and
  *Your call — weigh* (one line per factor with a KEEP / REPLACE lean), then
  a keep-it and a replace-it script. Details (station, distance, daily
  highs/lows, copy-for-the-record) are expanded below the verdict and can be
  collapsed. Constants: `PACKOUT_RATING_HOURS = 48`, `PICKUP_HOUR`.
- **Freezing.** Every product on this list is treated as freeze-sensitive, so
  frozen-solid packs always raise the freeze question rather than clearing the
  shipment. That flag used to be derived from whether the source spreadsheet
  happened to say "do not freeze", which made it an accident of transcription:
  the Mounjaro autoinjector row came out freeze-tolerant and the vial/KwikPen
  row did not, for the same molecule. `scripts/convert-drugs.py` now sets it
  unconditionally.
- **Cold packs never clear a room-temperature product.** Afinitor, Opzelura and
  Monovisc are stored well above freezing, and a melting pack holds the box at
  `PACK_MELT_F` for the whole trip, which is under their floors. The outdoor
  record cannot see that, because the box was colder than the air around it.
  So for these three the packs are the evidence of cold exposure rather than
  the reassurance, and slushy or solid packs give a judgment call naming the
  product's own range. Where the label has a cold window, Opzelura's -4 to 59°F
  for 4 days, the card credits it and asks how long the box sat there instead.
- **Solid packs that outlasted the pack-out** get their own card and can never
  produce a clean OK. Ice that should have melted and did not has usually
  melted and re-frozen, and re-freezing a pack takes air well below freezing —
  the same air the vial was sitting in, which is the one exposure that damages
  a protein irreversibly and often invisibly. The innocent reading, a pack-out
  that simply ran long in a cool hold, fits the same observation and nothing
  inside the box separates the two. The card asks where the parcel was held
  (a hub hold or cold-storage scan) and whether the pack still holds its
  moulded shape. Transit time comes from the shipped and received dates via
  `transitHours()`; pick-up is `PICKUP_HOUR` and the received date is assumed
  to be midday, which puts a next-morning delivery inside the rating and
  anything arriving on a third day outside it.
- **Short allowances are counted in hours.** Anything under three days
  (`SHORT_ALLOWANCE_HOURS`) is measured against elapsed hours, not calendar
  days: Humatrope's 12 hours, Tremfya's 24-hour transit window, Forteo's 36
  hours, Skyrizi's 48. Calendar days were wrong in both directions. A day
  rounded a 4-hour allowance up to "1 of 1 day" and cleared it, and a
  next-day delivery touches two calendar days, so a 24-hour allowance could
  never clear one. Time is counted on the clock below. The received date
  carries no clock time, so delivery is assumed around midday and the budget
  line says so.
- **Manufacturer windows are judged in hours.** Many rows carry a short
  high-temperature window beside the everyday allowance, most of them from
  Lilly's TempEx tool: Humalog allows 86°F for 28 days *and* up to 104°F for
  12 hours. A peak above the everyday ceiling is judged against the window it
  falls in by counting the hours the air spent above that ceiling, and the
  trip must still fit the main allowance. A window that leaves an uncovered
  gap beneath it can never clear across the gap. When a window carries its own
  instruction (Enbrel: back in the fridge, use within 4 days) the card gives
  that instead of the everyday one. Peaks above every window get *outside the
  published windows* with a link to the manufacturer's calculator.
- **The last tenth of a high-heat window is a judgment call, never a
  replace.** A window is cleared outright only with more than
  `BAND_MARGIN_SHARE` (10%) of its hours to spare, at least an hour: Aimovig's
  48-hour window clears up to 43 hours, Humalog's 12 up to 10, Basaglar's 4 up
  to 3. It mirrors the 5°F margin on temperature, because the hour count comes
  from station air up to 100 miles away, bucketed by clock hour. Kept small on
  purpose so it does not cost reships: the card says the exposure is covered
  on the numbers, leads with the keep script, and a clear with room to spare
  says how many hours were left.
- **Use-by date.** For a product that cannot go back in the fridge, the card's
  *Then tell them* line gives the date to use it by, and so does the NewLeaf
  note. The deadline is when the clock below started plus the allowance, or a
  window's own use-within figure (Enbrel, 4 days after a spell up to 107.6°F;
  `useWithinHours` on the tier). The date shown is the day before the
  deadline's date, so "use it by Monday" always leaves the deadline still
  ahead. Delivered on that day or later with time left, the card says to use
  it today; delivered after the deadline itself, that the time has run out.
  Products that may go back in the fridge keep to their expiration and get no
  date. A product that never counted as out of the fridge (slushy or solid
  packs, or cool packs inside the 48 hours) gets "into the fridge as normal"
  and none of the out-of-fridge instructions.
- **Cold data below the floor** (Avonex down to 23°F for 36 hours, Darzalex
  down to -4°F in limited episodes) is shown on the allowance line and on the
  cold and freeze cards, with where the dip sat against it. It never widens
  the floor or clears a shipment: a station low is not the box, and episode
  limits cannot be read from a weather record.
- **Both ends of the range are reported.** A trip that dipped below the floor
  *and* exceeded the ceiling used to return on the cold hours alone and never
  show the heat. It now reads *cold and heat exposure* and carries both sets
  of numbers.
- **What has to be true before a clean OK.** The weather record has to be good
  enough (at least ~18 of 24 hours reported on every scored day, judged against
  the hours that day could have had, and a station within 100 miles), and the
  peak has to sit at least `CEILING_MARGIN_F` (5°F) under the ceiling, widened
  to 10°F for products whose ceiling could not be verified. Anything short of
  that is a judgment call naming the reason, never a silent pass. Every verdict
  carries an evidence line: how many readings, from where, how far away.
- **Weather within 100 miles is treated as the same weather**
  (`MAX_STATION_MILES`). The nearest station with readings is the record. When
  it has missing hours, `fillGaps()` fills them from other stations inside the
  radius, nearest first: another station only ever supplies an hour the
  primary has no reading for, never replaces or averages one it has. Filling
  is limited to stations within `FILL_ELEVATION_FT` (1,000 ft) of the primary,
  because air cools about 3.5°F per 1,000 ft and a higher station would
  under-read heat. The evidence line names every station used and how many
  hours each supplied, and so does the NewLeaf note. Extra stations are only
  fetched when the record actually has holes.
- **The clock** (`exposureStart()`, `exposureEnd()`). The pharmacy's rule: a
  product counts as out of the fridge 48 hours after the 4pm carrier pick-up
  (`PICKUP_HOUR`, Central, plus `PACKOUT_RATING_HOURS`). Only the air from
  then until delivery, taken as midday on the received date, is scored, hour
  by hour, and the use-by date and the duration check run from the same
  start. Worked example, Aimovig (77°F for 7 days, can't go back in the
  fridge) picked up Tue 4pm:

  | Delivered | Packs | Counted | Card |
  |---|---|---|---|
  | Wed, on time | slushy or cool | nothing | OK, fridge as normal, no use-by |
  | Thu, 1 day late | cool | nothing, inside the 48 hours | same |
  | Fri, 2 days late | cool | Thu 4pm to Fri noon, 20 h | use by Wed, don't refrigerate |
  | Fri, 2 days late | warm | the same 20 h | same, with the safeguard below |
  | Wed, on time | warm | from the Tue 4pm pick-up | no credit; if kept, use by Mon |

  Two exceptions count from the pick-up itself: **warm packs on an on-time
  delivery**, which prove the pack-out gave out early, and **room-temperature
  products**, which have no pack-out. Hours before the pick-up, when the
  product was still in the pharmacy fridge, and after delivery are never
  counted. No readings inside the counted stretch is treated as no evidence,
  never a pass. Every card's evidence line states the stretch counted. The
  delay reference already worked this way, and a test checks the card and the
  reference agree for every product. Setting `PICKUP_HOUR` earlier than reality
  is conservative; later is not.
- **Cool packs settle the heat question** (`COOL_PACKS_COVER_F`). Packs only
  warm over a trip, so packs still clearly cooler than the room on delivery
  mean the inside of the box was never warmer than that and the product never
  reached the outdoor heat. For every product whose limit is 77°F or higher,
  which is every product with an allowance, cool packs clear the heat side
  however hot the air got: shipped Monday, delivered Thursday in a 95°F
  Houston week, Humira with cool packs is OK TO USE and with warm packs is a
  heat judgment call. Cool packs do not cover cold, do not stretch the time
  allowance, and do not change the use-by or fridge instructions. A gappy
  weather record only matters with cool packs when the low came within 10°F
  of the floor. Room-temperature products are not covered. The pack button
  reads "clearly cooler than the room to the touch", because the rule rests
  on it.
- **The safeguard on warm packs.** For warm packs on a late delivery the verdict
  is first decided counting from the pick-up. If that would not clear and the
  48-hour rule would, the rule is the only thing clearing it, and warm packs
  mean nothing shows how long the pack-out actually lasted. The card reads
  *JUDGMENT CALL — clears only on the 48-hour rule* with both counts, instead
  of OK TO USE. It never makes a verdict worse than counting from pick-up.
- **No allowance covers time above the ceiling.** A label's "77°F for 14 days"
  is time at or below 77°F; hours above it are outside the label, not spent
  from that budget. The heat cards say so, never weigh hours above against the
  allowance, and ask only whether the heat reached the product: pack state,
  how far and how long over, where it waited, and appearance, which can show
  damage but cannot clear heat.
- **Timezones**: day boundaries resolve in the weather station's own zone, not
  the browser's, and are DST-correct (a fall-back day is 25 hours). Pick-up
  resolves in Central regardless of destination.
- **Budget consumed.** The allowance is a budget, so the tool says what the trip
  spent of it: "about 36% of the 14-day allowance (5 of 14 days, 9 left)", or
  "all of the 2-day allowance and 4 days more" when it overruns. Flat arithmetic
  on the label's own number: labels publish a budget, not a rate, so nothing is
  weighted or modelled. Cumulative products say it counts against the running
  total.

  > Mean kinetic temperature was built and then removed. It is valid as a
  > compliance test against USP's 8°C limit for controlled cold temperature,
  > but ~91% of this list (antibodies, insulins, peptides) fails by aggregation
  > or fibrillation rather than rate-limited chemistry, so the number is not a
  > stability prediction for them, and against a flat labelled allowance it
  > added no decision power. See git history if it is ever wanted back.
- **Copy note for NewLeaf** produces a 2-3 line activity note, not a report.
- **On the call** — a highlighted card right under the verdict with seven one-line tips (packs are
  the thermometer, ask when it went in the fridge, say what you checked then
  the answer, weaker dose vs missed dose, manufacturer med-info line, a
  safety-net line for anxious patients, log it).
- **How late is too late (`delay-guide.html`)** — the duration half of a delay
  call, for every product, with no ZIP and no weather. Enter how many days late
  and it splits the list into still-inside and past-the-allowance. Worked in
  hours: a package N days late arrives around midday N+1 days after the 4pm
  pick-up, the pack-out covers the first 48 hours, and the rest must fit the
  allowance (`maxDaysLate()`, kept identical on both pages). For whole-day
  allowances that is `allowance days + 1`; short ones are no longer rounded up
  to a day they do not have. At 2 days late Darzalex, Omnitrope and Humatrope
  are past it; at 3 days Forteo, Nivestym and Tremfya join them.
  Room-temperature products are left out, since a cold-chain delay does not
  apply. Computed live from `data/drugs.json`, so it tracks the sheet.
- **Basis & references (`excursion-basis.html`)** — what each rule rests on
  (USP <659>/<1079>, CDC excursion procedure, ISTA 7D/7E, URAC P-MD, 22 TAC
  §291.12, JAPhA 2023 mail-transit study, manufacturer allowances), where
  the literature is thin, SOP wording, and a numbered reference list.
- **Product search** — type-ahead over the product list (matches any word
  start, so "kwik" finds Mounjaro KwikPen), each row showing its allowance.
  The last product used is remembered.
- **Pack physics.** `PACK_MELT_F = 32`. Our gel packs are polymer ice, which
  is water held in a superabsorbent polymer, so they melt at essentially 32°F.
  Any ice left means the coldest point in the box was about 32°F and the heat
  that got in was less than the remaining latent heat. That is why "slushy" is
  accepted without a temperature check, and why packs still **frozen solid**
  raise a freeze question for freeze-sensitive products rather than a clean OK.
  If the packs ever change to an engineered phase-change material (many melt
  at 41°F), change that constant and re-read the frozen/slushy wording.
- **Banded allowances.** A few labels publish more than one window. Aimovig
  allows 7 days up to 77°F **and, separately**, 2 days at 86–104°F; Opzelura has
  three. The sheet's Max Temp cell for Aimovig reads `104**`, which is the top of
  the *second* window, not a ceiling that holds for 7 days — using it as one
  would invent an allowance nobody published. So `excursionMaxF` is the primary
  ceiling and the windows live in `tiers`. A peak landing in a higher window is
  judged against **that window's** own allowance, which stops the tool flagging
  exposure the manufacturer has already covered. Aimovig publishes nothing
  between 77°F and 86°F, and a peak in that gap is called out as having no
  coverage either way rather than rounded into a window.
- **Special product classes** the tool handles separately: products with **no
  room-temperature allowance** (Forteo, Genotropin, Omnitrope) go to the
  manufacturer, since no weather reading can clear them; **insulins whose
  allowance depends on the presentation** link the manufacturer's stability
  calculator; **room-temperature products** (Afinitor, Monovisc, Opzelura)
  skip the ice-pack question entirely.
- **Keeping the product** now carries the right aftercare: a **cumulative**
  allowance says the clock does not reset, a **do-not-return-to-fridge** label
  says so, and a one-time allowance is flagged as partly spent.

### Tests
`.claude/hooks/check.sh` is the repo's lint and test run: it parses the inline
JS on every page, validates the JSON feeds, and runs `tests/decisions.js`.

`tests/decisions.js` locks down the rules a pharmacist acts on, so a failure
there is not a style nit. It covers freeze handling, solid packs past the
pack-out rating, sub-day allowances, the unverified-ceiling margin, cold and
heat on one trip, and a regression set over the summer heat path: excursions
never clear, the 5°F margin holds, the allowance boundary is exact, distant or
gappy records cannot clear a shipment, and banded products are judged against
the right window. It runs against the page's real `decide()`, extracted by
`scripts/extract-core.py` into `tests/_core.generated.js`, which is generated
and not committed.

### Drug data
`data/drugs.json` is generated. Do not hand-edit it:
```
python3 scripts/convert-drugs.py Temp_Excursion_CV.xlsx -o data/drugs.json
```
The converter finds columns by header (Drug, Manufacturer, Excursion Length,
Max Temp, Min Temp, Protect From Light?, Storage), so a reordered sheet still
converts. Product rows run to the first blank row; the **online stability
calculators** table below them is attached to each product by manufacturer and
shown as a link on the allowance line and on the cards that say to call the
manufacturer.

**The "Credit from Return?" column is deliberately not converted.** It holds
the pharmacy's return-credit figures, not stability data, and this repository
and the site it publishes are public. Keep the spreadsheet itself out of the
repository for the same reason.

The **Max Temp column is not consistently the excursion ceiling**: for Nivestym
and Simponi it is the fridge ceiling (46°F), for Tremfya and Sogroya a hard
limit (86°F), and on the TempEx rows it is the short high-temperature figure
(104°F). The page needs the everyday allowance ceiling, so it is parsed from
the text and every row where the two disagree is printed on each run. Rows
needing human judgment sit in `OVERRIDES` with a stated reason that surfaces
on the page as the ℹ line; a name in `OVERRIDES` that is not in the sheet stops
the run, so a renamed product cannot silently lose its rules.

**Two windows per row.** Where the Storage column gives a room-temperature
allowance and Excursion Length a short manufacturer figure, the row becomes
`tiers`: the everyday window plus a band from its ceiling up to the excursion
limit, judged in hours on the page. Cold figures below the floor become cold
bands for display only.

**After-first-use allowances.** Some rows carry an allowance that applies to a
pen already in use, not to unopened stock in transit, which is always what this
tool looks at. Those rows set `inUseAllowance`, show a warning on the allowance
line, and can never produce a clean OK. They were read by hand, not by wording
heuristics: Ozempic, Saxenda, Victoza, Xultophy, Soliqua, Toujeo, Norditropin.

**Return to the fridge** is read sentence by sentence, skipping in-use rules.
"Do not put pen back in the refrigerator after first use" says nothing about
unopened stock, and reading it as a transit rule marked four insulins wrongly.

Row fields: `name`, `manufacturer`, `ndc` (reference only), `storageMinF`/
`storageMaxF`, `excursionMinF`/`excursionMaxF` (the everyday allowance
ceiling), `allowanceHours`, `cumulative`, `returnToFridge`, `noExcursion`,
`refrigerated`, `calculatorUrl` (only when a row gives no numbers at all),
`mfrCalculator`, `tiers` (`minF`, `maxF`, `hours`, optional `note`),
`inUseAllowance`, `excursionNote`, `storage`, `protectFromLight`,
`freezeSensitive`, optional `flag` and `derivation`.

### Design system
All four pages share one token block (copied into each page's `<style>`, since
there is no build step): **Inter** throughout, a teal brand accent, **one coral
CTA per page** (`.btn-cta` — refresh on Hub Forecasts, copy pack-out note on the
map, check the temperature on Excursion Check) with dark-filled `.btn-primary`
for everything else, gold reserved for advisories. The header and day banner form
one full-bleed dark panel with a 48px rounded bottom; nav is pill-shaped; cards
are 32px-radius hairline surfaces with **no drop shadows** (elevation comes from
surface contrast). Header, tabs and content share one 1200px grid via a
`max()` gutter. Dark mode maps the same tokens onto a charcoal scale.

### Playful layer (`retro.css`, `retro.js`)
Shared by all five pages. Two ideas carry it: `steps()` timing instead of
easing, so motion lands in discrete frames like a sprite, and hard offset
shadows instead of soft blurs.

- **Buttons and tabs** depress on press and snap rather than glide.
- **Verdict cards** land like a title card, with a different entrance per
  outcome. OK bounces, JUDGMENT wobbles, REPLACE gets a single heavy thud and
  no bounce — a binned dose should not feel like a win.
- **The winter map's 2–3 minute load** gets a pixel parcel crossing a
  segmented bar. The sprite is an inline SVG built in `retro.js`, so there is
  no image file. The Excursion Check's lookup gets a scanning bar.
- **Retro mode** is hidden: the Konami code, or five taps on the header mark
  on a phone. It squares every corner, adds scanlines and a slow CRT roll, and
  switches headings and chrome to Press Start 2P. Body copy stays Inter,
  because the pixel font is too wide for running text on a phone — which also
  means the mode degrades gracefully if the font never downloads. The font is
  fetched only when the mode is first switched on, never on a normal load.
  The setting is remembered and restores silently.
- **Retro mode can be left with a button.** An EXIT RETRO control appears next
  to the theme toggle while the mode is on, so nobody has to remember the code
  to get out.
- Everything here is decoration. Nothing gates or delays a verdict, and the
  whole layer is inert under `prefers-reduced-motion`.

### The party (`characters.js` + `battle.js`, Excursion Check only, retro mode only)
A nine-character Shining Force homage that lives on the Excursion Check.
Sprites, portraits, trees, turf, flowers and particles are all generated
from pixel maps in the file, so no image assets ship.

| | Role | | | Role |
|---|---|---|---|---|
| **MAX** | Courier | | **LUKE** | Freezer Keeper |
| **KHRIS** | Pharmacist, heals | | **ZYLO** | Night Shift |
| **GORT** | Pack Knight, opens the battle | | **ADAM** | Pack-out Engine |
| **ANRI** | Forecaster, runs Ice Run | | **AMON** | Sky Scout (flies) |
| **HANS** | Route Scout | | | |

- **They wander on their own.** Nothing reads the cursor. Each character picks
  a spot in the lower half of the page, ambles there, waits a few seconds,
  picks another. A quarter of the time they go visit someone instead, face
  each other and trade a line. AMON circles overhead. Footsteps kick up dust.
- **They comment on choices**, not just the verdict, through the dialogue box:
  Tremfya gets "only 4 hours out of the fridge", Forteo gets the no-allowance
  warning from the pharmacist, Aimovig is flagged as banded, each pack state
  has a line. Lines queue and clicking the box advances.
- **Verdicts are events.** OK: the whole party hops with sparkles and MAX says
  so overhead. REPLACE: a **Heat Wave** spawns beside the verdict card, the
  front four charge it, three hits and it goes down, GORT calls the victory.
- **Ambient chatter**: someone says something over their head every 7–16 s.
- **Party roster** (top right, desktop only) lists everyone; click a name to
  hail them. **Ice Run**: ask ANRI for a 20-second round of catching parcels.
- **THE HEAT FRONT** (`battle.js`): a turn-based tactics battle. Click GORT
  and choose TO BATTLE, or press ⚔ BATTLE on the roster. MAX, KHRIS, GORT
  and ANRI take a 12×8 field of grass, forest (costs 2 to enter, +1 DEF),
  rock and road against three Heat Waves, a Frost Sprite (range 2) and the
  Porch Sun boss. Each turn: pick a unit's move from the highlighted tiles
  (or stay), then attack anything in range, use a special (KHRIS heals 8,
  GORT insulates neighbours for +3 DEF), or stay. Damage is ATK − DEF plus a
  little luck, with a 12% critical. Then the Heat Front advances on the
  nearest party member and hits the weakest one in reach. Clear the field for
  VICTORY and EXP, lose everyone for DEFEAT; GORT has a line for each. The
  wanderers freeze while the battle is open; Esc or ✕ leaves at any time.
- The stage never intercepts a click meant for the page (only sprites and the
  battle are clickable), the whole party and any open battle are torn down
  when retro mode is switched off, and none of it exists under
  `prefers-reduced-motion`.

### Data sources
| Source | Used for | Key required |
|--------|----------|--------------|
| OpenWeatherMap 5-day/3-hour forecast | Hub night-window conditions | Free API key (in `index.html`) |
| OpenWeatherMap geocoding | Delivery-ZIP → coordinates | same key |
| National Weather Service (api.weather.gov) | Active alerts + plain-language forecast + winter map + observation history (Excursion Check) | None |
| FAA NAS Status (nasstatus.faa.gov) | Ground stops / ground delay programs | None (proxied via Action) |
| NHC (nhc.noaa.gov) | Active tropical storms + 7-day formation chances | None (proxied via Action) |

The NWS API blocks no one but the FAA endpoint blocks browser CORS, so a
GitHub Action fetches it server-side (see below).

### Risk thresholds (hub forecasts)
The dashboard takes the **highest** risk across OpenWeatherMap, the NWS
plain-language forecast, and (for tonight only) active NWS alerts.

- **Do not ship (high):** tornado / hurricane / blizzard / ice / freezing /
  sleet, heavy rain or snow, sustained wind > 35 mph, visibility < 0.25 mi, or
  cold-precip below 15°F. NWS severe wording (severe thunderstorm, damaging
  winds, large hail, flash flood, ice storm, etc.) or a matching active warning
  also forces high.
- **Use caution (medium):** plain thunderstorms, rain/snow/fog, wind > 22 mph,
  visibility < 0.75 mi, or a watch-level NWS alert.
- **Monitor (borderline):** light precip, breezy, or just cold-but-clear.
- **Clear (low):** everything else.

> Thunderstorms are deliberately **medium**, not high — at MEM/SDF/IND in
> summer that's most nights, and treating every storm as a hard stop would
> block shipping all season. Formal NWS warnings are the source of truth for
> genuinely severe weather.

---

## How the automation works

GitHub Actions keeps data fresh and deploys the site; GitHub Pages serves the
static files from `main`.

**`faa-refresh.yml`** — every 10 minutes, fetches FAA airport events, slims the
payload down to the few fields the dashboard renders (only airports with an
active ground stop / ground delay / departure delay), and commits
`data/faa-events.json` + a `data/faa-events.timestamp` sidecar when it changes.

**`nhc-refresh.yml`** — every 6 hours, fetches the National Hurricane Center's
active-storm list and Tropical Weather Outlook, slims them to what the dashboard
shows (storm name/class/winds + per-basin 7-day formation chances), and commits
`data/nhc-outlook.json` when the tropical picture changes.

**`deploy-pages.yml`** — on every push to `main`, publishes the site to GitHub
Pages so changes go live automatically.

> **Email automation was removed.** A daily reminder and a proactive
> weather-alert workflow used to send email via the Gmail API; both were turned
> off. The dashboard's on-screen **Generate alert email** and **Generate team
> message** buttons still work — they produce copy-paste drafts, they don't send.

---

## Setup

### 1. GitHub Pages
Settings → Pages → **Deploy from a branch** → `main` / `/ (root)`. Pages
publishes the static files directly; no build step.

### 2. OpenWeatherMap key
Create a free key at openweathermap.org and set it in `index.html`:
```js
const WEATHER_API_KEY = 'your-key-here';
```
A new key can take up to an hour to activate. Until a key is set, the dashboard
runs in demo mode.

> Note: because the dashboard is fully client-side, this key is visible in the
> page source. Use a free-tier key dedicated to this dashboard so it can be
> rotated without affecting anything else.

---

## Common edits

- **Add/remove a hub or region:** edit the `LOCATIONS` array in `index.html`
  (set `hub: true` for a primary hub card). Add the airport code to
  `HUB_AIRPORTS`/`HUB_NAMES` to show its FAA delays too.
- **Tune risk thresholds:** see `assessRisk()` and the NWS phrase/event lists
  in `index.html`.

## Troubleshooting
The dashboard now names the failure instead of guessing. A yellow/red bar at the
top of Hub Forecasts appears whenever the load was not complete and fresh:

| What the bar says | What it means | What to do |
|---|---|---|
| key was rejected (401) | Key is new, mistyped, or deactivated | Check the key on openweathermap.org; a new key takes up to an hour |
| rate-limited (429) | Over the free tier's 60 calls/min | Wait a minute; the key is public in the page, so consider rotating it |
| outage (5xx) | OpenWeatherMap or NWS is down | Wait it out; the page retries 3x with backoff automatically |
| no network response | Offline, DNS, or a blocked network | Check connectivity |
| NWS alerts/forecast unavailable | Cards show OpenWeatherMap only | **Severe-weather warnings are not reflected** — check NWS directly before shipping |
| Showing the last good load from HH:MM | The refresh failed entirely | Data is stale; the reason is stated alongside |

Transient failures (408/429/5xx) are retried three times with exponential
backoff before anything is reported. A load that partly succeeds renders the
locations that worked and names the ones that didn't.

- **Dashboard shows demo data** — the OpenWeatherMap key isn't set (or isn't
  active yet).
- **FAA panel says data isn't available** — the `faa-refresh` Action hasn't run
  yet; trigger it manually from the Actions tab.
- **Pages not loading** — the repo must be public and Pages enabled.
