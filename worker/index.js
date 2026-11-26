// Konyha recipe reader:
//   GET  /?url=<recipe page>   → the recipe as JSON, with the photo inlined
//   POST /cimke  {kep}         → nutrition per 100 g read from a photo of a package label
//   POST /becsles {nev}        → typical nutrition per 100 g for an unpackaged food
//   POST /szinkron, GET /kep, GET /naplo  → the shared family collection (header x-csalad: family code)
// Only reads from the recipe sites below, and only answers the app's own origins.

const ENGEDETT_OLDALAK = [
  'nosalty.hu',
  'mindmegette.hu',
  'streetkitchen.hu',
  'sobors.hu',
  'receptneked.hu',
  'coolinarika.com',
  'recepti.com',
  // stvarukusa.mondo.rs works from a laptop but refuses requests from Cloudflare (530).
];

const ENGEDETT_ORIGINEK = [
  'https://bicskeiadam.github.io',
  'http://localhost:5180',
];

// Recipes from these sites are translated to Hungarian when imported.
const FORDITANDO_OLDALAK = ['coolinarika.com', 'recepti.com'];
// Chosen after comparing models on real recipes: best Hungarian, ~30 s with thinking switched off.
const FORDITO_MODELL = '@cf/qwen/qwen3.8-27b';

const BONGESZO = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36';
const MAX_KEP = 5 * 1024 * 1024;

export default {
  async fetch(keres, env = {}) {
    const origin = keres.headers.get('origin') || '';
    const fejlec = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ENGEDETT_ORIGINEK.includes(origin) ? origin : ENGEDETT_ORIGINEK[0],
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-csalad',
      'vary': 'origin',
    };
    const valasz = (adat, statusz = 200) => new Response(JSON.stringify(adat), { status: statusz, headers: fejlec });

    if (keres.method === 'OPTIONS') return new Response(null, { headers: fejlec });

    const ut = new URL(keres.url).pathname;
    if (ut === '/csalad-uj' && keres.method === 'POST') {
      const kod = await ujCsalad(env.DB);
      return kod ? valasz({ kod }) : valasz({ hiba: 'tul-sok' }, 429);
    }
    if (ut === '/szinkron' || ut === '/kep' || ut === '/naplo') {
      const csalad = await csaladAzonosito(keres.headers.get('x-csalad'), env);
      if (!csalad) return valasz({ hiba: 'ismeretlen-csalad' }, 403);
      if (ut === '/szinkron' && keres.method === 'POST') {
        let test;
        try { test = await keres.json(); } catch { return valasz({ hiba: 'rossz-keres' }, 400); }
        return valasz(await szinkron(env.DB, csalad, test));
      }
      if (ut === '/kep') {
        const sor = await env.DB.prepare("SELECT adat FROM elemek WHERE csalad = ? AND tipus = 'kep' AND id = ? AND torolve = 0")
          .bind(csalad, new URL(keres.url).searchParams.get('id') || '').first();
        return sor ? valasz({ adat: JSON.parse(sor.adat) }) : valasz({ hiba: 'nincs' }, 404);
      }
      if (ut === '/naplo') {
        const { results } = await env.DB.prepare('SELECT ido, ki, mit, tipus, elem_id, cimke FROM naplo WHERE csalad = ? ORDER BY ido DESC LIMIT 60')
          .bind(csalad).all();
        return valasz({ naplo: results });
      }
    }

    if (keres.method === 'POST' && ut === '/kepbol') {
      if (!env.AI) return valasz({ hiba: 'nincs-ai' }, 500);
      let test;
      try { test = await keres.json(); } catch { return valasz({ hiba: 'rossz-keres' }, 400); }
      if (typeof test.kep !== 'string' || !test.kep.startsWith('data:image/') || test.kep.length > 6_000_000) {
        return valasz({ hiba: 'rossz-kep' }, 400);
      }
      const recept = await receptKeprol(env.AI, test.kep);
      return recept ? valasz(recept) : valasz({ hiba: 'nem-talalhato' }, 422);
    }

    if (keres.method === 'POST' && (ut === '/cimke' || ut === '/becsles')) {
      if (!env.AI) return valasz({ hiba: 'nincs-ai' }, 500);
      let test;
      try { test = await keres.json(); } catch { return valasz({ hiba: 'rossz-keres' }, 400); }
      if (ut === '/cimke') {
        if (typeof test.kep !== 'string' || !test.kep.startsWith('data:image/') || test.kep.length > 4_000_000) {
          return valasz({ hiba: 'rossz-kep' }, 400);
        }
        const ertek = await cimkeOlvas(env.AI, test.kep);
        return ertek ? valasz(ertek) : valasz({ hiba: 'nem-olvashato' }, 422);
      }
      const nev = String(test.nev || '').trim().slice(0, 80);
      if (!nev) return valasz({ hiba: 'rossz-keres' }, 400);
      const ertek = await becsles(env.AI, nev);
      return ertek ? valasz(ertek) : valasz({ hiba: 'nem-sikerult' }, 422);
    }

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

    const forditando = env.AI && FORDITANDO_OLDALAK.some((d) => host === d || host.endsWith('.' + d));
    const forditas = forditando
      ? forditMagyarra(env.AI, recept)
      : null;

    recept.kep = recept.kepUrl ? await kepAdatkent(recept.kepUrl) : null;
    if (!recept.kep) {
      const megosztasiKep = kepCim((html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1], cel.href);
      if (megosztasiKep && megosztasiKep !== recept.kepUrl) recept.kep = await kepAdatkent(megosztasiKep);
    }
    delete recept.kepUrl;
    recept.forras = cel.href;

    // The original lines are kept for ingredient matching (the Serbian keywords are reliable);
    // the translated ones are what Mom reads.
    if (forditas) {
      const magyar = await forditas;
      if (magyar) {
        recept.eredetiHozzavalok = recept.hozzavalok;
        recept.eredetiNev = recept.nev;
        Object.assign(recept, magyar, { forditva: true });
      } else {
        recept.forditasSikertelen = true;
      }
    }
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
    edes: EDES_MINTA.test([r.recipeCategory, r.keywords, r.name].flat().filter(Boolean).join(' ')),
  };
}

// Dessert by the site's own category/keywords (Hungarian, Serbian/Croatian, English).
const EDES_MINTA = /desszert|sütemény|süti|torta|édesség|keksz|pite|kolač|kolac|poslastic|slatk|dessert|cake|cookie|brownie|muffin/i;

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

/* ---------- translation (Cloudflare Workers AI) ---------- */

const FORDITASI_UTASITAS = `Szerb, horvát vagy bosnyák receptet fordítasz magyarra egy idős magyar háziasszonynak.
Szabályok:
- Természetes, egyszerű magyar konyhanyelv. A hozzávalóknál a szokásos magyar elnevezést használd (pavlaka és kisela pavlaka = tejföl, slatka pavlaka = tejszín, pohovani/pohovano = rántott, beli luk u prahu = fokhagymapor, mladi sir = túró, kačkavalj = sajt, aleva paprika = pirospaprika, pečurke = gomba, mirođija = kapor, prezle = zsemlemorzsa, ulje = olaj).
- Mértékegységek: kašika/žlica = evőkanál, kašičica/žličica = teáskanál, šolja = bögre, prstohvat = csipet, čen = gerezd, glavica = fej, kesica = csomag. A számokat és a g/ml/dl/kg értékeket változatlanul hagyd.
- "po ukusu" és "po želji" = "ízlés szerint", a sor elejére írva (pl. "ízlés szerint só").
- A lépéseket tegezve, kijelentő módban írd, ahogy egy szakácskönyv: "A hagymát apróra vágod, és üvegesre párolod."
- Vigyázz a hamis barátokra: višnja = meggy, trešnja = cseresznye, kupus = káposzta, kiseli kupus = savanyú káposzta, tikvica = cukkini, plavi patlidžan = padlizsán, boranija/mahune = zöldbab, kukuruz = kukorica, cimet = fahéj, kvasac = élesztő, prašak za pecivo = sütőpor, šlag = tejszínhab.
- Márkanevet (pl. Dolcela, Lino Lada) hagyd meg, de a mögötte álló köznevet fordítsd le magyarra (pl. "Dolcela Cimet rolice" = "Dolcela fahéjas csiga"). Angol szót ne használj.
- Pontosan ugyanannyi elem legyen minden listában, ugyanabban a sorrendben.
Csak a JSON-t add vissza, ugyanazokkal a kulcsokkal, amiket kaptál (pl. {"nev": "...", "hozzavalok": ["..."]} vagy {"lepesek": ["..."]}).`;

const LEPES_CSOMAG = 3;

// Translates in parallel pieces (name + ingredients, then the steps three at a time),
// so a long recipe takes about as long as one short piece. Any failed piece → keep the original.
async function forditMagyarra(ai, recept) {
  const darabok = [{ nev: recept.nev, hozzavalok: recept.hozzavalok }];
  for (let i = 0; i < recept.lepesek.length; i += LEPES_CSOMAG) {
    darabok.push({ lepesek: recept.lepesek.slice(i, i + LEPES_CSOMAG) });
  }
  try {
    const kesz = await Promise.all(darabok.map((d) => forditDarab(ai, d)));
    return {
      nev: tisztit(kesz[0].nev),
      hozzavalok: kesz[0].hozzavalok.map(tisztit),
      lepesek: kesz.slice(1).flatMap((d) => d.lepesek).map(tisztit),
    };
  } catch {
    return null;
  }
}

async function forditDarab(ai, darab) {
  const valasz = await Promise.race([
    ai.run(FORDITO_MODELL, {
      messages: [
        { role: 'system', content: FORDITASI_UTASITAS },
        { role: 'user', content: JSON.stringify(darab) },
      ],
      max_tokens: 2048,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
    }),
    new Promise((_, nem) => setTimeout(() => nem(new Error('idotullepes')), 50000)),
  ]);
  const szoveg = typeof valasz?.response === 'string'
    ? valasz.response
    : valasz?.response ? JSON.stringify(valasz.response) : (valasz?.choices?.[0]?.message?.content || '');
  const json = JSON.parse(szoveg.slice(szoveg.indexOf('{'), szoveg.lastIndexOf('}') + 1));
  for (const [kulcs, ertek] of Object.entries(darab)) {
    const jo = Array.isArray(ertek)
      ? Array.isArray(json[kulcs]) && json[kulcs].length === ertek.length && json[kulcs].every((x) => typeof x === 'string')
      : typeof json[kulcs] === 'string';
    if (!jo) throw new Error('rossz forma: ' + kulcs);
  }
  return json;
}

/* ---------- recipe from a screenshot or a photo of a page ---------- */

const RECEPT_KEP_UTASITAS = `You read a recipe from an image: an Instagram or TikTok screenshot with the recipe in the caption,
a photographed cookbook or magazine page, or handwritten notes. The text may be Hungarian, Serbian (Latin or Cyrillic),
Croatian or English. Write everything in natural, simple Hungarian, as a Hungarian cookbook would.
- Ingredients: one per line, keep the amounts and units ("2 db tojás", "30 g fehérjepor", "1 evőkanál méz").
  Convert: kašika/žlica = evőkanál, kašičica/žličica = teáskanál, šolja = bögre, scoop = adag (keep the grams if given).
  False friends: višnja = meggy, trešnja = cseresznye, pavlaka = tejföl, slatka pavlaka = tejszín.
- Steps: one action per line, addressing the reader informally ("Összekevered a tojást a fehérjeporral.").
- Ignore hashtags, emojis, "follow me", likes and comments.
- edes = true for cakes, desserts, sweet pastries, sweet snacks.
Answer with JSON only:
{"nev": "...", "adag": number or null, "ido": "e.g. 30 perc" or "", "edes": true/false, "hozzavalok": ["..."], "lepesek": ["..."]}
If there is no recipe in the image, answer {"hiba": "nincs-recept"}.`;

async function receptKeprol(ai, kep) {
  try {
    const valasz = await Promise.race([
      ai.run(CIMKE_MODELL, {
        messages: [
          { role: 'system', content: RECEPT_KEP_UTASITAS },
          { role: 'user', content: [
            { type: 'text', text: 'Read the recipe in this image.' },
            { type: 'image_url', image_url: { url: kep } },
          ] },
        ],
        max_tokens: 2500,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
      }),
      new Promise((_, nem) => setTimeout(() => nem(new Error('idotullepes')), 60000)),
    ]);
    const szoveg = aiSzoveg(valasz);
    const json = JSON.parse(szoveg.slice(szoveg.indexOf('{'), szoveg.lastIndexOf('}') + 1));
    if (json.hiba || !Array.isArray(json.hozzavalok) || !json.hozzavalok.length) return null;
    // The model sometimes leaves out the portion count; fall back to "16 darabra vágod" / "na 16 komada" in the steps.
    const lepesSzoveg = (json.lepesek || []).join(' ');
    const talalt = lepesSzoveg.match(/(\d{1,2})\s*(darab|szelet|adag|rész|komad|porcij|parč)/i);
    const adag = Number(json.adag) > 0 ? Math.round(Number(json.adag)) : (talalt ? +talalt[1] : null);
    const recept = {
      nev: tisztit(json.nev) || 'Recept',
      ido: tisztit(json.ido),
      adag: adag ? `${adag} adag` : '',
      adagSzam: adag,
      edes: Boolean(json.edes),
      hozzavalok: json.hozzavalok.map(tisztit).filter(Boolean),
      lepesek: rovidLepesek((json.lepesek || []).map(tisztit).filter(Boolean)),
    };
    return await helyesiras(ai, recept);
  } catch {
    return null;
  }
}

// The image model reads well but slips in Hungarian spelling without "thinking" ("lis" for liszt),
// which would also break ingredient matching. A quick pass with the text model fixes it.
// If the pass fails or changes the number of lines, the unpolished version is kept.
const HELYESIRAS_UTASITAS = `Javítsd ki a magyar helyesírást és a ragozást ebben a receptben. Ne változtass a tartalmon, a mennyiségeken
és a sorok számán. A lépések tegező, kijelentő módban legyenek ("Összekevered", "Hagyod kihűlni").
A nevet írd normál mondatkezdő nagybetűvel (ne csupa nagybetűvel). Csak a JSON-t add vissza ugyanazokkal a kulcsokkal.`;

async function helyesiras(ai, recept) {
  try {
    const bemenet = { nev: recept.nev, hozzavalok: recept.hozzavalok, lepesek: recept.lepesek };
    const valasz = await Promise.race([
      ai.run(FORDITO_MODELL, {
        messages: [{ role: 'system', content: HELYESIRAS_UTASITAS }, { role: 'user', content: JSON.stringify(bemenet) }],
        max_tokens: 2500,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }),
      new Promise((_, nem) => setTimeout(() => nem(new Error('idotullepes')), 25000)),
    ]);
    const szoveg = aiSzoveg(valasz);
    const j = JSON.parse(szoveg.slice(szoveg.indexOf('{'), szoveg.lastIndexOf('}') + 1));
    if (typeof j.nev !== 'string' || j.hozzavalok?.length !== recept.hozzavalok.length || j.lepesek?.length !== recept.lepesek.length) return recept;
    return { ...recept, nev: tisztit(j.nev), hozzavalok: j.hozzavalok.map(tisztit), lepesek: j.lepesek.map(tisztit) };
  } catch {
    return recept;
  }
}

/* ---------- shared family collection (Cloudflare D1) ---------- */

const TIPUSOK = new Set(['recept', 'hozzavalo', 'feluliras', 'kep']);
const MAX_VALTOZAS = 50;

// A family code is accepted if it is in the CSALAD_KODOK secret or was made with /csalad-uj.
// The database only ever sees a hash of the code, never the code itself.
async function kodHash(kod) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('konyha:' + kod));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function csaladAzonosito(kod, env) {
  kod = String(kod || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{8,40}$/.test(kod)) return null;
  const hash = await kodHash(kod);
  const kodok = String(env.CSALAD_KODOK || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (kodok.includes(kod)) return hash;
  const sor = await env.DB.prepare('SELECT 1 FROM csaladok WHERE csalad = ?').bind(hash).first();
  return sor ? hash : null;
}

// Letters and digits that cannot be mixed up when read aloud or typed (no 0/o, 1/l/i).
const KOD_BETUK = 'abcdefghjkmnpqrstuvwxyz23456789';
const MAX_UJ_CSALAD_ORANKENT = 30;

async function ujCsalad(db) {
  const egyOraja = Date.now() - 3600_000;
  const { db_n } = await db.prepare('SELECT COUNT(*) AS db_n FROM csaladok WHERE letrehozva > ?').bind(egyOraja).first();
  if (db_n >= MAX_UJ_CSALAD_ORANKENT) return null;
  const veletlen = crypto.getRandomValues(new Uint8Array(16));
  const betuk = [...veletlen].map((b) => KOD_BETUK[b % KOD_BETUK.length]).join('');
  const kod = betuk.match(/.{4}/g).join('-');
  await db.prepare('INSERT INTO csaladok (csalad, letrehozva) VALUES (?, ?)').bind(await kodHash(kod), Date.now()).run();
  return kod;
}

// One round trip: store this phone's changes (stamped with who and when, and logged),
// then return everything that changed since this phone last synced. Photos come back without
// their data; the app fetches each one from /kep when it needs it.
async function szinkron(db, csalad, test) {
  const ki = String(test.nev || '').trim().slice(0, 40) || 'Valaki';
  const valtozasok = Array.isArray(test.valtozasok) ? test.valtozasok.slice(0, MAX_VALTOZAS) : [];
  const most = Date.now();
  const utasitasok = [];

  for (const v of valtozasok) {
    if (!TIPUSOK.has(v.tipus) || typeof v.id !== 'string' || !v.id || v.id.length > 80) continue;
    const adat = v.torolve ? null : JSON.stringify(v.adat ?? null);
    if (adat && adat.length > 1_500_000) continue;
    const regi = await db.prepare('SELECT torolve FROM elemek WHERE csalad = ? AND tipus = ? AND id = ?').bind(csalad, v.tipus, v.id).first();
    utasitasok.push(db.prepare(`
      INSERT INTO elemek (csalad, tipus, id, adat, torolve, letrehozta, letrehozva, modositotta, modositva)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?7)
      ON CONFLICT (csalad, tipus, id) DO UPDATE SET
        adat = excluded.adat, torolve = excluded.torolve, modositotta = excluded.modositotta, modositva = excluded.modositva`)
      .bind(csalad, v.tipus, v.id, adat, v.torolve ? 1 : 0, ki, most));
    const mit = v.torolve ? 'torolte' : (regi && !regi.torolve ? 'modositotta' : 'hozzaadta');
    utasitasok.push(db.prepare('INSERT INTO naplo (csalad, ido, ki, mit, tipus, elem_id, cimke) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(csalad, most, ki, mit, v.tipus, v.id, String(v.cimke || '').slice(0, 120)));
  }
  if (utasitasok.length) await db.batch(utasitasok);

  // A small overlap (and >=) so a change written in the same millisecond as the last sync is never missed.
  const ota = Math.max(0, Number(test.ota) || 0) - 2000;
  const { results } = await db.prepare(`
    SELECT tipus, id, CASE WHEN tipus = 'kep' THEN NULL ELSE adat END AS adat, torolve,
           letrehozta, letrehozva, modositotta, modositva
    FROM elemek WHERE csalad = ? AND modositva >= ? ORDER BY modositva`).bind(csalad, ota).all();
  return {
    most,
    elemek: results.map((r) => ({ ...r, adat: r.adat ? JSON.parse(r.adat) : null, torolve: Boolean(r.torolve) })),
    tobb: valtozasok.length < (Array.isArray(test.valtozasok) ? test.valtozasok.length : 0),
  };
}

/* ---------- nutrition: package labels and estimates ---------- */

// Chosen after testing on real Serbian labels: 5/6 exact in ~2 s (Llama 4 Scout 4/6, Mistral Small 0/6).
const CIMKE_MODELL = '@cf/google/gemma-4-26b-a4b-it';
const BECSLO_MODELL = '@cf/google/gemma-4-26b-a4b-it';

const CIMKE_UTASITAS = `You read nutrition labels on food packages photographed in Serbia (Serbian Latin or Cyrillic, sometimes Croatian, Hungarian or English).
Find the values PER 100 g (or per 100 ml), not per serving:
- energy in kcal ("energetska vrednost", "energija", "енергетска вредност"); if only kJ is given, divide by 4.184
- protein ("proteini", "беланчевине", "bjelančevine")
- fat ("masti", "масти") - the total, not "of which saturated"
- carbohydrates ("ugljeni hidrati", "угљени хидрати") - the total, not "of which sugars"
Use a dot as the decimal separator. Answer with JSON only:
{"kcal": number, "feherje": number, "zsir": number, "szenhidrat": number}
If the label is not readable or not a nutrition table, answer {"hiba": "nem-olvashato"}.`;

const BECSLES_UTASITAS = `You give typical nutrition values per 100 g of a RAW, unpackaged food as sold in Serbia or Hungary (e.g. butcher's meat, market vegetables, eggs).
The name may be Hungarian or Serbian (Latin or Cyrillic). First identify the food and its common English name
(examples: pastrnjak = parsnip, cvekla = beetroot, paškanat = parsnip, mirođija = dill, junetina = beef, svinjski vrat = pork neck, csirkemáj = chicken liver).
Then use standard food composition data (USDA FoodData Central) for that raw item.
Answer with JSON only: {"angol": "English name", "mire": "the item in Hungarian", "kcal": number, "feherje": number, "zsir": number, "szenhidrat": number}`;

function aiSzoveg(valasz) {
  if (typeof valasz?.response === 'string') return valasz.response;
  if (valasz?.response) return JSON.stringify(valasz.response);
  return valasz?.choices?.[0]?.message?.content || '';
}

// Plausibility: grams can't exceed 100 per 100 g, and kcal should be close to 4·protein + 9·fat + 4·carbs.
function tapErtek(json) {
  const szam = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')));
  const e = { kcal: szam(json.kcal), feherje: szam(json.feherje), zsir: szam(json.zsir), szenhidrat: szam(json.szenhidrat) };
  if (Object.values(e).some((v) => !Number.isFinite(v) || v < 0)) return null;
  if (e.feherje + e.zsir + e.szenhidrat > 101 || e.kcal > 950) return null;
  const szamolt = 4 * e.feherje + 9 * e.zsir + 4 * e.szenhidrat;
  e.ellenorizd = Math.abs(szamolt - e.kcal) > Math.max(25, e.kcal * 0.2);
  for (const k of ['kcal', 'feherje', 'zsir', 'szenhidrat']) e[k] = Math.round(e[k] * 10) / 10;
  return e;
}

async function aiJson(ai, modell, uzenetek, ido = 45000) {
  const valasz = await Promise.race([
    ai.run(modell, { messages: uzenetek, max_tokens: 400, temperature: 0, chat_template_kwargs: { enable_thinking: false } }),
    new Promise((_, nem) => setTimeout(() => nem(new Error('idotullepes')), ido)),
  ]);
  const szoveg = aiSzoveg(valasz);
  return JSON.parse(szoveg.slice(szoveg.indexOf('{'), szoveg.lastIndexOf('}') + 1));
}

async function cimkeOlvas(ai, kep) {
  try {
    const json = await aiJson(ai, CIMKE_MODELL, [
      { role: 'system', content: CIMKE_UTASITAS },
      { role: 'user', content: [
        { type: 'text', text: 'Read the per 100 g nutrition values from this label.' },
        { type: 'image_url', image_url: { url: kep } },
      ] },
    ]);
    return json.hiba ? null : tapErtek(json);
  } catch {
    return null;
  }
}

// The same question gives different numbers from run to run (kohlrabi once 27 kcal, once 49),
// so ask three times in parallel, take the median of each value, and flag it when the answers disagree.
async function becsles(ai, nev) {
  const egy = async () => {
    try {
      const json = await aiJson(ai, BECSLO_MODELL, [
        { role: 'system', content: BECSLES_UTASITAS },
        { role: 'user', content: nev },
      ]);
      return tapErtek(json);
    } catch {
      return null;
    }
  };
  const valaszok = (await Promise.all([egy(), egy(), egy()])).filter(Boolean);
  if (!valaszok.length) return null;
  const kozep = (tomb) => { const s = [...tomb].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const e = {};
  let szetszort = false;
  for (const k of ['kcal', 'feherje', 'zsir', 'szenhidrat']) {
    const ertekek = valaszok.map((v) => v[k]);
    e[k] = kozep(ertekek);
    if (Math.max(...ertekek) - Math.min(...ertekek) > Math.max(k === 'kcal' ? 15 : 2, e[k] * 0.25)) szetszort = true;
  }
  const ellenorzott = tapErtek(e);
  if (!ellenorzott) return null;
  ellenorzott.ellenorizd = ellenorzott.ellenorizd || szetszort || valaszok.length < 2;
  return ellenorzott;
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
