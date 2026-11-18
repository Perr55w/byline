// App-shell cache: the interface opens instantly (and offline); data always comes fresh from the server.
const CACHE = 'byline-shell-v2';
const SHELL = ['/', '/styles.css', '/css/career.css', '/css/people.css', '/css/control.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname === '/login') return; // never cache data or media
  // Stale-while-revalidate for the shell and view modules.
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then(res => { if (res.ok && res.type === 'basic') cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
