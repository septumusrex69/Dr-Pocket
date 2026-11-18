/*
 * Dr Pocket's service worker: what makes "Add to Home Screen" a real app (as in Remus), plus the
 * 21:00 reminder. It caches no app code, so an installed Dr Pocket is never stuck on an old version.
 * The one thing kept is a small "No connection" page, shown instead of the browser's error.
 */
const OFFLINE = 'drpocket-offline-v5';

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

// The evening reminder (api/evening.js). Counts only; tapping it opens the end-of-day check-in.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'Dr Pocket', {
    body: msg.body || 'Take a minute for your end-of-day check-in.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'evening',
    data: { url: msg.url || '/health/#/checkin' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/health/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin + '/health/')) { await c.focus(); c.navigate(url); return; }
    }
    await clients.openWindow(url);
  })());
});
