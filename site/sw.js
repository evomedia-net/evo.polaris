// Offline-first: a dark field has no signal, so everything must already be here.
//
// Two strategies on purpose, because "cache-first for everything" is how a
// static site pins every returning visitor to the first version they ever
// loaded. A deploy would then reach nobody until they cleared site data.
//
//   * App shell (HTML/JS/CSS) -> NETWORK first, cache as fallback. Online, you
//     always get the current build; offline, you get the last one that worked.
//   * Bundled data (stars, magnetic coefficients) -> CACHE first. It is 350 KB,
//     it changes roughly never, and re-fetching it on every load is rude to a
//     phone on a hotspot.
// Bumped to evict the precached index.html, which carried a claim that the
// app was open source while the repository was private. index.html is in
// ASSETS below, so the corrected page reaches a RETURNING visitor only when
// this cache key changes - without a bump the fix ships and is inert, the
// same way the og-card needed ?v=2 because scrapers key on the image URL.
//
// This is a CACHE KEY, not the release stamp. build-version.json stays where
// it is; the build advances once per release on the default branch.
const VERSION = '0.0.0.1.5';
const CACHE = `evo-polaris-${VERSION}`;

const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './src/style.css', './src/app.js', './src/astro.js',
  './src/geomag.js', './src/chart.js', './src/guide.js', './src/words.js',
  './src/skyview.js', './src/skydraw.js', './src/evomedia-chrome.js',
  './src/coords.js', './src/briefing.js', './src/iss.js', './src/moon.js',
  './src/planets.js', './src/tracks.js', './src/version.js',
  './build-version.json', './src/dwell.js',
  './src/data/constellations.js', './src/data/stars.json', './src/data/wmm2025.js', './src/data/icon.svg',
  './src/milkyway.js', './src/data/milkyway.webp',
];

/** Big, immutable, and expensive to re-fetch. */
const isData = (url) => /\/src\/data\//.test(url.pathname);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isData(url)) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })),
    );
    return;
  }

  // App shell: prefer the network, fall back to whatever we last cached, and
  // fall back again to the app itself so a deep link still opens offline.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request)
        .then((hit) => hit || caches.match('./index.html'))),
  );
});
