'use strict';

const TAROLO_KULCS = 'konyha.itthon';
const app = document.getElementById('app');

let adat = null;
let hozzavaloById = {};
let itthon = new Set(JSON.parse(localStorage.getItem(TAROLO_KULCS) || '[]'));
let mutasdATobbit = false;
let ebrenTartas = null;
const gorgetesek = {};

function mentsItthon() {
  localStorage.setItem(TAROLO_KULCS, JSON.stringify([...itthon]));
}

function esc(szoveg) {
  return String(szoveg).replace(/[&<>"']/g, (k) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[k]));
}

function vanItthon(id) {
  const h = hozzavaloById[id];
  return Boolean(h && h.alap) || itthon.has(id);
}

// Only non-optional, non-staple ingredients count as "missing".
function hianyzik(recept) {
  return recept.hozzavalok
    .filter((h) => !h.opcionalis && !vanItthon(h.id))
    .map((h) => hozzavaloById[h.id].nev);
}

function rendezettReceptek() {
  return adat.receptek
    .map((r) => ({ r, hiany: hianyzik(r) }))
    .sort((a, b) => a.hiany.length - b.hiany.length || a.r.nev.localeCompare(b.r.nev, 'hu'));
}

/* ---------- Screens ---------- */

function kezdolap() {
  const tudod = rendezettReceptek().filter((x) => x.hiany.length === 0).length;
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

function receptKartya({ r, hiany }) {
  const hianySor = hiany.length ? `<span class="hiany">Kell még: ${esc(hiany.join(', '))}</span>` : '';
  return `
    <button class="recept-kartya" data-ugras="#/recept/${r.id}">
      <span class="ikon" aria-hidden="true">${r.ikon}</span>
      <span>
        <span class="nev">${esc(r.nev)}</span>
        <span class="info">${esc(r.ido)} · ${esc(r.adag)}</span>
        ${hianySor}
      </span>
      <span class="nyil" aria-hidden="true">›</span>
    </button>`;
}

function receptLista() {
  const mind = rendezettReceptek();
  const tudod = mind.filter((x) => x.hiany.length === 0);
  const majdnem = mind.filter((x) => x.hiany.length > 0 && x.hiany.length <= 2);
  const tobbi = mind.filter((x) => x.hiany.length > 2);

  let html = `
    <div class="fejlec"><button class="vissza" data-vissza><span>‹</span> Vissza</button></div>
    <h1>Mit főzzek?</h1>`;

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

  app.innerHTML = html;
}

function receptOldal(id) {
  const r = adat.receptek.find((x) => x.id === id);
  if (!r) { location.replace('#/receptek'); return; }

  const sorok = r.hozzavalok.map((h) => {
    const info = hozzavaloById[h.id];
    let osztaly = '';
    let jel = '';
    if (!info.alap) {
      const van = itthon.has(h.id);
      osztaly = van ? 'van' : (h.opcionalis ? '' : 'nincs');
      jel = van ? '✓' : (h.opcionalis ? '' : '✗');
    }
    const megj = h.opcionalis ? '<span class="megj">ha van</span>' : (osztaly === 'nincs' ? '<span class="megj">nincs itthon</span>' : '');
    return `
      <li class="${osztaly}">
        <span class="jel" aria-hidden="true">${jel}</span>
        <span>${esc(info.nev)}${megj}</span>
        <span class="menny">${esc(h.menny)}</span>
      </li>`;
  }).join('');

  const lepesek = r.lepesek.map((l, i) => `
    <li><button data-lepes aria-pressed="false">
      <span class="szam">${i + 1}</span><span>${esc(l)}</span>
    </button></li>`).join('');

  app.innerHTML = `
    <div class="fejlec"><button class="vissza" data-vissza><span>‹</span> Vissza</button></div>
    <div class="recept-fej">
      <span class="ikon" aria-hidden="true">${r.ikon}</span>
      <div>
        <h1>${esc(r.nev)}</h1>
        <p class="meta">${esc(r.ido)} · ${esc(r.adag)}</p>
      </div>
    </div>
    <h2>Hozzávalók</h2>
    <ul class="hozzavalok">${sorok}</ul>
    <h2>Elkészítés</h2>
    <p class="tipp">Koppints a lépésre, ha megvagy vele.</p>
    <ol class="lepesek">${lepesek}</ol>`;

  tartsdEbren();
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
  else kezdolap();

  const ujUtvonal = location.hash || '#/';
  window.scrollTo(0, ujUtvonal === aktualisUtvonal ? window.scrollY : (gorgetesek[ujUtvonal] || 0));
  aktualisUtvonal = ujUtvonal;
}

window.addEventListener('hashchange', rajzol);

app.addEventListener('click', (e) => {
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
  }
});

/* ---------- Start ---------- */

async function indul() {
  try {
    const valasz = await fetch('data/receptek.json');
    adat = await valasz.json();
  } catch (_) {
    app.innerHTML = '<p class="uzenet">Most nem sikerült betölteni a recepteket. Csatlakozz egyszer wifire, utána internet nélkül is működik.</p>';
    return;
  }
  hozzavaloById = Object.fromEntries(adat.hozzavalok.map((h) => [h.id, h]));
  rajzol();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

indul();
