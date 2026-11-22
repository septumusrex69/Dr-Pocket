/*
 * Dr Pocket's service worker: the installed app, working with or without signal, plus the 21:00 reminder.
 *
 * Offline (20 Nov 2026): the app's own files are kept on the phone, so it opens without signal. With signal
 * it always fetches fresh copies first (network first), so it is never stuck on an old version. Journal data
 * read from the database is kept too (last copy seen), so screens still show your entries offline. Changes
 * made offline are not handled here: the app keeps them in an outbox and uploads them (src/health/db.js).
 */
const SHELL = 'drpocket-shell-v7';
const DATA = 'drpocket-data-v1';
const KEEP = [SHELL, DATA];
const STATIC = ['/health/', '/offline.html', '/fonts/montserrat-latin.woff2', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-180.png',
  '/brand/dr-pocket-symbol.svg', '/brand/dr-pocket-horizontal.svg', '/brand/dr-pocket-horizontal-white-text.svg'];

async function precache() {
  const c = await caches.open(SHELL);
  for (const u of STATIC) {
    try { const res = await fetch(new Request(u, { cache: 'reload' })); if (await genuine(res, u === '/health/' ? 'page' : 'other')) await c.put(u, res); } catch { /* keep going */ }
  }
  // The page's own scripts and styles (their names change with every release).
  try {
    const html = await (await fetch('/health/', { cache: 'reload' })).text();
    if (!html.includes('id="app"')) return;
    const assets = [...new Set(html.match(/\/assets\/[\w.-]+\.(?:js|css)/g) || [])];
    await c.addAll(assets);
    const fonts = html.match(/https:\/\/fonts\.googleapis\.com\/css2[^"']+/);
    if (fonts) await c.add(new Request(fonts[0].replace(/&amp;/g, '&'), { mode: 'no-cors' })).catch(() => {});
  } catch { /* offline during install: cached as they load instead */ }
}

self.addEventListener('install', (event) => { event.waitUntil(precache()); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  // Drop older copies only once this version has the app saved, so a weak signal during an update can't
  // leave the phone with no offline copy at all.
  event.waitUntil((async () => {
    const ready = await (await caches.open(SHELL)).match('/health/');
    if (ready) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))); }
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => { if (event.data?.type === 'clear-data') caches.delete(DATA); });

// Only keep genuine copies: a camp Wi-Fi login page or an error page must never replace the app on the phone.
async function genuine(res, kind) {
  if (!res || res.type === 'opaque') return kind === 'font';
  if (!res.ok || res.redirected) return false;
  const type = res.headers.get('content-type') || '';
  if (kind === 'page') return type.includes('text/html') && (await res.clone().text()).includes('id="app"');
  if (kind === 'asset') return /javascript|css/.test(type);
  if (kind === 'data') return type.includes('json');
  return true;
}

// A copy served from the phone says so (x-dp-offline), so the app knows to work offline straight away.
function fromPhone(res) {
  if (!res) return res;
  const headers = new Headers(res.headers); headers.set('x-dp-offline', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Network first, but give up waiting after `ms` when the signal is weak, and use the copy on the phone.
async function networkFirst(req, cacheName, ms, key = req, kind = 'other') {
  const c = await caches.open(cacheName);
  const net = fetch(req).then(async (res) => { if (await genuine(res, kind)) c.put(key, res.clone()).catch(() => {}); return res; });
  const timer = new Promise((resolve) => setTimeout(resolve, ms, 'slow'));
  try {
    const first = await Promise.race([net, timer]);
    if (first !== 'slow') return first;
    const cached = await c.match(key);
    return cached ? fromPhone(cached) : await net;
  } catch {
    const cached = await c.match(key);
    if (cached) return fromPhone(cached);
    throw new Error('offline');
  }
}
async function cacheFirst(req, cacheName, kind) {
  const c = await caches.open(cacheName);
  const hit = (await c.match(req)) || (await caches.match(req));
  if (hit) return hit;
  const res = await fetch(req);
  if (await genuine(res, kind)) c.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Journal data from the database (read only): last copy seen, for offline viewing.
  if (url.hostname.endsWith('.supabase.co')) {
    if (url.pathname.startsWith('/rest/v1/')) event.respondWith(networkFirst(req, DATA, 6000, req, 'data'));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(req, SHELL, 'font')); return; }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    const key = url.pathname.startsWith('/health') ? '/health/' : url.pathname;
    event.respondWith(networkFirst(req, SHELL, 4000, key, 'page').catch(async () => (await caches.match(key)) || caches.match('/offline.html')));  // caches.match searches every saved version
    return;
  }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, SHELL, 'asset')); return; } // names change per release
  if (url.pathname.startsWith('/fonts/')) { event.respondWith(cacheFirst(req, SHELL, 'other')); return; }
  if (/^\/(brand|icons)\/|^\/manifest\.webmanifest$/.test(url.pathname)) event.respondWith(networkFirst(req, SHELL, 4000, req, 'other'));
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
