# Konyha – Mit főzzek?

A simple offline recipe web app for Mom. Tap the ingredients you have at home, and it shows which recipes you can make.

- No build step: plain `index.html` + `style.css` + `app.js`.
- All data lives in `data/receptek.json`.
- `sw.js` stores everything on the phone. The app opens from the phone's storage and quietly updates itself in the background when there is internet.

## Run locally

```
python -m http.server 5180
```

Then open http://localhost:5180.

## Adding a recipe

Add an entry to `receptek` in `data/receptek.json`:

```json
{
  "id": "unique-id",
  "nev": "Recipe name",
  "ikon": "🍲",
  "ido": "30 perc",
  "adag": "4 adag",
  "hozzavalok": [
    { "id": "krumpli", "menny": "1 kg" },
    { "id": "kolbasz", "menny": "20 dkg", "opcionalis": true }
  ],
  "lepesek": ["First step.", "Second step."]
}
```

- `hozzavalok[].id` must match an entry in the `hozzavalok` list. If the ingredient is new, add it there too, with `nev`, `ikon` and `kat`.
- `"opcionalis": true` means it doesn't count as missing; it shows as "ha van".
- Ingredients with `"alap": true` (salt, pepper, oil, water) are always treated as being at home and don't show in the picker.

After a change, simply upload the files. Mom's phone picks up the new version the next time the app is opened with internet (on the second open at the latest).

## Importing a recipe from a link

On a recipe page, **Share → Konyha** (or "Mit főzzek?" → "+ Új recept hozzáadása" → paste the link). The app shows a preview with the photo; each ingredient line can be assigned to an ingredient button, then **Hozzáadom**.

- Imported recipes and their photos are stored **only on the phone** (IndexedDB), not in this repo. Back them up via "+ Új recept hozzáadása" → "Saját receptek mentése"; restore with "Mentés visszatöltése".
- The page is read by a Cloudflare Worker (`worker/`), since the browser cannot download other sites directly. It only accepts links from the sites in `ENGEDETT_OLDALAK` and only answers the app's origins (`ENGEDETT_ORIGINEK`).
- Ingredient matching uses the `kulcsok` keywords (Hungarian + Serbian, Latin or Cyrillic) in `data/receptek.json`; the longest keyword wins, `=` means whole word only, and lines containing a `tiltott` phrase never match.

Supported: Nosalty, Mindmegette, Street Kitchen, Sóbors, Receptneked, Coolinarika, Recepti.com, Stvar ukusa.

### Worker

```
cd worker
npx wrangler deploy        # deploy (after a one-time `npx wrangler login`)
node dev.mjs               # run locally on :8787 (the app on localhost uses it automatically)
```

New site: add its domain to `ENGEDETT_OLDALAK`, then deploy again. The worker's address is in `OLVASO_URL` at the top of `app.js`.

## Installing on the phone (Samsung / Chrome)

1. Open the site in Chrome.
2. Menu (⋮) → **Add to home screen** / **Install app**.
3. From then on it opens from the "Konyha" icon in full screen, and works without internet too.
4. "Konyha" also appears in Android's Share menu, but only after the app is installed this way.
