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

// The hand-written recipe form keeps its text while she moves between screens.
const uresKezi = () => ({ nev: '', ido: '', adag: '4', hozzavalok: '', lepesek: '', kepBlob: null, kepUrl: null, hiba: '' });
let kezi = uresKezi();
// After saving, the phone's back button would land on the emptied form; send it to the menu instead.
let keziMentve = false;

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
const szam = (v) => v.toLocaleString('hu-HU', { maximumFractionDigits: 1 });

/* ---------- Ingredient nutrition page ---------- */

let tapSzerint = 'feherje';
// Always best first: the most protein, but the fewest calories, carbs and fat.
const MERTEKEK = [
  { kulcs: 'feherje', nev: 'Fehérje', egyseg: 'g', tobbJobb: true },
  { kulcs: 'kcal', nev: 'Kalória', egyseg: 'kcal', tobbJobb: false },
  { kulcs: 'szenhidrat', nev: 'Szénhidrát', egyseg: 'g', tobbJobb: false },
  { kulcs: 'zsir', nev: 'Zsír', egyseg: 'g', tobbJobb: false },
];

// One row per entry in the nutrition table; chicken cuts get their own names, salt/pepper/water are left out.
function tapanyagSorok() {
  const valtozat = adat.tapanyagValtozatok || {};
  return Object.entries(adat.tapanyagok)
    .filter(([kulcs]) => kulcs !== '_')
    .map(([kulcs, [kcal, feherje, zsir, szenhidrat]]) => {
      const h = valtozat[kulcs] || hozzavaloById[kulcs];
      if (!h || (h.alap && !valtozat[kulcs])) return null;
      const gomb = hozzavaloById[kulcs] ? kulcs : (kulcs.startsWith('csirke') ? 'csirke' : null);
      return { kulcs, nev: h.nev, ikon: h.ikon, kat: h.kat, gomb, kcal, feherje, zsir, szenhidrat };
    })
    .filter(Boolean);
}

function tapanyagOldal() {
  const m = MERTEKEK.find((x) => x.kulcs === tapSzerint);
  const sorok = tapanyagSorok();
  sorok.sort((a, b) => (m.tobbJobb ? b[m.kulcs] - a[m.kulcs] : a[m.kulcs] - b[m.kulcs]) || a.nev.localeCompare(b.nev, 'hu'));
  const max = Math.max(...sorok.map((s) => s[m.kulcs]), 1);

  // "355 kcal" needs no word after it; grams do ("1 g szénhidrát").
  const ertekSzoveg = (x, s) => (x.egyseg === 'kcal' ? `${szam(s[x.kulcs])} kcal` : `${szam(s[x.kulcs])} g ${x.nev.toLowerCase()}`);
  const lista = sorok.map((s) => {
    const tobbi = MERTEKEK.filter((x) => x.kulcs !== m.kulcs).map((x) => `<span>${ertekSzoveg(x, s)}</span>`).join('');
    const jelzes = felulirasok[s.kulcs] || sajatHozzavalok.some((x) => x.id === s.kulcs) ? '<span class="tap-pontos">pontosítva</span>' : '';
    return `
      <li><button class="tap-elem" data-ugras="#/hozzavalo/${encodeURIComponent(s.kulcs)}">
        <span class="ikon" aria-hidden="true">${s.ikon || '🥄'}</span>
        <span class="tap-kozep">
          <span class="nev">${esc(s.nev)}${jelzes}</span>
          <span class="tap-csik" aria-hidden="true" style="width:${Math.max(2, (s[m.kulcs] / max) * 100)}%"></span>
          <span class="tap-tobbi">${tobbi}</span>
        </span>
        <span class="tap-fo">${szam(s[m.kulcs])} ${m.egyseg}<small>${m.nev.toLowerCase()}</small></span>
      </button></li>`;
  }).join('');

  app.innerHTML = `
    ${vissza()}
    <h1>Tápérték</h1>
    <div class="szuro-sor">${MERTEKEK.map((x) =>
      `<button class="szuro" data-rendez="${x.kulcs}" aria-pressed="${x.kulcs === tapSzerint}">${esc(x.nev)}</button>`).join('')}</div>
    <p class="tipp">${m.tobbJobb ? 'Elöl az, amiben a legtöbb van.' : 'Elöl az, amiben a legkevesebb van.'} Koppints egy hozzávalóra, ha pontosítanád.</p>
    <button class="halk-gomb balra" data-uj-hozzavalo>${ikon('plus')} Új hozzávaló</button>
    <div class="tap-tabla">
      <div class="tap-fejlec">
        <span class="tap-fejlec-nev">Hozzávaló</span>
        <span class="tap-fejlec-ertek">100 grammban<small>nyersen</small></span>
      </div>
      <ul class="tap-lista">${lista}</ul>
    </div>`;
}

/* ---------- Her own ingredients and corrected values (stored on the phone) ---------- */

const SAJAT_HOZZAVALO_KULCS = 'konyha.sajatHozzavalok';
const FELULIRAS_KULCS = 'konyha.felulirasok';
// [{ id, nev, ikon, kat, ertek: [kcal, fehérje, zsír, szénhidrát], forras }]
let sajatHozzavalok = JSON.parse(localStorage.getItem(SAJAT_HOZZAVALO_KULCS) || '[]');
// { kulcs: { ertek: [...], forras } } - replaces the built-in estimate for that ingredient
let felulirasok = JSON.parse(localStorage.getItem(FELULIRAS_KULCS) || '{}');
let eredetiAdat = null;

function sajatMent() {
  localStorage.setItem(SAJAT_HOZZAVALO_KULCS, JSON.stringify(sajatHozzavalok));
  localStorage.setItem(FELULIRAS_KULCS, JSON.stringify(felulirasok));
}

// Search keywords from the name: the whole name, plus each longer word without its last letter,
// so "Kajmak" also matches "kajmakot". Words the app already knows are skipped: in "Kranjska kobasica"
// only "kranjsk" is kept, so a plain "kobasica" in a recipe still means the generic Kolbász.
function nevKulcsok(nev, ismertSzavak) {
  const szavak = nev.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  const tovek = szavak.map((w) => (w.length > 5 ? w.slice(0, -1) : w))
    .filter((t) => !ismertSzavak.has(window.Illeszto.normal(t).trim()));
  return [...new Set([nev.toLowerCase(), ...tovek])];
}

// Rebuilds the working data from the shipped file + her additions, so every screen sees the same values.
function adatFrissit() {
  if (!eredetiAdat) eredetiAdat = JSON.parse(JSON.stringify({ hozzavalok: adat.hozzavalok, tapanyagok: adat.tapanyagok }));
  const ismertSzavak = new Set(eredetiAdat.hozzavalok.flatMap((h) => h.kulcsok || [])
    .map((k) => window.Illeszto.normal(k.replace(/^=/, '')).trim()));
  adat.hozzavalok = [
    ...eredetiAdat.hozzavalok.filter((h) => !h.alap),
    ...sajatHozzavalok.map((s) => ({ id: s.id, nev: s.nev, ikon: s.ikon, kat: s.kat, kulcsok: nevKulcsok(s.nev, ismertSzavak), sajat: true })),
    ...eredetiAdat.hozzavalok.filter((h) => h.alap),
  ];
  adat.tapanyagok = { ...eredetiAdat.tapanyagok };
  for (const s of sajatHozzavalok) adat.tapanyagok[s.id] = s.ertek;
  for (const [kulcs, f] of Object.entries(felulirasok)) if (adat.tapanyagok[kulcs]) adat.tapanyagok[kulcs] = f.ertek;
  hozzavaloById = Object.fromEntries(adat.hozzavalok.map((h) => [h.id, h]));
  illeszt = window.Illeszto.keszit(adat);
}

const IKON_VALASZTEK = ['🥩', '🍗', '🐟', '🌭', '🥓', '🧀', '🥛', '🥚', '🧈', '🥣', '🍶', '🥬', '🥦', '🥕', '🧅', '🧄', '🥔', '🍅', '🫑', '🌽', '🫘', '🍄', '🌾', '🍚', '🍝', '🍞', '🥜', '🍎', '🍋', '🍯', '🫙', '🥄'];

// Form state of the ingredient screen; "kulcs" is null for a new ingredient.
let hForm = null;

function hFormInit(kulcs) {
  if (hForm && hForm.kulcs === kulcs) return;
  const ertek = kulcs ? adat.tapanyagok[kulcs] : null;
  const valtozat = (adat.tapanyagValtozatok || {})[kulcs];
  const h = valtozat || hozzavaloById[kulcs];
  const sajat = sajatHozzavalok.find((s) => s.id === kulcs);
  hForm = {
    kulcs,
    nev: h ? h.nev : '',
    ikon: (sajat && sajat.ikon) || (h && h.ikon) || '🥄',
    kat: (sajat && sajat.kat) || (h && h.kat) || 'kamra',
    ertek: ertek ? ertek.map((v) => String(v).replace('.', ',')) : ['', '', '', ''],
    forras: (felulirasok[kulcs] || sajat || {}).forras || '',
    allapot: '',
    uzenet: '',
  };
}

const HFORM_ERTEKEK = [['Kalória', 'kcal'], ['Fehérje', 'g'], ['Zsír', 'g'], ['Szénhidrát', 'g']];

function hozzavaloOldal(kulcs) {
  if (kulcs && !adat.tapanyagok[kulcs]) { location.replace('#/tapanyag'); return; }
  hFormInit(kulcs);
  const f = hForm;
  const sajat = kulcs && sajatHozzavalok.some((s) => s.id === kulcs);
  const beepitett = kulcs && !sajat;
  const eredeti = beepitett ? eredetiAdat.tapanyagok[kulcs] : null;

  const allapotSor = f.allapot === 'olvas' ? `<p class="uzenet">${ikon('camera')} Olvasom a címkét…</p>`
    : f.allapot === 'becsul' ? '<p class="uzenet">Keresem a szokásos értékeket…</p>'
    : f.uzenet ? `<p class="uzenet${f.allapot === 'hiba' ? ' hiba-uzenet' : ''}">${esc(f.uzenet)}</p>` : '';

  const mezok = HFORM_ERTEKEK.map(([nev, egyseg], i) => `
    <div>
      <label class="cimke" for="h-${i}">${nev} <span class="egyseg">(${egyseg})</span></label>
      <input id="h-${i}" class="mezo" data-hertek="${i}" value="${esc(f.ertek[i])}" inputmode="decimal" autocomplete="off">
    </div>`).join('');

  app.innerHTML = `
    ${vissza()}
    <h1>${kulcs ? esc(f.nev) : 'Új hozzávaló'}</h1>
    ${kulcs ? '' : `
      <label class="cimke" for="h-nev">Neve</label>
      <input id="h-nev" class="mezo" data-hnev value="${esc(f.nev)}" autocomplete="off">
      <p class="szuro-cim">Melyik csoportba?</p>
      <div class="szuro-sor">${adat.kategoriak.map((k) =>
        `<button class="szuro" data-hkat="${k.id}" aria-pressed="${f.kat === k.id}">${esc(k.nev)}</button>`).join('')}</div>
      <p class="szuro-cim">Kép</p>
      <div class="ikon-racs">${IKON_VALASZTEK.map((e) =>
        `<button class="ikon-valaszt" data-hikon="${e}" aria-pressed="${f.ikon === e}">${e}</button>`).join('')}</div>`}
    <h2>Tápérték 100 grammban</h2>
    <p class="tipp">Fotózd le a csomagoláson a tápérték-táblázatot, és a számokat kiolvassa magától.</p>
    <div class="kep-gombok">
      <label class="halk-gomb fajl-gomb">${ikon('camera')} Címke fotó<input type="file" accept="image/*" capture="environment" data-cimke hidden></label>
      <label class="halk-gomb fajl-gomb">${ikon('image')} Galériából<input type="file" accept="image/*" data-cimke hidden></label>
    </div>
    <button class="halk-gomb balra" data-becsles>Nincs címkéje (hentes, piac)</button>
    ${allapotSor}
    <div class="ertek-racs">${mezok}</div>
    ${eredeti ? `<p class="tipp eredeti">Eredeti becslés: ${szam(eredeti[0])} kcal, ${szam(eredeti[1])} g fehérje, ${szam(eredeti[2])} g zsír, ${szam(eredeti[3])} g szénhidrát.</p>` : ''}
    ${beepitett && felulirasok[kulcs] ? `<button class="halk-gomb balra" data-visszaallit>Eredeti visszaállítása</button>` : ''}
    ${sajat ? `<button class="halk-gomb balra veszely" data-htorol>${ikon('trash')} Hozzávaló törlése</button>` : ''}
    <div class="also-sav">
      <button class="nagy-gomb" data-hment>${ikon('check')}<span class="gomb-szoveg">Mentés</span></button>
    </div>`;
}

// Reads the nutrition table from a label photo through the reader (Cloudflare Workers AI).
async function cimkeOlvasas(fajl) {
  if (!navigator.onLine) { hForm.allapot = 'hiba'; hForm.uzenet = 'Ehhez internet kell.'; return rajzolMarad(); }
  hForm.allapot = 'olvas'; hForm.uzenet = '';
  rajzolMarad();
  const ideiglenes = URL.createObjectURL(fajl);
  try {
    // Labels need more pixels than recipe photos to stay legible.
    const blob = await kicsinyit(ideiglenes, 1600);
    const valasz = await (await fetch(OLVASO_URL + 'cimke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kep: await blobbolAdat(blob) }),
    })).json();
    tapErtekBeir(valasz, 'cimke', 'Nem sikerült kiolvasni. Próbáld közelebbről, élesebben lefotózni a táblázatot.');
  } catch (_) {
    hForm.allapot = 'hiba'; hForm.uzenet = 'Most nem sikerült elérni a szolgáltatást. Próbáld újra kicsit később.';
  } finally {
    URL.revokeObjectURL(ideiglenes);
  }
  rajzolMarad();
}

async function becslesKeres() {
  const nev = hForm.nev.trim();
  if (!nev) { hForm.allapot = 'hiba'; hForm.uzenet = 'Előbb írd be a hozzávaló nevét.'; return rajzolMarad(); }
  if (!navigator.onLine) { hForm.allapot = 'hiba'; hForm.uzenet = 'Ehhez internet kell.'; return rajzolMarad(); }
  hForm.allapot = 'becsul'; hForm.uzenet = '';
  rajzolMarad();
  try {
    const valasz = await (await fetch(OLVASO_URL + 'becsles', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nev }),
    })).json();
    tapErtekBeir(valasz, 'becsles', 'Erre most nem találtam értéket. Írd be a számokat kézzel.');
  } catch (_) {
    hForm.allapot = 'hiba'; hForm.uzenet = 'Most nem sikerült elérni a szolgáltatást. Próbáld újra kicsit később.';
  }
  rajzolMarad();
}

function tapErtekBeir(valasz, forras, hibaSzoveg) {
  if (valasz.hiba) { hForm.allapot = 'hiba'; hForm.uzenet = hibaSzoveg; return; }
  hForm.ertek = [valasz.kcal, valasz.feherje, valasz.zsir, valasz.szenhidrat].map((v) => String(v).replace('.', ','));
  hForm.forras = forras;
  hForm.allapot = valasz.ellenorizd ? 'hiba' : 'kesz';
  hForm.uzenet = valasz.ellenorizd
    ? (forras === 'cimke'
      ? 'A számok nem egészen stimmelnek egymással. Nézd meg a címkén, és javítsd, ha kell.'
      : 'Ez a becslés bizonytalan, a számok nem stimmelnek egymással. Javítsd, ha tudod a pontos értéket.')
    : forras === 'cimke' ? 'Kiolvastam a címkéről. Nézd át, és mentsd el.' : 'Ezek szokásos, becsült értékek. Nézd át, és mentsd el.';
}

function rajzolMarad() {
  const y = window.scrollY;
  rajzol();
  window.scrollTo(0, y);
}

function hozzavaloMentes() {
  const f = hForm;
  const ertek = f.ertek.map((v) => parseFloat(String(v).replace(',', '.')));
  if (!f.kulcs && !f.nev.trim()) { f.allapot = 'hiba'; f.uzenet = 'Írd be a hozzávaló nevét.'; return rajzolMarad(); }
  if (ertek.some((v) => !Number.isFinite(v) || v < 0)) { f.allapot = 'hiba'; f.uzenet = 'Mind a négy számot töltsd ki.'; return rajzolMarad(); }
  if (ertek[1] + ertek[2] + ertek[3] > 101) { f.allapot = 'hiba'; f.uzenet = '100 grammban nem lehet több 100 grammnál. Nézd meg újra a számokat.'; return rajzolMarad(); }

  if (!f.kulcs) {
    sajatHozzavalok.push({ id: 'u' + Date.now().toString(36), nev: f.nev.trim(), ikon: f.ikon, kat: f.kat, ertek, forras: f.forras || 'kezi' });
  } else if (sajatHozzavalok.some((s) => s.id === f.kulcs)) {
    Object.assign(sajatHozzavalok.find((s) => s.id === f.kulcs), { ertek, forras: f.forras || 'kezi' });
  } else {
    felulirasok[f.kulcs] = { ertek, forras: f.forras || 'kezi' };
  }
  sajatMent();
  adatFrissit();
  hForm = null;
  if (history.length > 1) history.back(); else location.replace('#/tapanyag');
}

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

// "sajat": imported and hand-written recipes (photo inside the record).
// "kepek": photos she took of the built-in recipes, keyed by recipe id.
const Tar = {
  db: null,
  nyit() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((ok, hiba) => {
      const k = indexedDB.open('konyha', 2);
      k.onupgradeneeded = () => {
        const db = k.result;
        if (!db.objectStoreNames.contains('sajat')) db.createObjectStore('sajat', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kepek')) db.createObjectStore('kepek', { keyPath: 'id' });
      };
      k.onsuccess = () => { this.db = k.result; ok(this.db); };
      k.onerror = () => hiba(k.error);
    });
  },
  async muvelet(tar, mod, fn) {
    const db = await this.nyit();
    return new Promise((ok, hiba) => {
      const tx = db.transaction(tar, mod);
      const k = fn(tx.objectStore(tar));
      tx.oncomplete = () => ok(k && k.result);
      tx.onerror = () => hiba(tx.error);
    });
  },
  osszes() { return this.muvelet('sajat', 'readonly', (s) => s.getAll()); },
  ment(r) { return this.muvelet('sajat', 'readwrite', (s) => s.put(r)); },
  torol(id) { return this.muvelet('sajat', 'readwrite', (s) => s.delete(id)); },
  kepek() { return this.muvelet('kepek', 'readonly', (s) => s.getAll()); },
  kepMent(id, kep) { return this.muvelet('kepek', 'readwrite', (s) => s.put({ id, kep })); },
};

function kepBeallit(id, blob) {
  if (kepUrlek[id]) URL.revokeObjectURL(kepUrlek[id]);
  if (blob) kepUrlek[id] = URL.createObjectURL(blob); else delete kepUrlek[id];
}

async function sajatBetolt() {
  let kepek = [];
  try {
    sajatReceptek = await Tar.osszes();
    kepek = await Tar.kepek();
  } catch (_) {
    sajatReceptek = [];
  }
  for (const r of sajatReceptek) if (r.kep && !kepUrlek[r.id]) kepBeallit(r.id, r.kep);
  for (const k of kepek) if (k.kep && !kepUrlek[k.id]) kepBeallit(k.id, k.kep);
}

// Photo of any recipe: own recipes keep it in their record, built-in ones in the "kepek" store.
async function receptKepMent(r, blob) {
  if (r.sajat) {
    r.kep = blob;
    await Tar.ment(r);
  } else {
    await Tar.kepMent(r.id, blob);
  }
  kepBeallit(r.id, blob);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
}

/* ---------- Screens ---------- */

// Phosphor icon from the offline sprite in icons/ikonok.svg.
function ikon(nev) {
  return `<svg class="i" aria-hidden="true"><use href="icons/ikonok.svg#${nev}"/></svg>`;
}

function vissza() {
  return `<div class="fejlec"><button class="vissza" data-vissza>${ikon('caret-left')} Vissza</button></div>`;
}

function tudodSzam() {
  return rendezettReceptek().filter((x) => !x.ismeretlen && x.hiany.length === 0).length;
}

function menuGomb(cel, ikonNev, cim, leiras, fo = false) {
  return `
    <button class="menu-gomb${fo ? ' fo' : ''}" data-ugras="${cel}">
      <span class="menu-ikon">${ikon(ikonNev)}</span>
      <span class="menu-szoveg">
        <span class="menu-cim">${esc(cim)}</span>
        <span class="menu-leiras">${esc(leiras)}</span>
      </span>
      <span class="menu-nyil">${ikon('caret-right')}</span>
    </button>`;
}

function fomenu() {
  const tudod = tudodSzam();
  app.innerHTML = `
    <div class="menu">
      <div class="menu-fej">
        <span class="menu-jel">${ikon('fork-knife')}</span>
        <h1>Konyha</h1>
        <p class="alcim">Mit csinálunk ma?</p>
      </div>
      <nav class="menu-gombok" aria-label="Főmenü">
        ${menuGomb('#/itthon', 'cooking-pot', 'Mit főzzek?', tudod ? `${tudod} receptet meg tudsz főzni` : 'Pipáld be, mi van itthon', true)}
        ${menuGomb('#/tapanyag', 'chart-bar', 'Tápértékek', 'Fehérje, kalória, zsír')}
        ${menuGomb('#/kezi', 'note-pencil', 'Új recept', 'Saját recept, fényképpel')}
      </nav>
    </div>`;
}

// Camera + gallery buttons. "cel" says where the photo goes: kezi, import, or recept:<id>.
function kepValaszto(cel, kepUrl, elonezettel) {
  const kep = !elonezettel ? '' : kepUrl
    ? `<img class="nagykep" src="${kepUrl}" alt="">`
    : `<div class="kep-ures">${ikon('image')}<span>Még nincs fénykép</span></div>`;
  return `
    <div class="kep-valaszto">
      ${kep}
      <div class="kep-gombok">
        <label class="halk-gomb fajl-gomb">${ikon('camera')} Fotózás<input type="file" accept="image/*" capture="environment" data-kep="${esc(cel)}" hidden></label>
        <label class="halk-gomb fajl-gomb">${ikon('image')} Galériából<input type="file" accept="image/*" data-kep="${esc(cel)}" hidden></label>
      </div>
    </div>`;
}

function itthonOldal() {
  const tudod = tudodSzam();
  const csoportok = adat.kategoriak.map((kat) => {
    const csempek = adat.hozzavalok
      .filter((h) => h.kat === kat.id && !h.alap)
      .map((h) => `
        <button class="csempe" data-hozzavalo="${h.id}" aria-pressed="${itthon.has(h.id)}">
          <span class="ikon" aria-hidden="true">${h.ikon}</span>
          <span>${esc(h.nev)}</span>
          <span class="pipa" aria-hidden="true">${ikon('check')}</span>
        </button>`).join('');
    return `<h2>${esc(kat.nev)}</h2><div class="racs">${csempek}</div>`;
  }).join('');

  app.innerHTML = `
    ${vissza()}
    <h1>Mi van itthon?</h1>
    <p class="alcim">Koppints arra, ami van. Só, bors, olaj mindig van.</p>
    ${csoportok}
    ${itthon.size ? `<button class="halk-gomb veszely" data-torles>${ikon('x')} Minden pipa törlése</button>` : ''}
    <div class="also-sav">
      <button class="nagy-gomb" data-ugras="#/receptek">
        ${ikon('book-open-text')}
        <span class="gomb-szoveg">
          Receptek mutatása
          <small>${tudod ? `${tudod} receptet meg tudsz főzni` : 'Nézd meg, mihez mi kell még'}</small>
        </span>
      </button>
    </div>`;
}

function keziOldal() {
  const k = kezi;
  app.innerHTML = `
    ${vissza()}
    <h1>Új recept</h1>
    ${k.hiba ? `<p class="uzenet hiba-uzenet">${esc(k.hiba)}</p>` : ''}
    <h2>Fénykép</h2>
    ${kepValaszto('kezi', k.kepUrl, true)}
    <label class="cimke" for="k-nev">A recept neve</label>
    <input id="k-nev" class="mezo" data-kezi="nev" value="${esc(k.nev)}" autocomplete="off">
    <div class="ket-oszlop">
      <div>
        <label class="cimke" for="k-ido">Mennyi idő?</label>
        <input id="k-ido" class="mezo" data-kezi="ido" value="${esc(k.ido)}" placeholder="pl. 45 perc" autocomplete="off">
      </div>
      <div>
        <label class="cimke" for="k-adag">Hány adag?</label>
        <input id="k-adag" class="mezo" data-kezi="adag" value="${esc(k.adag)}" type="number" inputmode="numeric" min="1" max="30">
      </div>
    </div>
    <label class="cimke" for="k-hozz">Hozzávalók</label>
    <p class="tipp">Soronként egyet írj, például: 2 fej vöröshagyma</p>
    <textarea id="k-hozz" class="mezo szoveg-mezo" data-kezi="hozzavalok" rows="6">${esc(k.hozzavalok)}</textarea>
    <label class="cimke" for="k-lep">Elkészítés</label>
    <p class="tipp">Soronként egy lépést írj.</p>
    <textarea id="k-lep" class="mezo szoveg-mezo" data-kezi="lepesek" rows="6">${esc(k.lepesek)}</textarea>
    <button class="halk-gomb" data-ugras="#/uj">${ikon('link-simple')} Inkább linkből töltöm be</button>
    <div class="also-sav">
      <button class="nagy-gomb" data-kezi-tovabb>${ikon('arrow-right')}<span class="gomb-szoveg">Tovább</span></button>
    </div>`;
}

const sorokra = (s) => String(s).split(/\n+/).map((x) => x.trim()).filter(Boolean);

// Hand-written recipes go through the same check screen as imports, so ingredients get matched to buttons.
function keziTovabb() {
  const hozzavalok = sorokra(kezi.hozzavalok);
  if (!kezi.nev.trim() || !hozzavalok.length) {
    kezi.hiba = !kezi.nev.trim() ? 'Írd be a recept nevét.' : 'Írj be legalább egy hozzávalót.';
    keziOldal();
    window.scrollTo(0, 0);
    return;
  }
  kezi.hiba = '';
  const adagSzam = Math.max(1, parseInt(kezi.adag, 10) || 4);
  importalas = {
    allapot: 'elonezet',
    link: '',
    hiba: '',
    recept: {
      kezi: true,
      nev: kezi.nev.trim(),
      ido: kezi.ido.trim(),
      adag: `${adagSzam} adag`,
      forras: null,
      lepesek: sorokra(kezi.lepesek),
      hozzavalok: hozzavalok.map((szoveg) => ({ szoveg, id: illeszt(szoveg), opcionalis: OPCIONALIS.test(szoveg) || undefined })),
      kepBlob: kezi.kepBlob,
      kepUrl: kezi.kepUrl,
    },
  };
  location.hash = '#/uj';
}

function receptKep(r, osztaly) {
  if (kepUrlek[r.id]) return `<img class="${osztaly}" src="${kepUrlek[r.id]}" alt="">`;
  return r.ikon ? `<span class="ikon" aria-hidden="true">${r.ikon}</span>` : `<span class="ikon-hely">${ikon('fork-knife')}</span>`;
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
      <span class="nyil" aria-hidden="true">${ikon('caret-right')}</span>
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

  html += `<button class="halk-gomb" data-ugras="#/kezi">${ikon('plus')} Új recept hozzáadása</button>`;
  app.innerHTML = html;
}

function hozzavaloSor(h) {
  const info = h.id ? hozzavaloById[h.id] : null;
  let osztaly = '';
  let jel = '';
  if (info && !info.alap) {
    const van = itthon.has(h.id);
    osztaly = van ? 'van' : (h.opcionalis ? '' : 'nincs');
    jel = van ? ikon('check') : (h.opcionalis ? '' : ikon('x'));
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
  const fej = kepUrlek[r.id]
    ? `<img class="nagykep" src="${kepUrlek[r.id]}" alt=""><h1>${esc(r.nev)}</h1>${info ? `<p class="meta">${info}</p>` : ''}`
    : `<div class="recept-fej">${receptKep(r)}<div><h1>${esc(r.nev)}</h1>${info ? `<p class="meta">${info}</p>` : ''}</div></div>`;

  const forras = r.sajat && r.forras ? `
    <p class="forras">${ikon('link')}<span>${r.forditva ? 'Magyarra fordítva. Eredeti recept' : 'Forrás'}: <a href="${esc(r.forras)}" target="_blank" rel="noopener">${esc(new URL(r.forras).hostname.replace(/^www\./, ''))}</a></span></p>` : '';
  const lab = `
    <h2>${kepUrlek[r.id] ? 'Fénykép cseréje' : 'Fénykép hozzáadása'}</h2>
    ${kepValaszto(`recept:${r.id}`, null, false)}
    ${forras}
    ${r.sajat ? `<button class="halk-gomb veszely" data-recept-torles="${esc(r.id)}">${ikon('trash')} Recept törlése</button>` : ''}`;

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
    <option value="">Nem számít</option>${csoportok}</select>`;
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
        ${alap ? `<span class="megj">${esc(hozzavaloById[h.id].nev)}, mindig van itthon</span>` : hozzavaloValaszto(i, h.id)}
      </li>`;
    }).join('');
    const lepesek = recept.lepesek.map((l, i) => `
      <li><div class="lepes-elonezet"><span class="szam">${i + 1}</span><span>${esc(l)}</span></div></li>`).join('');
    html += `
      ${kepValaszto('import', recept.kepUrl, true)}
      <label class="cimke" for="recept-nev">A recept neve</label>
      <input id="recept-nev" class="mezo" value="${esc(recept.nev)}">
      ${info ? `<p class="meta">${info}</p>` : ''}
      ${recept.forditva ? '<p class="tipp">Magyarra fordítva. Az eredeti receptet a recept alján lévő linken találod.</p>' : ''}
      ${recept.forditasSikertelen ? '<p class="uzenet">A fordítás most nem sikerült, ezért eredeti nyelven látod. Később újra próbálhatod.</p>' : ''}
      <h2>Hozzávalók</h2>
      <p class="tipp">Ellenőrizd, melyik gombhoz tartozik. Ami „Nem számít”, az is látszani fog a receptben.</p>
      <ul class="hozzavalok">${sorok}</ul>
      <h2>Elkészítés</h2>
      ${recept.lepesek.length ? `<ol class="lepesek">${lepesek}</ol>` : '<p class="uzenet">Ennél a receptnél nem találtam lépéseket.</p>'}
      <div class="also-sav"><button class="nagy-gomb" data-mentes>${ikon('plus')}<span class="gomb-szoveg">Hozzáadom a receptekhez</span></button></div>`;
  } else {
    html += `
      ${allapot === 'hiba' ? `<p class="uzenet hiba-uzenet">${esc(hiba)}</p>` : ''}
      <label class="cimke" for="link">A recept linkje</label>
      <input id="link" class="mezo" type="url" inputmode="url" placeholder="https://…" value="${esc(link)}">
      <button class="nagy-gomb kozepen" data-betolt>${ikon('download-simple')}<span class="gomb-szoveg">Betöltés</span></button>
      <p class="tipp tipp-kozep">Tipp: a recept oldalán nyomd meg a <b>Megosztás</b> gombot, és válaszd a <b>Konyha</b> alkalmazást.</p>
      <p class="tipp tipp-kozep">Működik: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com.<br>A szerb és horvát recepteket magyarra fordítja.</p>
      <h2>Biztonsági mentés</h2>
      <p class="tipp">A hozzáadott receptek csak ezen a telefonon vannak. Néha érdemes elmenteni őket egy fájlba.</p>
      <button class="halk-gomb balra" data-export>${ikon('download-simple')} Saját receptek mentése (${sajatReceptek.length})</button>
      <label class="halk-gomb balra fajl-gomb">${ikon('upload-simple')} Mentés visszatöltése<input type="file" accept="application/json,.json" data-import hidden></label>`;
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
async function kicsinyit(adatUrl, maxMeret = 900) {
  const kep = new Image();
  kep.src = adatUrl;
  await kep.decode();
  const arany = Math.min(1, maxMeret / Math.max(kep.naturalWidth, kep.naturalHeight));
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
  if (r.kezi) { kezi = uresKezi(); keziMentve = true; }
  importalas = { allapot: 'ures', link: '', recept: null, hiba: '' };
  location.replace('#/recept/' + encodeURIComponent(uj.id));
}

// A photo from the camera or gallery, shrunk like imported photos, then put where "cel" says.
async function kepFeldolgoz(cel, fajl) {
  const ideiglenes = URL.createObjectURL(fajl);
  let blob;
  try {
    blob = await kicsinyit(ideiglenes);
  } catch (_) {
    alert('Ezt a képet nem sikerült megnyitni.');
    return;
  } finally {
    URL.revokeObjectURL(ideiglenes);
  }
  const y = window.scrollY;
  if (cel === 'kezi') {
    if (kezi.kepUrl) URL.revokeObjectURL(kezi.kepUrl);
    kezi.kepBlob = blob;
    kezi.kepUrl = URL.createObjectURL(blob);
  } else if (cel === 'import' && importalas.recept) {
    importalas.recept.kepBlob = blob;
    importalas.recept.kepUrl = URL.createObjectURL(blob);
  } else if (cel.startsWith('recept:')) {
    const r = osszesRecept().find((x) => x.id === cel.slice(7));
    if (!r) return;
    await receptKepMent(r, blob);
    rajzol();
    window.scrollTo(0, 0);
    return;
  }
  rajzol();
  window.scrollTo(0, y);
}

/* ---------- Backup to a file ---------- */

function blobbolAdat(blob) {
  return new Promise((ok) => { const o = new FileReader(); o.onload = () => ok(o.result); o.readAsDataURL(blob); });
}

async function exportal() {
  const receptek = await Promise.all(sajatReceptek.map(async (r) => ({ ...r, kep: r.kep ? await blobbolAdat(r.kep) : null })));
  // Photos she took of the built-in recipes.
  const kepek = await Promise.all((await Tar.kepek()).map(async (k) => ({ id: k.id, kep: await blobbolAdat(k.kep) })));
  const fajl = new Blob([JSON.stringify({ konyhaMentes: 1, receptek, kepek, sajatHozzavalok, felulirasok })], { type: 'application/json' });
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
    for (const k of mentett.kepek || []) {
      if (k.id && k.kep) await Tar.kepMent(k.id, await (await fetch(k.kep)).blob());
    }
    // Her own ingredients and corrected values: restored ones win, others on this phone are kept.
    if (Array.isArray(mentett.sajatHozzavalok)) {
      const ujak = mentett.sajatHozzavalok.filter((s) => s.id && s.nev && Array.isArray(s.ertek));
      sajatHozzavalok = [...sajatHozzavalok.filter((s) => !ujak.some((u) => u.id === s.id)), ...ujak];
    }
    if (mentett.felulirasok && typeof mentett.felulirasok === 'object') felulirasok = { ...felulirasok, ...mentett.felulirasok };
    sajatMent();
    adatFrissit();
    await sajatBetolt();
    alert(`${mentett.receptek.length} recept és ${(mentett.kepek || []).length} fénykép visszatöltve.`);
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

  if (ut === '#/itthon') itthonOldal();
  else if (ut === '#/receptek') receptLista();
  else if (ut.startsWith('#/recept/')) receptOldal(decodeURIComponent(ut.slice(9)));
  else if (ut.startsWith('#/uj')) ujRecept();
  else if (ut === '#/kezi' && keziMentve) { keziMentve = false; location.replace('#/'); return; }
  else if (ut === '#/kezi') keziOldal();
  else if (ut === '#/tapanyag') { hForm = null; tapanyagOldal(); }
  else if (ut === '#/hozzavalo/uj') hozzavaloOldal(null);
  else if (ut.startsWith('#/hozzavalo/')) hozzavaloOldal(decodeURIComponent(ut.slice(12)));
  else fomenu();

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
    itthonOldal();
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
      itthonOldal();
    }
  } else if ('keziTovabb' in gomb.dataset) {
    keziTovabb();
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
  } else if (gomb.dataset.rendez) {
    tapSzerint = gomb.dataset.rendez;
    tapanyagOldal();
    window.scrollTo(0, 0);
  } else if ('ujHozzavalo' in gomb.dataset) {
    hForm = null;
    location.hash = '#/hozzavalo/uj';
  } else if (gomb.dataset.hkat) {
    hForm.kat = gomb.dataset.hkat;
    rajzolMarad();
  } else if (gomb.dataset.hikon) {
    hForm.ikon = gomb.dataset.hikon;
    rajzolMarad();
  } else if ('becsles' in gomb.dataset) {
    becslesKeres();
  } else if ('hment' in gomb.dataset) {
    hozzavaloMentes();
  } else if ('visszaallit' in gomb.dataset) {
    delete felulirasok[hForm.kulcs];
    sajatMent();
    adatFrissit();
    const kulcs = hForm.kulcs;
    hForm = null;
    hFormInit(kulcs);
    rajzolMarad();
  } else if ('htorol' in gomb.dataset) {
    const kulcs = hForm.kulcs;
    if (confirm(`Biztosan törlöd ezt a hozzávalót?\n\n${hForm.nev}`)) {
      sajatHozzavalok = sajatHozzavalok.filter((s) => s.id !== kulcs);
      itthon.delete(kulcs);
      mentsItthon();
      sajatMent();
      adatFrissit();
      hForm = null;
      location.replace('#/tapanyag');
    }
  }
});

app.addEventListener('change', (e) => {
  if (e.target.matches('.valaszto') && importalas.recept) {
    importalas.recept.hozzavalok[+e.target.dataset.sor].id = e.target.value || null;
  } else if (e.target.matches('[data-import]') && e.target.files[0]) {
    importal(e.target.files[0]);
  } else if (e.target.matches('[data-kep]') && e.target.files[0]) {
    kepFeldolgoz(e.target.dataset.kep, e.target.files[0]);
  } else if (e.target.matches('[data-cimke]') && e.target.files[0]) {
    cimkeOlvasas(e.target.files[0]);
  }
});

app.addEventListener('input', (e) => {
  if (e.target.dataset.kezi) kezi[e.target.dataset.kezi] = e.target.value;
  else if ('hnev' in e.target.dataset && hForm) hForm.nev = e.target.value;
  else if (e.target.dataset.hertek && hForm) { hForm.ertek[+e.target.dataset.hertek] = e.target.value; hForm.forras = hForm.forras || 'kezi'; }
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
  adatFrissit();
  await sajatBetolt();
  if (link) betolt(link); else rajzol();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

indul();
