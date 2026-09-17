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
- Window, dwell and thresholds are named constants at the top of
  `winter-pack.html` (`DELIVERY_START_HOUR`, `DELIVERY_END_HOUR`,
  `DWELL_HOURS`, `WINTER_PACK_F`, `SEVERE_F`). To refresh the footprint, mark
  towns `ship: true` in `STATES_BY_FIPS` (the generic list needs no change).

**Excursion Check (`excursion.html`)**
- A phone script for the "my medication arrived warm / half-frozen" call, with
  one verdict: **OK TO USE / PHARMACIST CALL / REPLACE**, one sentence why, and
  one sentence to tell the patient.
  1. Pick the product (allowance shown in one line: *up to 77°F for 14 days ·
     not below 36°F · do not freeze* — from `data/drugs.json`, converted from
     the pharmacy's Temperature Sensitive Stabilities spreadsheet).
  2. Ask how the ice packs felt: **frozen solid** or **slushy** → the cold
     chain held → OK. **Thawed but cool** → OK if received inside the
     pack-out's 48-hour rating; otherwise only the delayed days are scored.
     **Thawed and warm** → the pack-out is spent; every day is scored. A
     product that itself looks frozen / has ice crystals / looks different →
     REPLACE regardless.
  3. ZIP (or a sort-hub ZIP via chips) + shipped/received dates → observed
     outdoor temperature from the nearest NWS station, scored worst-case
     (outdoor air the whole time) against the product's ceiling, floor (the
     sheet's Min Temp, 36°F for refrigerated) and allowance length. Never
     exceeded and inside the allowance days → OK; exceeded, below the floor,
     or too many days → PHARMACIST CALL with the numbers.
- Details (station, distance, daily highs/lows, copy-for-the-record) fold
  under a toggle. Constants: `PACKOUT_RATING_HOURS = 48`.
- `data/drugs.json` rows: `name`, `ndc` (reference only, not shown),
  `excursionMinF`/`excursionMaxF`, `excursionNote`, `storage`,
  `protectFromLight`, `freezeSensitive`, optional `flag`. Update by editing
  the spreadsheet and re-converting.

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
- **Dashboard shows demo data** — the OpenWeatherMap key isn't set (or isn't
  active yet).
- **FAA panel says data isn't available** — the `faa-refresh` Action hasn't run
  yet; trigger it manually from the Actions tab.
- **Pages not loading** — the repo must be public and Pages enabled.
