/**
 * service-worker.js — Kallendar
 * Caches all static assets for offline use.
 *
 * Strategy:
 *   HTML             → network-first (always get fresh shell)
 *   JS / CSS         → network-first (code changes must be seen immediately)
 *   Other assets     → cache-first   (icons, manifest — rarely change)
 *
 * Bump CACHE_VERSION whenever you want all clients to refetch everything.
 */

const CACHE_VERSION = 'v6';
const CACHE = `kallendar-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ical-parser.js',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// ── Install: pre-cache everything ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting(); // activate immediately, don't wait for old SW to die
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of all open tabs immediately
});

// ── Fetch: network-first for HTML/JS/CSS, cache-first for the rest ────────────
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;

  const url = new URL(e.request.url);

  // API calls must NEVER be cached — always go straight to the network.
  // Without this, the cache-first branch below would store the first
  // /api/proxy response and serve stale iCal data on every subsequent sync.
  if (url.pathname.startsWith('/api/')) return;

  const isCodeAsset = /\.(html|js|css)$/.test(url.pathname) || url.pathname === '/' || url.pathname === '';

  if (isCodeAsset) {
    // Network-first: always try the network, fall back to cache
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first: icons, manifest, etc.
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
  }
});
