/* Kula Revise Grade 10 content quiz, service worker.
   Network first for code so updates land. Cache first for the rest.
   A learner with no data must still be able to open and finish an attempt. */
const CACHE = 'kula-g10-content-quiz-v5';
const PRECACHE = ['./', './index.html', './styles.css', './config.js', './content.js', './app.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isCode(url) {
  return url.pathname.endsWith('/') || url.pathname.endsWith('.html') ||
         url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  if (isCode(url)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'no-store' });
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      } catch (_) {
        const cached = await caches.match(e.request);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      try { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); } catch (_) {}
      return res;
    }).catch(() => cached))
  );
});
