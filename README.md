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

## Installing on the phone (Samsung / Chrome)

1. Open the site in Chrome.
2. Menu (⋮) → **Add to home screen** / **Install app**.
3. From then on it opens from the "Konyha" icon in full screen, and works without internet too.
