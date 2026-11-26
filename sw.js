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
      .then((kulcsok) => Promise.all(kulcsok.filter((k) => k !== VERZIO && k !== 'megosztas').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Android's Share menu → Konyha. A shared image (e.g. an Instagram screenshot) is parked in a cache and
// the app opens on "Recept képről"; a shared link or text goes to the link import as before.
async function megosztas(keres) {
  const alap = new URL('./', self.registration.scope).href;
  const adat = await keres.formData();
  const kep = adat.get('kep');
  if (kep && kep.size) {
    const c = await caches.open('megosztas');
    await c.put('megosztott-kep', new Response(kep, { headers: { 'content-type': kep.type || 'image/jpeg' } }));
    return Response.redirect(alap + '#/kepbol?megosztott=1', 303);
  }
  const szoveg = ['title', 'text', 'url'].map((k) => adat.get(k)).filter(Boolean).join(' ');
  return Response.redirect(alap + '?text=' + encodeURIComponent(szoveg), 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/megosztas')) {
    e.respondWith(megosztas(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
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
