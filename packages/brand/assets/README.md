# Brand assets

Exported artwork for places that cannot render the React components in
[`../src/logo.tsx`](../src/logo.tsx): e-mail templates, app-store listings,
social profiles, print, slide decks.

Every file here is generated from the geometry in `logo.tsx` (the 48 × 48 grid,
one path with a 6-unit round stroke, two nodes of radius 6). Do not redraw the
mark by hand and do not edit these files directly: change the geometry in
`logo.tsx`, then regenerate. The full rules are in the
[brand book](../../../docs/brand/brand-book.md).

## Files

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

**To do:** export outlined-letter versions of the five lockups (plus white and
ink variants). It needs a font tool — a vector editor's "create outlines", or a
script with a font library — which was not available when these were generated.
Until then, use `mark.svg` with the name typed next to it in the destination's
own text, or export the lockup from a browser that has the font loaded.

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
