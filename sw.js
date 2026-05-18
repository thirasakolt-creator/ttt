const CACHE_NAME = 'vol-ctrl-v2';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API calls → always network (never cache)
  const API_PATHS = ['/up', '/down', '/set', '/status', '/toggle_mute', '/apps', '/app_set', '/app_mute'];
  if (API_PATHS.some(p => e.request.url.includes(p))) {
    return; // let browser handle directly
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
