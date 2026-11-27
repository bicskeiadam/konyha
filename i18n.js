'use strict';

/* Language: Hungarian (the app's own text) or Serbian (Latin script).
   Screens are written in Hungarian; in Serbian mode every piece of text that appears on the page is
   swapped for its Serbian version as it is added (see forditDom at the bottom), so the screens
   themselves don't need to know about languages. Recipes come from data/receptek.sr.json,
   family recipes are translated once by the reader and kept on the phone. */

const NYELV_KULCS = 'konyha.nyelv';
const NYELV = (() => {
  const mentett = localStorage.getItem(NYELV_KULCS);
  if (mentett === 'hu' || mentett === 'sr') return mentett;
  return /^(sr|hr|bs)/i.test(navigator.language || '') ? 'sr' : 'hu';
})();
const LOCALE = NYELV === 'sr' ? 'sr-Latn-RS' : 'hu-HU';
document.documentElement.lang = NYELV === 'sr' ? 'sr-Latn' : 'hu';

// Serbian plural: 1 kašika, 2-4 kašike, 5+ kašika (21 kašika, 22 kašike…). Fractions take the 2-4 form.
function tobbes(n, egy, nehany, sok) {
  const x = Number(String(n).replace(',', '.'));
  if (!Number.isInteger(x)) return nehany;
  if (x % 10 === 1 && x % 100 !== 11) return egy;
  if (x % 10 >= 2 && x % 10 <= 4 && (x % 100 < 12 || x % 100 > 14)) return nehany;
  return sok;
}

// Unit words for an amount: [one, 2-4, 5+].
const SR_EGYSEG = {
  'evőkanál': ['kašika', 'kašike', 'kašika'],
  'teáskanál': ['kašičica', 'kašičice', 'kašičica'],
  fej: ['glavica', 'glavice', 'glavica'],
  gerezd: ['čen', 'čena', 'čenova'],
  db: ['kom', 'kom', 'kom'],
  szelet: ['kriška', 'kriške', 'kriški'],
  konzerv: ['konzerva', 'konzerve', 'konzervi'],
  kocka: ['kocka', 'kocke', 'kocki'],
  csomag: ['kesica', 'kesice', 'kesica'],
  liter: ['l', 'l', 'l'],
};

// Portion words: "4 porcije", "1 parče", "12 kom".
const SR_ADAG = {
  adag: ['porcija', 'porcije', 'porcija'],
  szelet: ['parče', 'parčeta', 'parčadi'],
  db: ['kom', 'kom', 'kom'],
};

// "1 adag" / "8 szelet" in the language of the screen.
function egysegSzo(egyseg, n = 1) {
  if (NYELV !== 'sr') return egyseg;
  const s = SR_ADAG[egyseg];
  return s ? tobbes(n, ...s) : egyseg;
}

// Amounts written in Hungarian ("2 evőkanál", "25 dkg", "ízlés szerint", "1 db, mell") → Serbian.
// Serbia weighs in grams, so dkg becomes g.
function mennySr(s) {
  if (NYELV !== 'sr' || !s) return s;
  if (SR_ADAT && SR_ADAT.menny[s]) return SR_ADAT.menny[s];
  return String(s)
    .replace(/ízlés szerint/gi, 'po ukusu')
    .replace(/(\d+(?:[.,]\d+)?)\s*dkg/g, (_, n) => `${String(Math.round(parseFloat(n.replace(',', '.')) * 100) / 10).replace('.', ',')} g`)
    .replace(/(\d+(?:[.,]\d+)?)\s*(evőkanál|teáskanál|fej|gerezd|db|szelet|konzerv|kocka|csomag|liter)\b/g,
      (_, n, e) => `${n} ${tobbes(n, ...SR_EGYSEG[e])}`)
    .replace(/\bkb\./g, 'oko')
    .replace(/\bfél\b/g, 'pola')
    .replace(/, mell\b/g, ', belo meso')
    .replace(/, comb\b/g, ', batak')
    .replace(/, egész\b/g, ', cela');
}

// "45 perc", "1,5 óra (+ kelesztés)" → "45 minuta", "1,5 sat (+ narastanje)".
function idoSr(s) {
  if (NYELV !== 'sr' || !s) return s;
  return String(s)
    .replace(/(\d+(?:,\d+)?)\s*óra/g, (_, n) => `${n} ${tobbes(n, 'sat', 'sata', 'sati')}`)
    .replace(/(\d+)\s*perc/g, (_, n) => `${n} ${n === '1' ? 'minut' : 'minuta'}`)
    .replace(/sata? (\d+) minut/g, (m) => m.replace(/ (\d+) minut/, ' i $1 minut'))
    .replace('éjszakai áztatás', 'potapanje preko noći')
    .replace('pácolás', 'mariniranje')
    .replace('kelesztés', 'narastanje')
    .replace(/\bkb\./g, 'oko');
}

// "4 adag", "8 szelet", "kb. 15 db (5 adag)" → "4 porcije", "8 parčadi", "oko 15 kom (5 porcija)".
function adagSr(s) {
  if (NYELV !== 'sr' || !s) return s;
  return String(s)
    .replace(/(\d+(?:,\d+)?)\s*(adag|szelet|db)\b/g, (_, n, e) => `${n} ${tobbes(n, ...SR_ADAG[e])}`)
    .replace(/\bkb\./g, 'oko');
}

// Serbian recipe and ingredient names (data/receptek.sr.json), loaded at start in Serbian mode.
let SR_ADAT = null;

// Puts the Serbian names, amounts and steps into the shipped data. Ids, grams and keywords stay,
// so matching, "what's missing" and nutrition work exactly as in Hungarian.
function adatSzerbre(adat, sr) {
  SR_ADAT = sr;
  for (const k of adat.kategoriak) if (sr.kategoriak[k.id]) k.nev = sr.kategoriak[k.id];
  for (const h of adat.hozzavalok) if (sr.hozzavalok[h.id]) h.nev = sr.hozzavalok[h.id];
  for (const [kulcs, v] of Object.entries(adat.tapanyagValtozatok || {})) if (sr.valtozatok[kulcs]) v.nev = sr.valtozatok[kulcs];
  for (const r of adat.receptek) {
    const x = sr.receptek[r.id];
    if (x) { r.nev = x.nev; if (x.lepesek.length === r.lepesek.length) r.lepesek = x.lepesek; }
    r.ido = idoSr(r.ido);
    r.adag = adagSr(r.adag);
    for (const h of r.hozzavalok) { h.mennyHu = h.menny; h.menny = mennySr(h.menny); }
  }
}

/* ---------- Screen text ---------- */

const SR = {
  'Egy pillanat…': 'Samo trenutak…',
  'Vissza': 'Nazad',
  'Keresés': 'Pretraga',
  'Recept keresése': 'Pretraga recepata',
  'Recept neve vagy hozzávaló': 'Naziv recepta ili sastojak',
  'Főmenü': 'Glavni meni',
  'Mai ötletek': 'Današnje ideje',
  'Másik ötlet': 'Druga ideja',
  'Pipáld be, mi van itthon, és itt mindig mutatok pár ötletet, mit főzhetnél ma.': 'Označi šta imaš kod kuće i ovde ću ti uvek pokazati par ideja šta da skuvaš danas.',
  'Abból, ami be van pipálva, most nincs ötletem. Nézd meg, mihez mi hiányzik.': 'Od onoga što je označeno sada nemam ideju. Pogledaj šta čemu nedostaje.',
  'Mit főzzek?': 'Šta da kuvam?',
  'Pipáld be, mi van itthon': 'Označi šta imaš kod kuće',
  'Családi receptek': 'Porodični recepti',
  'Linkből, képről vagy kézzel': 'Iz linka, sa slike ili ručno',
  'Édességek': 'Slatkiši',
  'Sütik, desszertek': 'Kolači, deserti',
  'Tápértékek': 'Nutritivne vrednosti',
  'Fehérje, kalória, zsír': 'Proteini, kalorije, masti',
  'Hogyan működik?': 'Kako funkcioniše?',
  'Család és beállítások': 'Porodica i podešavanja',
  'Kipróbálom': 'Probaj',
  'Koppints egy témára, és megmutatja, hogyan kell.': 'Dodirni temu i pokazaće ti kako se radi.',

  // Nutrition page and ingredient screen
  'Tápérték': 'Nutritivne vrednosti',
  'Fehérje': 'Proteini',
  'Kalória': 'Kalorije',
  'Szénhidrát': 'Ugljeni hidrati',
  'Zsír': 'Masti',
  'fehérje': 'proteini',
  'kalória': 'kalorije',
  'szénhidrát': 'ugljeni hidrati',
  'zsír': 'masti',
  'Elöl az, amiben a legtöbb van. Koppints egy hozzávalóra, ha pontosítanád.': 'Na vrhu je ono čega ima najviše. Dodirni sastojak ako želiš da ispraviš vrednosti.',
  'Elöl az, amiben a legkevesebb van. Koppints egy hozzávalóra, ha pontosítanád.': 'Na vrhu je ono čega ima najmanje. Dodirni sastojak ako želiš da ispraviš vrednosti.',
  'Új hozzávaló': 'Novi sastojak',
  'Vonalkód': 'Bar-kod',
  'Hozzávaló': 'Sastojak',
  '100 grammban': 'Na 100 grama',
  'nyersen': 'sirovo',
  'pontosítva': 'ispravljeno',
  'Olvasom a címkét…': 'Čitam etiketu…',
  'Keresem a szokásos értékeket…': 'Tražim uobičajene vrednosti…',
  'Keresem a terméket…': 'Tražim proizvod…',
  'Ezt a terméket még nem ismerem.': 'Ovaj proizvod još ne poznajem.',
  'Fotózd le a tápérték-táblázatot a csomagoláson, és megjegyzem ehhez a vonalkódhoz. Legközelebb már az egész család telefonja ismeri.': 'Fotografiši tabelu nutritivnih vrednosti na pakovanju i zapamtiću je uz ovaj bar-kod. Sledeći put će ga prepoznati telefoni cele porodice.',
  'Címke fotó': 'Fotografiši etiketu',
  'Vonalkód beolvasása': 'Skeniraj bar-kod',
  'Vagy írd be kézzel:': 'Ili upiši ručno:',
  'Neve': 'Naziv',
  'Melyik csoportba?': 'U koju grupu?',
  'Kép': 'Slika',
  'Tápérték 100 grammban': 'Nutritivna vrednost na 100 grama',
  'Fotózd le a csomagoláson a tápérték-táblázatot, és a számokat kiolvassa magától.': 'Fotografiši tabelu nutritivnih vrednosti na pakovanju i brojevi će se sami upisati.',
  'Galériából': 'Iz galerije',
  'Nincs címkéje (hentes, piac)': 'Nema etiketu (mesara, pijaca)',
  'Eredeti visszaállítása': 'Vrati originalne vrednosti',
  'Hozzávaló törlése': 'Obriši sastojak',
  'Mentés': 'Sačuvaj',
  'Ehhez internet kell.': 'Za ovo je potreban internet.',
  'Nem sikerült kiolvasni. Próbáld közelebbről, élesebben lefotózni a táblázatot.': 'Čitanje nije uspelo. Probaj da fotografišeš tabelu izbliza i oštrije.',
  'Most nem sikerült elérni a szolgáltatást. Próbáld újra kicsit később.': 'Usluga trenutno nije dostupna. Pokušaj ponovo malo kasnije.',
  'Előbb írd be a hozzávaló nevét.': 'Prvo upiši naziv sastojka.',
  'Erre most nem találtam értéket. Írd be a számokat kézzel.': 'Za ovo nema vrednosti. Upiši brojeve ručno.',
  'A számok nem egészen stimmelnek egymással. Nézd meg a címkén, és javítsd, ha kell.': 'Brojevi se baš ne slažu. Proveri na etiketi i ispravi ako treba.',
  'Ez a becslés bizonytalan, a számok nem stimmelnek egymással. Javítsd, ha tudod a pontos értéket.': 'Ova procena je nesigurna, brojevi se ne slažu. Ispravi ako znaš tačnu vrednost.',
  'Kiolvastam a címkéről. Nézd át, írd be a nevét, és mentsd el: a vonalkódhoz kötöm.': 'Etiketa je pročitana. Proveri, upiši naziv i sačuvaj: biće povezana s bar-kodom.',
  'Kiolvastam a címkéről. Nézd át, és mentsd el: a vonalkódhoz kötöm.': 'Etiketa je pročitana. Proveri i sačuvaj: biće povezana s bar-kodom.',
  'Kiolvastam a címkéről. Nézd át, és mentsd el.': 'Etiketa je pročitana. Proveri i sačuvaj.',
  'Ezek szokásos, becsült értékek. Nézd át, és mentsd el.': 'Ovo su uobičajene, procenjene vrednosti. Proveri i sačuvaj.',
  'Ez a telefon nem tud vonalkódot olvasni. Fotózd le inkább a tápérték-táblázatot.': 'Ovaj telefon ne može da čita bar-kodove. Radije fotografiši tabelu nutritivnih vrednosti.',
  'Tartsd a vonalkódot a keretbe': 'Drži bar-kod u okviru',
  'Mégse': 'Otkaži',
  'Nem sikerült elindítani a kamerát. Engedd meg a kamera használatát, vagy fotózd le a tápérték-táblázatot.': 'Kamera nije mogla da se pokrene. Dozvoli korišćenje kamere ili fotografiši tabelu nutritivnih vrednosti.',
  'Ez a termék már megvan, itt vannak az értékei.': 'Ovaj proizvod već postoji, evo njegovih vrednosti.',
  'Írd be a hozzávaló nevét.': 'Upiši naziv sastojka.',
  'Mind a négy számot töltsd ki.': 'Popuni sva četiri broja.',
  '100 grammban nem lehet több 100 grammnál. Nézd meg újra a számokat.': 'U 100 grama ne može biti više od 100 grama. Proveri brojeve ponovo.',

  // Family
  'A családi kód nem érvényes.': 'Porodični kod nije važeći.',
  'Most nem sikerült szinkronizálni. Ha lesz internet, magától újrapróbálja.': 'Sinhronizacija trenutno nije uspela. Kad bude interneta, pokušaće ponovo sama.',
  'Még nem adtál hozzá receptet.': 'Još nema tvojih recepata.',
  'Még nincs elmentett recept. Az Új recept gombbal adhatsz hozzá.': 'Još nema sačuvanih recepata. Dodaj ih dugmetom Novi recept.',
  'Új recept': 'Novi recept',
  'Mind': 'Svi',
  'Csak az enyém': 'Samo moji',
  'Ha összekötöd a család telefonjait, itt mindenki receptjei megjelennek. Lásd lent: Család és beállítások.': 'Ako povežeš telefone porodice, ovde će se pojaviti svačiji recepti. Pogledaj dole: Porodica i podešavanja.',
  'Képről': 'Sa slike',
  'Fotó egy szakácskönyvről, vagy képernyőkép': 'Fotografija kuvara ili snimak ekrana',
  'Linkből': 'Iz linka',
  'Receptoldal címe vagy megosztás': 'Adresa stranice s receptom ili deljenje',
  'Kézzel írom be': 'Upisujem ručno',
  'Hozzávalók a listából, mennyiséggel': 'Sastojci sa liste, s količinom',
  'Most nem sikerült kódot kérni. Próbáld újra kicsit később.': 'Kod trenutno nije mogao da se dobije. Pokušaj ponovo malo kasnije.',
  'Kód elküldése üzenetben': 'Pošalji kod porukom',
  'Kérj egy rövid kódot, és mondd meg vagy küldd el annak, akit meghívsz.': 'Zatraži kratak kod i reci ga ili pošalji osobi koju pozivaš.',
  'Kód készül…': 'Pravim kod…',
  'Meghívó kód': 'Kod za poziv',
  'Közös családi receptkönyv': 'Zajednička porodična knjiga recepata',
  'Ha összekötöd a család telefonjait, amit bárki hozzáad, mindenkinél megjelenik.': 'Ako povežeš telefone porodice, ono što bilo ko doda pojaviće se kod svih.',
  'Hogy hívnak?': 'Kako se zoveš?',
  'pl. Mama, Anna': 'npr. Mama, Ana',
  'Új család': 'Nova porodica',
  'Ha még senki nem indította el a család receptkönyvét, indítsd el te. Utána kapsz egy rövid kódot, amit megadsz a többieknek.': 'Ako niko još nije pokrenuo porodičnu knjigu recepata, pokreni je ti. Zatim dobijaš kratak kod koji daješ ostalima.',
  'Új családot indítok': 'Pokrećem novu porodicu',
  'Kaptál meghívó kódot?': 'Imaš kod za poziv?',
  'Kérj egy kódot attól, aki már bent van: neki a Család és beállítások oldalon van a Meghívó kód gomb.': 'Zatraži kod od nekoga ko je već unutra: na stranici Porodica i podešavanja ima dugme Kod za poziv.',
  'pl. K7M-4PX': 'npr. K7M-4PX',
  'Csatlakozom': 'Pridružujem se',
  'Még nem történt semmi.': 'Još se ništa nije desilo.',
  'Betöltöm…': 'Učitavam…',
  'A neved ezen a telefonon': 'Tvoje ime na ovom telefonu',
  'Név mentése': 'Sačuvaj ime',
  'Közös receptkönyv': 'Zajednička knjiga recepata',
  'Frissítés most': 'Osveži sada',
  'Családtag meghívása': 'Pozovi člana porodice',
  'Mi változott?': 'Šta je novo?',
  'Kilépés': 'Izlazak',
  'Ha kilépsz, a receptek ezen a telefonon maradnak, de nem frissülnek többé. Egy új meghívó kóddal bármikor visszaléphetsz.': 'Ako izađeš, recepti ostaju na ovom telefonu, ali se više ne osvežavaju. S novim kodom za poziv uvek možeš da se vratiš.',
  'Kilépés a családból': 'Izađi iz porodice',
  'Biztonsági mentés': 'Rezervna kopija',
  'Egy fájlba menti a recepteket, fényképeket és hozzávalókat. A közös receptkönyv mellett nem feltétlenül kell, de nem árt.': 'Čuva recepte, fotografije i sastojke u jedan fajl. Uz zajedničku knjigu recepata nije neophodno, ali ne škodi.',
  'Egy fájlba menti a recepteket, fényképeket és hozzávalókat, mert most csak ezen a telefonon vannak.': 'Čuva recepte, fotografije i sastojke u jedan fajl, jer su sada samo na ovom telefonu.',
  'Mentés fájlba': 'Sačuvaj u fajl',
  'Mentés visszatöltése': 'Vrati iz fajla',
  'Családi kód': 'Porodični kod',
  'Családi receptkönyv': 'Porodična knjiga recepata',
  'Meghívtak a közös családi receptkönyvbe. Amit bárki hozzáad, mindenkinél megjelenik.': 'Imaš poziv u zajedničku porodičnu knjigu recepata. Ono što bilo ko doda pojaviće se kod svih.',
  'Írd be a neved, hogy lássák, ki mit tett hozzá.': 'Upiši svoje ime da se vidi ko je šta dodao.',
  'Írd be a meghívó kódot.': 'Upiši kod za poziv.',
  'Ez a kód nem jó, vagy már lejárt. Nézd meg újra, vagy kérj új kódot.': 'Ovaj kod nije dobar ili je istekao. Proveri ga ponovo ili zatraži novi.',
  'Túl sok rossz kód. Várj egy órát, és próbáld újra.': 'Previše pogrešnih kodova. Sačekaj sat vremena i pokušaj ponovo.',
  'Ez a kód nem jó. Nézd meg újra, vagy kérj új meghívó kódot.': 'Ovaj kod nije dobar. Proveri ga ponovo ili zatraži novi kod za poziv.',
  'Nyelv': 'Jezik',

  // Photos, pickers
  'Még nincs fénykép': 'Još nema fotografije',
  'Fotózás': 'Fotografiši',
  'Gyümölcs': 'Voće',
  'Alapok': 'Osnovno',
  'Mi van itthon sütéshez?': 'Šta imaš kod kuće za kolače?',
  'Mi van itthon?': 'Šta imaš kod kuće?',
  'Koppints arra, ami van. Só, olaj, víz mindig van.': 'Dodirni ono što imaš. So, ulje i voda se podrazumevaju.',
  'Koppints arra, ami van. Só, bors, olaj mindig van.': 'Dodirni ono što imaš. So, biber i ulje se podrazumevaju.',
  'Pipák törlése ezen a listán': 'Obriši oznake na ovoj listi',
  'Édességek mutatása': 'Prikaži slatkiše',
  'Receptek mutatása': 'Prikaži recepte',
  'Nézd meg, mihez mi kell még': 'Pogledaj šta čemu još treba',

  // Units on the hand-written form
  'liter': 'litar',
  'evőkanál': 'kašika',
  'teáskanál': 'kašičica',
  'ízlés szerint': 'po ukusu',
  'db': 'kom',
  'fej': 'glavica',
  'gerezd': 'čen',
  'szelet': 'kriška',
  'konzerv': 'konzerva',
  'csomag': 'kesica',
  'Mell': 'Belo meso',
  'Comb': 'Batak',
  'Egész': 'Cela',

  // Hand-written recipe
  'szövegként': 'kao tekst',
  'A recept neve': 'Naziv recepta',
  'Mennyi idő?': 'Koliko traje?',
  'pl. 45 perc': 'npr. 45 minuta',
  'Hány szelet?': 'Koliko parčadi?',
  'Hány adag?': 'Koliko porcija?',
  'Milyen recept?': 'Kakav recept?',
  'Étel': 'Jelo',
  'Édesség': 'Slatkiš',
  'Hozzávalók': 'Sastojci',
  'Koppints egy hozzávalóra, ha a mennyiségét változtatnád.': 'Dodirni sastojak ako želiš da promeniš količinu.',
  'Még nincs hozzávaló.': 'Još nema sastojaka.',
  'Hozzávaló hozzáadása': 'Dodaj sastojak',
  'Elkészítés': 'Priprema',
  'Soronként egy lépést írj.': 'Piši po jedan korak u svakom redu.',
  'Inkább linkből töltöm be': 'Radije ću učitati iz linka',
  'Recept mentése': 'Sačuvaj recept',
  'Fénykép': 'Fotografija',
  'Melyik része?': 'Koji deo?',
  'Mennyi?': 'Koliko?',
  'Miben?': 'Mera',
  'Másikat választok': 'Biram drugi',
  'Hozzáadom': 'Dodaj',
  'Módosítom': 'Izmeni',
  'Nincs ilyen a listában. Lent beírhatod szövegként.': 'Toga nema na listi. Dole ga možeš upisati kao tekst.',
  'Nincs a listában?': 'Nema ga na listi?',
  'Írd be szövegként, például: 1 csomag sütőpor. Ez nem számít bele a tápértékbe.': 'Upiši kao tekst, na primer: 1 kesica praška za pecivo. To se ne računa u nutritivnu vrednost.',
  'Hozzávaló szövegként': 'Sastojak kao tekst',
  'Hozzáadom szövegként': 'Dodaj kao tekst',
  'Írd be, mennyi kell belőle.': 'Upiši koliko treba.',
  'Írd be a recept nevét.': 'Upiši naziv recepta.',
  'Adj hozzá legalább egy hozzávalót.': 'Dodaj bar jedan sastojak.',

  // Recipe lists and recipe page
  'Ezt meg tudod csinálni': 'Ovo možeš da napraviš',
  'Ezt meg tudod főzni': 'Ovo možeš da skuvaš',
  'Ebből még nem jön ki egy recept sem. Lent láthatod, mi hiányzik.': 'Od ovoga još ne izlazi nijedan recept. Dole vidiš šta nedostaje.',
  'Ehhez kell még 1-2 dolog': 'Za ovo treba još 1-2 stvari',
  'A többi recept': 'Ostali recepti',
  'Új recept hozzáadása': 'Dodaj novi recept',
  'nincs itthon': 'nemaš kod kuće',
  'ha van': 'ako imaš',
  'Az egész': 'Ukupno',
  'Fénykép cseréje': 'Zameni fotografiju',
  'Fénykép hozzáadása': 'Dodaj fotografiju',
  'Recept törlése': 'Obriši recept',
  'Forrás:': 'Izvor:',
  'Eredeti recept:': 'Originalni recept:',
  'Koppints a lépésre, ha megvagy vele.': 'Dodirni korak kad ga završiš.',
  'Fordítás…': 'Prevodim…',

  // Recipe from a photo
  'Recept képről': 'Recept sa slike',
  'Olvasom a receptet a képről…': 'Čitam recept sa slike…',
  'Ez 10-20 másodpercig is eltarthat.': 'Ovo može da potraje 10-20 sekundi.',
  'Fotózz le egy receptet egy szakácskönyvből, újságból vagy a füzetedből. Vagy válassz egy képernyőképet, például egy Instagram-leírást.': 'Fotografiši recept iz kuvara, novina ili svoje sveske. Ili izaberi snimak ekrana, na primer opis sa Instagrama.',
  'Az egész recept látszódjon a képen, élesen. Más nyelvű receptet magyarra fordít.': 'Ceo recept treba da se vidi na slici, oštro. Recept se čuva za celu porodicu i prikazuje se na tvom jeziku.',
  'Ezen a képen nem találtam receptet. Próbáld élesebb képpel, úgy, hogy az egész recept látszódjon.': 'Na ovoj slici nema recepta. Probaj s oštrijom slikom, tako da se vidi ceo recept.',

  // Recipe from a link
  'Erről az oldalról még nem tudok receptet betölteni.': 'Sa ove stranice još ne mogu da učitam recept.',
  'Ezen az oldalon nem találtam receptet. Biztos, hogy egy recept oldala?': 'Na ovoj stranici nema recepta. Da li je to sigurno stranica s receptom?',
  'Ez nem tűnik linknek. Másold be a recept oldalának címét.': 'Ovo ne liči na link. Nalepi adresu stranice s receptom.',
  'Most nem sikerült elérni az oldalt. Próbáld újra kicsit később.': 'Stranica trenutno nije dostupna. Pokušaj ponovo malo kasnije.',
  'Ehhez internet kell. Csatlakozz a wifire, és próbáld újra.': 'Za ovo je potreban internet. Poveži se na wifi i pokušaj ponovo.',
  'Melyik hozzávaló?': 'Koji sastojak?',
  'Nem számít': 'Ne računa se',
  'Betöltöm a receptet, és lefordítom…': 'Učitavam recept i prevodim ga…',
  'Ez fél percig is eltarthat, várj türelemmel.': 'Ovo može da potraje i pola minuta, sačekaj malo.',
  'Egy pillanat, betöltöm a receptet…': 'Samo trenutak, učitavam recept…',
  'Lefordítva. Az eredeti szöveget is elmentem, mindkét nyelven meglesz.': 'Prevedeno. Čuva se i originalni tekst, recept će postojati na oba jezika.',
  'A fordítás most nem sikerült, ezért eredeti nyelven látod. Mentés után magától lefordítja.': 'Prevod trenutno nije uspeo, pa vidiš original. Posle čuvanja biće preveden sam od sebe.',
  'Tápérték számolása…': 'Računam nutritivnu vrednost…',
  'Hány adag vagy szelet?': 'Koliko porcija ili parčadi?',
  'Ellenőrizd, melyik gombhoz tartozik. Ami „Nem számít”, az is látszani fog a receptben.': 'Proveri kom sastojku pripada. I ono što je „Ne računa se” videće se u receptu.',
  'Ennél a receptnél nem találtam lépéseket.': 'Za ovaj recept nisu pronađeni koraci.',
  'Hozzáadom a receptekhez': 'Dodaj u recepte',
  'A recept linkje': 'Link recepta',
  'Betöltés': 'Učitaj',
  'Tipp: a recept oldalán nyomd meg a': 'Savet: na stranici recepta pritisni',
  'Megosztás': 'Podeli',
  'gombot, és válaszd a': 'i izaberi aplikaciju',
  'alkalmazást.': '.',
  'Működik: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com.': 'Radi sa: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com.',
  'A szerb és horvát recepteket magyarra fordítja.': 'Recept se čuva za celu porodicu i prikazuje se na tvom jeziku.',

  // Dialogs
  'Ezt a képet nem sikerült megnyitni.': 'Ova slika nije mogla da se otvori.',
  'Ez nem egy Konyha mentés fájl.': 'Ovo nije Konyha fajl s rezervnom kopijom.',
  'Biztosan kilépsz a családi receptkönyvből? A receptek ezen a telefonon maradnak.': 'Sigurno želiš da izađeš iz porodične knjige recepata? Recepti ostaju na ovom telefonu.',
  'A meghívó a vágólapra került. Küldd el üzenetben.': 'Poziv je kopiran. Pošalji ga porukom.',
  'Biztosan törlöd a pipákat ezen a listán?': 'Sigurno želiš da obrišeš oznake na ovoj listi?',
  'Biztosan törlöd ezt a receptet?': 'Sigurno želiš da obrišeš ovaj recept?',
  'Biztosan törlöd ezt a hozzávalót?': 'Sigurno želiš da obrišeš ovaj sastojak?',
  'Most nem sikerült betölteni a recepteket. Csatlakozz egyszer wifire, utána internet nélkül is működik.': 'Recepti trenutno nisu mogli da se učitaju. Poveži se jednom na wifi, posle radi i bez interneta.',
  'Konyha meghívó': 'Konyha poziv',
};

const NAPLO_SR = {
  hozzáadta: { receptet: 'novi recept', fényképet: 'nova fotografija', hozzávalót: 'novi sastojak', tápértéket: 'nove nutritivne vrednosti' },
  módosította: { receptet: 'izmenjen recept', fényképet: 'nova fotografija', hozzávalót: 'izmenjen sastojak', tápértéket: 'izmenjene nutritivne vrednosti' },
  törölte: { receptet: 'obrisan recept', fényképet: 'obrisana fotografija', hozzávalót: 'obrisan sastojak', tápértéket: 'vraćene nutritivne vrednosti' },
};
const TAP_SR = { fehérje: 'proteina', zsír: 'masti', szénhidrát: 'ugljenih hidrata' };

// Text that has numbers or names in it: [pattern, Serbian].
const SR_MINTAK = [
  [/^(\d+) receptet meg tudsz főzni$/, (n) => `Možeš da skuvaš ${n} ${tobbes(n, 'recept', 'recepta', 'recepata')}`],
  [/^(\d+) édességet meg tudsz csinálni$/, (n) => `Možeš da napraviš ${n} ${tobbes(n, 'slatkiš', 'slatkiša', 'slatkiša')}`],
  [/^(\d+) elmentett recept$/, (n) => `${n} ${tobbes(n, 'sačuvan recept', 'sačuvana recepta', 'sačuvanih recepata')}`],
  [/^Család és beállítások \((.*)\)$/, (nev) => `Porodica i podešavanja (${nev})`],
  [/^Kell még: (.*)$/, (mi) => `Treba još: ${mi}`],
  [/^1 (adag|szelet|db): (\d+) kcal · (\d+) g fehérje$/, (e, k, f) => `1 ${egysegSzo(e)}: ${k} kcal · ${f} g proteina`],
  [/^1 (adag|szelet|db)$/, (e) => `1 ${egysegSzo(e)}`],
  [/^\((\d+) (adag|szelet|db)\)$/, (n, e) => `(${n} ${egysegSzo(e, n)})`],
  [/^Nincs ilyen recept: „(.*)”\.$/, (x) => `Nema takvog recepta: „${x}”.`],
  [/^Találatok \((\d+)\)$/, (n) => `Rezultati (${n})`],
  [/^A többi recept \((\d+)\)$/, (n) => `Ostali recepti (${n})`],
  [/^(?:(\d+) változás vár küldésre\. ?)?(?:Utoljára frissítve: (.+)\.|(Még nem volt frissítés\.))$/,
    (n, ido, soha) => `${n ? `${n} ${tobbes(n, 'izmena čeka', 'izmene čekaju', 'izmena čeka')} na slanje. ` : ''}${soha ? 'Još nije bilo osvežavanja.' : `Poslednje osvežavanje: ${ido}.`}`],
  [/^A másik telefonon: Konyha → Család és beállítások → írja be ezt a kódot\. (.+)-ig érvényes\.$/,
    (ido) => `Na drugom telefonu: Konyha → Porodica i podešavanja → upisati ovaj kod. Važi do ${ido}.`],
  [/^(hozzáadta|módosította|törölte) a (receptet|fényképet|hozzávalót|tápértéket): (.*)$/,
    (mit, tipus, cimke) => `· ${NAPLO_SR[mit][tipus]}: ${cimke}`],
  [/^([\d.,]+) g (fehérje|zsír|szénhidrát)$/, (n, mi) => `${n} g ${TAP_SR[mi]}`],
  [/^Eredeti becslés: (.+) kcal, (.+) g fehérje, (.+) g zsír, (.+) g szénhidrát\.$/,
    (k, f, z, s) => `Originalna procena: ${k} kcal, ${f} g proteina, ${z} g masti, ${s} g ugljenih hidrata.`],
  [/^Megtaláltam(?:: (.*))?\. Nézd át a számokat, válassz csoportot és képet, és mentsd el\.$/,
    (nev) => `Pronađeno${nev ? `: ${nev}` : ''}. Proveri brojeve, izaberi grupu i sliku, pa sačuvaj.`],
  [/^Vonalkód: (\d+)$/, (k) => `Bar-kod: ${k}`],
  [/^(.*), mindig van itthon$/, (nev) => `${nev}, uvek imaš kod kuće`],
  [/^(.*) törlése$/, (nev) => `Obriši: ${nev}`],
];

function tr(szoveg) {
  if (NYELV !== 'sr' || !szoveg) return szoveg;
  if (Object.prototype.hasOwnProperty.call(SR, szoveg)) return SR[szoveg];
  for (const [minta, fn] of SR_MINTAK) {
    const m = minta.exec(szoveg);
    if (m) return fn(...m.slice(1));
  }
  return szoveg;
}

/* ---------- Swapping the text on the page ---------- */

const FORDITOTT_JELLEMZOK = ['placeholder', 'aria-label', 'title', 'label'];

function szovegFordit(csomopont) {
  const eredeti = csomopont.data;
  const tiszta = eredeti.trim();
  if (!tiszta || !/[a-zA-ZÀ-ž]/.test(tiszta)) return;
  const uj = tr(tiszta);
  if (uj !== tiszta) csomopont.data = eredeti.replace(tiszta, uj);
}

function jellemzoFordit(elem) {
  for (const j of FORDITOTT_JELLEMZOK) {
    const v = elem.getAttribute(j);
    if (v) { const uj = tr(v.trim()); if (uj !== v.trim()) elem.setAttribute(j, uj); }
  }
}

// What she typed (form fields) is never touched.
const KIHAGY = new Set(['TEXTAREA', 'SCRIPT', 'STYLE']);

function forditDom(gyoker) {
  if (gyoker.nodeType === 3) { if (!KIHAGY.has(gyoker.parentNode?.nodeName)) szovegFordit(gyoker); return; }
  if (gyoker.nodeType !== 1 || KIHAGY.has(gyoker.nodeName)) return;
  jellemzoFordit(gyoker);
  const bejaro = document.createTreeWalker(gyoker, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && KIHAGY.has(n.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = bejaro.nextNode())) {
    if (n.nodeType === 3) szovegFordit(n); else jellemzoFordit(n);
  }
}

if (NYELV === 'sr') {
  forditDom(document.body);
  // Runs before the browser paints, so the Hungarian text is never seen.
  new MutationObserver((valtozasok) => {
    for (const v of valtozasok) for (const n of v.addedNodes) forditDom(n);
  }).observe(document.body, { childList: true, subtree: true });
}

/* ---------- Help page in Serbian (same order as SUGO in app.js) ---------- */

const SUGO_SR = [
  ['Šta da kuvam danas?', [
    'Na vrhu glavnog menija uvek su 3 ideje šta možeš danas da skuvaš od onoga što imaš kod kuće. Ceo dan ostaju iste, sutra dolaze nove. Ako ti se nijedna ne sviđa, dodirni <b>Druga ideja</b>.',
    'U glavnom meniju dodirni <b>Šta da kuvam?</b>.',
    'Označi šta imaš kod kuće. So, biber i ulje se podrazumevaju, njih ne treba označavati.',
    'Dodirni <b>Prikaži recepte</b>.',
    'Na vrhu je ono što sada možeš da skuvaš. Ispod je ono čemu nedostaje samo 1-2 stvari, i piše šta.',
    'Oznake ostaju zapamćene. Sledeći put promeni samo ono što je nestalo ili što si kupio/la.',
    'Ako tražiš određeni recept, na listi recepata dodirni gore <b>lupu</b> i upiši naziv ili neki sastojak.',
  ]],
  ['Kuvanje po receptu', [
    'Gore vidiš koliko kalorija i proteina ima jedna porcija i cela šerpa.',
    'Kod sastojaka vidiš šta imaš kod kuće, a šta nedostaje.',
    'Dodirni korak kad ga završiš: biće precrtan, pa se nećeš izgubiti.',
    'Dok je recept otvoren, ekran se ne gasi.',
    'Na dnu recepta možeš dodati i fotografiju: <b>Fotografiši</b> ili <b>Iz galerije</b>.',
  ]],
  ['Slatkiši', [
    'U glavnom meniju dodirni <b>Slatkiši</b>.',
    'Ovde označavaš samo ono što treba za kolače: brašno, šećer, jaja, kakao, voće.',
    'Dodirni <b>Prikaži slatkiše</b>.',
    'Kod kolača su nutritivne vrednosti za jedno parče ili jedan komad.',
  ]],
  ['Recept s interneta', [
    'Najlakše: otvori recept u pregledaču, dodirni <b>Podeli</b> i izaberi <b>Konyha</b>.',
    'Ili: <b>Porodični recepti</b> → <b>Novi recept</b> → <b>Iz linka</b>, pa nalepi adresu recepta.',
    'Konyha učitava sastojke, korake i sliku. Recept se čuva za celu porodicu i prikazuje se na tvom jeziku.',
    'Proveri, upiši broj porcija i dodirni <b>Dodaj u recepte</b>.',
    'Radi sa ovih stranica: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com.',
  ]],
  ['Recept sa slike ili snimka ekrana', [
    'Na Instagramu ili TikToku napravi snimak ekrana opisa recepta.',
    'Na snimku ekrana dodirni <b>Podeli</b> i izaberi <b>Konyha</b>.',
    'Ili: <b>Porodični recepti</b> → <b>Novi recept</b> → <b>Sa slike</b>. Možeš fotografisati i kuvar ili svesku.',
    'Čitanje traje oko 10 sekundi. Posle proveri i sačuvaj.',
    'Ako Konyha nije na listi za deljenje, koristi dugme <b>Sa slike</b>.',
  ]],
  ['Upisivanje svog recepta', [
    '<b>Porodični recepti</b> → <b>Novi recept</b> → <b>Upisujem ručno</b>.',
    'Upiši naziv, broj porcija i da li je jelo ili slatkiš.',
    'Sastojke biraš sa liste, s količinom (g, dl, kom, kašika). Tako se računaju i kalorije.',
    'Ono čega nema na listi možeš upisati kao običan tekst.',
    'Slobodno prekini usred upisivanja: ono što si upisao/la ostaje.',
  ]],
  ['Porodični recepti', [
    'Ovde su svačiji recepti, najnoviji na vrhu.',
    'Kod svakog recepta vidiš ko ga je dodao.',
    'Dugmetom <b>Samo moji</b> vidiš samo svoje recepte.',
    'Pretraga: dodirni gore <b>lupu</b> i upiši naziv recepta ili neki sastojak.',
  ]],
  ['Nutritivne vrednosti', [
    'Možeš ih poređati po proteinima, kalorijama, mastima ili ugljenim hidratima. Svi brojevi su za 100 grama, sirovo.',
    'Dodirni sastojak ako želiš da ispraviš brojeve.',
    'Novi sastojak: skeniraj <b>bar-kod</b> ili fotografiši tabelu nutritivnih vrednosti na pakovanju.',
    'Ako bar-kod još nije poznat, fotografiši tabelu. Sledeći put će ga prepoznati telefoni cele porodice.',
    'Ako nema pakovanja (mesara, pijaca), dodirni <b>Nema etiketu</b> i vrednosti će biti procenjene.',
  ]],
  ['Povezivanje porodice', [
    'Poziv: <b>Porodica i podešavanja</b> → <b>Kod za poziv</b>. Reci ili pošalji kod od 6 znakova. Važi jedan dan.',
    'Pridruživanje na drugom telefonu: <b>Porodica i podešavanja</b> → upiši ime i kod → <b>Pridružujem se</b>.',
    'Ako niko još nije pokrenuo porodicu, dodirni <b>Pokrećem novu porodicu</b>.',
    'Ono što bilo ko doda pojaviće se kod svih. U listi <b>Šta je novo?</b> vidiš ko je šta uradio.',
  ]],
  ['I bez interneta', [
    'Svi recepti su na telefonu i rade i bez wifija.',
    'Internet treba samo za učitavanje (link, slika, bar-kod), osvežavanje porodice i prvi prevod porodičnih recepata.',
    'Ono što dodaš bez interneta biće kasnije samo poslato porodici.',
    'Rezervna kopija: <b>Porodica i podešavanja</b> → <b>Sačuvaj u fajl</b>.',
  ]],
];
