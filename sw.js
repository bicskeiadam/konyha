'use strict';

// Files refresh themselves; bump this only if you remove or rename files.
const VERZIO = 'konyha-v1';
const ALKALMAZAS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'illeszto.js',
  'i18n.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/ikonok.svg',
  'data/receptek.json',
  'data/receptek.sr.json',
];

self.addEventListener('install', (e) => {
  // 'reload' skips the phone's ordinary web cache, which may still hold the previous version for 10 minutes.
  e.waitUntil(caches.open(VERZIO)
    .then((c) => c.addAll(ALKALMAZAS.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  // The app's own update check (verzioEllenoriz in app.js) must reach the server, not this cache.
  if (url.searchParams.has('friss')) return;

  // Answer instantly from the phone, refresh quietly in the background:
  // if a file really changed, the open app is told and reloads itself once (see ujVerzio in app.js).
  e.respondWith(caches.open(VERZIO).then(async (c) => {
    const tarolt = await c.match(e.request, { ignoreSearch: true });
    const friss = frissit(c, e.request, tarolt);
    if (tarolt) { e.waitUntil(friss.catch(() => {})); return tarolt; }
    return friss.catch(() => c.match('index.html'));
  }));
});

// Fetches the file, stores it, and tells the app when it differs from the stored copy.
async function frissit(c, keres, tarolt) {
  // A page-load request can't be re-sent with options, so its address is used instead.
  const v = await fetch(keres.mode === 'navigate' ? keres.url : keres, { cache: 'no-cache' });
  if (!v.ok) return tarolt || v;
  if (tarolt && !(await ugyanaz(tarolt.clone(), v.clone()))) uzen({ tipus: 'uj-verzio' });
  await c.put(keres, v.clone());
  return v;
}

async function ugyanaz(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const u = new Uint8Array(x), w = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== w[i]) return false;
  return true;
}

async function uzen(adat) {
  for (const kliens of await self.clients.matchAll({ type: 'window' })) kliens.postMessage(adat);
}

// The app asks for a check when it is opened or comes back to the front: iOS often resumes the app
// from memory without loading anything, so nothing would be refreshed otherwise.
self.addEventListener('message', (e) => {
  if (e.data !== 'ellenoriz') return;
  e.waitUntil(caches.open(VERZIO).then((c) => Promise.all(ALKALMAZAS.map(async (f) => {
    const keres = new Request(new URL(f, self.registration.scope).href);
    return frissit(c, keres, await c.match(keres, { ignoreSearch: true })).catch(() => {});
  }))));
});
