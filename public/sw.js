// Offline fallback for the app shell. Network first: whenever the server is reachable you get the
// current version; the cached copy is used only when offline. Bump VERSION when the shell changes.
const VERSION = 'byline-shell-v5';
const SHELL = ['/', '/styles.css', '/css/career.css', '/css/people.css', '/css/control.css', '/css/desk.css', '/css/motion.css', '/css/index.css', '/css/player.css', '/js/index-menu.js', '/js/player.js', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/fx/surface.js', '/js/fx/micro.js', '/js/fx/type.js', '/css/fx-type.css', '/css/fx-micro.css', '/css/fx-surface.css', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const stale = (await caches.keys()).filter(k => k !== VERSION);
    await Promise.all(stale.map(k => caches.delete(k)));
    await self.clients.claim();
    // Pages that were opened from an older cached shell reload once onto the current version.
    if (stale.length) for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname === '/login') return; // never cache data or media
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request)) || (e.request.mode === 'navigate' ? cache.match('/') : Response.error());
    }
  })());
});
