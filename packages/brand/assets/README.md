# Brand assets

Exported artwork for places that cannot render the React components in
[`../src/logo.tsx`](../src/logo.tsx): e-mail templates, app-store listings,
social profiles, print, slide decks.

Every file here is generated from the geometry in `logo.tsx` (the 48 × 48 grid,
one path with a 6-unit round stroke, two nodes of radius 6). Do not redraw the
mark by hand and do not edit these files directly: change the geometry in
`logo.tsx`, then regenerate. The full rules are in the
[brand book](../../../docs/brand/brand-book.md).

## Carreta artwork (`lockups/`, `app-icons/`)

The Carreta design ([SISTEMA.md §15](../../../docs/brand/system/SISTEMA.md))
draws new lockups, with the letters as outlines, and new app icons. They are
**copies**, byte for byte, of the files in
[`docs/brand/system/assets`](../../../docs/brand/system/assets), under English
names: `scripts/copy-assets.ts` makes them from the map in
`lib/asset-map.ts`, and `test/assets.test.ts` fails when a copy differs from
its source (sha256), is missing, is not in the map, or when a PNG is blank,
broken or the same as another. Never edit them here: redraw them with the
specification's generators (`docs/brand/system/src/logo.py`, `assets.py`,
`render.js`, `lockpng.py`), then copy again. No app uses them yet; step 1c of
the rebuild wires them in. The mark inside them is the unchanged mark of
`mark.svg`.

Words in the names: `shop` (yuntera), `seller` (vende), `driver` (ruta),
`warehouse` (bodega), `ops` (central); `brand` = achiote mark with noche
letters, `ink` = all noche, `white` = all white.

### Lockups

Each lockup comes as an SVG (letters in outlines, no font needed) and as PNGs
60 and 120 px high (`-60.png`, `-120.png`).

| File                                        | Where it is used                                                                | Clear space                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lockups/lockup-shop-brand.svg` + PNGs      | The shop and the company on white or arena: shop header, sign-in, e-mail header | SVG: drawn tight, keep a quarter of the mark's height free on every side. PNG: built in, 10 % of the height on every side. |
| `lockups/lockup-shop-ink.svg` + PNGs        | The shop in one colour: print, stamps, a fax or a receipt                       | As above                                                                                                                   |
| `lockups/lockup-shop-white.svg` + PNGs      | The shop on noche, achiote or a dark photograph                                 | As above                                                                                                                   |
| `lockups/lockup-seller-brand.svg` + PNGs    | Yuntera Vende on white or arena: sign-in, store listing artwork                 | As above                                                                                                                   |
| `lockups/lockup-seller-ink.svg` + PNGs      | Yuntera Vende in one colour                                                     | As above                                                                                                                   |
| `lockups/lockup-seller-white.svg` + PNGs    | Yuntera Vende on its cacao bar                                                  | As above                                                                                                                   |
| `lockups/lockup-driver-brand.svg` + PNGs    | Yuntera Ruta on white or arena                                                  | As above                                                                                                                   |
| `lockups/lockup-driver-ink.svg` + PNGs      | Yuntera Ruta in one colour                                                      | As above                                                                                                                   |
| `lockups/lockup-driver-white.svg` + PNGs    | Yuntera Ruta on its añil bar                                                    | As above                                                                                                                   |
| `lockups/lockup-warehouse-brand.svg` + PNGs | Yuntera Bodega on white or arena                                                | As above                                                                                                                   |
| `lockups/lockup-warehouse-ink.svg` + PNGs   | Yuntera Bodega on its white bar (with the 3 px ink rule)                        | As above                                                                                                                   |
| `lockups/lockup-warehouse-white.svg` + PNGs | Yuntera Bodega on a dark ground                                                 | As above                                                                                                                   |
| `lockups/lockup-ops-brand.svg` + PNGs       | Yuntera Central on white or arena                                               | As above                                                                                                                   |
| `lockups/lockup-ops-ink.svg` + PNGs         | Yuntera Central in one colour                                                   | As above                                                                                                                   |
| `lockups/lockup-ops-white.svg` + PNGs       | Yuntera Central on its noche side bar                                           | As above                                                                                                                   |

### App icons

`<app>` is `shop`, `seller`, `driver` or `warehouse` (the four phone apps);
the console has a browser icon only (`ops`).

| File                                                 | Where it is used                                                                                                                  | Clear space                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `app-icons/icon-<app>-1024.png` (RGB, no alpha)      | App Store; `apps/<app>-native/assets/icon.png`                                                                                    | Built in: the tile is the icon, nothing is added around it              |
| `app-icons/icon-<app>-512.png`                       | Google Play listing (store console, not in the repository)                                                                        | Built in                                                                |
| `app-icons/icon-<app>-180.png`                       | iPhone 60 pt @3x, for reference (Expo makes it from `icon.png`)                                                                   | Built in                                                                |
| `app-icons/icon-<app>-48.png`                        | Android mdpi and the favicon of the Expo web export: `apps/<app>-native/assets/favicon.png`                                       | Built in                                                                |
| `app-icons/icon-<app>-adaptive-foreground-432.png`   | Android adaptive icon foreground: `apps/<app>-native/assets/android-icon-foreground.png`                                          | Ring and mark at 68 %, the furthest pixel inside the 61.1 % safe circle |
| `app-icons/icon-<app>-adaptive-background-432.png`   | Shows the background only; the app configuration uses the app colour token instead                                                | Not placed                                                              |
| `app-icons/icon-<app>-monochrome-432.png`            | Android 13 themed icon: `apps/<app>-native/assets/android-icon-monochrome.png`                                                    | As the foreground, 68 %                                                 |
| `app-icons/icon-<app>-splash-1024.png`               | Splash image, the wheel on the page colour: `apps/<app>-native/assets/splash-icon.png`                                            | Built in; the splash background colour is `page`                        |
| `app-icons/icon-warehouse-splash-dark-1024.png`      | The warehouse splash in dark appearance (its ring is noche): `splash-icon-dark.png`                                               | As above, on `page` dark                                                |
| `app-icons/icon-ops-512.png`, `-180.png`, `-48.png`  | The console's browser icon in raster form                                                                                         | Built in                                                                |
| `app-icons/icon-<app>.svg`, `app-icons/icon-ops.svg` | Each web app's `public/icon.svg`: web ← `shop`, seller ← `seller`, field ← `driver`, ops ← `ops`; the warehouse one is its source | Built in: the tile is the icon                                          |

## Today's files

The files below are the artwork of before Carreta. They stay, unchanged, until
every app has moved (a test holds their sha256).

| File                   | What it is                                                               | Use it for                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `mark.svg`             | The mark in the brand colour, celeste 600 `#0b7f8e`                      | Light backgrounds. The default.                                                                            |
| `mark-ink.svg`         | The mark in ink, añil 900 `#161d33`                                      | One-colour printing, stamps, anywhere the brand colour is not available                                    |
| `mark-white.svg`       | The mark in white                                                        | On the brand colour, on ink, or on a dark photograph                                                       |
| `app-icon.svg`         | White mark at 70 % on a brand-colour square with rounded corners (11/48) | Favicon and browser tab (it is the same drawing as each app's `icon.svg`), home-screen icon, social avatar |
| `lockup-shop.svg`      | Mark + `yuntera`                                                         | The shop and the company                                                                                   |
| `lockup-seller.svg`    | Mark + `yuntera vende`                                                   | The seller centre                                                                                          |
| `lockup-driver.svg`    | Mark + `yuntera ruta`                                                    | The drivers' app                                                                                           |
| `lockup-warehouse.svg` | Mark + `yuntera bodega`                                                  | The warehouse app                                                                                          |
| `lockup-ops.svg`       | Mark + `yuntera central`                                                 | The internal console                                                                                       |

## The lockups use live text

The wordmark in the lockup files is real text set in **Bricolage Grotesque**
(weight 700; the descriptor at weight 500 and 62 % opacity), exactly as the
`YunteraLogo` component draws it. That keeps the files small and the letters
sharp, but it means:

- They look right **only where Bricolage Grotesque is installed or loaded**
  (it is free under the SIL Open Font License; the font files the apps use are
  in `packages/next-kit/fonts/`). Anywhere else the browser or viewer falls back
  to a system sans-serif and the lockup is wrong.
- **Do not send these files to a printer, an app store or a partner.** For
  those, the letters must be converted to outlines.

Outlined-letter lockups now exist in the Carreta lettering (Epilogue) under
`lockups/` above. Use those for printers, stores and partners.

The mark-only files and the app icon contain no text and are safe everywhere.

## Clear space

Keep an empty margin around the mark or lockup equal to **the diameter of one
of the mark's nodes: a quarter of the mark's height** (12 units on the 48-unit
grid). At a 48 px mark that is 12 px on every side. Nothing else enters that
margin: no text, no other logo, no edge of the page or screen.

The files are drawn tight to the artwork (no margin built in), so add the clear
space when placing them.

## Minimum sizes

| Artwork    | On screen                               | In print       |
| ---------- | --------------------------------------- | -------------- |
| Mark alone | 16 px high                              | 6 mm high      |
| App icon   | 16 px (favicon); 48 px and up for touch | 8 mm           |
| Lockup     | Mark 20 px high (wordmark about 17 px)  | Mark 8 mm high |

Below these the two nodes and the stroke start to merge. The apps use the
lockup with the mark at 26 px and 30 px.

## Colour

Only three colourings exist: brand colour, ink, white. Never tint the mark with
another palette colour, add a gradient, or give the two nodes different colours.
In a lockup the wordmark is ink on light backgrounds and white on dark ones;
the descriptor is always the same colour as the wordmark at 62 % opacity, never
its own colour.

## Regenerating

The values come straight from `logo.tsx` and `tokens.ts`:

```
path     M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42
stroke   6, round caps and joins
nodes    (12, 11) r 6 and (36, 11) r 6
lockup   gap 0.30 × mark height · wordmark size 0.86 × mark height
         tracking −0.03 em · descriptor 0.22 × mark height after the wordmark
```
