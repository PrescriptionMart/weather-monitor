# Prescription Mart — Overnight Shipping Weather Monitor

Monitors overnight weather (10pm–4am) at FedEx Memphis and UPS Louisville hubs, plus major regional zones. Sends an email alert the morning before severe weather is forecast.

---

## Setup (about 15 minutes)

### Step 1 — Create the GitHub repo

1. Log in to github.com
2. Click the **+** icon (top right) → **New repository**
3. Name it `weather-monitor`
4. Set it to **Public** (required for free GitHub Pages)
5. Click **Create repository**

### Step 2 — Upload these files

Upload the two files in this folder to your new repo:
- `index.html` → root of the repo
- `.github/workflows/daily-alert.yml` → create those folders and upload

The easiest way: use the GitHub web interface, click **Add file → Upload files**.

### Step 3 — Turn on GitHub Pages

1. In your repo, go to **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose branch: `main`, folder: `/ (root)`
4. Click Save
5. Wait ~2 minutes, then your dashboard will be live at:
   `https://prescriptionmart.github.io/weather-monitor`

### Step 4 — Get a free OpenWeatherMap API key

1. Go to openweathermap.org and create a free account
2. Go to **API keys** in your profile
3. Copy your key

### Step 5 — Add the API key to the dashboard

In `index.html`, find this line near the top of the `<script>` block:
```
const WEATHER_API_KEY = 'YOUR_OPENWEATHERMAP_KEY_HERE';
```
Replace `YOUR_OPENWEATHERMAP_KEY_HERE` with your actual key.

### Step 6 — Set up Gmail for the daily email alert

The GitHub Action sends email directly via the Gmail API. You need three values from Google:

**Get a Client ID and Client Secret:**
1. Go to console.cloud.google.com
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Library**, search for **Gmail API**, enable it
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI
8. Save — copy your **Client ID** and **Client Secret**

**Get a Refresh Token:**
1. Go to developers.google.com/oauthplayground
2. Click the gear icon (top right) → check **Use your own OAuth credentials**
3. Enter your Client ID and Client Secret
4. In the left panel, find **Gmail API v1**, select `https://mail.google.com/`
5. Click **Authorize APIs** → sign in with the Gmail account you want to send from
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token**

**Add the secrets to GitHub:**
1. In your GitHub repo, go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret** and add each of these:
   - `OPENWEATHER_KEY` — your OpenWeatherMap API key
   - `GMAIL_CLIENT_ID` — from Google Cloud Console
   - `GMAIL_CLIENT_SECRET` — from Google Cloud Console
   - `GMAIL_REFRESH_TOKEN` — from OAuth Playground

### Step 7 — Update the dashboard URL in the workflow

In `.github/workflows/daily-alert.yml`, find this line near the bottom:
```
Dashboard: https://prescriptionmart.github.io/weather-monitor
```

---

## How it works

**Dashboard (`index.html`):**
- Loads live weather from OpenWeatherMap for each hub and regional zone
- Evaluates the 10pm–4am forecast window specifically
- Shows risk level: Clear to ship / Use caution / Do not ship
- "Email alert" button sends a manual alert via Gmail
- Bookmark the Pages URL and check it anytime

**Daily alert (GitHub Actions):**
- Runs automatically every morning at 8am Central
- Checks the next overnight forecast window
- Sends an email to bclay@scriptcare.com **only if** there's a weather concern
- To get a daily email regardless (even when clear), comment out line 78 in the workflow
- You can also trigger it manually from the **Actions** tab in GitHub

**Risk thresholds:**
- High / Do not ship: severe weather keywords (thunderstorm, blizzard, ice storm, etc.), wind > 25 mph, or visibility < 0.5 mi
- Medium / Use caution: moderate weather (rain, snow, fog, etc.), wind > 15 mph, or visibility < 2 mi
- Low / Clear: everything else

---

## Adding recipients

To add Cricket or others to the daily email, edit the `ALERT_EMAIL` line in `daily-alert.yml`:
```
ALERT_EMAIL: bclay@scriptcare.com,cricket@prescriptionmart.com
```

---

## Troubleshooting

- **Dashboard shows demo data** — API key not set in `index.html`
- **Email not sending** — check the Actions tab in GitHub for error logs; most common issue is secrets not set correctly
- **GitHub Pages not loading** — make sure repo is Public and Pages is enabled in Settings
