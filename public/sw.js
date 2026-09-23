self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass through fetch for real-time live DB updates
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});