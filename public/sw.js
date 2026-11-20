/*
 * Dr Pocket's service worker: the installed app, working with or without signal, plus the 21:00 reminder.
 *
 * Offline (20 Nov 2026): the app's own files are kept on the phone, so it opens without signal. With signal
 * it always fetches fresh copies first (network first), so it is never stuck on an old version. Journal data
 * read from the database is kept too (last copy seen), so screens still show your entries offline. Changes
 * made offline are not handled here: the app keeps them in an outbox and uploads them (src/health/db.js).
 */
const SHELL = 'drpocket-shell-v6';
const DATA = 'drpocket-data-v1';
const KEEP = [SHELL, DATA];
const STATIC = ['/health/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-180.png',
  '/brand/dr-pocket-symbol.svg', '/brand/dr-pocket-horizontal.svg', '/brand/dr-pocket-horizontal-white-text.svg'];

async function precache() {
  const c = await caches.open(SHELL);
  await c.addAll(STATIC.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {});
  // The page's own scripts and styles (their names change with every release).
  try {
    const html = await (await fetch('/health/', { cache: 'reload' })).text();
    const assets = [...new Set(html.match(/\/assets\/[\w.-]+\.(?:js|css)/g) || [])];
    await c.addAll(assets);
    const fonts = html.match(/https:\/\/fonts\.googleapis\.com\/css2[^"']+/);
    if (fonts) await c.add(new Request(fonts[0].replace(/&amp;/g, '&'), { mode: 'no-cors' })).catch(() => {});
  } catch { /* offline during install: cached as they load instead */ }
}

self.addEventListener('install', (event) => { event.waitUntil(precache()); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (event) => { if (event.data?.type === 'clear-data') caches.delete(DATA); });

// Network first, but give up waiting after `ms` when the signal is weak, and use the copy on the phone.
async function networkFirst(req, cacheName, ms, key = req) {
  const c = await caches.open(cacheName);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(key, res.clone()).catch(() => {}); return res; });
  const timer = new Promise((resolve) => setTimeout(resolve, ms, 'slow'));
  try {
    const first = await Promise.race([net, timer]);
    if (first !== 'slow') return first;
    const cached = await c.match(key);
    return cached || await net;
  } catch {
    const cached = await c.match(key);
    if (cached) return cached;
    throw new Error('offline');
  }
}
async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Journal data from the database (read only): last copy seen, for offline viewing.
  if (url.hostname.endsWith('.supabase.co')) {
    if (url.pathname.startsWith('/rest/v1/')) event.respondWith(networkFirst(req, DATA, 8000));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(req, SHELL)); return; }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    const key = url.pathname.startsWith('/health') ? '/health/' : url.pathname;
    event.respondWith(networkFirst(req, SHELL, 5000, key).catch(async () => (await caches.match(key)) || caches.match('/offline.html')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, SHELL)); return; } // names change per release
  if (/^\/(brand|icons)\/|^\/manifest\.webmanifest$/.test(url.pathname)) event.respondWith(networkFirst(req, SHELL, 4000));
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
