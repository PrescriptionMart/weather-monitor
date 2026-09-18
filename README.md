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
  2. Ask how the ice packs felt: **frozen solid** or **slushy** → the cold
     chain held → OK. **Thawed but cool** → OK if received inside the
     pack-out's 48-hour rating; otherwise only the delayed days are scored.
     **Thawed and warm** → the pack-out is spent; every day is scored. A
     product that itself looks frozen / has ice crystals / looks different →
     REPLACE regardless.
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
  collapsed. Constants: `PACKOUT_RATING_HOURS = 48`.
- **On the call** — a highlighted card right under the verdict with seven one-line tips (packs are
  the thermometer, ask when it went in the fridge, say what you checked then
  the answer, weaker dose vs missed dose, manufacturer med-info line, a
  safety-net line for anxious patients, log it).
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
- **Special product classes** the tool handles separately: products with **no
  room-temperature allowance** (Forteo, Genotropin, Omnitrope) go to the
  manufacturer, since no weather reading can clear them; **insulins whose
  allowance depends on the presentation** link the manufacturer's stability
  calculator; **room-temperature products** (Afinitor, Monovisc, Opzelura)
  skip the ice-pack question entirely.
- **Keeping the product** now carries the right aftercare: a **cumulative**
  allowance says the clock does not reset, a **do-not-return-to-fridge** label
  says so, and a one-time allowance is flagged as partly spent.

### Drug data
`data/drugs.json` is generated — do not hand-edit it:
```
python3 scripts/convert-drugs.py Temperature_Sensitive_Stabilities.xlsx -o data/drugs.json
```
The converter exists because the sheet's **Max Temp column is not consistently
the excursion ceiling**: for Nivestym, Norditropin and Skyrizi it is the fridge
ceiling (46°F), for Sogroya it is a hard discard limit (86°F), and for Dupixent
it is the allowance (77°F). The page needs the allowance ceiling, so it is
parsed from the excursion text and the column is kept separately as
`storageMaxF`. Every row where the two disagree is printed on each run, and
rows needing human judgment sit in an `OVERRIDES` table with a stated reason
that surfaces on the page.

**After-first-use allowances.** Several sheet rows carry an allowance that
applies to a pen already in use, not to unopened stock in transit — which is
always what this tool is looking at. Those rows set `inUseAllowance`, show a
warning on the allowance line, and can never produce a clean OK: the verdict
becomes "JUDGMENT CALL — allowance may not apply" pointing at the label.
Currently Norditropin FP and both Sogroya strengths. The values were flagged
rather than changed, because the unopened allowance could not be verified.

Row fields: `name`, `ndc` (reference only, not shown), `storageMinF`/`storageMaxF`,
`excursionMinF`/`excursionMaxF` (the allowance ceiling), `allowanceHours`,
`cumulative`, `returnToFridge`, `noExcursion`, `refrigerated`, `calculatorUrl`,
`tiers`, `inUseAllowance`, `excursionNote`, `storage`, `protectFromLight`, `freezeSensitive`,
optional `flag` and `derivation`.

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
