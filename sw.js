'use strict';

// Files refresh themselves; bump this only if you remove or rename files.
const VERZIO = 'konyha-v1';
const ALKALMAZAS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'illeszto.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/ikonok.svg',
  'data/receptek.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERZIO).then((c) => c.addAll(ALKALMAZAS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((kulcsok) => Promise.all(kulcsok.filter((k) => k !== VERZIO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Answer instantly from the phone, refresh quietly in the background:
  // the new version shows up the next time the app is opened, with no waiting on bad wifi.
  e.respondWith(caches.open(VERZIO).then(async (c) => {
    const tarolt = await c.match(e.request, { ignoreSearch: true });
    const friss = fetch(e.request)
      .then((v) => { if (v.ok) c.put(e.request, v.clone()); return v; })
      .catch(() => tarolt || c.match('index.html'));
    if (tarolt) { e.waitUntil(friss); return tarolt; }
    return friss;
  }));
});
