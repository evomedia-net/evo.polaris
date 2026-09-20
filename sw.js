// Offline-first: a dark field has no signal, so everything must already be here.
const CACHE = 'evo-polaris-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './src/style.css', './src/app.js', './src/astro.js',
  './src/geomag.js', './src/chart.js',
  './src/data/stars.json', './src/data/wmm2025.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first: correctness here does not depend on being fresh, and a stalled
// network request in the field is worse than a slightly old asset.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
