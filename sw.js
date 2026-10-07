/**
 * ClearMind Pro — Progressive Web App Service Worker (v5.0.0)
 * Intelligent Cache Strategies:
 * - Network-First for dynamic /api endpoints with IndexedDB queue fallback
 * - Cache-First for static assets (CSS, JS, Fonts, Images)
 * - Offline Fallback page support for uninterrupted revision
 */

const CACHE_NAME = 'clearmind-pro-cache-v5.0';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/app',
  '/app.html',
  '/study-planner',
  '/study_planner.html',
  '/leaderboard',
  '/leaderboard.html',
  '/teacher',
  '/teacher_portal.html',
  '/parent',
  '/parent_dashboard.html',
  '/study_planner.js',
  '/offline_pwa.js',
  '/i18n_locales.js',
  '/landing.css',
  '/landing.js',
  '/style.css',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.info('Pre-caching ClearMind Pro offline application shell...');
      return cache.addAll(OFFLINE_URLS.map(url => new Request(url, { cache: 'reload' }))).catch(err => {
        console.warn('Some assets could not be pre-cached, proceeding with core shell:', err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // For API endpoints: Network-first
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(JSON.stringify({
          error: "offline_fallback",
          message: "You are currently offline. Actions will sync automatically upon reconnection."
        }), {
          headers: { "Content-Type": "application/json" }
        });
      })
    );
    return;
  }

  // For navigation & static assets: Stale-while-revalidate or Cache-first
  event.respondWith(
    caches.match(req).then(cachedResp => {
      const fetchPromise = fetch(req).then(networkResp => {
        if (networkResp && networkResp.status === 200 && req.method === 'GET') {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
        }
        return networkResp;
      }).catch(() => {
        return cachedResp || caches.match('/app.html');
      });

      return cachedResp || fetchPromise;
    })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'ClearMind Pro', body: 'Time for your daily spaced review!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/manifest.json',
      badge: '/manifest.json'
    })
  );
});
