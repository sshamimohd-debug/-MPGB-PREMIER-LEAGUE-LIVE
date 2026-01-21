/* MPGB Premier League - simple PWA service worker */
// Bump cache version whenever you deploy UI/JS fixes so users instantly get latest files.
const CACHE_NAME = 'mpgb-pl-v4';
// Keep precache minimal but correct: a missing file here breaks install.
const PRECACHE = [
  './',
  './index.html',
  './schedule.html',
  './summary.html',
  './scorecard.html',
  './live.html',
  './points.html',
  './stats.html',
  './teams.html',
  './venues.html',
  './rules.html',
  './admin.html',
  './scorer.html',
  './manifest.json',
  './css/theme-dark.css',
  './js/util.js',
  './js/renderers.js',
  './js/scoring-core.js',
  './js/store-fb.js',
  './js/firebase-config.js',
  './js/firebase.js',
  './js/page-home.js',
  './js/page-schedule.js',
  './js/page-summary.js',
  './js/page-scorecard.js',
  './js/page-live.js',
  './js/page-points.js',
  './js/page-stats.js',
  './js/page-teams.js',
  './js/page-venues.js',
  './js/page-admin.js',
  './js/page-scorer.js',
  './data/tournament.json',
  './data/squads.json',
  './assets/icons/favicon-32.png',
  './favicon.ico',
  './assets/icons/icon-192.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful basic responses
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached); // if network fails and nothing cached, browser will handle
    })
  );
});
