// Konyha recipe reader: GET /?url=<recipe page> → the recipe as JSON, with the photo inlined.
// Only reads from the recipe sites below, and only answers the app's own origins.

const ENGEDETT_OLDALAK = [
  'nosalty.hu',
  'mindmegette.hu',
  'streetkitchen.hu',
  'sobors.hu',
  'receptneked.hu',
  'coolinarika.com',
  'recepti.com',
  'stvarukusa.mondo.rs',
];

const ENGEDETT_ORIGINEK = [
  'https://bicskeiadam.github.io',
  'http://localhost:5180',
];

const BONGESZO = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36';
const MAX_KEP = 5 * 1024 * 1024;

export default {
  async fetch(keres) {
    const origin = keres.headers.get('origin') || '';
    const fejlec = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ENGEDETT_ORIGINEK.includes(origin) ? origin : ENGEDETT_ORIGINEK[0],
      'vary': 'origin',
    };
    const valasz = (adat, statusz = 200) => new Response(JSON.stringify(adat), { status: statusz, headers: fejlec });

    if (keres.method === 'OPTIONS') return new Response(null, { headers: fejlec });

    let cel;
    try {
      cel = new URL(new URL(keres.url).searchParams.get('url') || '');
    } catch {
      return valasz({ hiba: 'rossz-link' }, 400);
    }
    if (cel.protocol !== 'https:' && cel.protocol !== 'http:') return valasz({ hiba: 'rossz-link' }, 400);
    const host = cel.hostname.toLowerCase();
    if (!ENGEDETT_OLDALAK.some((d) => host === d || host.endsWith('.' + d))) {
      return valasz({ hiba: 'nem-tamogatott', oldal: host }, 400);
    }

    let html;
    try {
      const v = await fetch(cel.href, { headers: { 'user-agent': BONGESZO, 'accept-language': 'hu,sr;q=0.8,en;q=0.5' }, signal: AbortSignal.timeout(12000) });
      if (!v.ok) return valasz({ hiba: 'letoltes', statusz: v.status }, 502);
      html = await v.text();
    } catch {
      return valasz({ hiba: 'letoltes' }, 502);
    }

    const recept = jsonLdRecept(html, cel.href) || mikroadatRecept(html, cel.href);
    if (recept && host.endsWith('streetkitchen.hu')) streetKitchenKiegeszit(recept, html);
    if (!recept || !recept.hozzavalok.length) return valasz({ hiba: 'nem-talalhato' }, 422);

    recept.kep = recept.kepUrl ? await kepAdatkent(recept.kepUrl) : null;
    if (!recept.kep) {
      const megosztasiKep = kepCim((html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1], cel.href);
      if (megosztasiKep && megosztasiKep !== recept.kepUrl) recept.kep = await kepAdatkent(megosztasiKep);
    }
    delete recept.kepUrl;
    recept.forras = cel.href;
    return valasz(recept);
  },
};

/* ---------- schema.org JSON-LD ---------- */

function jsonLdRecept(html, alap) {
  const blokkok = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, nyers] of blokkok) {
    let adat;
    try {
      adat = JSON.parse(nyers.trim());
    } catch {
      // Some sites put raw newlines inside JSON strings; flatten them and retry.
      try { adat = JSON.parse(nyers.replace(/[\r\n\t]+/g, ' ').trim()); } catch { continue; }
    }
    const r = keresRecept(adat);
    if (r) return normalizal(r, alap);
  }
  return null;
}

function keresRecept(csomopont) {
  if (!csomopont || typeof csomopont !== 'object') return null;
  if (Array.isArray(csomopont)) {
    for (const elem of csomopont) { const r = keresRecept(elem); if (r) return r; }
    return null;
  }
  const tipus = [].concat(csomopont['@type'] || []);
  if (tipus.includes('Recipe')) return csomopont;
  return keresRecept(csomopont['@graph']) || keresRecept(csomopont.mainEntity);
}

function normalizal(r, alap) {
  return {
    nev: receptnev(r.name),
    kepUrl: kepCim(r.image, alap),
    hozzavalok: [].concat(r.recipeIngredient || r.ingredients || []).map(hozzavalo).filter(Boolean),
    lepesek: rovidLepesek(lepesekbol(r.recipeInstructions)),
    ido: idoszoveg(r.totalTime) || osszeadIdo(r.prepTime, r.cookTime),
    adag: adagszoveg(r.recipeYield),
  };
}

function kepCim(kep, alap) {
  if (!kep) return null;
  if (Array.isArray(kep)) return kepCim(kep[0], alap);
  const cim = typeof kep === 'string' ? kep : (kep.url || kep.contentUrl);
  try { return cim ? new URL(cim, alap).href : null; } catch { return null; }
}

// recipeInstructions can be a string, a list of strings, HowToSteps, or HowToSections of HowToSteps.
function lepesekbol(utasitas) {
  if (!utasitas) return [];
  if (typeof utasitas === 'string') return sorokra(utasitas);
  if (Array.isArray(utasitas)) return utasitas.flatMap(lepesekbol);
  if (utasitas.itemListElement) return lepesekbol(utasitas.itemListElement);
  if (utasitas.text) return sorokra(utasitas.text);
  if (utasitas.name) return sorokra(utasitas.name);
  return [];
}

/* ---------- microdata fallback (e.g. recepti.com) ---------- */

function mikroadatRecept(html, alap) {
  if (!/itemprop=["'](recipeIngredient|ingredients)["']/i.test(html)) return null;

  const elemek = (nev) => {
    const ki = [];
    const meta = new RegExp(`<meta[^>]*itemprop=["']${nev}["'][^>]*content=["']([^"']*)["']`, 'gi');
    for (const m of html.matchAll(meta)) ki.push(m[1]);
    const tag = new RegExp(`<(\\w+)[^>]*itemprop=["']${nev}["'][^>]*>([\\s\\S]*?)</\\1>`, 'gi');
    for (const m of html.matchAll(tag)) ki.push(m[2]);
    return ki;
  };
  const meta = (tul) => (html.match(new RegExp(`<meta[^>]*property=["']${tul}["'][^>]*content=["']([^"']*)["']`, 'i')) || [])[1];

  return {
    nev: receptnev(meta('og:title') || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]),
    kepUrl: kepCim(meta('og:image'), alap),
    hozzavalok: [...elemek('recipeIngredient'), ...elemek('ingredients')].flatMap(sorokra).map(hozzavalo).filter(Boolean),
    lepesek: rovidLepesek(elemek('recipeInstructions').flatMap(sorokra)),
    ido: idoszoveg((html.match(/itemprop=["']totalTime["'][^>]*content=["']([^"']+)["']/i) || [])[1]),
    adag: adagszoveg(tisztit(elemek('recipeYield')[0])),
  };
}

/* ---------- Street Kitchen: its JSON-LD has no ingredients or steps ---------- */

function streetKitchenKiegeszit(recept, html) {
  if (!recept.hozzavalok.length) {
    // <input type="checkbox" …/><div class="flex items-center gap-2"><div>500 g</div><div class="font-bold">sütőtök</div></div>
    const sorok = [...html.matchAll(/<input type="checkbox"[^>]*\/>\s*<div class="flex items-center gap-2">([\s\S]*?)<\/div>\s*<\/div>/g)]
      .map((m) => hozzavalo(m[1]))
      .filter(Boolean);
    recept.hozzavalok = [...new Set(sorok)]; // the page repeats the list (print + screen)
  }
  if (!recept.lepesek.length) {
    const cikk = (html.match(/<article class="recipe-article recipe-preparation[^"]*">([\s\S]*?)<\/article>/) || [])[1] || '';
    recept.lepesek = rovidLepesek([...cikk.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => tisztit(m[1])).filter(Boolean));
  }
}

/* ---------- text helpers ---------- */

const ENTITASOK = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', deg: '°', frac12: '½', frac14: '¼', frac34: '¾' };

function dekodol(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (egesz, k) => {
    if (k[0] === '#') {
      const kod = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(kod) ? String.fromCodePoint(kod) : egesz;
    }
    return ENTITASOK[k.toLowerCase()] ?? egesz;
  });
}

function tisztit(s) {
  if (s == null) return '';
  return dekodol(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Splits HTML or plain text into lines at block tags, <br> and newlines.
function sorokra(s) {
  return String(s)
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n')
    .split(/\n+/)
    .map(tisztit)
    .filter((sor) => sor.length > 1);
}

// Drops a trailing site name: "Palacsinta | Mindmegette.hu" → "Palacsinta".
function receptnev(s) {
  return tisztit(s)
    .replace(/\s+[|–—-]\s+[^|–—-]*\.(hu|rs|com|ba|hr)\s*$/i, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+recept$/i, '')
    .trim() || 'Recept';
}

// Nosalty writes "to taste" amounts as "0 ízlés szerint Só"; drop the zero.
function hozzavalo(s) {
  return tisztit(s).replace(/^0\s+/, '');
}

const MAX_LEPES = 260;

// Breaks over-long steps (some sites give the whole method as one paragraph) at sentence ends.
// "…felfut.A pizzalisztet…" counts as a sentence end too, since some sites drop the space.
function rovidLepesek(lepesek) {
  return lepesek.flatMap((lepes) => {
    if (lepes.length <= MAX_LEPES) return [lepes];
    const mondatok = lepes.replace(/([.!?:])\s*(?=\p{Lu})/gu, '$1\n').split('\n').map((m) => m.trim()).filter(Boolean);
    const darabok = [];
    for (const m of mondatok) {
      const utolso = darabok.length - 1;
      if (utolso >= 0 && darabok[utolso].length + m.length + 1 <= MAX_LEPES) darabok[utolso] += ' ' + m;
      else darabok.push(m);
    }
    return darabok;
  });
}

// ISO 8601 duration ("PT1H30M") → "1 óra 30 perc".
function idoszoveg(iso) {
  return percbol(percSzam(iso));
}

function osszeadIdo(a, b) {
  return percbol(percSzam(a) + percSzam(b));
}

function percSzam(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(String(iso || '').trim());
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function percbol(perc) {
  if (!perc) return '';
  const ora = Math.floor(perc / 60);
  const maradek = perc % 60;
  return [ora ? `${ora} óra` : '', maradek ? `${maradek} perc` : ''].filter(Boolean).join(' ');
}

function adagszoveg(y) {
  if (Array.isArray(y)) y = y.find((x) => /\D/.test(String(x))) || y[0];
  const s = tisztit(y);
  return /^\d+$/.test(s) ? `${s} adag` : s;
}

/* ---------- photo ---------- */

async function kepAdatkent(cim) {
  try {
    const v = await fetch(cim, { headers: { 'user-agent': BONGESZO }, signal: AbortSignal.timeout(10000) });
    const tipus = v.headers.get('content-type') || '';
    if (!v.ok || !tipus.startsWith('image/')) return null;
    const bajtok = new Uint8Array(await v.arrayBuffer());
    if (bajtok.length > MAX_KEP) return null;
    let bin = '';
    for (let i = 0; i < bajtok.length; i += 0x8000) bin += String.fromCharCode(...bajtok.subarray(i, i + 0x8000));
    return `data:${tipus.split(';')[0]};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}
