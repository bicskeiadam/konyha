'use strict';

// Matches a free-text ingredient line ("2 fej vöröshagyma", "500 g pilećeg mesa", "2 главице лука")
// to one of the app's ingredient ids, using the "kulcsok" keywords in receptek.json.
(function (kulso) {
  const CIRILL = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj',
    м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
  };

  // Lowercase, Serbian Cyrillic → Latin, accents stripped (á→a, ő→o, š→s, ć→c), punctuation → spaces.
  function normal(s) {
    return ' ' + String(s).toLowerCase()
      .replace(/[Ѐ-ӿ]/g, (b) => CIRILL[b] ?? b)
      .replace(/đ/g, 'dj')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() + ' ';
  }

  function keszit(adat) {
    const kulcsok = [];
    for (const h of adat.hozzavalok) {
      for (const k of h.kulcsok || []) {
        const egesz = k.startsWith('=');
        kulcsok.push({ id: h.id, szo: normal(egesz ? k.slice(1) : k).trim(), egesz });
      }
    }
    const tiltott = (adat.tiltott || []).map((t) => normal(t).trim());

    // The longest matching keyword wins: "fokhagym" beats "hagyma", "pirospaprik" beats "paprika".
    return function illeszt(sor) {
      const n = normal(sor);
      if (tiltott.some((t) => n.includes(t))) return null;
      let legjobb = null;
      let hossz = 0;
      for (const k of kulcsok) {
        const talalt = k.egesz ? n.includes(' ' + k.szo + ' ') : n.includes(k.szo);
        if (talalt && k.szo.length > hossz) { legjobb = k.id; hossz = k.szo.length; }
      }
      return legjobb;
    };
  }

  kulso.Illeszto = { keszit, normal };
})(typeof window !== 'undefined' ? window : globalThis);
