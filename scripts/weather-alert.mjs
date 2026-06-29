// Proactive overnight-shipping weather alert.
//
// Runs server-side (GitHub Actions) on a weekday-evening schedule, evaluates the
// SAME risk logic the dashboard uses for the 10pm–4am sort window at each hub,
// and emails the team via the Gmail API ONLY when a hub is high or medium for
// tonight. This is the closed-loop counterpart to the dashboard: nobody has to
// remember to look.
//
// The risk logic here is a faithful port of index.html — keep them in sync.
//
// Env:
//   OPENWEATHER_KEY            OpenWeatherMap API key (falls back to the public
//                              dashboard key, which is already in index.html)
//   GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN   Gmail API OAuth (same as daily-reminder)
//   ALERT_EMAIL                comma-separated recipients
//   DASHBOARD_URL              link included in the email
//   DRY_RUN=1                  print the decision/email instead of sending

const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY || '9a54213295e4acad6a2af136430650e5';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'BClay@scriptcare.com';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://prescriptionmart.github.io/weather-monitor';
const DRY_RUN = !!process.env.DRY_RUN;
const UA = 'Prescription-Mart-Dashboard (ops@prescriptionmart.com)';

const LOCATIONS = [
  { id: 'mem', name: 'Memphis (MEM)', lat: 35.0421, lon: -89.9765, tz: 'America/Chicago' },
  { id: 'sdf', name: 'Louisville (SDF)', lat: 38.1741, lon: -85.7369, tz: 'America/Kentucky/Louisville' },
  { id: 'ind', name: 'Indianapolis (IND)', lat: 39.7173, lon: -86.2944, tz: 'America/Indiana/Indianapolis' },
];

// ---- risk logic (ported from index.html) -----------------------------------
const MEDIUM_WX = ['rain', 'snow', 'drizzle', 'shower', 'fog', 'mist'];
const BORDERLINE_WX = ['light rain', 'light snow', 'overcast', 'wind', 'clouds', 'broken clouds', 'scattered clouds'];

function assessRisk(desc, wind, vis, temp) {
  const d = (desc || '').toLowerCase();
  const isLight = d.includes('light') || d.includes('drizzle');
  const hasTornado = d.includes('tornado');
  const hasHurricane = d.includes('hurricane');
  const hasBlizzard = d.includes('blizzard');
  const hasIcing = (d.includes(' ice') || d.startsWith('ice') || d.includes('freezing') || d.includes('sleet'));
  const hasHeavy = d.includes('heavy');
  if (hasTornado || hasHurricane || hasBlizzard || hasIcing) return 'high';
  if (hasHeavy && (d.includes('rain') || d.includes('snow'))) return 'high';
  if (wind > 35) return 'high';
  if (vis && vis < 400) return 'high';
  if (temp !== null && temp < 15 && (d.includes('rain') || d.includes('snow') || d.includes('shower') || d.includes('drizzle'))) return 'high';
  const hasThunder = d.includes('thunder') || d.includes('lightning');
  if (hasThunder) return 'medium';
  let mediumFactors = 0;
  if (!isLight && MEDIUM_WX.some(k => d.includes(k))) mediumFactors++;
  if (wind > 22) mediumFactors++;
  if (vis && vis < 1200) mediumFactors++;
  if (temp !== null && temp < 25 && d.includes('cloud')) mediumFactors++;
  if (mediumFactors >= 3) return 'high';
  if (mediumFactors >= 1) return 'medium';
  if (BORDERLINE_WX.some(k => d.includes(k)) || isLight) return 'borderline';
  if (wind > 18) return 'borderline';
  if (temp !== null && temp < 22) return 'borderline';
  return 'low';
}
function riskRank(r) { return r === 'high' ? 3 : r === 'medium' ? 2 : r === 'borderline' ? 1 : 0; }

const _hourFmt = {}, _dateFmt = {};
function getLocalHour(date, tz) {
  const f = _hourFmt[tz] || (_hourFmt[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
  return parseInt(f.formatToParts(date).find(p => p.type === 'hour').value, 10);
}
function getLocalDateKey(date, tz) {
  const f = _dateFmt[tz] || (_dateFmt[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return f.format(date);
}
function getNext3SortNights(tz) {
  const now = new Date();
  const nights = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    nights.push(getLocalDateKey(d, tz));
  }
  return nights;
}

const NWS_SEVERE_PHRASES = ['severe thunderstorm', 'damaging wind', 'damaging winds', 'tornado', 'tornadoes', 'large hail', 'flash flood', 'blizzard', 'ice storm', 'freezing rain', 'heavy snow', 'extreme', 'destructive', 'hurricane', 'tropical storm', 'high wind warning', 'periods of heavy rain'];
const NWS_MODERATE_PHRASES = ['thunderstorm', 'thunderstorms', 'gusty winds', 'wind gusts', 'snow likely', 'rain likely', 'showers likely', 'heavy rain'];
function assessNWSForecastRisk(periodText) {
  if (!periodText) return null;
  const t = periodText.toLowerCase();
  if (NWS_SEVERE_PHRASES.some(p => t.includes(p))) return 'high';
  const isLightWording = t.includes('chance of') || t.includes('slight chance') || t.includes('light rain') || t.includes('light snow') || t.includes('few showers') || t.includes('isolated showers');
  if (isLightWording && !t.includes('thunderstorm')) return null;
  if (NWS_MODERATE_PHRASES.some(p => t.includes(p))) return 'medium';
  return null;
}
const HIGH_RISK_NWS_EVENTS = ['Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Winter Storm Warning', 'Blizzard Warning', 'Ice Storm Warning', 'Hurricane Warning', 'Tropical Storm Warning', 'High Wind Warning', 'Extreme Wind Warning', 'Freezing Rain Advisory'];
const MEDIUM_RISK_NWS_EVENTS = ['Severe Thunderstorm Watch', 'Flash Flood Watch', 'Flood Warning', 'Winter Weather Advisory', 'Frost Advisory', 'Freeze Warning', 'Dense Fog Advisory', 'Wind Advisory', 'Special Weather Statement'];
function nwsAlertRiskOverride(alerts) {
  if (!alerts || alerts.length === 0) return null;
  for (const a of alerts) if (HIGH_RISK_NWS_EVENTS.some(e => a.event && a.event.includes(e))) return 'high';
  for (const a of alerts) if (MEDIUM_RISK_NWS_EVENTS.some(e => a.event && a.event.includes(e))) return 'medium';
  return null;
}

async function fetchNWSAlerts(lat, lon) {
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, { headers: { Accept: 'application/geo+json', 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.features || []).map(f => ({ event: f.properties.event }));
  } catch (e) { return []; }
}
async function fetchNWSForecast(lat, lon) {
  try {
    const pr = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers: { Accept: 'application/geo+json', 'User-Agent': UA } });
    if (!pr.ok) return null;
    const pd = await pr.json();
    const url = pd.properties.forecast;
    if (!url) return null;
    const fr = await fetch(url, { headers: { Accept: 'application/geo+json', 'User-Agent': UA } });
    if (!fr.ok) return null;
    const fd = await fr.json();
    return fd.properties.periods || [];
  } catch (e) { return null; }
}

async function fetchHub(loc) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${loc.lat}&lon=${loc.lon}&appid=${OPENWEATHER_KEY}&units=imperial`;
  const [resp, nwsAlerts, nwsForecast] = await Promise.all([fetch(url), fetchNWSAlerts(loc.lat, loc.lon), fetchNWSForecast(loc.lat, loc.lon)]);
  if (!resp.ok) throw new Error(`OWM ${resp.status} for ${loc.id}`);
  const data = await resp.json();
  const sortNights = getNext3SortNights(loc.tz);
  const nwsAlertOverride = nwsAlertRiskOverride(nwsAlerts);

  const nwsPeriodByNight = {};
  if (nwsForecast) {
    nwsForecast.forEach(period => {
      const name = (period.name || '').toLowerCase();
      if (name.includes('night') || name === 'overnight' || name === 'tonight') {
        const key = getLocalDateKey(new Date(period.startTime), loc.tz);
        nwsPeriodByNight[key] = { shortForecast: period.shortForecast, risk: assessNWSForecastRisk(period.detailedForecast || period.shortForecast) };
      }
    });
  }

  const nights = sortNights.map((dateKey, idx) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d));
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextKey = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
    const slots = data.list.filter(item => {
      const utc = new Date(item.dt * 1000);
      const h = getLocalHour(utc, loc.tz);
      const ld = getLocalDateKey(utc, loc.tz);
      return (ld === dateKey && h >= 22) || (ld === nextKey && h <= 4);
    });
    let owRisk = 'low', worstDesc = '';
    slots.forEach(s => {
      const risk = assessRisk(s.weather[0].description, s.wind ? s.wind.speed : 0, s.visibility || 10000, s.main ? s.main.temp : null);
      if (riskRank(risk) > riskRank(owRisk)) { owRisk = risk; worstDesc = s.weather[0].description; }
    });
    const nwsPeriod = nwsPeriodByNight[dateKey];
    let finalRisk = owRisk;
    if (nwsPeriod && nwsPeriod.risk && riskRank(nwsPeriod.risk) > riskRank(finalRisk)) finalRisk = nwsPeriod.risk;
    if (idx === 0 && nwsAlertOverride && riskRank(nwsAlertOverride) > riskRank(finalRisk)) finalRisk = nwsAlertOverride;
    const desc = worstDesc || (nwsPeriod && nwsPeriod.shortForecast) || (slots[0] && slots[0].weather[0].description) || 'no forecast';
    return { dateKey, idx, risk: finalRisk, desc };
  });

  return { id: loc.id, name: loc.name, nights };
}

function findFirstShippableNight(hub) {
  for (let i = 0; i < hub.nights.length; i++) if (hub.nights[i].risk === 'low' || hub.nights[i].risk === 'borderline') return i;
  return -1;
}

function buildAlert(hubs) {
  const hubsHolding = hubs.filter(h => h.nights[0].risk === 'high');
  const hubsCaution = hubs.filter(h => h.nights[0].risk === 'medium');
  if (hubsHolding.length === 0 && hubsCaution.length === 0) return null; // clear — no alert

  const lines = [];
  hubs.forEach(hub => {
    const tonight = hub.nights[0];
    if (tonight.risk === 'high') {
      const fs = findFirstShippableNight(hub);
      let impact;
      if (fs === -1) impact = 'no clear sort window in the 3-night forecast — multi-day delay likely.';
      else if (fs === 1) impact = 'ship tomorrow night; expect a 1-day patient delay.';
      else if (fs === 2) impact = 'hold tonight and tomorrow; expect a 2-day patient delay.';
      else impact = 'monitor closely.';
      lines.push(`• ${hub.name}: HOLD next-day air (${tonight.desc}) — ${impact}`);
    } else if (tonight.risk === 'medium') {
      lines.push(`• ${hub.name}: CAUTION (${tonight.desc}) — delays possible; ship time-sensitive only and notify patients.`);
    } else {
      lines.push(`• ${hub.name}: clear to ship.`);
    }
  });

  let subject, lead;
  if (hubsHolding.length > 0) {
    subject = `Action: hold next-day air tonight — ${hubsHolding.map(h => h.name).join(', ')}`;
    lead = `Forecasted severe overnight weather at ${hubsHolding.map(h => h.name).join(' and ')}. Recommend holding tonight's next-day air to avoid hub delays.`;
  } else {
    subject = `Heads up: weather caution tonight — ${hubsCaution.map(h => h.name).join(', ')}`;
    lead = `Possible overnight weather delays at ${hubsCaution.map(h => h.name).join(' and ')}. Shipments can go, but some may run behind.`;
  }
  const body = `${lead}\n\n${lines.join('\n')}\n\nFull dashboard: ${DASHBOARD_URL}\n\n— Prescription Mart Shipping Weather Monitor (automated)`;
  return { subject, body };
}

// ---- Gmail send -------------------------------------------------------------
async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: process.env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('No access token: ' + JSON.stringify(d));
  return d.access_token;
}
async function sendEmail(token, subject, body) {
  const raw = Buffer.from(`To: ${ALERT_EMAIL}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}`).toString('base64url');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (r.status !== 200) throw new Error('Gmail send failed: ' + r.status + ' ' + (await r.text()));
}

async function main() {
  const hubs = [];
  for (const loc of LOCATIONS) {
    try { hubs.push(await fetchHub(loc)); }
    catch (e) { console.error('Hub fetch failed:', loc.id, e.message); }
  }
  if (hubs.length === 0) { console.error('No hub data — aborting without alert.'); process.exit(1); }

  const alert = buildAlert(hubs);
  if (!alert) { console.log('All hubs clear or borderline tonight — no alert sent.'); return; }

  console.log('ALERT:', alert.subject);
  console.log(alert.body);
  if (DRY_RUN) { console.log('\n[DRY_RUN] Email not sent.'); return; }

  const token = await getAccessToken();
  await sendEmail(token, alert.subject, alert.body);
  console.log('Alert email sent to', ALERT_EMAIL);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
