self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('umishka-v1').then((cache) => {
      return cache.addAll(['./', './index.html', './renderer.js']);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
