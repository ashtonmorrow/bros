/* Pounce service worker.
 *
 * Strategy:
 * - On install: precache the app shell (HTML + JS + CSS + icons + manifest).
 * - On fetch:
 *     - Navigation / HTML  → network-first, fall back to cache so code
 *                             changes propagate on the next online load
 *                             without the user getting stuck on stale html.
 *     - Static assets      → cache-first, with background revalidation so
 *                             returning visitors load instantly.
 *     - Cross-origin       → pass through to the network untouched
 *                             (Google Fonts, Supabase REST, etc).
 * - On activate: delete old caches with different names.
 *
 * When shipping a breaking change, bump CACHE_NAME (v1 → v2) so old caches
 * clear on next visit.
 */

const CACHE_NAME = 'pounce-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/readme.html',
  '/style.css',
  '/manifest.json',
  '/preview.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/favicon-64.png',
  '/favicon-96.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/js/sprites.js',
  '/js/audio.js',
  '/js/level.js',
  '/js/game.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll fails the whole install if any one URL 404s — wrap each in
      // a tolerant put() so an asset rename doesn't brick the cache.
      .then((cache) => Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => { if (res.ok) cache.put(url, res); })
            .catch(() => {})
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin requests pass straight through.
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first for HTML so code updates ship.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for static assets, with stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
