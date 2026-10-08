// Keeps the app on the phone so it opens instantly and works offline.
// Bump VERSION (and APP_VERSION in app.js) whenever you upload a new version of the app.
const VERSION = 'lists-v3';
const FONTS = 'lists-fonts';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' = always download fresh files, never reuse the browser's (possibly old) copy.
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // calls to the Google Sheet (POST) are never cached
  const url = new URL(req.url);

  // Fonts and icons from Google Fonts: keep a copy so the icons still show offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async cache => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }

  // App files: answer from the phone's copy straight away, refresh it in the background.
  const scope = new URL(self.registration.scope);
  const own = url.origin === location.origin && SHELL.includes(url.pathname.slice(scope.pathname.length) || './');
  if (req.mode !== 'navigate' && !own) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(new Request(req.mode === 'navigate' ? 'index.html' : req.url, { cache: 'no-cache' })).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => hit);
    if (hit) { e.waitUntil(fresh); return hit; }
    return fresh;
  }));
});
