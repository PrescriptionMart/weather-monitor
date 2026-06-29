// Service worker for the Overnight Shipping Weather dashboard.
//
// Strategy: NETWORK-FIRST for everything same-origin. This is a
// decision-critical dashboard, so a connected user must always get the latest
// page and the latest FAA data file; the cache is only a fallback for when the
// device is offline. Cross-origin requests (OpenWeatherMap, NWS, the map CDN)
// are left untouched and go straight to the network.
const CACHE = 'pm-weather-v1';
const SHELL = ['./', './index.html', './winter-pack.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let API/CDN calls pass through

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      return caches.match('./index.html');
    }
  })());
});
