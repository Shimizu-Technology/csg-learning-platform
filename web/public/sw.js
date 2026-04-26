const CACHE_NAME = 'csg-learning-hub-v2';
const RUNTIME_CACHE = 'csg-learning-runtime-v2';
const OFFLINE_URL = '/offline.html';
const APP_SHELL_ASSETS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/favicon-32x32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(event.request);
          return cachedPage || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  if (!sameOrigin) return;

  const isStaticAsset =
    requestUrl.pathname.startsWith('/assets/') ||
    requestUrl.pathname === '/manifest.json' ||
    requestUrl.pathname.endsWith('.png') ||
    requestUrl.pathname.endsWith('.ico') ||
    requestUrl.pathname.endsWith('.css') ||
    requestUrl.pathname.endsWith('.js');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'CSG Learning Hub', body: event.data.text() };
    }
  }

  const title = data.title || 'CSG Learning Hub';
  const options = {
    body: data.body || 'You have a new update.',
    icon: '/icon-192x192.png',
    badge: '/icon-180x180.png',
    tag: data.tag || 'csg-learning-update',
    data: {
      path: data.path || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/';
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
