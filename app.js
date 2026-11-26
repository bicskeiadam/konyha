'use strict';

// The recipe reader (Cloudflare Worker). Locally it runs with `node worker/dev.mjs`.
const OLVASO_URL = location.hostname === 'localhost'
  ? 'http://localhost:8787/'
  : 'https://konyha-olvaso.adambickei14.workers.dev/';

const TAROLO_KULCS = 'konyha.itthon';
const app = document.getElementById('app');

let adat = null;
let hozzavaloById = {};
let illeszt = () => null;
let sajatReceptek = [];
const kepUrlek = {};
let itthon = new Set(JSON.parse(localStorage.getItem(TAROLO_KULCS) || '[]'));
let mutasdATobbit = false;
let ebrenTartas = null;
const gorgetesek = {};

// State of the "new recipe" screen: ures → tolt → elonezet | hiba
let importalas = { allapot: 'ures', link: '', recept: null, hiba: '' };

function mentsItthon() {
  localStorage.setItem(TAROLO_KULCS, JSON.stringify([...itthon]));
}

function esc(szoveg) {
  return String(szoveg ?? '').replace(/[&<>"']/g, (k) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[k]));
}

function vanItthon(id) {
  const h = hozzavaloById[id];
  return Boolean(h && h.alap) || itthon.has(id);
}

function osszesRecept() {
  return [...adat.receptek, ...sajatReceptek];
}

// Only recognised, non-optional, non-staple ingredients count as "missing".
function hianyzik(recept) {
  return [...new Set(recept.hozzavalok
    .filter((h) => h.id && hozzavaloById[h.id] && !h.opcionalis && !vanItthon(h.id))
    .map((h) => hozzavaloById[h.id].nev))];
}

/* ---------- Nutrition (built-in recipes: grams × per-100 g table) ---------- */

// Optional ingredients ("ha van") only count when they're ticked as being at home,
// so the numbers match what she'll actually put in the pot.
function tapertek(recept) {
  if (recept.sajat || !adat.tapanyagok || !recept.hozzavalok.every((h) => typeof h.g === 'number')) return null;
  const osszes = { kcal: 0, feherje: 0, zsir: 0, szenhidrat: 0 };
  const kimaradt = [];
  const benne = [];
  for (const h of recept.hozzavalok) {
    if (h.opcionalis && !itthon.has(h.id)) { kimaradt.push(hozzavaloById[h.id].nev); continue; }
    if (h.opcionalis) benne.push(hozzavaloById[h.id].nev);
    const [kcal, feherje, zsir, szenhidrat] = adat.tapanyagok[h.t || h.id] || [0, 0, 0, 0];
    const x = h.g / 100;
    osszes.kcal += kcal * x;
    osszes.feherje += feherje * x;
    osszes.zsir += zsir * x;
    osszes.szenhidrat += szenhidrat * x;
  }
  const n = recept.adagSzam || 4;
  const adag = Object.fromEntries(Object.entries(osszes).map(([k, v]) => [k, v / n]));
  return { osszes, adag, adagSzam: n, kimaradt: [...new Set(kimaradt)], benne: [...new Set(benne)] };
}

const kerekKcal = (v) => Math.round(v / 10) * 10;
const kerekG = (v) => Math.round(v);

// An imported recipe with no recognised ingredient can't be judged, so it never counts as "can cook".
function ismeretlen(recept) {
  return !recept.hozzavalok.some((h) => h.id && hozzavaloById[h.id] && !hozzavaloById[h.id].alap);
}

function rendezettReceptek() {
  return osszesRecept()
    .map((r) => ({ r, hiany: hianyzik(r), ismeretlen: ismeretlen(r) }))
    .sort((a, b) => a.ismeretlen - b.ismeretlen || a.hiany.length - b.hiany.length || a.r.nev.localeCompare(b.r.nev, 'hu'));
}

/* ---------- Storage on the phone (IndexedDB) for imported recipes ---------- */

const Tar = {
  db: null,
  nyit() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((ok, hiba) => {
      const k = indexedDB.open('konyha', 1);
      k.onupgradeneeded = () => k.result.createObjectStore('sajat', { keyPath: 'id' });
      k.onsuccess = () => { this.db = k.result; ok(this.db); };
      k.onerror = () => hiba(k.error);
    });
  },
  async muvelet(mod, fn) {
    const db = await this.nyit();
    return new Promise((ok, hiba) => {
      const tx = db.transaction('sajat', mod);
      const k = fn(tx.objectStore('sajat'));
      tx.oncomplete = () => ok(k && k.result);
      tx.onerror = () => hiba(tx.error);
    });
  },
  osszes() { return this.muvelet('readonly', (s) => s.getAll()); },
  ment(r) { return this.muvelet('readwrite', (s) => s.put(r)); },
  torol(id) { return this.muvelet('readwrite', (s) => s.delete(id)); },
};

async function sajatBetolt() {
  try {
    sajatReceptek = await Tar.osszes();
  } catch (_) {
    sajatReceptek = [];
  }
  for (const r of sajatReceptek) {
    if (r.kep && !kepUrlek[r.id]) kepUrlek[r.id] = URL.createObjectURL(r.kep);
  }
}

/* ---------- Screens ---------- */

function vissza() {
  return '<div class="fejlec"><button class="vissza" data-vissza><span>‹</span> Vissza</button></div>';
}

function kezdolap() {
  const tudod = rendezettReceptek().filter((x) => !x.ismeretlen && x.hiany.length === 0).length;
  const csoportok = adat.kategoriak.map((kat) => {
    const csempek = adat.hozzavalok
      .filter((h) => h.kat === kat.id && !h.alap)
      .map((h) => `
        <button class="csempe" data-hozzavalo="${h.id}" aria-pressed="${itthon.has(h.id)}">
          <span class="ikon" aria-hidden="true">${h.ikon}</span>
          <span>${esc(h.nev)}</span>
          <span class="pipa" aria-hidden="true">✓</span>
        </button>`).join('');
    return `<h2>${esc(kat.nev)}</h2><div class="racs">${csempek}</div>`;
  }).join('');

  app.innerHTML = `
    <h1>Mi van itthon?</h1>
    <p class="alcim">Koppints arra, ami van. Só, bors, olaj mindig van.</p>
    ${csoportok}
    ${itthon.size ? '<button class="halk-gomb" data-torles>Minden pipa törlése</button>' : ''}
    <div class="also-sav">
      <button class="nagy-gomb" data-ugras="#/receptek">
        Mit főzzek?
        <small>${tudod ? `${tudod} receptet meg tudsz főzni` : 'Nézd meg a recepteket'}</small>
      </button>
    </div>`;
}

function receptKep(r, osztaly) {
  if (r.sajat && kepUrlek[r.id]) return `<img class="${osztaly}" src="${kepUrlek[r.id]}" alt="">`;
  return `<span class="ikon" aria-hidden="true">${r.ikon || '🍽️'}</span>`;
}

function receptKartya({ r, hiany }) {
  const hianySor = hiany.length ? `<span class="hiany">Kell még: ${esc(hiany.join(', '))}</span>` : '';
  const info = [r.ido, r.adag].filter(Boolean).map(esc).join(' · ');
  const t = tapertek(r);
  const tapSor = t ? `<span class="tap-sor">1 adag: ${kerekKcal(t.adag.kcal)} kcal · ${kerekG(t.adag.feherje)} g fehérje</span>` : '';
  return `
    <button class="recept-kartya" data-ugras="#/recept/${encodeURIComponent(r.id)}">
      ${receptKep(r, 'kiskep')}
      <span>
        <span class="nev">${esc(r.nev)}</span>
        ${info ? `<span class="info">${info}</span>` : ''}
        ${tapSor}
        ${hianySor}
      </span>
      <span class="nyil" aria-hidden="true">›</span>
    </button>`;
}

function receptLista() {
  const mind = rendezettReceptek();
  const tudod = mind.filter((x) => !x.ismeretlen && x.hiany.length === 0);
  const majdnem = mind.filter((x) => !x.ismeretlen && x.hiany.length > 0 && x.hiany.length <= 2);
  const tobbi = mind.filter((x) => x.ismeretlen || x.hiany.length > 2);

  let html = `${vissza()}<h1>Mit főzzek?</h1>`;

  html += '<h2>Ezt meg tudod főzni</h2>';
  html += tudod.length
    ? `<div class="lista">${tudod.map(receptKartya).join('')}</div>`
    : '<p class="uzenet">Ebből még nem jön ki egy recept sem. Lent láthatod, mi hiányzik.</p>';

  if (majdnem.length) {
    html += `<h2>Ehhez kell még 1-2 dolog</h2><div class="lista">${majdnem.map(receptKartya).join('')}</div>`;
  }

  if (tobbi.length) {
    html += mutasdATobbit
      ? `<h2>A többi recept</h2><div class="lista">${tobbi.map(receptKartya).join('')}</div>`
      : `<button class="halk-gomb" data-tobbi>A többi recept (${tobbi.length})</button>`;
  }

  html += '<button class="halk-gomb" data-ugras="#/uj">+ Új recept hozzáadása</button>';
  app.innerHTML = html;
}

function hozzavaloSor(h) {
  const info = h.id ? hozzavaloById[h.id] : null;
  let osztaly = '';
  let jel = '';
  if (info && !info.alap) {
    const van = itthon.has(h.id);
    osztaly = van ? 'van' : (h.opcionalis ? '' : 'nincs');
    jel = van ? '✓' : (h.opcionalis ? '' : '✗');
  }
  const megj = h.opcionalis ? opcionalisCimke(h) : (osztaly === 'nincs' ? '<span class="megj">nincs itthon</span>' : '');
  // Built-in recipes: name + amount. Imported ones: the original line as written on the site.
  const szoveg = h.szoveg != null
    ? `<span class="sor-szoveg">${esc(h.szoveg)}${megj}</span>`
    : `<span>${esc(info.nev)}${megj}</span><span class="menny">${esc(h.menny)}</span>`;
  return `<li class="${osztaly}"><span class="jel" aria-hidden="true">${jel}</span>${szoveg}</li>`;
}

function taperTabla(r) {
  const t = tapertek(r);
  if (!t) return '';
  const sor = (nev, kulcs, egyseg) => {
    const k = egyseg === 'kcal' ? kerekKcal : kerekG;
    return `<tr><th>${nev}</th><td>${k(t.adag[kulcs])} ${egyseg}</td><td>${k(t.osszes[kulcs])} ${egyseg}</td></tr>`;
  };
  const megjegyzesek = [
    r.megj,
    t.benne.length ? `Benne van: ${t.benne.join(', ')}.` : '',
    t.kimaradt.length ? `Nincs benne: ${t.kimaradt.join(', ')} (nincs bepipálva, hogy itthon van).` : '',
  ].filter(Boolean).map(esc).join(' ');
  return `
    <div class="tapertek">
      <table>
        <thead><tr><th></th><th>1 adag</th><th>Az egész<br><small>(${t.adagSzam} adag)</small></th></tr></thead>
        <tbody>
          ${sor('Kalória', 'kcal', 'kcal')}
          ${sor('Fehérje', 'feherje', 'g')}
          ${sor('Zsír', 'zsir', 'g')}
          ${sor('Szénhidrát', 'szenhidrat', 'g')}
        </tbody>
      </table>
      <p class="tap-megj">Becsült érték. ${megjegyzesek}</p>
    </div>`;
}

function receptOldal(id) {
  const r = osszesRecept().find((x) => x.id === id);
  if (!r) { location.replace('#/receptek'); return; }

  const lepesek = r.lepesek.map((l, i) => `
    <li><button data-lepes aria-pressed="false">
      <span class="szam">${i + 1}</span><span>${esc(l)}</span>
    </button></li>`).join('');

  const info = [r.ido, r.adag].filter(Boolean).map(esc).join(' · ');
  const fej = r.sajat && kepUrlek[r.id]
    ? `<img class="nagykep" src="${kepUrlek[r.id]}" alt=""><h1>${esc(r.nev)}</h1>${info ? `<p class="meta">${info}</p>` : ''}`
    : `<div class="recept-fej">${receptKep(r)}<div><h1>${esc(r.nev)}</h1>${info ? `<p class="meta">${info}</p>` : ''}</div></div>`;

  const lab = r.sajat ? `
    <p class="forras">${r.forditva ? 'Magyarra fordítva. Eredeti recept' : 'Forrás'}: <a href="${esc(r.forras)}" target="_blank" rel="noopener">${esc(new URL(r.forras).hostname.replace(/^www\./, ''))}</a></p>
    <button class="halk-gomb" data-recept-torles="${esc(r.id)}">Recept törlése</button>` : '';

  app.innerHTML = `
    ${vissza()}
    ${fej}
    ${taperTabla(r)}
    <h2>Hozzávalók</h2>
    <ul class="hozzavalok">${r.hozzavalok.map(hozzavaloSor).join('')}</ul>
    <h2>Elkészítés</h2>
    <p class="tipp">Koppints a lépésre, ha megvagy vele.</p>
    <ol class="lepesek">${lepesek}</ol>
    ${lab}`;

  tartsdEbren();
}

/* ---------- New recipe from a link ---------- */

const HIBAUZENETEK = {
  'nem-tamogatott': 'Erről az oldalról még nem tudok receptet betölteni.',
  'nem-talalhato': 'Ezen az oldalon nem találtam receptet. Biztos, hogy egy recept oldala?',
  'rossz-link': 'Ez nem tűnik linknek. Másold be a recept oldalának címét.',
  'letoltes': 'Most nem sikerült elérni az oldalt. Próbáld újra kicsit később.',
  'internet': 'Ehhez internet kell. Csatlakozz a wifire, és próbáld újra.',
};

function hozzavaloValaszto(i, kivalasztott) {
  const csoportok = adat.kategoriak.map((kat) => {
    const opciok = adat.hozzavalok.filter((h) => h.kat === kat.id && !h.alap)
      .map((h) => `<option value="${h.id}" ${h.id === kivalasztott ? 'selected' : ''}>${esc(h.nev)}</option>`).join('');
    return `<optgroup label="${esc(kat.nev)}">${opciok}</optgroup>`;
  }).join('');
  return `<select class="valaszto" data-sor="${i}" aria-label="Melyik hozzávaló?">
    <option value="">– nem számít –</option>${csoportok}</select>`;
}

function ujRecept() {
  const { allapot, link, recept, hiba } = importalas;
  let html = `${vissza()}<h1>Új recept</h1>`;

  if (allapot === 'tolt') {
    html += FORDITANDO.test(linkBelole(link))
      ? '<p class="uzenet">Betöltöm a receptet, és lefordítom magyarra…<br>Ez fél percig is eltarthat, várj türelemmel.</p>'
      : '<p class="uzenet">Egy pillanat, betöltöm a receptet…</p>';
  } else if (allapot === 'elonezet') {
    const info = [recept.ido, recept.adag].filter(Boolean).map(esc).join(' · ');
    const sorok = recept.hozzavalok.map((h, i) => {
      const alap = h.id && hozzavaloById[h.id]?.alap;
      const ha = h.opcionalis ? opcionalisCimke(h) : '';
      return `
      <li class="import-sor">
        <span class="sor-szoveg">${esc(h.szoveg)}${ha}</span>
        ${alap ? `<span class="megj">${esc(hozzavaloById[h.id].nev)} – mindig van itthon</span>` : hozzavaloValaszto(i, h.id)}
      </li>`;
    }).join('');
    const lepesek = recept.lepesek.map((l, i) => `
      <li><div class="lepes-elonezet"><span class="szam">${i + 1}</span><span>${esc(l)}</span></div></li>`).join('');
    html += `
      ${recept.kepUrl ? `<img class="nagykep" src="${recept.kepUrl}" alt="">` : ''}
      <label class="cimke" for="recept-nev">A recept neve</label>
      <input id="recept-nev" class="mezo" value="${esc(recept.nev)}">
      ${info ? `<p class="meta">${info}</p>` : ''}
      ${recept.forditva ? '<p class="tipp">Magyarra fordítva. Az eredeti receptet a recept alján lévő linken találod.</p>' : ''}
      ${recept.forditasSikertelen ? '<p class="uzenet">A fordítás most nem sikerült, ezért eredeti nyelven látod. Később újra próbálhatod.</p>' : ''}
      <h2>Hozzávalók</h2>
      <p class="tipp">Ellenőrizd, melyik gombhoz tartozik. Ami „nem számít”, az is látszani fog a receptben.</p>
      <ul class="hozzavalok">${sorok}</ul>
      <h2>Elkészítés</h2>
      ${recept.lepesek.length ? `<ol class="lepesek">${lepesek}</ol>` : '<p class="uzenet">Ennél a receptnél nem találtam lépéseket.</p>'}
      <div class="also-sav"><button class="nagy-gomb" data-mentes>Hozzáadom a receptekhez</button></div>`;
  } else {
    html += `
      ${allapot === 'hiba' ? `<p class="uzenet hiba-uzenet">${esc(hiba)}</p>` : ''}
      <label class="cimke" for="link">A recept linkje</label>
      <input id="link" class="mezo" type="url" inputmode="url" placeholder="https://…" value="${esc(link)}">
      <button class="nagy-gomb kozepen" data-betolt>Betöltés</button>
      <p class="tipp tipp-kozep">Tipp: a recept oldalán nyomd meg a <b>Megosztás</b> gombot, és válaszd a <b>Konyha</b> alkalmazást.</p>
      <p class="tipp tipp-kozep">Működik: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com.<br>A szerb és horvát recepteket magyarra fordítja.</p>
      <h2>Biztonsági mentés</h2>
      <p class="tipp">A hozzáadott receptek csak ezen a telefonon vannak. Néha érdemes elmenteni őket egy fájlba.</p>
      <button class="halk-gomb balra" data-export>Saját receptek mentése (${sajatReceptek.length})</button>
      <label class="halk-gomb balra fajl-gomb">Mentés visszatöltése<input type="file" accept="application/json,.json" data-import hidden></label>`;
  }
  app.innerHTML = html;
}

// Serbian/Croatian sites: the reader translates these, which takes a while.
const FORDITANDO = /^https?:\/\/([^/]+\.)?(coolinarika\.com|recepti\.com)\//i;

// Lines like "1 tk fokhagymapor (opcionális)" or "po ukusu beli luk" don't count as missing.
const OPCIONALIS = /opcion|elhagyhat|ha van|ízlés szerint|tetszés szerint|díszítéshez|tálaláshoz|po želji|po zelji|po ukusu|po izboru|за украс|по жељи|по укусу/i;

// Built-in recipes: "ha van" (kolbász, if you have it). Imported lines: "ízlés szerint", unless the line already says so.
function opcionalisCimke(h) {
  if (h.szoveg == null) return '<span class="megj">ha van</span>';
  return /ízlés szerint/i.test(h.szoveg) ? '' : '<span class="megj">ízlés szerint</span>';
}

function linkBelole(szoveg) {
  const m = String(szoveg || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : '';
}

async function betolt(link) {
  importalas = { allapot: 'tolt', link, recept: null, hiba: '' };
  rajzol();
  if (!linkBelole(link)) return importHiba('rossz-link', link);
  if (!navigator.onLine) return importHiba('internet', link);

  let valasz;
  try {
    const v = await fetch(OLVASO_URL + '?url=' + encodeURIComponent(linkBelole(link)));
    valasz = await v.json();
  } catch (_) {
    return importHiba(navigator.onLine ? 'letoltes' : 'internet', link);
  }
  if (valasz.hiba) return importHiba(valasz.hiba, link);

  let kepBlob = null;
  try { if (valasz.kep) kepBlob = await kicsinyit(valasz.kep); } catch (_) { /* recipe without photo */ }

  importalas = {
    allapot: 'elonezet',
    link,
    hiba: '',
    recept: {
      nev: valasz.nev,
      ido: valasz.ido || '',
      adag: valasz.adag || '',
      forras: valasz.forras,
      forditva: Boolean(valasz.forditva),
      forditasSikertelen: Boolean(valasz.forditasSikertelen),
      lepesek: valasz.lepesek,
      // Match on the original line first (reliable Serbian keywords), then on the Hungarian translation.
      hozzavalok: valasz.hozzavalok.map((szoveg, i) => {
        const eredeti = valasz.eredetiHozzavalok?.[i] || '';
        return {
          szoveg,
          id: illeszt(eredeti) || illeszt(szoveg),
          opcionalis: OPCIONALIS.test(eredeti) || OPCIONALIS.test(szoveg) || undefined,
        };
      }),
      kepBlob,
      kepUrl: kepBlob ? URL.createObjectURL(kepBlob) : null,
    },
  };
  if (location.hash.startsWith('#/uj')) rajzol();
}

function importHiba(kod, link) {
  importalas = { allapot: 'hiba', link, recept: null, hiba: HIBAUZENETEK[kod] || HIBAUZENETEK.letoltes };
  if (location.hash.startsWith('#/uj')) rajzol();
}

// Shrinks the photo to at most 900 px so a few hundred recipes still fit comfortably on the phone.
async function kicsinyit(adatUrl) {
  const kep = new Image();
  kep.src = adatUrl;
  await kep.decode();
  const arany = Math.min(1, 900 / Math.max(kep.naturalWidth, kep.naturalHeight));
  const vaszon = document.createElement('canvas');
  vaszon.width = Math.round(kep.naturalWidth * arany);
  vaszon.height = Math.round(kep.naturalHeight * arany);
  vaszon.getContext('2d').drawImage(kep, 0, 0, vaszon.width, vaszon.height);
  return new Promise((ok) => vaszon.toBlob(ok, 'image/jpeg', 0.82));
}

async function mentes() {
  const r = importalas.recept;
  const nev = document.getElementById('recept-nev')?.value.trim() || r.nev;
  const uj = {
    id: 's' + Date.now().toString(36),
    sajat: true,
    nev,
    ido: r.ido,
    adag: r.adag,
    forras: r.forras,
    ...(r.forditva ? { forditva: true } : {}),
    lepesek: r.lepesek,
    hozzavalok: r.hozzavalok.map(({ szoveg, id, opcionalis }) => ({ szoveg, id: id || null, ...(opcionalis ? { opcionalis } : {}) })),
    kep: r.kepBlob,
    hozzaadva: new Date().toISOString(),
  };
  await Tar.ment(uj);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if (uj.kep) kepUrlek[uj.id] = r.kepUrl;
  sajatReceptek.push(uj);
  importalas = { allapot: 'ures', link: '', recept: null, hiba: '' };
  location.replace('#/recept/' + encodeURIComponent(uj.id));
}

/* ---------- Backup to a file ---------- */

function blobbolAdat(blob) {
  return new Promise((ok) => { const o = new FileReader(); o.onload = () => ok(o.result); o.readAsDataURL(blob); });
}

async function exportal() {
  const receptek = await Promise.all(sajatReceptek.map(async (r) => ({ ...r, kep: r.kep ? await blobbolAdat(r.kep) : null })));
  const fajl = new Blob([JSON.stringify({ konyhaMentes: 1, receptek })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(fajl);
  a.download = `konyha-mentes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importal(fajl) {
  try {
    const mentett = JSON.parse(await fajl.text());
    if (!mentett.konyhaMentes || !Array.isArray(mentett.receptek)) throw new Error();
    for (const r of mentett.receptek) {
      if (!r.id || !r.nev || !Array.isArray(r.hozzavalok)) continue;
      const kep = r.kep ? await (await fetch(r.kep)).blob() : null;
      await Tar.ment({ ...r, sajat: true, kep });
    }
    await sajatBetolt();
    alert(`${mentett.receptek.length} recept visszatöltve.`);
  } catch (_) {
    alert('Ez nem egy Konyha mentés fájl.');
  }
  rajzol();
}

/* ---------- Keep the screen on while a recipe is open ---------- */

async function tartsdEbren() {
  if (!('wakeLock' in navigator) || ebrenTartas) return;
  try {
    ebrenTartas = await navigator.wakeLock.request('screen');
    ebrenTartas.addEventListener('release', () => { ebrenTartas = null; });
  } catch (_) { /* not critical */ }
}

function engedjAludni() {
  if (ebrenTartas) { ebrenTartas.release(); ebrenTartas = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash.startsWith('#/recept/')) tartsdEbren();
});

/* ---------- Routing (hash, so the phone's back button works) ---------- */

let aktualisUtvonal = null;

function rajzol() {
  if (!adat) return;
  if (aktualisUtvonal !== null) gorgetesek[aktualisUtvonal] = window.scrollY;

  const ut = location.hash || '#/';
  if (!ut.startsWith('#/recept/')) engedjAludni();

  if (ut === '#/receptek') receptLista();
  else if (ut.startsWith('#/recept/')) receptOldal(decodeURIComponent(ut.slice(9)));
  else if (ut.startsWith('#/uj')) ujRecept();
  else kezdolap();

  const ujUtvonal = location.hash || '#/';
  window.scrollTo(0, ujUtvonal === aktualisUtvonal ? window.scrollY : (gorgetesek[ujUtvonal] || 0));
  aktualisUtvonal = ujUtvonal;
}

window.addEventListener('hashchange', rajzol);

app.addEventListener('click', async (e) => {
  const gomb = e.target.closest('button');
  if (!gomb) return;

  if (gomb.dataset.hozzavalo) {
    const id = gomb.dataset.hozzavalo;
    if (itthon.has(id)) itthon.delete(id); else itthon.add(id);
    mentsItthon();
    const y = window.scrollY;
    kezdolap();
    window.scrollTo(0, y);
  } else if (gomb.dataset.ugras) {
    location.hash = gomb.dataset.ugras;
  } else if ('vissza' in gomb.dataset) {
    if (history.length > 1) history.back(); else location.hash = '#/';
  } else if ('tobbi' in gomb.dataset) {
    mutasdATobbit = true;
    const y = window.scrollY;
    receptLista();
    window.scrollTo(0, y);
  } else if ('lepes' in gomb.dataset) {
    gomb.setAttribute('aria-pressed', gomb.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  } else if ('torles' in gomb.dataset) {
    if (confirm('Biztosan törlöd az összes pipát?')) {
      itthon.clear();
      mentsItthon();
      kezdolap();
    }
  } else if ('betolt' in gomb.dataset) {
    betolt(document.getElementById('link').value.trim());
  } else if ('mentes' in gomb.dataset) {
    gomb.disabled = true;
    await mentes();
  } else if (gomb.dataset.receptTorles) {
    const id = gomb.dataset.receptTorles;
    const r = sajatReceptek.find((x) => x.id === id);
    if (r && confirm(`Biztosan törlöd ezt a receptet?\n\n${r.nev}`)) {
      await Tar.torol(id);
      sajatReceptek = sajatReceptek.filter((x) => x.id !== id);
      location.replace('#/receptek');
    }
  } else if ('export' in gomb.dataset) {
    exportal();
  }
});

app.addEventListener('change', (e) => {
  if (e.target.matches('.valaszto') && importalas.recept) {
    importalas.recept.hozzavalok[+e.target.dataset.sor].id = e.target.value || null;
  } else if (e.target.matches('[data-import]') && e.target.files[0]) {
    importal(e.target.files[0]);
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'link') betolt(e.target.value.trim());
});

/* ---------- Start ---------- */

// Opened from Android's Share menu: the link arrives as ?url= or inside ?text=.
function megosztottLink() {
  const p = new URLSearchParams(location.search);
  const link = linkBelole(p.get('url')) || linkBelole(p.get('text')) || linkBelole(p.get('title'));
  if (location.search) history.replaceState(null, '', location.pathname + (link ? '#/uj' : location.hash));
  return link;
}

async function indul() {
  const link = megosztottLink();
  try {
    const valasz = await fetch('data/receptek.json');
    adat = await valasz.json();
  } catch (_) {
    app.innerHTML = '<p class="uzenet">Most nem sikerült betölteni a recepteket. Csatlakozz egyszer wifire, utána internet nélkül is működik.</p>';
    return;
  }
  hozzavaloById = Object.fromEntries(adat.hozzavalok.map((h) => [h.id, h]));
  illeszt = window.Illeszto.keszit(adat);
  await sajatBetolt();
  if (link) betolt(link); else rajzol();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

indul();
