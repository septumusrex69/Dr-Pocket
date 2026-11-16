/*
 * Dr Pocket's service worker: what makes "Add to Home Screen" a real app, and nothing more (as in Remus).
 * It caches no app code, so an installed Dr Pocket is never stuck on an old version. The one thing
 * kept is a small "No connection" page, shown instead of the browser's error when there is no signal.
 */
const OFFLINE = 'drpocket-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
});
