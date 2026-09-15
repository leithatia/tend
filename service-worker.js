const CACHE_NAME = 'daily-planner-v13';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/date.js',
  './js/occurrences.js',
  './js/categories.js',
  './js/icons.js',
  './js/taskForm.js',
  './js/actionSheet.js',
  './js/backup.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        // cache.addAll() lets fetch() serve stale responses from the
        // browser's own HTTP cache, which can mix an old file in with an
        // otherwise-new set (e.g. a stale taskForm.js next to a new app.js
        // that expects an export it doesn't have yet) and break the app
        // outright. { cache: 'reload' } forces every file to come from the
        // network so the whole app shell is internally consistent.
        APP_SHELL.map((url) => fetch(url, { cache: 'reload' }).then((response) => {
          if (response.ok) return cache.put(url, response);
          return undefined;
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request, { cache: 'reload' })
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        });
    })
  );
});
