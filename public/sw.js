// Offline fallback for the app shell. Network first: whenever the server is reachable you get the
// current version; the cached copy is used only when offline. Bump VERSION when the shell changes.
const VERSION = 'byline-shell-v14';
const SHELL = ['/',
  '/css/v4/tokens.css', '/css/v4/shell.css', '/css/v4/components.css', '/css/v4/today.css', '/css/v4/feed.css', '/css/v4/dossier.css', '/css/v4/map.css', '/css/v4/search.css', '/css/v4/studio.css', '/css/v4/calendar.css', '/css/v4/campaigns.css', '/css/v4/performance.css', '/css/v4/career.css', '/css/v4/employers.css', '/css/v4/people.css', '/css/v4/sources.css', '/css/v4/runs.css', '/css/v4/settings.css',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/motion.js', '/js/quality.js', '/js/bg.js', '/js/bg2d.js', '/js/bg2d-worker.js', '/js/dossier.js', '/js/index-menu.js', '/js/map-engine.js',
  '/js/views/_placeholder.js', '/js/views/calendar.js', '/js/views/campaigns.js', '/js/views/career.js', '/js/views/employers.js', '/js/views/feed.js', '/js/views/map.js', '/js/views/people.js', '/js/views/performance.js', '/js/views/runs.js', '/js/views/search.js', '/js/views/settings.js', '/js/views/sources.js', '/js/views/story-dossier.js', '/js/views/studio.js', '/js/views/today.js',
  '/fonts/newsreader.woff2', '/fonts/geist.woff2', '/fonts/geist-mono.woff2',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/favicon.svg', '/icons/icon-192.png'];

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
