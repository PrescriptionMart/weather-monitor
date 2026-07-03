# Prescription Mart — Overnight Shipping Weather Monitor

A zero-backend dashboard that helps the shipping team decide whether to send
next-day-air specialty pharma overnight. It evaluates the **10pm–4am sort
window** at the carrier hubs we depend on and surfaces anything that would
delay the overnight package sort.

Live dashboard: `https://prescriptionmart.github.io/weather-monitor`

---

## What it shows

The site is two pages (tabs at the top):

**Hub Forecasts (`index.html`)**
- Next 3 sort windows at our hubs: **FedEx Memphis (MEM)**, **UPS Louisville
  (SDF)**, and **UPS Indianapolis (IND)** — each evaluated in its own local time.
- A combined recommendation ("hold next-day air", "ship with caution", etc.)
  plus one-click **email** and **team-message** drafts.
- **Live FAA delays** (ground stops / ground delay programs) at the three hubs.
- **Delivery destination check** — enter a ZIP to see weather where the package lands over the next two days (a clear hub doesn't help if the destination is socked in).
- Regional watch zones (ORD, DFW, ATL, DEN, LAX, JFK) for situational awareness.
- Links out to FedEx/UPS service alerts and the FAA National Status board.

Both pages are a **PWA** — open the site on a phone and "Add to Home Screen" for an app-like, installable shortcut that still shows the last-loaded data when offline.

**Winter Packing Map (`winter-pack.html`)**
- A US map flagging states whose forecast low-of-the-day drops below the
  cold-pack threshold over the next 7 days, aggregated to each state's coldest
  city so panhandles/cold corners aren't missed.

### Data sources
| Source | Used for | Key required |
|--------|----------|--------------|
| OpenWeatherMap 5-day/3-hour forecast | Hub night-window conditions | Free API key (in `index.html`) |
| OpenWeatherMap geocoding | Delivery-ZIP → coordinates | same key |
| National Weather Service (api.weather.gov) | Active alerts + plain-language forecast + winter map | None |
| FAA NAS Status (nasstatus.faa.gov) | Ground stops / ground delay programs | None (proxied via Action) |

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
