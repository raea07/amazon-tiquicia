# Carreta: the design system for all eight Yuntera apps

Date: 27 November 2026 (third pass, after three independent checks: a judge, a measurement run and a builder's dry run against the repository at main `d6b637e`). Owner of this document: the design lead. Readers: the
builders who rebuild `apps/web`, `apps/seller`, `apps/ops`, `apps/field` and
the four phone apps, and the agents who check them. Written in English; every
word on screen is Spanish (usted).

Decided and not reopened: direction B "Carreta" with font variant F2, and the full achiote strip (version 1, the owner's answer 5A of 27 November 2026). Titles,
prices and the delivery code in **Epilogue 600–800**; all other text in **Fira
Sans 400–700**. This file turns the drawings into rules a builder can apply
without asking. Every rule is written so it can be checked: by reading the
code, by a test, or by measuring a screenshot.

Labels: **[M]** measured in this folder (script named), **[E]** estimated (the
reason is given), **[P]** a project fact from the repository or its rules.

---

## 0. What is in this folder and how to rebuild it

| Path | What it is |
|---|---|
| `SISTEMA.md` | This specification. Its token tables (TOKENS markers), migration tables (MIGRATION) and status words (ESTADOS) are generated. |
| `carreta.css` | The one stylesheet of every reference page. Generated; do not edit by hand. |
| `tokens.json` | Every token value, light and dark, for `packages/brand` and `packages/expo-kit`. |
| `migration.json` | §2.5 and §4.3 as data: today's names → Carreta names, the ratchet patterns, every status value with its sign and words. The step-1 owners port it to code. |
| `src/tokens.py` | The single source of every token and every contrast pair. |
| `src/migration.py` | The single source of §2.5 and of the status words of §4.3. |
| `src/css/1-base.css … 5-apps.css` | Base, components, shop, work tools, phone apps. |
| `src/common.py`, `shop.py`, `tools.py`, `apps.py`, `misc.py` | Page generators (Python 3, standard library). `common.page()` passes every page through `keep_together()` (§3 rule 8). |
| `src/fonts.py` | **Builds every font file from pinned open-licence sources** (§2.4): checksums, tabular figures by default, U+202F, names, subset, `.ttf` + `.woff2`, `fonts/manifest.json`, `fonts/glyph-check.txt`. Reproducible (same bytes twice, measured). |
| `src/logo.py` | Wordmark and lockups with the text in outlines (fontTools, from the F2 files in `fonts/f2/`). |
| `src/assets.py` | Wheel, the five app icons (four phone apps + the console's browser icon), product placeholders. |
| `src/render.js` | PNG app icons (1024, 512, 180, 48; Android adaptive front and back, themed one-colour, splash) and raw lockup PNGs (Playwright, SVG as a `data:` URL). |
| `src/lockpng.py` | Crops each lockup PNG to its ink and pads it evenly (10 % of the height on every side). |
| `src/checkpng.py` | Fails on any blank, duplicate or broken-image PNG; flattens the 1024 icons to RGB; writes `assets/png-check.txt`. |
| `src/spacing.py` | Fails on any margin, padding or gap off the spacing scale. |
| `src/shots.js`, `src/audit.js`, `src/franja.py` | Screenshots, measurements (§17), the strip comparison. |
| `index.html` | List of the 46 reference pages with their template and widths. |
| `shots/` | Screenshots at deviceScaleFactor 2, `shots.json`, `audit.json`. |
| `franja/` | The two strip versions side by side. History: the owner chose version 1 (5A). |
| `fonts/` | `web/*.woff2` (4 web apps), `ttf/*.ttf` (4 phone apps), `OFL-*.txt` (upstream licences), `MODIFICATIONS.txt`, `manifest.json`, `glyph-check.txt`; `f2/` = the first-pass files, kept only as the outline source of `logo.py`. |
| `assets/logo/`, `assets/app-icons/` | 15 outlined lockups (SVG + PNG at 60 and 120 px high, even clear space), app icons (§15). |
| `origen-F2/`, `src/origen-B/` | Copies of the starting point, for reference only. |

Rebuild, from this folder (`docs/brand/system/`, called `carreta-final/` while it was drawn):

```bash
python3 -I src/fonts.py      # all font files from npm @expo-google-fonts/{epilogue@0.4.2,fira-sans@0.4.1}, checked by sha512 + sha256
python3 -I src/assets.py     # wheel, icons, placeholders
python3 -I src/logo.py       # outlined lockups
node src/render.js           # PNGs of icons and raw lockups
python3 -I src/lockpng.py    # even clear space around the lockup PNGs
python3 -I src/checkpng.py   # fails on a blank, duplicate or broken PNG
python3 -I src/migration.py  # migration.json
python3 -I src/build.py      # carreta.css, tokens.json, SISTEMA.md tables, all pages
python3 -I src/spacing.py    # fails on spacing off the scale
node src/shots.js            # screenshots
node src/audit.js            # measurements -> shots/audit.json (about 30 minutes; FAST=1 skips the ring pixels)
python3 -I src/franja.py     # the strip comparison (history)
```

`node` resolves Playwright from `/opt/node-tools/node_modules/playwright`. `src/fonts.py` takes `OFFLINE=<folder>` with the two `.tgz` files when there is no network.

## 1. The system in eight sentences

1. Yuntera carries things to people's gates with its own people, so the painted
   oxcart wheel means one thing only: **"Yuntera lo lleva"**, our own delivery,
   when it arrives and where it is now.
2. **Achiote** (`--yt-brand`) does that one job (strip, arrival date, code block,
   wheel, "Entregado por Yuntera") plus the mark and the shop app icon; buttons
   and selection are **noche**, links and focus are **añil**.
3. Titles, prices and the delivery code are **Epilogue**, wide and heavy; everything
   people read or press is **Fira Sans**.
4. Sellers are **people with a trade**: monogram or logo, name, their own line,
   never just a store id.
5. Every sequence (checkout steps, order tracking, the driver's stops) is drawn
   as **one route line with stations** (from direction C); the wheel rides that
   line only where the sequence *is* the delivery, as the station where the
   parcel or the driver is now.
6. The shopper's order page and every work-tool detail page use **A's
   structure**: title and status, one notice, the main fact block, the line,
   packages, money, history as sentences; actions on the side; the destructive
   one last, apart, naming its target.
7. Surfaces are a white page, rules and solid arena bands: **no resting shadow,
   no card on a card, no pills, no pastel tints**; radius by role.
8. Status is **shape + word** with five signs the same in every app (○ ◐ ✓ ! –).

---

## 2. Tokens

### 2.1 How the tokens map onto the code

| Here | `packages/brand/src/tokens.ts` | Web stylesheet (`tokens.css`, Tailwind `@theme`) | `packages/expo-kit/src/theme/tokens.ts` |
|---|---|---|---|
| Palette (`--yt-noche` …) | `palette.noche` … (flat, no ramps; a new export: today's `color` ramps stay in `legacy.ts` until step 6, §2.5) | `--yt-noche` … (never exposed as Tailwind colours) | `theme.palette.noche` … |
| Semantic light (`--yt-ink` …) | `light.ink` … (camelCase of the CSS name; today's `semantic` stays as legacy) | `--yt-ink` …; Tailwind names through `@theme inline`: `bg-page`, `text-ink`, `border-edge` … | `theme.colors.ink` … via `useTheme()` |
| Semantic dark | `dark.ink` … | `:root[data-theme="dark"]` block, outside `@theme` (the web stays light) | `themeDark.colors.ink` …, chosen by `ThemeProvider` from `useColorScheme()` |
| Focus ring | `light.focus` and the rule in §2.3 | `--yt-ring` (contextual), rules in `carreta-base.css` | `focusRing` prop on pressables: `colors.focus`, on bands `colors.onApp` / `onBrand` |
| Type steps | `type.display` … `{face, weight, phone:{size,line}, desktop:{size,line}, tracking}` | classes `.t-display` … `.t-fine` | `Text` variants named after the steps (phone sizes); today's variant names map as in §2.5.4 |
| Spacing | `spacing = {none:0, hair:4, tight:8, snug:12, base:16, loose:24, wide:32, section:48, page:64}` (named; today's numeric `space` stays as a legacy export until step 6, §2.5.4) | `--yt-space-0` … `-8` | `spacing` (the same named object) |
| Radius | `radii.control/tag/overlay/photo/round` (today's `radius` sm…full stays as legacy) | `--yt-radius-*` | `theme.radii.*` |
| Elevation | `elevation.rest/overlay` (sticky bars use a top border, no token) | `--yt-elevation-*` | `elevation.overlay` (iOS shadow + Android elevation 8) |
| Motion | `motion.fast/panel/none` | `--yt-motion-*` | `motion.*` with `AccessibilityInfo.isReduceMotionEnabled` |
| Targets | `target = {web:44, app:48, driverAction:56, driverPrimary:64}` | `--yt-target`, `--yt-target-app`, `--yt-target-driver`, `--yt-target-driver-fixed` | `target.app = 48`, `target.driverAction = 56`, `target.driverPrimary = 64` (today's `touchTarget = 44` stays as legacy) |
| Header height | `headerHeightMax = {phone:120, desktop:124}`: a **maximum**, not a value to equal (the real header holds an account menu) | `--yt-header-h` is the fallback; the shell measures its header with a ResizeObserver and writes the real height into `--yt-header-h`, which `scroll-padding-top` reads | — |
| Fonts | `font.text`, `font.title`, `fontFiles` | `--yt-font-text`, `--yt-font-title` (next-kit binds them, and the legacy `--font-sans` / `--font-display`, to the files of §2.4) | `fontFamily.text = "Fira Sans"`, `fontFamily.title = "Epilogue"` (the nameID 16 inside the files, §2.4) |
| Theme colour | `appThemeColor = {web:'page', seller:'appSeller', ops:'appOps', field:'appDriver'}` | each app's `viewport.themeColor` and `manifest.ts` | adaptive icon background colour per app (§15) |

`tokens.json` holds all of it. The existing `tokens.test.ts` (both packages)
keeps its job: it must list every pair of the contrast table of §2 and fail under the threshold.

**How today's code gets there without breaking: §2.5.** Every new name in this table is *added* beside today's names in step 1; today's names keep their values until the last app has moved, and only then are deleted (step 6). Where a name is spelled the same today and in Carreta but means something else (`brand`, `onBrand`, `warning`, and the palette names `achiote`, `anil`, `arena`, `maiz`, `selva`), §2.5 says exactly how the two meanings are kept apart.

<!-- TOKENS -->
### Palette (values only; components never use these names)

| Name | Hex | What it is for |
|---|---|---|
| `--yt-noche` | `#1E1A16` | ink: text, primary buttons, selection |
| `--yt-humo` | `#574E45` | secondary text |
| `--yt-borde` | `#7A6F63` | edges of controls that tell you something |
| `--yt-regla` | `#D9D0C3` | decorative rules only |
| `--yt-cal` | `#FFFFFF` | page |
| `--yt-arena` | `#F3EEE6` | second surface, as a solid band |
| `--yt-papel` | `#EEEAE4` | ground of product photos and their placeholder |
| `--yt-achiote` | `#B8420F` | brand: Yuntera's own delivery; the shop app |
| `--yt-maiz` | `#F2B705` | paint in the wheel; warning fill |
| `--yt-anil` | `#1F47A8` | links and focus ring; the ruta app |
| `--yt-selva` | `#1F6B3A` | done, delivered, paid |
| `--yt-rojo` | `#A4161A` | errors and destructive actions |
| `--yt-cacao` | `#4A2A1C` | the vende app |
| `--yt-fondo` | `#16120F` | dark: page |
| `--yt-superficie` | `#231E19` | dark: second surface |
| `--yt-papel-oscuro` | `#2E2823` | dark: photo ground |
| `--yt-texto-claro` | `#F3EEE6` | dark: ink |
| `--yt-humo-claro` | `#C9BFB2` | dark: secondary text |
| `--yt-borde-claro` | `#8F8478` | dark: control edges |
| `--yt-regla-oscura` | `#3A332C` | dark: decorative rules |
| `--yt-achiote-claro` | `#F0804A` | dark: brand |
| `--yt-anil-claro` | `#9DB4F5` | dark: links and focus |
| `--yt-selva-claro` | `#6CC48A` | dark: done |
| `--yt-rojo-claro` | `#FF8A80` | dark: errors |

### Semantic colours (the only names components use)

| CSS variable | tokens.ts / expo-kit key | Light | Dark | Its one job |
|---|---|---|---|---|
| `--yt-page` | `page` | cal `#FFFFFF` | fondo `#16120F` | Page background. Nothing else. |
| `--yt-band` | `band` | arena `#F3EEE6` | superficie `#231E19` | Second surface as a solid band: buy box, summary, filters, footer, table head. Never a card on a card. |
| `--yt-photo` | `photo` | papel `#EEEAE4` | papel-oscuro `#2E2823` | Ground behind product photos and the neutral placeholder. |
| `--yt-ink` | `ink` | noche `#1E1A16` | texto-claro `#F3EEE6` | All text that is read, and icons. |
| `--yt-ink-muted` | `inkMuted` | humo `#574E45` | humo-claro `#C9BFB2` | Secondary text: seller line, counts, hints, dates in lists. |
| `--yt-edge` | `edge` | borde `#7A6F63` | borde-claro `#8F8478` | Edges of fields, checkboxes, radios, outline buttons, tags: anything whose edge tells you it is a control. |
| `--yt-rule` | `rule` | regla `#D9D0C3` | regla-oscura `#3A332C` | Decorative rules between sections. Never the only sign of anything. |
| `--yt-primary` | `primary` | noche `#1E1A16` | texto-claro `#F3EEE6` | Fill of the primary button, a selected choice, the current tab marker, the cart count. |
| `--yt-on-primary` | `onPrimary` | cal `#FFFFFF` | fondo `#16120F` | Text and icons on primary. |
| `--yt-link` | `link` | anil `#1F47A8` | anil-claro `#9DB4F5` | Links, always underlined. |
| `--yt-focus` | `focus` | anil `#1F47A8` | anil-claro `#9DB4F5` | Focus ring on page and band. On any coloured band the ring takes the band's own text colour (--yt-ring). |
| `--yt-brand` | `brand` | achiote `#B8420F` | achiote-claro `#F0804A` | Yuntera's own delivery only: delivery strip or its rule, arrival date, delivery code block, the wheel, 'Entregado por Yuntera'. Plus the shop app icon. |
| `--yt-on-brand` | `onBrand` | cal `#FFFFFF` | fondo `#16120F` | Text on brand. |
| `--yt-success` | `success` | selva `#1F6B3A` | selva-claro `#6CC48A` | Only done: Entregado, Pagado, Listo, Recibido. |
| `--yt-on-success` | `onSuccess` | cal `#FFFFFF` | fondo `#16120F` | Text on success. |
| `--yt-danger` | `danger` | rojo `#A4161A` | rojo-claro `#FF8A80` | Errors and destructive actions, always with the ! glyph and a word. |
| `--yt-on-danger` | `onDanger` | cal `#FFFFFF` | fondo `#16120F` | Text on danger. |
| `--yt-warning` | `warning` | maiz `#F2B705` | maiz `#F2B705` | Needs attention: Por atender, Esperando el pago. Fill only, never text. |
| `--yt-on-warning` | `onWarning` | noche `#1E1A16` | noche `#1E1A16` | Text on warning (stays dark in both appearances). |
| `--yt-app-shop` | `appShop` | achiote `#B8420F` | achiote `#B8420F` | Shop app icon ground. |
| `--yt-app-seller` | `appSeller` | cacao `#4A2A1C` | cacao `#4A2A1C` | vende: top bar and icon. |
| `--yt-app-driver` | `appDriver` | anil `#1F47A8` | anil `#1F47A8` | ruta: top bar and icon. |
| `--yt-app-warehouse` | `appWarehouse` | cal `#FFFFFF` | superficie `#231E19` | bodega: top bar (with a 3 px ink rule) and icon. |
| `--yt-app-ops` | `appOps` | noche `#1E1A16` | noche `#1E1A16` | central: side bar and phone top bar. |
| `--yt-on-app` | `onApp` | cal `#FFFFFF` | cal `#FFFFFF` | Text on the vende, ruta and central bars; fill of on-band buttons and side-bar counts. |
| `--yt-ink-fixed` | `inkFixed` | noche `#1E1A16` | noche `#1E1A16` | Text on a fill that stays light in both appearances: on-band buttons, side-bar counts (on on-app). |
| `--yt-wheel-rim` | `wheelRim` | noche `#1E1A16` | texto-claro `#F3EEE6` | Rim of the painted wheel. Turns light in dark so the wheel keeps its edge; the paint does not change. |

### Contrast pairs (computed with the WCAG 2.x formula in src/tokens.py)

| Pair | Needs | Light | Dark |
|---|---|---|---|
| Body text on page: `ink` on `page` | 4.5:1 | 17.29 | 16.13 |
| Body text on band: `ink` on `band` | 4.5:1 | 14.97 | 14.30 |
| Muted text on page: `ink-muted` on `page` | 4.5:1 | 8.14 | 10.27 |
| Muted text on band: `ink-muted` on `band` | 4.5:1 | 7.05 | 9.11 |
| Muted text on photo ground: `ink-muted` on `photo` | 4.5:1 | 6.79 | 8.02 |
| Control edge on page: `edge` on `page` | 3:1 | 4.90 | 5.09 |
| Control edge on band: `edge` on `band` | 3:1 | 4.25 | 4.52 |
| Primary button label: `on-primary` on `primary` | 4.5:1 | 17.29 | 16.13 |
| Primary button against page: `primary` on `page` | 3:1 | 17.29 | 16.13 |
| Link on page: `link` on `page` | 4.5:1 | 8.32 | 9.12 |
| Link on band: `link` on `band` | 4.5:1 | 7.20 | 8.09 |
| Focus ring on page: `focus` on `page` | 3:1 | 8.32 | 9.12 |
| Focus ring on band: `focus` on `band` | 3:1 | 7.20 | 8.09 |
| Brand text on page (date, Entregado por Yuntera): `brand` on `page` | 4.5:1 | 5.49 | 7.00 |
| Brand text on band (date in buy box): `brand` on `band` | 4.5:1 | 4.75 | 6.21 |
| Text on brand (strip, code block): `on-brand` on `brand` | 4.5:1 | 5.49 | 7.00 |
| Ring on brand (= on-brand): `on-brand` on `brand` | 3:1 | 5.49 | 7.00 |
| Success tag text: `on-success` on `success` | 4.5:1 | 6.52 | 8.78 |
| Success text on page: `success` on `page` | 4.5:1 | 6.52 | 8.78 |
| Danger text on page: `danger` on `page` | 4.5:1 | 7.75 | 8.16 |
| Text on danger (button, refused scan): `on-danger` on `danger` | 4.5:1 | 7.75 | 8.16 |
| Text on warning: `on-warning` on `warning` | 4.5:1 | 9.51 | 9.51 |
| Text on vende bar: `on-app` on `app-seller` | 4.5:1 | 12.81 | 12.81 |
| Text on ruta bar: `on-app` on `app-driver` | 4.5:1 | 8.32 | 8.32 |
| Text on central bar: `on-app` on `app-ops` | 4.5:1 | 17.29 | 17.29 |
| On-band button label and side-bar count: `ink-fixed` on `on-app`: `ink-fixed` on `on-app` | 4.5:1 | 17.29 | 17.29 |
| Refused-scan button label (on the on-danger fill): `danger` on `on-danger` | 4.5:1 | 7.75 | 8.16 |
| Wheel rim against the page: `wheel-rim` on `page` | 3:1 | 17.29 | 16.13 |

Every pair passes in both appearances (smallest margin 1.06 × its threshold). `rule` on `page` is 1.53:1 and is decorative only (WCAG 1.4.11 exempt): it may never be the only sign of a state or a control.

### Type

| Step (`.t-<name>`, `type.<camel>`) | Face | Weight | Phone size/line | Desktop size/line (≥ 900 px) | Tracking | Used for |
|---|---|---|---|---|---|---|
| `display` | Epilogue | 800 | 30/34 | 40/44 | -0.01em | Order title, empty-state title. One per screen at most. |
| `title` | Epilogue | 700 | 26/30 | 30/34 | -0.01em | Page H1 on shop pages, product title. |
| `section` | Epilogue | 700 | 21/26 | 24/28 | -0.03em | Section heads on shop pages; the H1 of work-tool pages. |
| `price-xl` | Epilogue | 800 | 32/36 | 36/40 | 0 | Buy-box price, order total. |
| `price` | Epilogue | 700 | 20/23 | 22/25 | 0 | Card price, line total, money in summaries. |
| `code` | Epilogue | 800 | 60/69 | 72/83 | 0.18em | The delivery code. Shopper screens only. The largest thing on its screen. |
| `h3` | Fira Sans | 600 | 18/24 | 18/24 | 0 | Sub-heads, buy-box rows, card titles in work tools. |
| `body` | Fira Sans | 400 | 16/24 | 16/24 | 0 | Running text and product names on the web. |
| `body-app` | Fira Sans | 400 | 17/24 | 17/24 | 0 | Body in the phone apps (17 pt iPhone body). |
| `label` | Fira Sans | 600 | 15/20 | 15/20 | 0 | Field labels, button text (buttons at 16). |
| `small` | Fira Sans | 400 | 14/20 | 14/20 | 0 | Secondary lines: seller, rating count, hints. |
| `table` | Fira Sans | 400 | 15/20 | 14/20 | 0 | Work-tool tables and lists. |
| `fine` | Fira Sans | 400 | 13/18 | 13/18 | 0 | Legal line, tab labels, stamps, badges. Nothing smaller anywhere. |
| `button` | Fira Sans | 600 | 16/20 | 16/20 | 0 | Button labels on the web (.btn); 15/20 in .btn-sm. |
| `button-app` | Fira Sans | 600 | 17/22 | 17/22 | 0 | Button labels in the phone apps and the 56 px driver actions. |
| `button-xl` | Fira Sans | 600 | 20/24 | 20/24 | 0 | The driver's fixed 64 px action (Llegué, Entregar) and full-screen confirmations. |
| `field-lg` | Fira Sans | 500 | 22/30 | 22/30 | 0 | Field apps only: señas, district, the product to pick, the cash line, the refused-scan sentence. |
| `loc` | Fira Sans | 700 | 44/48 | 44/48 | 0.02em | Warehouse location code on a pick line (the one tracked Fira step besides code-entry). |
| `count` | Epilogue | 800 | 34/34 | 34/34 | 0 | The count of a task on a dashboard (T6). |
| `code-entry` | Fira Sans | 700 | 32/40 | 32/40 | 0.3em | The driver's code-entry field and the 6-digit sign-in code field. |

### Spacing, radius, elevation, motion

Spacing steps `--yt-space-0` … `--yt-space-8`: 0, 4, 8, 12, 16, 24, 32, 48, 64 px. Every margin, padding and gap uses one of them (`carreta.css` writes them as `var(--yt-space-N)`; checked by `src/spacing.py`). The only exception: 2 px vertical padding inside stamps and badges, and 1 px corrections where a state thickens a border by 1 px.

| Radius | px | Role |
|---|---|---|
| `--yt-radius-control` | 4 | Buttons, fields, selects, chips, the quantity stepper. |
| `--yt-radius-tag` | 2 | Status stamps, counts, badges, the seller monogram. |
| `--yt-radius-overlay` | 10 | Menus, sheets, drawers, dialogs, the suggestion list (open side only). |
| `--yt-radius-photo` | 0 | Product photos and placeholders. |
| `--yt-radius-round` | 999 (fully round) | Only the wheel, radio dots, route stations and the status glyph. |

| Elevation | Value | Where |
|---|---|---|
| `--yt-elevation-rest` | `none` | Everything that rests on the page. No exceptions. |
| `--yt-elevation-overlay` | `0 10px 30px rgba(30,26,22,.25)` | Menus, sheets, drawers, dialogs, the suggestion list. Plus a 55 % noche scrim under drawers and sheets. |

Sticky bars (buy bar, driver action, submit bar) have no elevation token: a 1 px `rule` or 2 px `ink` top border, never a shadow.

| Motion | Duration and easing | Where |
|---|---|---|
| `--yt-motion-fast` | 100ms ease-out | Feedback on a control: pressed, checked, quantity change. |
| `--yt-motion-panel` | 200ms ease-out | Header hide and return, drawer, sheet, disclosure. |
| `--yt-motion-none` | 0ms  | Everything under prefers-reduced-motion: reduce. Nothing plays on scroll. |
<!-- /TOKENS -->

### 2.3 Focus ring (closes the critics' finding: rings of 1.00, 1.51 and 2.08 to 1)

- One ring everywhere: `outline: 3px solid var(--yt-ring); outline-offset: 2px` on
  `:focus-visible`. Never `outline: none` without this replacement.
- `--yt-ring` is `--yt-focus` (añil, 8.32:1 on page, 7.20:1 on band).
- Every coloured or dark surface carries a band class that resets the ring to
  its own text colour: `.banda` (noche console bar, cacao vende bar, añil ruta
  bar, bulk bar: `--yt-on-app`, cal), `.banda-marca` (delivery strip, code
  block: `--yt-on-brand`), `.banda-peligro` (refused scan: `--yt-on-danger`);
  the maíz cash line and warning notice set it to `--yt-on-warning` (noche).
- The dark appearance re-declares `--yt-ring: var(--yt-focus)` because a
  custom property that points at another one is resolved where it is
  declared (this was a measured bug: 2.24:1 in the first audit run).
- **Inset ring.** Where the 2 px offset would put a side of the ring outside the
  surface it belongs to, or where a frame clips it, the ring is drawn inside the
  control instead (`outline-offset: -6px`, the value in `carreta.css` and the one
  measured; `-7px` on side-bar rows, whose current row carries a 4 px left bar;
  `-4px` only on sortable table-head buttons): links and buttons in `.side`, `.mtop`,
  `.bar`, `.app-top`, `.nav-h`, `.tabbar`; rows of `.depts`, `.rowlist`, `.hub`;
  controls inside `.tbl-wrap`; options in the suggestion list. Lockups in bars
  get 8 px side padding so the inset ring never crosses the letters. The
  search input raises itself above its joined «Buscar» button on focus
  (`position:relative; z-index:1`), so its right side is not covered.
- **Focus is never hidden behind a bar** (WCAG 2.4.11). `html` carries
  `scroll-padding-top: var(--yt-header-h)` and `scroll-padding-bottom:
  var(--bar-h, 0px)`; the script that measures a sticky or fixed bottom bar
  (`.sticky-buy`, `.fixed`, `.submit-bar`) writes `--bar-h` on the **root**
  element, so the browser scrolls a focused control clear of the bar, not only
  the end of the page. A T7b table frame carries `scroll-padding-left:
  calc(52px + 9em + 8px)` and `scroll-padding-right: 24px`, so a focused head
  button never slides under the frozen columns or out of the frame. Checked by
  `audit.js` (focus hidden: at least one of five inner points of the focused
  control must hit-test to it after a real Tab).
- A control that is hidden from sight is not focusable (the card-list table
  head is `display:none`, not visually hidden; its sorting moves to the
  visible «Ordenar por» field).
- Check: `src/audit.js` tabs to every focus stop, shoots it blurred and
  focused, and on each of the four sides compares the pixels: the changed
  pixels must contrast 3:1 with what was there before; a side that does not
  change, or falls outside the screen, fails. Result in §17.

### 2.4 Fonts as files

Made by `src/fonts.py` from two pinned npm packages of the Google Fonts builds
(Epilogue 2.112 in `@expo-google-fonts/epilogue@0.4.2`, Fira Sans 4.203 in
`@expo-google-fonts/fira-sans@0.4.1`), each checked against the registry's
sha512 and a written sha256 before use [M: reproducible, the same sha256 on two
runs]. What the script changes in every file (also in `fonts/MODIFICATIONS.txt`):
tabular lining digits by default (the cmap points at the font's own `tnum`
glyphs), U+202F added (Epilogue 400/2000 em, Fira 200/1000 em), names (below),
a subset to Latin, Latin-1, Latin Extended-A, punctuation and currency with
every layout feature kept.

| Where | Files | Family name to register | In the repository |
|---|---|---|---|
| Web, all four apps | `fonts/web/epilogue-{600,700,800}.woff2`, `fonts/web/fira-sans-{400,500,600,700}.woff2`: **one file per weight**, ₡ and U+202F in the same file as the digits | `"Epilogue"`, `"Fira Sans"` in `packages/next-kit/src/fonts.ts` with `next/font/local` in the src-array form it uses today (`{path, weight, style}`), `display: "swap"`, variables `--font-title` and `--font-text`; no `unicode-range` is needed | `packages/next-kit/fonts/` (where the Inter and Bricolage files are today), with the two OFL files |
| Phones (expo-font config plugin) and the Expo web export (`fonts.web.ts`) | `fonts/ttf/Epilogue-{SemiBold,Bold,ExtraBold}.ttf`, `fonts/ttf/FiraSans-{Regular,Medium,SemiBold,Bold}.ttf` | `"Fira Sans"` and `"Epilogue"` with weights 400–700 and 600–800. iOS reads the family from nameID 16 inside the file, and every file now carries it (the F2 files did not: Medium and SemiBold would have fallen back on iOS). Android takes the name the plugin gives. No other weight may be asked for | `packages/expo-kit/fonts/`, with the two OFL files. `config.ts` builds the path as today: `./node_modules/@yuntera/expo-kit/fonts/<file>`; `fonts.web.ts` `require`s `../../fonts/<file>`. The `@expo-google-fonts/inter` and `bricolage-grotesque` dependencies leave `packages/expo-kit/package.json` and `apps/shop-native/package.json` in step 1 (dependency owner, §20.2) |
| E-mail | none (mail programs do not load web fonts) | Arial, Helvetica, sans-serif | — |
| The build script and its record | `src/fonts.py`, `fonts/manifest.json`, `fonts/MODIFICATIONS.txt`, `fonts/glyph-check.txt` | — | `packages/brand/fonts-build/` (`fonts.py`, `manifest.json`, `MODIFICATIONS.txt`); run by hand with Python and fontTools only when the fonts change, never in CI |

- **Tests (step 1).** `packages/brand/src/fonts.test.ts` hashes every shipped
  font file in `packages/next-kit/fonts` and `packages/expo-kit/fonts` and
  compares it with `manifest.json` (a changed or extra file fails), and checks
  that the manifest records, for each file: no missing character of the list
  (₡, U+202F, U+00A0, −, ñ Ñ á é í ó ú ü ¿ ¡ « » × · – …), tabular digits,
  nameID 16 equal to the family `fontFamily` registers, nameID 17 and the
  weight class. `packages/expo-kit/src/config.test.ts` checks that
  `fontsPlugin()` registers exactly the families and weights of the manifest.
  Plain Node, no new dependency.
- **Device check (step 1, not later).** One development build of the shopper
  app on one iPhone shows a test screen with Fira Sans 400, 500, 600, 700 and
  Epilogue 600, 700, 800 side by side; the builder confirms by eye that five
  different weights of Fira are not two. The store build of step 6 is too late
  to find a font-name problem.
- Prices, the code and titles keep `font-variant-numeric: lining-nums
  tabular-nums` (`.t-*`, `.num`); with the digits tabular by default this is a
  second guard, and React Native needs no `fontVariant` for it.
- Licences: OFL 1.1; neither upstream licence names a Reserved Font Name, so
  the modified files keep the names [M: read in the two `LICENSE_FONT` files].
  The OFL file and `MODIFICATIONS.txt` ship next to the fonts in both packages.
- **The shopper tester build 0.1.0 (4) cannot get these fonts**: new font
  files are native assets and need a new store build [E, inventory §6].

### 2.5 Migration: from today's names to Carreta, one app at a time

The danger [P, builder dry run]: Tailwind v4 drops an unknown class without an
error, and three names keep their spelling but change their job (`brand` is a
button fill today and our delivery tomorrow; `warning` is a text colour today
and a fill tomorrow; the palette words `achiote`, `anil` are error and ink
today). A rename in one go would pass lint and typecheck on the web and
silently strip or recolour screens. So the move has two phases and a test per
app.

**Phase A, step 1 (adds, removes nothing).**

1. `packages/brand/src/tokens.ts` keeps every export it has today (`color`,
   `semantic`, `font`, `fontSize`, `radius`, `shadow`, `touchTarget`,
   `themeColor`) with today's values, marked `@deprecated` and moved to
   `legacy.ts` (re-exported). It **adds** `palette` (flat Carreta palette),
   `light` and `dark` (Carreta semantics), `type`, `spacing`, `radii`,
   `elevation`, `motion`, `target`, `headerHeightMax`, `fontFiles`,
   `appThemeColor`. No added name equals an existing export, so no import
   changes meaning.
2. `css.ts` generates **two** stylesheets:
   - `tokens.legacy.css` = today's `tokens.css`, byte for byte, plus the
     Carreta-only names (`--color-page`, `band`, `photo`, `edge`, `rule`,
     `primary`, `on-primary`, `on-success`, `on-danger`, `on-warning`,
     `app-*`, `on-app`, `ink-fixed`, `wheel-rim`) with Carreta values, so the
     new components of step 2 render in an app that has not moved yet;
   - `tokens.css` (Carreta) = `:root{--yt-*}` light values,
     `:root[data-theme="dark"]{--yt-*}` dark values (outside any `@theme`),
     and one `@theme inline { --color-page: var(--yt-page); … }` block that
     exposes every Carreta semantic name **plus** every legacy-only name as an
     alias of its Carreta target (`--color-surface: var(--yt-page)`,
     `--color-surface-muted: var(--yt-band)`, `--color-border: var(--yt-rule)`,
     `--color-border-strong: var(--yt-edge)`, `--color-bg`, `--color-brand-hover`,
     `--color-brand-soft`, `--color-promo`, `--color-rating`), **plus** today's
     raw ramps with today's values. Nothing an app writes today disappears.
   The palette words are never exposed to Tailwind in Carreta (components use
   semantic names only), so `bg-achiote-600` keeps meaning today's red until
   the ratchet removes it.
3. `packages/expo-kit` keeps `colors`, `tone`, `space`, `fontSize`,
   `lineHeight`, `radius`, `fontFamily.body/display` unchanged, and adds
   `theme` (light) and `themeDark`, `useTheme()` and a `ThemeProvider`
   (§5.23), `spacing`, `type`, `target`, and `fontFamily.text/title`.

**Phase B, one app at a time (steps 3 and 4).** An app moves when its builder
switches one line: `@import "@yuntera/brand/tokens.legacy.css"` →
`@import "@yuntera/brand/tokens.css"` in its `globals.css` (web), or wraps its
root layout in `ThemeProvider` and reads `useTheme()` (phone). From that
commit the app's **ratchet** applies: `packages/brand/src/ratchet.test.ts`
greps each app for the patterns of §2.5.7 and compares the counts with
`ratchet.json` (one number per app and pattern, measured at the start). Measured by this
pass over all of `apps/` at `d6b637e` (lines matching, `rg -c -U`): raw ramp
classes 32, legacy-only semantic classes 286, `brand` outside the delivery
components 73, warning as text 23, hand-written targets and arbitrary values
99, fonts and borders set by hand 72, legacy theme names in the phone apps
403, bare `formatPrice` in JSX 29, module-level `StyleSheet` reading colours
31. A count may only go down; a moved app must reach 0 before its step is done. The
meaning-changed names are caught there: `bg-brand`, `border-brand`,
`accent-(--color-brand)`, `colors.brand` and `text-warning` are 0 in a moved
app, because the components (`DeliveryStrip`, `ArrivalDate`, `CodeBlock`,
`Wheel`) are the only places allowed to use `brand`, and warnings are `Notice`
or `Tag` fills.

**Phase C, step 6.** When every app counts 0, `legacy.ts`,
`tokens.legacy.css`, the alias lines, the ramps, the expo-kit legacy exports
and the component adapters of §2.5.6 are deleted in one commit, and
`ratchet.json` is deleted with them.

<!-- MIGRATION -->
#### 2.5.1 Semantic colour names

| Today (`semantic.*`, Tailwind `--color-*`) | Carreta | Kind | What changes |
|---|---|---|---|
| `bg` | `page` | renamed | bg-bg → bg-page |
| `surface` | `page` | renamed | Carreta has one page colour; a raised white card on a tinted page does not exist. |
| `surfaceMuted` | `band` | renamed | bg-surface-muted → bg-band |
| `border` | `rule` | renamed | Decorative rules only. A control edge is never `rule`. |
| `borderStrong` | `edge` | renamed | Control edges (fields, outline buttons, checkboxes): 4.90:1. |
| `ink` | `ink` | same | añil 900 → noche |
| `inkMuted` | `inkMuted` | same | añil 600 → humo |
| `brand` | `primary (as a fill or a selection) / brand (only our delivery)` | **meaning** | Today brand (celeste) fills primary buttons, selected options and checkbox accents. In Carreta brand is achiote and may only mark our own delivery (§4.2). Every bg-brand, border-brand, accent-(--color-brand) and colors.brand becomes primary; only the strip, the arrival date, the code block and the wheel use brand. |
| `onBrand` | `onPrimary (on buttons) / onBrand (on the strip and code block)` | **meaning** | Follows brand. |
| `brandHover` | `primary (pressed state is the 1 px move + inner shade, §5.1)` | gone | No hover colour. |
| `brandSoft` | `band` | gone | No pastel tints. |
| `link` | `link` | same | celeste 700 → añil, always underlined |
| `focus` | `focus` | same | celeste 500 → añil; the ring rules of §2.3 |
| `promo` | `— (none)` | gone | No sale colour. A discount is a plain stamp with the number («−18 %»). |
| `rating` | `ink` | gone | Stars are decorative in ink; the number is written. |
| `success` | `success` | same | selva 600 → selva #1F6B3A |
| `danger` | `danger` | same | achiote 600 → rojo #A4161A. Achiote stops meaning error. |
| `warning` | `warning (a FILL with onWarning text)` | **meaning** | Today warning (maíz 700) is a TEXT colour (text-warning, 22 uses). Carreta warning is maíz #F2B705, a fill under noche text; as text on the page it is 1.9:1. Every text-warning becomes a Notice kind="warn" or a Tag warn. |

New names with no ancestor: `photo`, `onSuccess`, `onDanger`, `onWarning`, `appShop`, `appSeller`, `appDriver`, `appWarehouse`, `appOps`, `onApp`, `inkFixed`, `wheelRim`.

#### 2.5.2 Raw ramp classes (68 web uses, 36 `colors.palette` uses) by the property they colour

| Ramp | Steps | As a background | As text | As a border |
|---|---|---|---|---|
| `celeste` | 50–200 | `band` | `ink-muted` | `rule` |
| `celeste` | 300–500 | `band` | `link` | `edge (focus ring: focus)` |
| `celeste` | 600–700 | `primary` | `link` | `edge` |
| `celeste` | 800–950 | `primary` | `ink` | `edge` |
| `anil` | 50–200 | `band` | `ink-muted` | `rule` |
| `anil` | 300–500 | `band` | `ink-muted` | `edge` |
| `anil` | 600–950 | `primary` | `ink (600–700: ink-muted)` | `edge` |
| `guaria` | all | `band (seller identity: app-seller)` | `ink` | `rule` |
| `maiz` | 50–300 | `band` | `ink` | `rule` |
| `maiz` | 400–900 | `warning (fill only; stars: ink)` | `ink (never maíz text)` | `edge` |
| `selva` | 50–300 | `band` | `success` | `rule` |
| `selva` | 400–900 | `success` | `success` | `success` |
| `achiote` | 50–300 | `band` | `danger` | `danger` |
| `achiote` | 400–900 | `danger` | `danger` | `danger` |
| `arena` | 50 | `page` | `ink-muted` | `rule` |
| `arena` | 100 | `band` | `ink-muted` | `rule` |
| `arena` | 200–300 | `band` | `ink-muted` | `rule` |
| `arena` | 400 | `band` | `ink-muted` | `edge` |
| `white` | — | `page` | `on-primary / on-app` | `rule` |

#### 2.5.3 Other web tokens and habits

| Today | Carreta | Note |
|---|---|---|
| font-sans (Inter) | font-text (Fira Sans) | next-kit fonts.ts binds --font-sans to Fira Sans in step 1, so `font-sans` keeps working. |
| font-display (Bricolage) | font-title (Epilogue) | --font-display is bound to Epilogue in step 1; the class name stays until step 6. |
| text-xs (12 px) | t-fine (13/18) | 12 px is under the minimum; no text step is smaller than 13. |
| text-sm (14) | t-small (14/20) or t-table |  |
| text-base (16) | t-body (16/24) |  |
| text-lg (18) | t-h3 (18/24) |  |
| text-xl, text-2xl (20, 24) | t-section (21/26 phone, 24/28 desktop) |  |
| text-3xl (30) | t-title (26/30, 30/34) |  |
| text-4xl, text-5xl (40, 52) | t-display (30/34, 40/44) | One per screen at most. |
| radius sm / md (6, 10) | radius-control (4) | Buttons, fields, chips. |
| radius lg / xl (16, 24) | radius-overlay (10) | Menus, sheets, dialogs only; cards have no radius (photos 0). |
| radius full | radius-round | Only the wheel, radio dots, stations, the status glyph. No pills. |
| shadow sm / md / lg | elevation-rest (none) / elevation-overlay | Nothing that rests has a shadow. |
| min-h-11 written by hand | the component (Button, Field, RowList) sets the target | Ratchet counts it. |
| uppercase tracking-wide (DataTable head and others) | nothing | §3.3: no capitals. |

#### 2.5.4 Phone tokens (expo-kit)

| Today | Carreta | Note |
|---|---|---|
| `colors.<semantic>` | `theme.colors.<carreta name> (useTheme())` | Same table as the web (1). `colors` stays exported, unchanged, until step 6. |
| `colors.palette.<ramp>[step]` | `nothing (components never use palette names)` | As the ramps above. |
| `colors.fieldBorder (añil 400)` | `theme.colors.edge` |  |
| `tone.<neutral|info|success|warning|danger|promo>` | `Tag sign from the status table (§4.3), Notice kind` | A tone is chosen by the state, not by the screen: the word, the sign and the colour come from packages/core status words. |
| `fontFamily.body` | `fontFamily.text = "Fira Sans"` | body stays an alias of text until step 4 ends. |
| `fontFamily.display` | `fontFamily.title = "Epilogue"` | display stays an alias of title until step 4 ends. |
| `fontSize.<xs..5xl>, lineHeight.<..>` | `type.<step>.phone {size, line}` | Through Text variants only. |
| `radius.<sm|md|lg|xl|full>` | `theme.radii.control | tag | overlay | photo | round` | A new object beside the old one; `radius` goes in step 6. |
| `touchTarget (44)` | `target.app (48), target.driverAction (56), target.driverPrimary (64)` |  |
| `gutter (16)` | `spacing.base (16)` |  |

Spacing changes **name**, never meaning under the same key: today `space` is keyed 0, 1, 2, 3, 4, 5, 6, 8, 10, 12; the new object is `spacing` with named keys, so an old index cannot silently mean a new value. `space` stays exported, unchanged, until step 6; the ratchet forbids it in a moved app.

| Today | px | Carreta | px |
|---|---|---|---|
| `space[0]` | 0 | `spacing.none` | 0 |
| `space[1]` | 4 | `spacing.hair` | 4 |
| `space[2]` | 8 | `spacing.tight` | 8 |
| `space[3]` | 12 | `spacing.snug` | 12 |
| `space[4]` | 16 | `spacing.base` | 16 |
| `space[5]` | 20 | `spacing.loose` | 24 |
| `space[6]` | 24 | `spacing.loose` | 24 |
| `space[8]` | 32 | `spacing.wide` | 32 |
| `space[10]` | 40 | `spacing.section` | 48 |
| `space[12]` | 48 | `spacing.section` | 48 |
| `—` |  | `spacing.page` | 64 |

20 and 40 have no step: they round to the nearer step and ties go up (20 → 24, 40 → 48).

| Text variant today | Type step |
|---|---|
| `display` | `display` |
| `title` | `title` |
| `heading` | `section` |
| `subheading` | `h3` |
| `body` | `bodyApp` |
| `bodyStrong` | `bodyApp at weight 600` |
| `small` | `small` |
| `smallStrong` | `small at weight 600 (label where it names a field)` |
| `caption (12 px)` | `fine (13/18)` |
| `figure` | `price for an amount, count for a count` |

The old variant names stay accepted by `Text` (mapped as above) until step 4 ends.

#### 2.5.5 Button kinds and sizes

| Today | Carreta |
|---|---|
| web variant primary | primary |
| web variant secondary | outline |
| web variant ghost | link-button |
| web variant danger | danger (inside the danger zone only) |
| web size sm (36 px with a mouse) | btn-sm, 44 everywhere |
| web size md | default, 48 |
| web size lg | default, 48 (no larger web button) |
| phone variant primary / secondary / ghost / danger | primary / outline / link-button / danger |
| phone size md | default, 52 |
| phone size sm | sm, 48 |
| phone size lg | lg, 56 |
| phone: driver actions (new) | size="driver", 56 |
| phone: the driver's fixed action (new) | size="driverFixed", 64 |
| on a coloured bar (new) | onBand / ghostBand |

#### 2.5.6 Component adapters (kept until the last caller has moved; deleted in step 6)

| Today | Carreta component | How the adapter maps it |
|---|---|---|
| `ui Badge({tone})` | `Tag({sign, children})` | tone → sign: neutral ○, info ◐, success ✓ ok, warning ! warn, danger ! err, promo plain. Only a fallback: states use StatusTag (below). |
| `ui OrderStatusBadge / ShipmentStatusBadge / InvoiceStatusBadge` | `StatusTag({kind, value, viewer})` | Reads sign and word from packages/core status words. |
| `ui Alert({tone, title})` | `Notice({kind, title})` | tone → kind: success ok, info info, warning warn, danger err. |
| `ui buttonClass({variant, size}) / Button` | `Button({kind, size})` | Old prop values accepted and mapped (table above) until step 4 ends. |
| `next-kit PageHeader` | `PageHead` | Same props; drops the eyebrow (no caps). |
| `next-kit Stat` | `Task / KeyValue (§5.17)` | Stat({label, value}) renders a KeyValue row. |
| `next-kit DataTable({caption, head, children})` | `DataTable<Row>({caption, columns, rows, …}) (§5.13)` | The old signature renders T7a cards with the head as labels, without sorting, until the 17 callers move. |
| `next-kit FormMessage` | `Notice at the top of the form (§5.26)` |  |
| `expo-kit Badge, Alert, Button, Card, ListRow, InfoRow` | `Tag, Notice, Button, RowList` | Same mapping as the web. |

#### 2.5.7 Ratchet patterns (packages/brand `ratchet.test.ts`, per app; a moved app must count 0)

| What | Pattern (ripgrep) |
|---|---|
| raw ramp classes | `\b(bg|text|border|ring|accent|fill|stroke|outline|from|to)-(celeste|anil|guaria|maiz|selva|achiote|arena)-\d+` |
| legacy-only semantic classes | `\b(bg|text|border)-(bg|surface|surface-muted|border|border-strong|brand-hover|brand-soft|promo|rating)\b` |
| brand outside the delivery components | `\b(bg|text|border|accent)-brand\b|--color-brand|colors\.brand|semantic\.brand` |
| warning used as text | `\btext-warning\b|tint="warning"|color: *colors\.warning` |
| hand-written targets and arbitrary values | `\bmin-h-(9|10|11|12)\b|\[[0-9.]+(px|rem)\]` |
| fonts and borders set by hand in the phone apps | `fontFamily|borderWidth|fontSize: *\d` |
| legacy theme in the phone apps | `\b(colors|tone|space|fontSize|lineHeight)(\.[A-Za-z]|\[)` |
| a bare formatPrice in JSX | `>\{formatPrice\(` |
| module-level StyleSheet reading colours (rg -U, multiline) | `StyleSheet\.create\(\{(?s:.)*?colors\.` |
<!-- /MIGRATION -->

## 3. Type rules (checkable)

1. Epilogue only for: `display`, `title`, `section`, `price-xl`, `price`, `code`,
   `count`, the wordmark, the seller monogram and `legend` titles of checkout
   fieldsets (at `section`). Never under 18 px, never for running text,
   buttons, labels or tables.
2. Fira Sans for everything else, 13 px minimum anywhere (`fine`: also stamps
   and badges), 15 px minimum in tables on phones, 17 px body and 14 px small
   in the phone apps (the `small` step is 14/20 on every platform). Every text uses a step of the type table: size and line
   height together; a Fira step may be set at 400–700 for emphasis, its size
   never changes. Checked by `audit.js` (type off the scale: 0 on every page).
   Exempt by design: the wordmark and monogram (logo art), the `!` disc glyph,
   the phone frames' status bar, frame captions outside the drawn screens,
   the e-mail frame (Arial), the 200 % phone frame (A2), and the text inside
   inputs.
3. No ALL CAPS, no italic in headings. Letter-spacing on Fira only in three
   named places: the code-entry field and the 6-digit sign-in code
   (`code-entry`, +0.3 em), the warehouse location (`loc`, +0.02 em) and
   codes set with `.mono-code` (package numbers, Código Plus, consecutivos:
   Fira 700 tabular, +0.04 em). Nothing else.
4. One `display` per screen at most. Back-office pages (side bar) use
   `section` as their H1 (no hero). Field-app pages (`apps/field`, driver
   and warehouse phone apps) put the page H1 in the identity bar as an
   app-bar title, Fira 600 18/24 (`h3` step); on those pages Epilogue is kept
   for the stop's recipient or the task's name (`title`) and for counts.
5. Money: `₡` + digits with U+202F thousands, decimal comma only with céntimos,
   real minus `−`, tabular figures. One helper writes it: `formatPrice`, moved
   into `packages/core` in step 1 (today it lives in `packages/ui/src/commerce.tsx`
   and is copied in `packages/expo-kit/src/format.ts`; core has only
   `format(money)`, which already writes U+202F and `−`). `ui` and `expo-kit`
   re-export it. One component draws it large (`Price`, §5.12).
6. Long words may break (`overflow-wrap: anywhere`) only on `display` and
   `title`, product names, card prices and the code, and only when the word is
   longer than the line (200 % text, a 320 px screen); `h2`, `h3` and bar
   titles use `break-word`. Under 360 px the department list is one column and
   the product title sits above the photo, so no word breaks at normal size.
7. Stamps, buttons and tab labels never break inside a word (no
   `overflow-wrap:anywhere`, no automatic hyphens): they wrap between words
   only. In a table, the status column is at least as wide as the longest
   stamp word plus its glyph (`td.estado{min-width:8.5em}`). Checked by
   `audit.js` (words broken inside the word: 0 at normal size, and 0 at 200 %
   text outside the places rule 6 names, unless the word is longer than its
   whole line).
8. **A time, an amount or a quantity never breaks across two lines.** Inside
   a time the parts are joined by U+00A0 NO-BREAK SPACE: «2 p. m.» is
   `2` U+00A0 `p.` U+00A0 `m.`, «6:33 a. m.» likewise. A number and the unit
   or the counted word right after it are joined by U+00A0: «340 g», «1,8 L»,
   «24 horas», «3 unidades», «12 %», «8 días hábiles» (only a number with its
   unit or counted noun; «2 de 8» may break). Money keeps U+202F
   between thousands and U+00A0 never appears inside an amount. The helpers in
   `packages/core` write these characters, so no screen types them:
   `formatTime(date)` («6:33 p. m.»), `formatDay(date, {time})` (§10.4) and
   `formatQuantity(n, unit)` («340 g», «3 unidades»; units: g, kg, ml, L, cm,
   mm, m, km, W, %, and counted nouns in the plural rules of es and en). A unit
   test checks each example of this rule character by character. The
   reference pages get the same treatment from `keep_together()` in
   `src/common.py`, and `audit.js` fails on any time, amount or number with
   its unit that spans two line boxes, at normal size and at 200 % [M: 0 on
   46 pages at 390, 320 and 1280].

---

## 4. The signature elements

### 4.1 The wheel

- **Meaning:** "Yuntera lo lleva", our own delivery (when it arrives, where it is
  now). Its accessible name says so: «Entregado por Yuntera, con nuestros
  propios repartidores» or «Aquí va su pedido».
- **At most one per screen** [checkable: count `.wheel` per page; the audit list
  in §17 has 1 or 0 per drawn screen].
- **Forms and sizes:** 24 px in the strip on phones, 28 px on desktop; 32 px as
  the marker on the route line (tracking form); 48 px unpainted (outline in ink)
  for "nothing delivered yet" empty states; the app icons. Nothing else.
- **Where it may appear:** the delivery strip (shop list, home, product, cart);
  the current station of order tracking (T5) and of the driver's stops (T16);
  the empty state of orders lists. A screen with tracking has no strip.
- **Never:** behind text or a form, as a repeated pattern, on errors, blocks or
  suspensions (they get the `!` disc), on checkout steps, in e-mail.
- In dark appearance the rim turns `texto-claro` (`--yt-wheel-rim`, a semantic
  token: noche in light, texto-claro in dark, 17.29 and 16.13 against the
  page); the paint does not change.

### 4.2 Achiote

- Allowed uses (complete list): the delivery strip (version 1 fill or version 2
  rule and lead words), the arrival date (`.when`, `.yt-line`), the delivery-code
  block, the "Llega antes" stamp, the wheel's paint, the mark, the shop app icon,
  the arrival line in delivery e-mails.
- Never a button, link, focus ring, selected state, active tab, error, warning,
  discount or promotion. Never next to a form field.
- **Risk** [E]: next to the crimson of errors (`rojo`, about 39° of hue away) the
  achiote strip may read as a warning or a sale. Errors therefore always carry
  the `!` glyph and a sentence, and achiote never appears inside a form.
- **Decided (27 November 2026, owner's answer 5A):** the strip is version 1,
  the full achiote band (`.strip.banda-marca`). Version 2 (`.strip.regla`) is
  not built; it stays drawn in `franja2-*.html` and `franja/` as history.

### 4.3 The status stamp: five signs, and the word of every state

| Sign | Class | Meaning |
|---|---|---|
| ○ hollow disc | `.tag` | not yet |
| ◐ half disc | `.tag.half` (`.half.solid` when it is the headline state) | in progress |
| ✓ check | `.tag.done` (on primary) / `.tag.ok` (on success) | done |
| ! | `.tag.warn` (maíz, noche text) / `.tag.err` (rojo) | needs attention |
| – bar | `.tag.ended` | ended |

Rules: 2 px radius, 13/18 Fira 600, wraps between words only (§3.7); green
only for done; the word is required; one tone table for web and phone.

**One source.** Every status value the database has gets exactly one sign and
one word per viewer, from the table below. In step 1 the core owner writes it
as `packages/core/src/status-words.ts`
(`statusWord(kind, value, {viewer, locale, attemptCount?})` →
`{sign, word}`), extending today's `ORDER_STATUS_LABEL` (whose shopper words
are kept). `packages/ui` (`StatusTag`), `packages/expo-kit`, the four native
`labels.ts` files, `apps/ops/src/lib/labels.ts`, `notification-labels.ts`,
`apps/seller/src/lib/labels.ts` and `packages/notifications` import it and
keep no copy (a test in core greps those files for any of the words below
written as a literal next to a status key). The journeys read the words from
the same module (§20.5), so changing a word is one edit.

Words that change from today [P]: `picking` «En preparación» → «Preparando»;
`delivery_failed` «Entrega fallida» → «No se pudo entregar»; `returning`
«De regreso» → «Vuelve a la bodega»; `returned` «Devuelto» → «Devuelto a la
bodega»; `payment_review` keeps «Verificando el pago». The journeys that look
for the old words (`console-followups.cjs`, `console-operations.cjs`,
`order-followups.cjs`) move to the module in step 0b, before the words change.

<!-- ESTADOS -->
| Enum / table (viewer) | Value | Sign | Spanish word | English |
|---|---|---|---|---|
| order_status (shopper) | `pending_payment` | ! warn | Esperando el pago | Awaiting payment |
|  | `payment_review` | ◐ | Verificando el pago | Checking your payment |
|  | `confirmed` | ✓ done | Pedido confirmado | Order confirmed |
|  | `processing` | ◐ | Preparando su pedido | Preparing your order |
|  | `partially_shipped` | ◐ | Parte del pedido va en camino | Part of your order is on its way |
|  | `shipped` | ◐ | En camino | On its way |
|  | `delivered` | ✓ ok | Entregado | Delivered |
|  | `completed` | ✓ ok | Entregado | Delivered |
|  | `cancelled` | – | Cancelado | Cancelled |
|  | `refunded` | – | Reembolsado | Refunded |
| order_status (seller, staff) | `pending_payment` | ! warn | Esperando el pago | Awaiting payment |
|  | `payment_review` | ◐ | Verificando el pago | Checking payment |
|  | `confirmed` | ○ | Por preparar | To prepare |
|  | `processing` | ◐ | Preparando | Preparing |
|  | `partially_shipped` | ◐ | Parte en camino | Partly on its way |
|  | `shipped` | ◐ | En camino | On its way |
|  | `delivered` | ✓ ok | Entregado | Delivered |
|  | `completed` | ✓ ok | Completado | Completed |
|  | `cancelled` | – | Cancelado | Cancelled |
|  | `refunded` | – | Reembolsado | Refunded |
| shipment_status (seller, staff, driver; shopper where it differs) | `pending` | ○ | Por preparar | To prepare |
|  | `picking` | ◐ | Preparando | Preparing |
|  | `packed` | ◐ | Empacado (shopper: Preparando) | Packed (shopper: Preparing) |
|  | `ready_for_dispatch` | ◐ | Listo para salir (shopper: Preparando) | Ready to leave (shopper: Preparing) |
|  | `out_for_delivery` | ◐ | En camino | On its way |
|  | `delivered` | ✓ ok | Entregado | Delivered |
|  | `delivery_failed` | ! warn | No se pudo entregar; with attempt_count 0 (taken off a route): Reprogramado (◐) | Not delivered; attempt 0: Rescheduled |
|  | `returning` | ! warn | Vuelve a la bodega | Returning to the warehouse |
|  | `returned` | – | Devuelto a la bodega | Back at the warehouse |
|  | `cancelled` | – | Cancelado | Cancelled |
| derived order flags (packages/core lifecycle.ts; staff only) | `isStoppedOrder` | ! warn | Detenido | Stopped |
|  | `waitsForNewAttempt / awaiting another route` | ! warn | Espera otra ruta | Waiting for another route |
|  | `needs a person (any of the above, or unpaid at the cut-off)` | ! warn | Por atender | Needs attention |
| payment_status | `pending (cash on delivery)` | ○ | Se paga al recibir | Pay on delivery |
|  | `pending (SINPE, transfer)` | ! warn | Esperando el pago | Awaiting payment |
|  | `authorized` | ◐ | Autorizado | Authorised |
|  | `captured` | ✓ ok | Pagado | Paid |
|  | `failed` | ! err | Pago rechazado | Payment declined |
|  | `cancelled` | – | Anulado | Voided |
|  | `refunded` | – | Devuelto | Refunded |
|  | `partially_refunded` | – | Devuelto en parte | Partly refunded |
| return_requests.status | `requested` | ○ | Por decidir | To decide |
|  | `approved` | ◐ | Aprobada: por recibir | Approved: to receive |
|  | `received` | ◐ | Recibida: por devolver el dinero | Received: refund pending |
|  | `refunded` | ✓ ok | Dinero devuelto | Refunded |
|  | `rejected` | – | Rechazada | Declined |
| complaints.status | `open` | ○ | Por responder | To answer |
|  | `in_progress` | ◐ | En revisión | In review |
|  | `resolved` | ✓ ok | Respondido | Answered |
| payouts.status | `scheduled` | ○ | Programado | Scheduled |
|  | `paid` | ✓ ok | Transferido | Transferred |
|  | `failed` | ! err | No se pudo transferir | Transfer failed |
| product_status | `draft` | ○ | Borrador | Draft |
|  | `pending_review` | ◐ | En revisión | In review |
|  | `active` | ✓ ok | Publicado | Published |
|  | `rejected` | ! err | Rechazado | Rejected |
|  | `archived` | – | Archivado | Archived |
| offer_status (+ derived stock) | `active` | ✓ ok | A la venta | On sale |
|  | `active with stock 0` | ! warn | Sin existencias | Out of stock |
|  | `paused` | – | En pausa | Paused |
|  | `archived` | – | Archivada | Archived |
| product_photos.state | `uploading` | ◐ | Subiendo | Uploading |
|  | `pending` | ◐ | En revisión | In review |
|  | `approved` | ✓ ok | Publicada | Published |
|  | `rejected` | ! err | Rechazada (the reason follows in a sentence) | Rejected |
|  | `removed` | – | Quitada | Removed |
| invoice_status (Hacienda) | `pending` | ○ | Por enviar | To send |
|  | `sent` | ◐ | Enviada | Sent |
|  | `accepted` | ✓ ok | Aceptada | Accepted |
|  | `rejected` | ! err | Rechazada | Rejected |
|  | `voided` | – | Anulada | Voided |
| inbound_status (+ derived) | `draft` | ○ | Por enviar | To send |
|  | `in_transit` | ◐ | En camino | On its way |
|  | `receiving` | ◐ | Recibiendo | Receiving |
|  | `received` | ✓ ok | Recibido | Received |
|  | `received with a difference` | ! warn | Con diferencias | With differences |
|  | `closed` | – | Cerrado | Closed |
|  | `cancelled` | – | Cancelado | Cancelled |
| review_status | `pending` | ○ | Por revisar | To review |
|  | `published` | ✓ ok | Publicada | Published |
|  | `rejected` | – | No publicada | Not published |
| stop_status (driver) | `pending` | ○ | Por entregar | To deliver |
|  | `arrived` | ◐ | En la puerta | At the door |
|  | `delivered` | ✓ ok | Entregado | Delivered |
|  | `failed` | ! warn | No se pudo entregar | Not delivered |
|  | `skipped` | – | Quitada por Central | Removed by Central |
|  | `code locked (pin_attempts_left 0)` | ! err | Código bloqueado | Code locked |
| route_status | `draft` | ○ | Borrador | Draft |
|  | `assigned` | ○ | Asignada | Assigned |
|  | `in_progress` | ◐ | En ruta | On the road |
|  | `completed` | ✓ ok | Terminada | Finished |
|  | `cancelled` | – | Cancelada | Cancelled |
| seller_invitations.status | `pending` | ○ | Pendiente | Pending |
|  | `pending past expires_at` | – | Vencida | Expired |
|  | `accepted` | ✓ ok | Aceptada | Accepted |
|  | `declined` | – | Rechazada | Declined |
|  | `revoked` | – | Retirada | Withdrawn |
| shop change requests (pending, approved, rejected, withdrawn, replaced) | `pending` | ◐ | En revisión | In review |
|  | `approved` | ✓ ok | Aprobado | Approved |
|  | `rejected` | ! err | Rechazado | Rejected |
|  | `withdrawn` | – | Retirado | Withdrawn |
|  | `replaced` | – | Reemplazado | Replaced |
| messages (notification outbox; staff only) | `pending, sending` | ◐ | Enviando | Sending |
|  | `sent` | ◐ | Enviado | Sent |
|  | `delivered` | ✓ ok | Entregado | Delivered |
|  | `failed` | ! warn | Falló: se reintenta | Failed: retrying |
|  | `dead` | ! err | Detenido | Stopped |
|  | `skipped, expired` | – | No se envió | Not sent |
| content_reports.status | `open` | ○ | Por revisar | To review |
|  | `in_review` | ◐ | En revisión | In review |
|  | `actioned` | ✓ ok | Atendido | Acted on |
|  | `dismissed` | – | Descartado | Dismissed |
<!-- /ESTADOS -->

The shopper's order page and list show the order word; each package row shows
its shipment word for the shopper (the «shopper:» variants). «Por atender»
is never a state: it is the derived flag of the staff table.

**Route-line words are positions, not states.** The words above each station
of the route line (Hecho, Ahora, Falta, from A) say where the station sits in
the sequence. They never replace a stamp, and a stamp never says Hecho, Ahora
or Falta. On the driver's list the current stop reads «Ahora»; on that stop's
own page the stamp reads «Por entregar», then «En la puerta» after «Llegué».

### 4.4 Sellers as people

- A seller is shown with: the monogram (first letter, Epilogue 800 on band,
  1.5 px edge, 2 px radius) or their approved logo at the same size; their name
  as a 44 px link; their own one-line trade; on their shop page the facts row
  (products, who delivers, how fast they answer).
- On a product: "Vendido por <link>" plus their trade line in the buy box.
- Optional, approved by the seller: their place («Desde San Marcos de
  Tarrazú, San José») and who answers («Atiende: Marta»), on `.seller` and
  `.shopface` (drawn on `home.html` and `tienda.html`).
- The delivery code shows only on the shopper's own screens.

**How a person's name is shown, by who is looking** (the product rules [P] say
what each viewer may receive; this table says how to write it):

| Viewer and screen | Name form | Example | Other personal data |
|---|---|---|---|
| Shopper, own screens and e-mail greeting | full name; greeting by first name | María Fernández Solís; «María, …» | own address, phone, e-mail, code |
| Seller (web and phone), every screen | first name only | Andrés · San Pedro, Montes de Oca | district and cantón only; never phone, e-mail, address, pin |
| Seller, documents | none (commission invoices are between Yuntera and the seller) | — | — |
| Staff, lists, panels and audit sentences | first name + initial | Jorge A. | district |
| Staff, order detail page (T9) | full name | María Fernández Solís · 8888 1234 | phone, address; never the code («Solo lo ve el cliente.») |
| Driver, route list and stop | the recipient's name as the shopper wrote it | María Fernández Solís | phone (call and WhatsApp buttons), señas, pin, cash; never the code |
| Warehouse, screens | no person name | package code YT500018, route | — |
| Warehouse, printed parcel label (not drawn) | first name + initial and district | María F. · San Pedro | no phone, no address; the driver's app has the rest |
| Reviews (public) | first name + initial | Andrés M. | — |



### 4.5 The route line (from C) and the wheel together

| Use | Form | Stations | Wheel |
|---|---|---|---|
| Checkout steps (T4) | `.linea.pasos`, horizontal at every width | numbers 1–3, current ring, done check | never |
| Order tracking (T5, T9) | `.linea.track`, horizontal ≥ 600 px, vertical below | done check, now ring, to do hollow; words Hecho / Ahora / Falta (from A), the step, its time | on the "Ahora" station in shopper screens only |
| Driver's stops (T16) | `.linea.v`, always vertical | the same | on the current stop |

Done stretch: 4 px ink line. To-do stretch: 2 px dashed edge line. Each
station has its words, so the state is never colour or shape alone.

---

## 5. Components

Sizes: **touch** = phones and any `pointer: coarse` screen; **desktop** = mouse.
"Replaces" names what each component takes over in the code today [P, inventory §4].

### 5.1 Button (`.btn`)
- Anatomy: optional icon (20 px) + verb label; 2 px border; radius control.
- Kinds: primary (noche fill), outline (page fill, edge border), danger (rojo,
  names its target: «Cancelar el pedido YT-100018»), on-band (cal fill with
  `ink-fixed` text on dark bars), ghost-band (transparent with cal border),
  link-button.
- **Which kind cancels.** A shopper cancelling their own order, or leaving
  anything they own, uses an **outline** button (it is a service, not a
  danger). Staff and sellers acting on someone else's order, account or
  product use the **danger** button inside the danger zone. Both open the
  same confirmation dialog (§5.19, `confirmar.html`): the consequence in one
  sentence, the reason field, and a final button that repeats the action.
- Sizes: web 48 (default), 44 (`.btn-sm`, work tools and secondary); phone
  apps 52 (default), 48 (`.btn-sm`), 56 (`.btn-lg`, and every driver action),
  64 (`.btn-xl`, the driver's fixed action) — in the phone frames and in the
  web field app alike. Never under 44 anywhere, also with a mouse (replaces
  `buttonClass` size `sm`, 36 px). Label type: `button` 16/20 (web),
  `button-app` 17/22, `button-xl` 20/24.
- States: rest; hover = label underlined (outline: ink border); focus = ring §2.3;
  pressed = moves 1 px down with an inner 3 px shade; disabled = band fill, dashed
  edge, muted text, `aria-disabled`; loading = the label becomes what is happening
  («Agregando…»), `aria-busy`, a 2 px bar under the label (static under reduced
  motion), width unchanged; error = not a button state (the field or notice says it).
- Rules: label fits one line at 390 (X5); labels wrap between words only, never
  inside a word; one primary per region; at most one danger per region,
  confirmed once (dialog) or undoable (§5.28).
- Replaces: `packages/ui` `Button` and `buttonClass()` (78 calls), next-kit
  `SubmitButton`, expo-kit `Button`, `LinkButton`, `IconButton` (icon buttons get
  a word, X6). Today's kinds and sizes map as in §2.5.5; the old prop values
  stay accepted until step 4 ends. Phone sizes are a prop (`size`), never
  inferred from the platform: `default` 52, `sm` 48, `lg` 56, `driver` 56,
  `driverFixed` 64.

### 5.2 Field (`.field`) and choices
- Anatomy: label (15/20 Fira 600, always visible, above) · hint (14, muted) ·
  error message (15 Fira 600 rojo with `!`, **above** the input) · input.
- Input: 48 px web, 52 px phone app, 2 px edge, radius control; hover: ink edge;
  focus: ring; disabled: band fill, dashed edge; read-only: band fill, no edge;
  error: 3 px rojo edge + message + `aria-invalid` + the typed value kept.
- Select: same box with the drawn chevron. Textarea: 112 px minimum.
- Checkbox / radio (`.check`): 24 px box, 2 px edge, the whole row ≥ 44 px (48
  in apps); on = primary fill with a cal check; disabled = dashed. Consent and
  marketing boxes start unticked.
- Choice row (`.choice`): radio + bold title + one sentence of what happens next;
  selected = 3 px ink edge. Nothing pre-selected at checkout except the
  shopper's own address.
- Replaces: ui `TextField`, `SelectField`, `TextAreaField`; expo-kit `TextField`,
  `ChoiceList`, `Checkbox`; the 3 pin pickers and 2 district pickers become one
  `DistrictPicker` (T12 drawing) and one `PinPicker` per platform.

### 5.3 Status stamp (`.tag`) and count badge (`.count-badge`)
§4.3. Count badge: noche square 24 px, 14 px bold, only for actionable counts
(cart, orders to pack, items to decide). Replaces ui `Badge`, `OrderStatusBadge`,
`ShipmentStatusBadge`, `InvoiceStatusBadge` and their copies in
`seller-native/src/components/parts.tsx`.

### 5.4 Notice (`.notice`) and error summary (`.errsum`)
- Kinds: ok (selva 3 px top rule + check), info (ink rule), warn (maíz fill, noche
  text), err (3 px rojo border, `!`), offline (band fill, cut-signal icon).
- First line says what happened (bold), second what to do. No pastel fills.
- Error summary at the top of any form with errors: «Revise N dato(s) para
  continuar», each a 44 px link to its field; focus moves to it on submit.
- Replaces: ui `Alert`, next-kit `FormMessage`, ops `catalogue-outcome.tsx`
  (becomes `Notice` in next-kit), expo-kit `Alert`, `FormMessage`.

### 5.5 Delivery strip (`.strip`)
`.strip.banda-marca` (version 1, decided 5A). Wheel 24/28 + one sentence (two
lines at most at 390) + zone link 44 px; the row wraps, so at 200 % text the
link goes under the sentence. Shop pages only, under the header, never in
checkout, order, account or work tools. On desktop the strip is the only place
that asks for the zone (the header has no zone link).

**The one strip text** (order first, then the result; «hoy» belongs to the
order, never to the delivery): «**Pida hoy antes de las 2 p. m.** y le llega
mañana, en el GAM.» plus, from 900 px, «Con nuestros propios repartidores.»
With a zone chosen: «Pida hoy antes de las 2 p. m. y le llega mañana,
**miércoles 25 de noviembre**, en San Pedro.» The time comes from the cut-off
in the database and is written by `formatTime` (§3 rule 8).

### 5.6 Route line (`.linea`) — §4.5.

### 5.7 Product card (`.card`)
Photo 1:1 on photo ground (optional «Hecho en Costa Rica» plain stamp), brand
(14 muted), name (16 Fira 500, whole card is the link via `::after`), rating
(stars decorative, number + count written; stars hidden on phones), price
(`t-price`), old price + discount stamp, unit price, «Vendido por …», «Entregado
por Yuntera» or the date in achiote. Grid: 2 across under 900, 3 with filters,
4 without. The card price may break inside the number when it does not fit
(a long price at 200 % text) rather than push the page sideways. Replaces ui `Card` (0 uses), `Price`, `Stars`, next-kit
`ProductImage`, shop-native `ProductCard`, `ProductGrid`, `Stars`, `ProductImage`.

### 5.8 Seller block (`.seller`, `.shopface`) — §4.4. Replaces next-kit `ShopLogo` placement rules.

### 5.9 Quantity stepper (`.qty`)
− output +; 48 px buttons (44 in cart lines); updates without an "Actualizar"
button; − disabled at 1 (dashed), «Quitar» is a separate link-button.

### 5.10 Definition rows (`.rows`) and facts (`.facts`)
Term and value; the value wraps under the term when space or text size demands
(fixes the 48 × 36 px buy-box overlap at 200 %). Facts in a narrow panel stack
(container query at 420 px). Replaces the 22 hand-made `<dl>`.

### 5.11 Tabs row (`.tabs-row`) and section navigation
Saved views (A) and in-page views: 44 px items, current = bold + 3 px ink
underline + `aria-current`; the row **wraps**; it never scrolls out of sight
(N3, S3). Counts in brackets in muted text.

### 5.12 Money (`Price` component, web and phone)
`t-price-xl` (buy box, totals) or `t-price` (cards, lines, summaries), in
Epilogue with lining tabular figures. Every one of the 190 `formatPrice()`
display sites that shows a price as a figure (not inside a sentence) uses
`Price`; prices inside sentences stay Fira.

### 5.13 Table (`table.t`, `DataTable`) — §9
Its layout is chosen by the width of its frame in `em` (container queries), so a narrow screen and 200 % text get the same answer.

```ts
DataTable<Row>({
  caption: string,                      // visible or .sr, always present
  columns: Array<{ key: string; label: string; render: (row: Row) => ReactNode;
                   sort?: "asc" | "desc" | true;   // header becomes a button with aria-sort
                   frozen?: boolean;               // T7b key column (at most two, the first human)
                   align?: "start" | "end";        // money: end, tabular
                   under?: string }>,              // T7b: shown under the frozen name (status, total)
  rows: Row[], rowKey: (row: Row) => string,
  layout?: "cards" | "compare",         // T7a (default) or T7b
  sort?: { key: string; dir: "asc" | "desc"; href: (key) => string },  // a link per header, server-sorted
  selectable?: { name: string; label: (row: Row) => string },        // checkboxes posted with the bulk form
  bulk?: ReactNode,                     // the bulk bar (§5.14), shown when one row or more is chosen
  empty: ReactNode,
})
```

Server component; sorting is a link (`?orden=`) read on the server, so no
client state. Selection is the only client island: a small component that
counts the ticked boxes for the bulk bar; the boxes are ordinary `<input
type="checkbox" name=…>` inside the bulk `<form>`, so the Server Action reads
them without JavaScript. In `cards` layout the head is not drawn and the
filters row shows «Ordenar por» (a select of the sortable columns). The old
signature `DataTable({caption, head, children})` stays as an adapter (cards,
no sort) until its 17 calls (in 10 ops files and 4 seller files) have moved.

### 5.14 Bulk bar (`.bulk.banda`)
Appears when ≥ 1 row is chosen; says «N <rows' noun> elegidos» with the noun of what the rows are («2 pedidos elegidos», «3 paquetes elegidos», «1 producto elegido»); actions as on-band /
ghost-band buttons; «Quitar la selección» link; wraps on phones.

### 5.15 Detail panel / detail page (`.detail`, `.side-panel`, `.danger-zone`)
A's structure. Main column: line, facts, packages (table → cards), money,
history as sentences («Laura Quesada cambió … de «X» a «Y». martes 24 de
noviembre, 9:42 a. m.»). Side: primary actions, then the danger zone under a
2 px ink rule, with its consequence in one sentence and one danger button.
Panel beside the table from 1200 px; under that, «Abrir el pedido» goes to the
detail page. The danger button opens the confirmation dialog (§5.19).

- **One notice per page.** When several conditions hold at once (unpaid,
  stopped, waiting for another route, a package coming back), the page shows
  one `.notice` whose first line is the most urgent condition (order: money
  first, then a stopped parcel, then a failed attempt, then waiting) and whose
  next lines are the others, one sentence each. Conditions of one package
  are its stamp on the package row, never a second notice.
- **When the shopper may cancel.** The shopper's «Cancelar el pedido» (outline,
  in «¿Cambió de opinión?») shows only while `cancel_order` would accept it for
  them [P, migration 082900]: order status `pending_payment`, `payment_review`
  or `confirmed`, with every shipment still `pending`. From `processing` on,
  the section says «Ya empezamos a prepararlo, así que no se puede cancelar. Si
  no lo quiere, puede devolverlo cuando lo reciba: tiene 8 días hábiles y le
  devolvemos ₡…» and links «Cómo devolver un producto» (drawn on
  `pedido.html`). After delivery it becomes «Pedir una devolución». Staff can
  still stop an order while it is being picked (danger zone), not once a
  package is packed.

### 5.16 Decision queue item (`.qitem`) — T8.
Thumbnail (96), kind + waiting time, the reason in bold, one sentence of
context; approve (primary) and refuse (outline) with a labelled reason field.

### 5.17 Task row (`.task`) and key value (`.kv`) — T6
Task: optional `warn` stamp on the single most urgent, name, deadline, 44 px link,
count in the `count` step (Epilogue 800, 34/34); zero counts collapse to one muted line, with no link (there is nothing to open).
Replaces next-kit `Stat` and the seller-native `Stat`, `StatGrid` (S9, tell 13).

### 5.18 Empty, error, offline, loading — §11.

### 5.19 Overlays: sheet, drawer, dialog, menu
10 px radius on the open side, `--yt-elevation-overlay`, 55 % noche scrim,
«Cerrar» button with its word, focus trapped and returned, Escape closes.
The confirmation dialog of an action that cannot be undone (`confirmar.html`):
title as the question («¿Cancelar el pedido YT-100018?»), the consequence in
one sentence with the amount, the reason field (optional for the shopper,
required and sent to the shopper for staff), then «No, mantener el pedido»
(outline) and the final button that repeats the action (primary for the
shopper, danger for staff).

### 5.20 Disclosure (`details.more`)
44 px summary, underlined like a link, chevron drawn in CSS. Replaces the 39
hand-made `<details>`.

### 5.21 Breadcrumbs (`.crumbs`)
Links 44 px tall and wide; the current page as text with `aria-current`.

### 5.22 Lockup in the interface (`.lockup`)
Mark image + `wordmark` (Epilogue 800, −0.03 em) + descriptor (600, 62 %);
44 px target. Shown on shop pages, back-office bars, phone home and sign-in
only (A6). Replaces ui `YunteraLogo`, `YunteraMark` (0 uses), expo-kit `Logo`.

### 5.23 Phone app frame parts (expo-kit)
- `Screen`: safe areas top (status bar) and bottom (home indicator), 16 pt gutter.
- `StackHeader` (`.nav-h`): back = chevron + the previous screen's name (48 pt),
  title 17/24 Fira 600, optional action with a word. The title names the
  screen or its category («Audio y audífonos»); the content's own heading
  (the product name) is the first heading inside the body. No header action
  repeats a tab (no cart icon in the product header: the tab bar has
  «Carrito»).
- `AppBar` (`.app-top`): identity bar for vende (cacao), ruta (añil), bodega (cal
  + 3 px ink rule). **Every tab root carries the AppBar in the app colour;
  only Inicio shows the lockup; the other tab roots show the tab word as the
  title** (`app-vende.html`, Pedidos). Stack screens pushed above a tab root
  use the `StackHeader`.
- `TabBar`: 3–5 tabs, 24 pt icon + one word (13/18), current = ink + bold +
  3 pt top bar, hidden only under a modal. Badges (13/18 bold) sit on the
  icon's top right corner, never over the word, only for actionable counts.
  **Large text:** the label stays on one line and never breaks inside a word;
  it grows with the system text size up to 1.6× and then shrinks to fit its
  tab, never under 13 (React Native: `numberOfLines={1}`,
  `adjustsFontSizeToFit`, `maxFontSizeMultiplier={1.6}`,
  `minimumFontScale` so the result is ≥ 13). The tab's accessible name is
  the full word plus the badge («Carrito, 3 productos»).
- **iOS and Android.** The drawings are iOS frames plus one Android frame
  (`app-ruta.html`, «Parada en Android»). Rules:

| | iOS | Android |
|---|---|---|
| Back | chevron + the previous screen's word, top left; edge swipe | arrow without a word in the top bar (accessible name «Volver a …»); the system back gesture and button do the same |
| Screen title | centred in the `StackHeader`; left in an `AppBar` | left-aligned in both bars |
| Press feedback | the 1 px move + inner shade of §5.1 | the platform ripple (`android_ripple` in ink at 12 %) instead of the move; same colours |
| Safe areas | status bar 47 pt, home indicator 34 pt | status bar and the gesture or 3-button navigation bar insets from `react-native-safe-area-context`; content never under them |
| Haptics (warehouse, driver) | accepted read: light impact; refused read: three heavy notifications | accepted: `CONFIRM`; refused: `REJECT` + three long vibrations |
| Status bar in dark | light content on the dark page; light content on every identity bar (cacao, añil, noche), dark on the bodega cal bar | the same, with `StatusBar` `translucent` and the bar colour behind it |
| Elevation (overlays only) | the overlay shadow | elevation 8 |
- `RowList` (`.rowlist`): grouped rows ≥ 56 pt, title + muted second line +
  chevron. Replaces expo-kit `ListRow`, `InfoRow`, `Divider`, `SectionHeader`,
  `Card` (91 uses become rows or bands) and the 24 hand-written `Pressable` rows.
- `SegmentedViews` (new, step 2): the phone form of a tabs row — 2 to 4
  views as 48 pt buttons in one bordered group, current = primary fill +
  `accessibilityState.selected`, the group wraps to two rows at large text,
  never scrolls sideways. Used for saved views on phone lists (seller-native
  Inventario: «En su bodega · En la bodega de Yuntera · Envíos»).
- **Links inside a phone screen** are never inline text links: a link is a
  `RowList` row (≥ 56 pt) or a `link-button` (≥ 48 pt). Rows with a zero
  count carry no link at all (`app-vende.html`). The web keeps its inline
  links inside sentences (WCAG 2.5.8 exception), the phone apps do not.
- **Dark appearance** (phones only): `ThemeProvider` at the root reads
  `useColorScheme()` and gives `useTheme()` → `{colors, scheme}`. Colours are
  never read at module level: `StyleSheet.create` holds sizes and layout only,
  and colours are applied inline from `useTheme()` (or through a
  `makeStyles(theme => …)` helper called inside the component). The 34
  `StyleSheet.create` blocks that read `colors.*` today move in step 4 (the
  ratchet pattern «module-level StyleSheet reading colours» counts them).
  `userInterfaceStyle` becomes `automatic` only when an app's ratchet is 0.
- **Haptics** need `expo-haptics` (a native module: added by the dependency
  owner in step 1, shipped with the step-6 store builds). Until a build has it,
  `scanner/signal.ts` keeps `Vibration` with the same three tones it has today:
  accepted = one 40 ms pulse, warning = two 80 ms pulses, refused = three
  250 ms pulses. With expo-haptics: accepted `impactAsync(Light)` /
  Android `CONFIRM`; warning `notificationAsync(Warning)`; refused three
  `notificationAsync(Error)` 300 ms apart / Android `REJECT`.
- **Large text on the tab bar.** The rule above is what the phones do; a
  browser cannot draw it, so the plain «every font × 2» emulation of the HTML
  frames overlaps the labels by design. The capped result is drawn in the A2
  frame of `app-tienda.html` (labels at 15 after the cap and the shrink) and
  is checked on a phone in step 4.
- Every rebuilt element keeps its `testID` [P]. The check compares the
  **set** of testID strings per package (today 433 in `apps/*-native/src` and
  70 in `packages/expo-kit/src`) with a committed list
  (`tools/native-e2e/testids.json`), not one total: a testID may move from an
  app into expo-kit only when the list is updated in the same commit.

### 5.24 Scanner (`.scan`, `.camera`, `.refused`) — T17.
On the web (`apps/field`) codes come from typing or a hand scanner, which
types the code and presses Enter: the field's button is a submit button
that says «Buscar» (`enterkeyhint="search"`). There is no camera on the web.
The phone apps add «Cámara» beside the same field. The refused-scan button
is cal with the danger colour as its text (`danger` on `on-danger`: 7.75 light,
8.16 dark).

### 5.25 Fiscal document (`.fiscal`) — T9 sub-template.
Order and words of the tax format; a printable sheet (`@media print` hides the
chrome); the table becomes labelled rows under 640 px; download PDF / XML and
print as outline buttons. Replaces next-kit `FiscalDocumentView`'s styling only.

### 5.26 Result of a form (Server Action, `ActionState`)
After a mutation the page re-reads (`refresh()`) and the result appears as a
`.notice` **at the top of the form** that was sent: `ok` with what was saved
(«Guardamos sus avisos.») or `err` with what to do. Focus moves to it
(`tabindex="-1"`, `role="status"` or `alert`). It stays until the person
changes a field or leaves; it never fades on a timer. Field errors also stay
at their fields (§10). Drawn on `cuenta.html` and `sistema.html`. Replaces
next-kit `FormMessage` placement and ops `catalogue-outcome.tsx`.

### 5.27 Consent and settings choices: checkboxes, never a switch
Notification and marketing consent use `.check` rows that start unticked and
are saved with one button («Guardar avisos»), on every app (web
`cuenta/notificaciones`, seller, shop-native, seller-native). There is no
toggle switch component: a switch implies saving at once, and consent needs
a deliberate save and its sentence. The legal sentence about consent sits
under the boxes, above the button.

### 5.28 Undo
For a reversible action that removes something the person owns (remove a
cart line, remove a filter, remove a saved address): do it at once and show
a `.notice` with the sentence and a «Deshacer» link-button, for as long as
the page stays open (no timer). Anything that cannot be undone (cancel an
order, delete an account, refuse a product, a payout) uses the confirmation
dialog instead (§5.19). Never both.

### 5.29 Pager (`.pager-t`)
What is shown in words («Mostrando 1–7 de 214 pedidos. Página 1 de 31.»),
«Anterior» and «Siguiente» as 44 px outline buttons (Anterior disabled on page
1: dashed, `aria-disabled`), and in tables longer than 5 pages a labelled
«Ir a la página» field with «Ir». When everything fits: one sentence
(«Página 1 de 1. Ya ve sus 4 productos.»), no buttons. Drawn on `consola.html`.

### 5.30 Dates typed
A text field with the format in the label («Desde (dd/mm/aaaa)»),
`inputmode="numeric"`, and an outline «Calendario» button beside it that
opens the system picker (`<input type="date">` picker on the web, the
platform date picker on the phones). No calendar component of our own. The
error says the expected form in words («Escriba la fecha como 25/12/2026.»).

### 5.31 Upload of photos and logos
Each slot shows its state in words: «Subiendo foto 2» with a 8 px bar and the
per cent; failure in rojo with `!`, «No se pudo subir la foto 3.» and
«Intentar otra vez»; the other photos are kept. Maximum size and formats in
the hint before choosing. Drawn on `vende-publicar.html` and `sistema.html`.

**Photo manager row** (seller `productos/[id]`, seller-native `editar/[id]`):
one row per photo, in order: thumbnail 96 · «Foto 2 de 5» · its state stamp
(Subiendo ◐, En revisión ◐, Publicada ✓ ok, Rechazada ! err with the reason in
a sentence under it and «Quitar la foto 2» as the action) · a field «Qué se ve
en la foto» (alt text, required for publishing, 120 characters) · «Subir un
lugar» and «Bajar un lugar» as 44 px outline buttons whose accessible names
carry the number («Subir la foto 2 un lugar»; the first has no «Subir», the
last no «Bajar») · «Quitar la foto 2» as a link-button that removes at once
and offers «Deshacer» (§5.28). Under the rows, one «Guardar orden y textos»
(outline) and, when files are chosen, «Subir 3 fotos» (primary). On a product
that is already published a notice sits above the rows: «Los cambios de
fotos se revisan antes de publicarse. La foto actual se queda mientras
tanto.» No drag and no crop in this rebuild. The 604-line `photo-manager.tsx`
is split into `PhotoList` (server, rows), `PhotoRow`, `PhotoUpload` (client
island) and `photo-actions.ts`.

### 5.32 Human check (sign-up)
`HumanCheck` sits in its own labelled block («Confirme que es una persona»)
directly above the final button of the sign-up form, never at the top; when
it fails, the error summary names it like any other field.

### 5.33 Variant choice (product page)
A product with variants (`option.variant_name` offers [P]) shows them in the
buy box above the quantity: up to 6 as choice rows (`.choice`, the variant
name in bold and its price and date in the sentence: «Negro · ₡19 500 · llega
el viernes 27»); more than 6 as a labelled select «Elija el color» (the
attribute name). Choosing one updates the price, the date and «Agregar al
carrito» on the server (a link per variant, `?variante=`), with no client
state. Nothing is pre-selected when the variants differ in price; the first
in stock is pre-selected when they do not.

### 5.34 Password field
«Contraseña» with an outline 44 px «Mostrar» button inside the field's row
(«Ocultar» when shown; `aria-pressed`), on the web and the phones (shared
`SignInForm` in next-kit, `auth/forms.tsx` in expo-kit). New behaviour: a
journey step shows, types and hides. The 6-digit code field uses the
`code-entry` step on the web and on the phones (`textContentType=
"oneTimeCode"`, `autoComplete="one-time-code"`).

---

## 6. Grid and breakpoints

| Breakpoint | What changes |
|---|---|
| < 600 | Tracking line vertical; `hist` and `facts` stack. |
| < 360 | Department list one column; product title above the photo; «Ayuda» leaves header row 1 (header stays 2 rows). |
| frame < 40em | Card-list tables become cards (T7a); a container query on the table frame, so it also happens at 200 % text. |
| frame < 36em | Comparison tables become T7b (frozen key columns, the rest slides in the frame). |
| < 640 | Fiscal table becomes rows. |
| < 900 | Phone header (2 rows, 119 px measured, ≤ 120); department bar hidden (departments live on the home and in «Todas las categorías»); back-office side bar → top bar + drawer. |
| ≥ 900 | Desktop header (122 px measured: one row of 72 plus the department bar), side bars, filters column, buy box column. |
| ≥ 1100 | Dashboards two columns. |
| ≥ 1200 | Console detail panel beside the table. |

Shop: max content 1312 px with 32 px side margins (1248 inside), 16 px at 390;
product grid gap 24/32. Work tools: full width, side bar 248 px, main padding 32.
Phone apps: 16 pt gutter, no wide layout.

---

## 7. Navigation of each app

| App | Desktop | Phone width | Notes |
|---|---|---|---|
| web (shop) | Sticky header: lockup, search with visible label and «Buscar», account, cart + count (no zone link: the strip under the header asks for the zone). Row 2: «Todas las categorías» (plain bold link), 5 departments, «Más (9)», «Ayuda», «WhatsApp». Hides on scroll down, returns on scroll up; `scroll-padding-top` = header height (122). | Row 1: lockup, Ayuda, Ingresar, Carrito N. Row 2: label + search + Buscar. 119 px [M]. Departments on the home (6 + «Todas las categorías (14)»). | Footer: facts strip; «Dónde entregamos» first (the five areas as links to the zone check, and «Vea si llegamos a su distrito»), then the Ayuda and Yuntera lists (44 px links), legal line. No tagline. Checkout and sign-in use the closed header (lockup, Ayuda, Volver). |
| seller | `AppShell` with cacao side bar: lockup, shop name + «Cambiar de tienda», 8 sections (Resumen, Productos, Tienda, Inventario, Pedidos N, Pagos, Equipo, Cuenta), «Su cuenta · Salir». | Cacao top bar + «Secciones» drawer. | Replaces the sideways-scrolling `NavLinks` row. |
| ops | Noche side bar, 22 sections in 6 groups: Hoy (Resumen, Pedidos, Atención, **Casos**, Mensajes) · Entrega (Despacho, Operación, Repartidores, Bodegas, Liquidaciones) · Catálogo (Catálogo, Ofertas en pausa) · Vendedores (Vendedores, Cambios de tienda) · Dinero (Cobros, Pagos a vendedores, Comprobantes) · Administración (Personal, Auditoría, Seguridad, **Salud del sistema**, **Versiones**). Casos, Salud del sistema and Versiones are being built now (task 46, §8.2); they take their place here with the roles of the research note (Casos: support, ops, finance, catalog, admin; Salud: admin plus each role's rows; Versiones: admin). Cliente (`/clientes/[id]`) is not in the bar: it is reached only from an order or a case. Filtered by role; a group with no visible section is not drawn. Sub-sections (Catálogo 8, Operación 7, Cobros 4) open **indented under their section** when it is current. | Noche top bar + «Secciones» drawer with the same two levels. | One `SideNav` replaces `NavLinks menu`, `catalogue-nav.tsx`, `operations-nav.tsx`, `payment-nav.tsx` (38 links). |
| field | No side bar. Home `/` chooses Ruta or Bodega: two full-width choice rows with a 2 px edge, each with the app's own icon (48 px) as its picture, the app word, one sentence and a chevron; no coloured edge. Shown only to people with both roles. Ruta bar añil, Bodega bar cal + 3 px rule; the bar holds the page H1 (Fira 600 18/24) and ends with Cambiar, Cuenta. | Same. | Driver fixed action 64 px at the bottom. |
| shop-native | — | Tab bar: Inicio, Categorías, Buscar, Carrito (badge), Cuenta. Stack screens with `StackHeader`; zona as a modal sheet. | Logo on home and sign-in only. |
| seller-native | — | Cacao `AppBar` on every tab root (lockup on Inicio, the tab word on the others; Cuenta at the end); shop name + Cambiar on Inicio. Tabs: Inicio, Pedidos (badge), Productos, Inventario, Pagos. Tienda and Equipo inside Cuenta. | |
| driver-native | — | Stack only. Home = route line under the añil `AppBar` (title «Ruta 3 · martes 24», Cuenta at the end); Parada, Su ubicación (modal), Su cuenta are stack screens above it, each with the añil bar and a back control. Sign-out is the last row of Su cuenta (outline button), never in a bar. | Offline queue notice on top of the list. |
| warehouse-native | — | Stack only. Home = scan field + task list under the cal bar. | Camera, hand scanner and typing on every scan screen. |

---

## 8. Templates

For each: the layout at 390 and at 1280, how the phone app builds it, and the
reference page. Screens per template: inventory §5.

| # | Template | 390 px | 1280 px | Phone app | Reference page |
|---|---|---|---|---|---|
| T1 | Shop home | Header, strip, «Departamentos» with «Todas las categorías (14)» and 6 departments, then «Hecho en Costa Rica» 2 across with prices on the first screen. | Department list column (240) + main: Hecho en Costa Rica (4), Quién le vende (4 sellers), Lo que más se está llevando (8), footer. | Lockup + zone, search with label, strip, same content, tab bar. | `home.html`, `app-tienda.html` |
| T2 | Product list with filters (+ seller storefront, + category index) | «Filtrar y ordenar (2)» 48 px opens one sheet (sort first, filters, «Ver N productos» fixed); applied filters as a row of 44 px chips with ✕ and «Quitar todos» between the toolbar and the grid; grid 2. | Filters column on band (260) + toolbar (title, count, sort select) + the same applied-filters row + grid 3 + pager sentence. Storefront: `shopface` header, no filters column. Category index = `depts` list full width. | Same; the sheet is a native modal. | `lista.html`, `lista-filtros.html`, `tienda.html` |
| T3 | Product page | Title beside a 128 px photo (above it under 360), buy box band full width: price, date, quantity, Agregar al carrito (the only button), envío, seller, rows; then the description and its facts as `.rows` (no bullet list); sticky buy bar after the buy box scrolls away, and the page end padded by the bar's height. | Photo · info and facts as rows · buy box (340) on band; offers («Agregar esta oferta al carrito», outline), reviews, similar. No «Comprar ahora». | Photo full width, stack header, buy box band, tab bar stays. | `producto.html`, `app-tienda.html` |
| T4 | Cart and checkout | Lines (88 photo), summary band below; checkout: closed header, K1 entry (pending), route line 1–3, error summary, fieldsets, summary under. | Lines + summary column (380). | Cart tab; checkout as stack screens, one step each, the same line at the top. | `carrito.html`, `pago.html` |
| T5 | Shopper order + own orders list | Title + stamp, notice, code block (largest thing), vertical line with the wheel, date, packages, products, invoices, history, then summary, help, cancel. | A's two columns: content + side stack (summary band, ¿Necesita ayuda?, ¿Cambió de opinión?). | Same order, stack header «Pedidos». | `pedido.html`, `pedidos.html`, `app-tienda.html` |
| T6 | Dashboard of tasks | Tasks list (most urgent first, one warn stamp, zero rows collapsed), then figures as `kv` rows. | Two columns (3:2). Field `/` uses the two-card chooser variant. | Same under the app bar. | `vende-inicio.html`, `central-resumen.html`, `bodega-tareas.html`, `campo.html`, `app-vende.html`, `app-bodega.html` |
| T7 | Table with filters, summary, bulk | T7a card list (default) or T7b narrow table with frozen columns (when rows are compared: Despacho, Pedidos, Liquidaciones, Pagos a vendedores, Auditoría). Filters stack (card lists add a visible «Ordenar por»); saved views wrap; bulk bar wraps. | Page head, saved views, filters row, bulk bar, table (no fixed height; the head sticks to the page), pager (§5.29), detail panel ≥ 1200. | Row list with stamp + money (T7a). | `consola.html`, `vende-productos.html`, `app-vende.html` |
| T8 | Queue to decide | One item per block: thumbnail (the shopper's photo for a return; the chat icon for a complaint), kind and waiting time, the request in bold, one sentence of context with the amount, approve («Aprobar la devolución de ₡26 500») / reason field / refuse stacked. | Three columns per item (120 · text · 300 actions). Empty end state as a sentence. The side-bar badge equals the number of items in the queue. | Same as rows with two buttons. | `central-atencion.html` (Atención: return and complaint), `central-catalogo.html` (Catálogo › Productos por revisar), `vende-invitaciones.html` |
| T9 | Detail with actions (+ fiscal document) | A's structure in one column, actions after the content, danger zone last. | Content + 300–340 side panel of actions. Fiscal: printable sheet. | Same, stack header. | `central-pedido.html`, `comprobante.html`, `vende-comprobante.html` |
| T10 | Long form | Error summary, sections under 2 px rules (numbered only if a real sequence), photo slots with an in-scale slot, sticky submit bar. | Max 720 wide, two fields per row from 700. | Stack screens; submit fixed above the home indicator. | `vende-publicar.html` |
| T11 | Settings, reference lists, account hub | Hub rows (title + current value + chevron); lists with inline edit / remove naming the item; add row on band. | Same, max 720 for the shopper; full width in tools; sub-sections in the side bar. | Row list; logout as outline button; «Eliminar mi cuenta» in danger text at the end. | `cuenta.html`, `central-feriados.html`, `vende-invitaciones.html`, `app-tienda.html` |
| T12 | One-question form | Title as the question, one field with label and hint, matches as choice rows, one primary naming the result («Guardar San Pedro, Montes de Oca»). | Same, 560 wide. | Modal sheet (zona) or stack screen. | `zona.html` |
| T13 | Sign-in and recovery | Closed header, form (correo, contraseña + Mostrar), Ingresar, recovery link; «¿Primera vez?» under a rule; verify step = one 6-digit field with `one-time-code`. | Two columns (440 + rest). | Lockup above the title (A6), error above the field. | `ingresar.html`, `app-tienda.html` |
| T14 | Notice page (not found, error, offline, destructive confirmation, done, no access, permission) | `!` disc (never the wheel), title says what happened, one sentence, the next step as buttons; destructive confirmation lists consequences and needs the typed word, danger button names the action. Cancelling an order is a dialog over the page, not a page. | Same, 640 wide. | Same; driver permission screen explains before the system prompt. | `avisos.html`, `confirmar.html`, `app-ruta.html` |
| T15 | Help and legal | Title, opening hours sentence, contents links (44 px), prose ≤ 68 characters per line. | Contents column 280 + prose. | Stack screen. | `ayuda.html` |
| T16 | Route and stop | Añil bar with the H1 at `h3`; summary sentence; vertical line of stops (recipients' full names) with the wheel at the current one; open the current stop. Stop: the recipient (`title`), stamp «Por entregar», señas first (`field-lg`), Código Plus, 2 × 2 actions 56 px, cash on maíz with «Más información», «Llegué» 64 fixed; then code entry field (empty), «Entregar», «No pude entregar». The fixed bar pads the page end by its height, and over 20 % of the screen (large text) it stops being fixed. | Same (phone-first tool). | Same; offline queue notice; one Android frame. | `ruta.html`, `ruta-parada.html`, `ruta-entregar.html`, `app-ruta.html` |
| T17 | Scanner task | Scan field first («Escanee o escriba cualquier código») with a «Buscar» submit (hand scanners press Enter), the current line: location (`loc`), product, quantity; refused scan fills the screen in rojo and must be acknowledged; sound and haptic patterns noted outside the screen. | Same. | Camera frame + typed field + hand scanner; refused scan drawn in light and dark. | `bodega.html`, `app-bodega.html` |
| T18 | Message frame | 600 px table e-mail: PNG lockup, 3 px ink rule, Arial title, one ink button, band footer that starts with the reason line of that message; achiote only for the arrival line; WhatsApp plain text, first line says what happened. | — | — | `mensajes.html` |

**Hybrids** (inventory §5): seller `productos/[id]` = T9 frame + T10 sections
(the photo manager row of §5.31); ops `catalogo/categorias` = T11 tree (§8.1);
ops `operacion/distritos` = T12 + T7a with a review step (§8.1); field `/` = T6
chooser (`campo.html`); driver `ubicacion` = T14 permission variant
(`app-ruta.html`); fiscal document = T9 sub-template.

### 8.1 Decisions for screens without their own drawing

The judge sampled 15 inventory screens and listed what a builder would still
have to ask. Each point is decided here; the template and its reference page
give the rest.

| Screen (template) | Decided |
|---|---|
| web `reportar` (T12) | Reasons as `.choice` rows (Producto prohibido o peligroso · Copia de una marca · Información falsa · Precio abusivo · Otro, con un campo «Cuéntenos qué pasa», required only for Otro). The reported product or seller sits at the top as a one-line row (photo 48 + name + «Vendido por …»). Done state: an ok notice on the same page («Recibimos su reporte. Lo revisamos en 1 día hábil.») and a link back. A visitor without an account may report; the e-mail field is optional and labelled «Su correo, si quiere respuesta». |
| web `cuenta/notificaciones` (T11) | `.check` rows, no switch (§5.27); one «Guardar avisos» for the page; the legal sentence under the boxes; result notice at the top (§5.26). |
| seller `pagos` (T7 + summary) | Summary row = three `.kv` rows above the table (Por pagar, Próximo pago with its date, Pagado este mes), not tiles. Payout stamps: Programado ○, Transferido ✓ ok, Fallido ! err (§4.3). Fee invoices: a second table «Facturas de comisión» with month, amount and «Ver» (T9 fiscal, `vende-comprobante.html`). Negative amounts with the real minus `−₡2 268` in ink (never red alone), with the word «descuento» in the row. |
| seller `registro` (T10) | Not numbered (the sections can be filled in any order): Su tienda · Quién es usted · Cuenta para pagos · Revisión. HumanCheck above «Enviar a revisión» (§5.32). IBAN field: label «Cuenta IBAN (CR + 20 números)», `inputmode` text, grouped as typed; error «Escriba la cuenta IBAN completa: CR y 20 números.» |
| seller `inventario` (T7) | Stock movements as a T7a table: date, product, `+12` or `−2` with the word (Entrada, Venta, Ajuste), who. History as sentences only in a product's detail (T9). Inbound shipments are a separate saved view «Envíos a la bodega» in the tabs row. |
| ops `despacho` (T7b + bulk) | One checkbox group: parcels. Routes are a filter (select «Ruta») and a column, not a second checkbox group. «Agregar a una ruta» opens a dialog (§5.19) with a select of today's routes, each with its capacity in words («Ruta 3: 8 de 12 paradas»). A full route is shown in the select as «(llena)» and cannot be chosen. |
| ops `liquidaciones` (T7 + action) | The row action opens the detail in the side panel (≥ 1200) or the detail page. A cash difference is shown as «Faltan ₡1 500» or «Sobran ₡500» with a `warn` stamp, and confirming it needs a reason in the danger zone (§5.15). |
| ops `cobros/revision` (T8) | The thumbnail is the SINPE receipt image the shopper uploaded (96 px; opens full size in a dialog). Expected and received amounts side by side as `.facts` («Esperado ₡29 400 · Recibido ₡29 400»); a difference gets a `warn` stamp and the word. |
| ops `operacion/distritos` (T12 + T7a + review) | Follows the flow the page has [P, `operacion/distritos/page.tsx`]: (1) a select «Cantón»; (2) the districts of that cantón as a T7a card list of `.check` rows, legend «Elija los distritos que cambian», each row «San Pedro · 11501», its current zone as a stamp («Zona Este», «Zona propia, no la del cantón», «No se entrega» –), and «12 direcciones · 3 pedidos abiertos» in muted text; (3) one select «Pasan a» (a district has one zone, never several); (4) «Revisar el cambio» opens a review step on the same page: one sentence of consequence («3 distritos pasan a Zona Este. 41 direcciones guardadas y 7 pedidos abiertos cambian de zona; los pedidos ya pagados mantienen su costo de envío.») and «Cambiar 3 distritos a Zona Este» (primary) with «Volver» (outline). No matrix. |
| field `bodega/ubicacion` count (T17) | Quantity as a numeric field (52 px, `inputmode="numeric"`) with − and + of the stepper beside it; a difference with the system shows «Contó 36, el sistema tenía 38» and asks for a reason before «Guardar el conteo». |
| shop-native `direcciones/nueva` (T10 + PinPicker) | DistrictPicker order: provincia, cantón, distrito, each a select (the T12 search is the shortcut). Señas: textarea, 200 characters, the count shown. PinPicker: a map screen with a fixed centre pin and «Usar esta ubicación»; without location permission it opens on the chosen district. (Map drawing: §18.) |
| shop-native `(tabs)/buscar` (T2) | The label «Buscar en Yuntera» stays visible above the field inside the tab. Zero results: «No encontramos “cafetra”.» + «¿Quiso decir café?» as a link + up to 6 department links; no empty illustration. |
| seller-native `oferta/[id]` (T9) | Price and stock are inline fields in the detail (52 px), saved with one «Guardar cambios». Pausing the offer sits in the danger zone with one sentence («Deja de venderse hasta que la active.») and an outline button (it is undoable: «Activar la oferta»). |
| driver-native `cuenta` (T11) | Stack screen with the añil bar and back «Ruta»; sign-out is the last row as an outline button «Salir», with «Eliminar mi cuenta» in danger text under it. |
| shop `pedidos/[numero]` (T5) | **Payment panel**: while the order is unpaid, the page's one notice is the payment panel (warn): the amount, the SINPE Móvil number to pay, «Subir el comprobante» (upload of §5.31, one image) and the deadline in words («hasta hoy a las 2 p. m.»); after the upload it reads «Revisando su pago» (◐) with the uploaded image as a 96 px thumbnail. **Money section** under the products: refunds and returns as rows with their stamps (§4.3 words: «Dinero devuelto», «Aprobada: por recibir»), each with its amount. **Side stack** order: Resumen, ¿Necesita ayuda?, ¿Cambió de opinión? (cancel or the return sentence, §5.15), «Pedir una devolución» after delivery. **Code block** only from «Preparando su pedido» on (never while unpaid); it disappears once delivered. |
| seller `productos/[id]` (T9 + T10) | The photo manager row of §5.31; variants as one T10 section «Variantes» with a row per variant (name, price field, stock field, «Pausar esta variante» link-button); the notice that changes to a published product are reviewed sits at the top of the form. The page splits into `page.tsx` (data), `ProductForm`, `PhotoList`, `VariantList`, `DangerZone`. |
| ops `catalogo/categorias` (T11 tree) | A nested `<ul>` (three levels at most, as the page says today), 24 px indent per level with a 2 px `rule` line on the left of each level. Each row: the name, a muted line «14 productos · oculta» when hidden, and a «Cambiar» disclosure (§5.20) holding: «Nombre» field; «Mover dentro de» select (refuses a fourth level with the sentence «Una categoría puede tener hasta tres niveles.»); «Subir un lugar» and «Bajar un lugar» outline buttons named with the category; «Ocultar con sus subcategorías» (outline; says how many products stop showing); «Eliminar la categoría» (danger) opening the dialog of §5.19 that names the category and its product count, refused while it has products. «Crear categoría» sits on a band at the top (name + «Dentro de»). |
| driver-native `parada/[id]` (T16) | Drawn on `ruta-entregar.html`: cash as a typed amount («Efectivo que le entrega el cliente») with the change sentence and the confirmation box, «Nombre de quien recibe», the 4-digit code field, then the three other states: attempts left after a wrong code, no signal when checking the code (the delivery needs signal; nothing is kept; «Intentar de nuevo» and «Dejar pendiente y seguir»), and the locked code (no code field; «Central ya lo desbloqueó: revisar de nuevo»). Every testID of the screen stays (`deliver`, `deliver-locked`, `deliver-recheck`, `attempts-notice`, `deliver-cash`, `deliver-change`, `deliver-cash-confirm`, `deliver-name`, `deliver-pin`, `deliver-offline`, `deliver-retry`, `deliver-later`, `deliver-message`, `deliver-submit`, `fail-open`, `fail-reason`, `fail-submit`, `stop-*`). Offline, only a failed attempt and «Llegué» are kept in the phone; a delivery is never kept (`app-ruta.html` now says so). |
| seller-native `(tabs)/inventario` (T7a) | Under the cacao AppBar, `SegmentedViews` «En su bodega · En la bodega de Yuntera · Envíos». En su bodega: when no pickup place exists, the notice «Falta registrar de dónde recogemos sus paquetes» with «Registrar el lugar»; else stock rows with an inline quantity. En la bodega de Yuntera: rows «12 en bodega · 3 apartadas» (Fira, no stamp) and «Enviar más a la bodega». Envíos: inbound shipments with their stamps (§4.3: Por enviar ○, En camino ◐, Recibido ✓, Con diferencias !). History stays on this tab as a T7a list under «Movimientos» (date, product, `+12 Entrada` / `−2 Venta`, who); the web keeps it in the product detail too. |
| ops `pedidos/[numero]` (T9) | One notice with the conditions in order (§5.15); per-package conditions as stamps on the package rows («Vuelve a la bodega», «Espera otra ruta», «Detenido»). «Confirmar la transferencia de ₡29 400» is a primary action in the side panel, above the danger zone, shown only while a bank transfer waits; the money section lists payments and refunds with their §4.3 stamps. «Mensajes» is a section after the history: one row per message sent (channel, template in words, time, its outbox stamp). |
| ops `despacho` (T7b + bulk), completed | Bulk text «N paquetes elegidos». Saved views in the tabs row: «Listos para salir (N) · Volvieron sin entregar (N) · Rutas de hoy (N)»; «Rutas de hoy» is a T7a list of routes (driver first name + initial, stops «8 de 12», state stamp). The first, frozen column is the package code with the district («YT500018 · San Pedro»): for parcels this is the human key. |
| warehouse-native `(app)/index` (T17 home) | The cal bar with the lockup; then, only for people with more than one warehouse, a select «Bodega» (`warehouse-choice`) above the scan field; then the scan field; then two `RowList` rows «Buscar un producto» (`open-lookup`) and «Ubicaciones» (`open-locations`); then the task list (`warehouse-board`). The warning read («Leído, pero …») is a maíz notice under the field with what to check, and its own haptic tone (§5.23). |
| shop `p/[slug]` (T3) | Variants: §5.33. The reviews section anchor `#resenas` uses `scroll-margin-top: var(--yt-header-h)` (the measured header), not a fixed 28. |
| sign-in (T13), web and phones | «Mostrar» (§5.34) is new and gets a journey step in step 2; the 6-digit code uses `code-entry` on both platforms. |
| e-mail (T18) | The lockup PNG is served from `https://yuntera.cr/correo/yuntera-marca@2x.png` (`apps/web/public/correo/`, `Cache-Control: public, max-age=31536000, immutable`; a changed file gets a new name). `alt="yuntera"`; the first text line is the reason line, so a mail with images blocked still says who and why. `render.ts` stops writing `headerLabel` in capitals. `packages/notifications/src/brand.ts` keeps its own `mailColors` (mail must stay self-contained) and changes their values to Carreta in step 5: bg `#F3EEE6`, surface `#FFFFFF`, border `#D9D0C3`, ink `#1E1A16`, brand `#B8420F` (arrival line only), link `#1F47A8`. |
| warehouse-native `recibir/[id]` (T17) | One line per product of the shipment, each with the expected count and a quantity field; partial receipt allowed («Recibir 10 de 12»). A difference with the seller's count needs a reason chosen from Faltan · Llegaron dañados · Otro, worded «Llegaron 10 de 12. Faltan 2.»; the seller gets that sentence. |

### 8.2 Pages being built now with today's components (task 46: Casos, Salud del sistema, Versiones)

These pages are written before the rebuild, so they must be easy to carry.

1. **Use only components that get an adapter (§2.5.6):** `Badge` (with a
   `tone` taken from `statusWord()` once core has it), `Alert`, `buttonClass`/
   `Button`, `PageHeader`, `DataTable` in its old signature, `TextField`,
   `SelectField`, `TextAreaField`, `FormMessage`. No raw palette class, no
   hand-written `min-h-11`, no new `<details>`, no new component in `apps/ops`.
2. **Templates they become:** Casos list = T7 (T7a cards on a phone; saved
   views «Míos · Sin asignar · Vencen hoy · Atrasados»); a case = T9 (the
   request, the order summary, the timeline as sentences, «Nota interna» and
   «Respuesta al cliente» as T10 fields, «Responder», «Responder y cerrar»,
   «Asignarme el caso» in the side panel); Respuestas guardadas = T11;
   Cliente = T9 without actions, contact behind «Mostrar contacto» (writes an
   audit row); Salud del sistema = T6 (one task row per check, the count in the
   `count` step, «0» rows collapsed) + T7a for the failing items; Versiones =
   T7a (version, channel, date, state stamp).
3. **Words:** case states use §4.3 «complaints» words; «vence pronto» and
   «atrasado» are `warn` and `err` stamps with the word (never colour alone).
4. **Ownership:** their files belong to the task-46 builder until it merges;
   then they join the step-3 ops list (§20) and move with the rest of Hoy and
   Administración. `apps/ops/src/lib/staff.ts` gets their three nav entries from
   the task-46 builder; the step-3 ops owner turns the list into the grouped
   `SideNav` afterwards.

---

## 9. Tables on a phone

1. Default: **card list** (T7a) when the table's frame is under 40em (a
   container query, so a phone and 200 % text both get it). The first cell is
   the title (link to the detail); other cells show their column name; money
   sits top right in `price`; actions last. The head is removed
   (`display:none`), so a card-list table always carries a visible «Ordenar
   por» field in its filters row. No sideways scroll at 390, 320 or 200 %
   text [M].
2. Use the **narrow table** (T7b) only where people compare rows, when the frame
   is under 36em: key columns only (checkbox, the person/order with the status
   stamp **and the total** under the name), the first two columns frozen with a
   2 px ink edge (at most 60 % of the frame: 9em for the name column, 6.5em
   under 22em). The total rides with the name, so it stays visible however far
   the table is slid [M: before and after sliding, at 390 and 320]; the Total
   column itself shows only from 36em. The other columns (dates) slide inside
   the frame only, which carries the scroll padding of §2.3; a shaded cut-off edge on the right and
   a one-line hint above («Toque un nombre para ver el pedido completo;
   deslice la tabla para ver las fechas»). Measured on `consola.html`.
3. Desktop: the head sticks to the page (no fixed height on the frame, no inner
   vertical scroll); sortable headers are buttons with the order in words
   (`aria-sort` + hidden text); first column human (name, never an id alone;
   for parcels the package code with the district); the name column at least
   10em, date cells may wrap between date and time (the time itself never
   splits, §3 rule 8);
   money right-aligned tabular; rows ≥ 56 px by `min-height`/padding, never a
   fixed height; status as stamps in a column at least 8.5em wide.
4. `DataTable`'s forced `min-w-[40rem]` goes away.

---

## 10. Forms and errors

1. Visible label above every field; the placeholder only shows an example.
2. Hint under the label; error message above the input, same words as in the
   error summary; the typed value stays.
3. Validate on submit (not while typing), then move focus to the summary.
4. Dates. **Long form** (sentences, arrival dates, documents): the weekday,
   the day, «de» and the month, **no comma**: «viernes 27 de noviembre»; with
   the year on documents: «domingo 1 de noviembre de 2026». A time follows
   after a comma: «lunes 23 de noviembre de 2026, 6:34 p. m.». In messages read
   later (e-mail, WhatsApp) a relative word may lead: «Llega hoy, viernes 27
   de noviembre, entre 9 a. m. y 1 p. m.». **Short form** (tables, lists,
   history), one helper `formatDay(date, {now, time?, locale})` in
   `packages/core`, owned by step 1, used by every app: «hoy», «ayer»,
   «mañana»; otherwise the weekday in full and the day («viernes 27»); with
   the month when the date is not in the current month («miércoles 2 de
   diciembre», seen on 24 November); with the year only when it is not the
   current year. A time follows after a comma: «ayer, 6:33 p. m.». Never
   abbreviated weekdays or months («mié», «nov»). `formatTime` writes the
   time with U+00A0 (§3 rule 8). Today's `formatDateTime` (`month: "short"`,
   56 calls) becomes a wrapper of `formatDay` in step 1; a unit test checks
   every example of this rule, in es and en. Typed dates are dd/mm/aaaa with
   the format in the label (§5.30).
5. Money typed with numeric keyboard; the error says the expected form in words.
6. One primary per form, saying what it does; «Guardar sin enviar» as outline.
7. Server errors never show a code: say what happened and what to do («No es
   culpa suya…»).

---

## 11. Empty, error, offline and loading states

| State | Picture | Words | Action |
|---|---|---|---|
| Empty, about a delivery (no orders yet) | the wheel unpainted, 48 px, ink outline | «Todavía no tiene pedidos.» + what will appear | one outline button |
| Empty, anything else (queue done, no results) | the check icon (40) or no picture | what is true + next step («Cuando termine, aquí no queda nada») | optional |
| Error / not found / no access / suspension | `!` disc (56–96, ink or on-danger) | what happened, whose fault it is not, what to do | primary to retry or go on, outline to go back |
| Offline | cut-signal icon on a band notice | how old the data is, what we kept, and what needs signal («Guardamos en el teléfono 1 parada que no se pudo entregar… Para entregar con código necesita señal.») | none needed |
| Loading | skeleton blocks on band, same shape as the content; no shimmer under reduced motion; buttons show «…ando» | — | — |

No mascots, no illustrations of people, no wheel on errors.

---

## 12. Icons

- Drawn from the mark's stroke: 24 grid, 2.75 stroke (6 on 48 at 20 px), round
  caps and joins, the mark's round heads as dot terminals (`src/common.py`
  `ICON`, 35 icons, shown on `sistema.html`).
- Always next to a word (navigation, actions, tabs; X6). Payments use the coin
  with ₡, never $.
- Sizes: 20 web, 24 tab bar, 14 in sort headers.
- Replaces the 13 expo-kit icons and every inline SVG in the apps.

---

## 13. Product pictures and the neutral placeholder

Photo direction for sellers: square 1:1, product centred filling about 80 %,
plain light background (white or light warm grey), soft daylight from one
side, a soft shadow, no props, no text; one extra photo in use or in the hand
for scale. The placeholder (`img/*.svg`, `img/generico.svg`) is a warm grey
studio shot with a product silhouette in the same framing, so a real photo
drops in without a layout change. Photos keep their own light ground in the
dark appearance (they are never recoloured). No pastel pictograms (tell 20).

---

## 14. E-mail and message header

- E-mail: 600 px table, inline styles, `color-scheme: light`; header = lockup PNG
  (`assets/logo/yuntera-marca.png`, shown 36 px high: the ink is 29 px with 3.6 px
  of even clear space on every side; `@2x` for retina), served from the
  absolute address of §8.1 (e-mail row), with alt «yuntera», then a 3 px
  noche rule. No capital letters in the header label (today `render.ts` sets
  `text-transform: uppercase`; removed in step 5). Title Arial bold 24, body Arial 16/24,
  one noche button with a verb, band footer that starts with **the reason line
  of that message** (a parameter of the frame: event e-mails «Le escribimos
  porque compró en Yuntera.»; account e-mails «Le escribimos porque alguien
  creó una cuenta con este correo en yuntera.cr.»; seller e-mails «… porque
  vende en Yuntera.»), then help and the legal line.
  Achiote only on the arrival line. Never «Yuntera» typed with a capital Y as
  a logo (B2). The delivery code is never sent by e-mail or WhatsApp.
- `renderEmail` (37 messages), the 10 Supabase account e-mails and `_layout.html`,
  and the commercial frame all use this frame.
- WhatsApp: plain text; first line «Yuntera: <what happened>», the number that
  matters, then the link. No emoji.

---

## 15. Logo, lockups, app icons, the strip test

- `assets/logo/<yuntera|vende|central|ruta|bodega>-<marca|tinta|blanco>.svg`:
  15 files, text in outlines (`src/logo.py`, method in its docstring: glyph
  outlines from the Epilogue woff2 via fontTools `SVGPathPen`, advances from
  `hmtx`, pair kerning read from the GPOS `kern` feature, tracking −0.03 em;
  mark unchanged; geometry of brand book §5 with h = 48). PNG at 60 and 120 px
  high next to each, **cropped to the ink and padded evenly**: 10 % of the
  height on every side [M: 6 px on all four sides at 60 px] (`src/lockpng.py`).
- Change against the brand book: the wordmark is Epilogue 800 and the descriptor
  Epilogue **600** (the chosen files stop at 600; the book says 500). Brand book
  v2 must say so.
- App icons, per phone app (`yuntera` shop, `vende`, `ruta`, `bodega`), in
  `assets/app-icons/`, and where each goes in the repository:

| File | Use | Goes to |
|---|---|---|
| `icono-<app>-1024.png` (RGB, no alpha) | App Store | `apps/<app>-native/assets/icon.png` |
| `-512.png` | Google Play listing | store console (not in the repo) |
| `-180.png` | iPhone 60 pt @3x (reference; Expo makes it from icon.png) | not copied |
| `-48.png` | Android mdpi, **the favicon of the Expo web export** | `apps/<app>-native/assets/favicon.png` |
| `-adaptativo-frente-432.png` | Android adaptive foreground (108 dp at 4x; ring and mark at **68 %**: the furthest pixel at 57.9 % of the canvas, inside the 61.1 % safe circle [M]) | `apps/<app>-native/assets/android-icon-foreground.png` |
| `-adaptativo-fondo-432.png` | shows the background only; the config uses a **colour**: `adaptiveIcon.backgroundColor` = app colour token (shop achiote, seller cacao, driver añil, warehouse arena `#F3EEE6`) | not copied |
| `-monocromo-432.png` | Android 13 themed icon: ring, pattern and mark in one colour on alpha (the hub is left out so the mark stays visible), 68 % | `apps/<app>-native/assets/android-icon-monochrome.png` |
| `-inicio-1024.png` (and `icono-bodega-inicio-oscuro-1024.png`) | splash image: the wheel without the tile on the page colour; `splash.backgroundColor` = `page` light, `dark.backgroundColor` = `page` dark; only bodega needs a dark image (its ring is noche) | `apps/<app>-native/assets/splash-icon.png` (+ `splash-icon-dark.png` for bodega) |
| `icono-central-{512,180,48}.png` and `assets/icono-central.svg` | the console has no phone app: its browser icon (noche tile, cal ring and squares) | `apps/ops/public/icon.svg` |

  The web apps' `public/icon.svg`: `apps/web` ← `icono-yuntera.svg`,
  `apps/seller` ← `icono-vende.svg`, `apps/field` ← `icono-ruta.svg`,
  `apps/ops` ← `icono-central.svg`. **The warehouse icon** is now an arena
  tile with a 48/1024 noche rule along its bottom (the 3 px rule of the bodega
  bar), so it keeps its square on a white home screen at 48 px.
  `src/checkpng.py` fails the build on any blank, duplicate or broken-image
  PNG [M: 66 PNGs pass].
- **Theme colour per app** (browser bar, installed web app title bar):
  `apps/web` page (cal, light; not achiote: achiote is not a chrome colour),
  `apps/seller` app-seller (cacao), `apps/ops` app-ops (noche), `apps/field`
  app-driver (añil). `packages/brand/src/tokens.test.ts` «theme colour is the
  brand colour» becomes «each app's theme colour is its `appThemeColor`
  token».
- The strip test is closed (5A, §4.2). `franja/inicio-390.png` and
  `franja/producto-390.png` stay as the record of what was compared,
  regenerated with the current strip text.

## 16. Never do

| Never | Why |
|---|---|
| Use achiote for a button, link, focus, selection, error or sale | It must keep one meaning (our delivery); rojo is 39° away. |
| Show more than one wheel, or the wheel behind text, on an error or as a pattern | One meaning, once (brand book §10, tell 25). |
| Put a shadow on anything that rests, or a card inside a card | Tells 5, 6, 8. |
| Use pills or pastel tints for status | Tells 9, 10; status is shape + word. |
| Set ALL CAPS, or Epilogue under 18 px or for running text | Tell 17; Epilogue is a display face. |
| Show an icon without a word, or $ for money | X6, B4. |
| Show the delivery code to drivers, staff or sellers, or a buyer's full name to a seller | Product privacy rules [P]. |
| Pre-select anything at checkout but the shopper's own address | No dark patterns [P]. |
| Hide a label behind a placeholder | X3. |
| Let a row of tabs or departments scroll out of sight | N3, S3. |
| Remove the focus ring, or draw it in añil on a coloured band | It disappears (1.00–2.08:1 measured before). |
| Fix a height on a text container, or a max-height with an inner scroll on a table | It overlaps or cuts rows at 200 % text. |
| Break a word inside a stamp, a button or a tab label | Broken Spanish («Preparand-o») is what builders copy. |
| Write a colour literal (`#1E1A16`) for text | It does not follow dark appearance (the refused-scan button was 1.08:1). Use `ink-fixed` or a semantic token. |
| Put a spacing value off the scale | §2 spacing; `src/spacing.py` fails. |
| Animate on scroll, or anything under reduced motion | X7, tell 22. |
| Show an error code, field name or raw id | X8 [P]. |
| Type a time, a unit or an amount with an ordinary space | It splits at the line end («2 p. / m.»); use `formatTime`, `formatQuantity`, `formatPrice` (§3 rule 8). |
| Rename a token, a class or a component prop in place | Tailwind drops unknown classes silently; add the new name, alias the old, ratchet to 0, delete in step 6 (§2.5). |
| Write a status word anywhere but `packages/core` status words | Six copies drifted apart already (§4.3). |
| Put an inline text link in a phone screen | It is 18 px tall; use a row or a link-button (§5.23). |

---

## 17. How this was checked (27 November 2026, third pass)

All measured with Playwright Chromium, every request that was not `file://`
aborted [M: `src/audit.js` → `shots/audit.json`; `src/shots.js` →
`shots/shots.json`; `src/checkpng.py` → `assets/png-check.txt`;
`src/spacing.py`; `src/fonts.py` → `fonts/glyph-check.txt`, `fonts/manifest.json`].

- 46 pages, 133 audit runs: 390 and 320 (touch) for phone widths, 1280
  (mouse) for desktop, 1024 for the console, forced dark on the four
  phone-app pages and `sistema.html`. 200 % text now runs at 320 as well.
- Network blocked: 0 outside requests; fonts loaded from `fonts/web/` (one
  file per weight); 0 font errors.
- Sideways scroll at normal size: none at 390, 320, 1024 or 1280.
- **Times, amounts and quantities split over two lines** (new check, §3 rule
  8): 0 at normal size and 0 at 200 %, on all 46 pages and widths (the third
  verifier measured 21 and the judge 13 pages before this pass). Both strip
  pictures in `franja/` are regenerated with the new sentence.
- **Focus hidden behind a bar** (new check, real Tab, five hit-test points):
  0, except the 2 accepted stops on `sugerencias.html` under the open
  suggestion list (Escape closes it). The verifier measured 26 before.
- Console T7b at 390 and 320: frozen columns 0.57 and 0.58 of the frame; the
  total visible **before and after** the table is slid to its end (it rides
  under the name). At 1280 the table fits its frame next to the panel.
- Text contrast: no pair under 4.5:1 (3:1 large), light and dark.
- Targets: no stand-alone control under 44 px on the web, 48 in the phone
  frames (the two 18 px inline links on `app-vende.html` are gone), 56 for
  the driver's actions, 64 for the driver's fixed action.
- Labels: every input, select and textarea has a visible label.
- Focus rings, by pixels on four sides: 2,168 focus stops, 2,166 with a ring
  of 3:1 or more on all four sides; the 2 others are the accepted
  `sugerencias.html` stops above. The `.is-focus` specimens on `sistema.html`
  are left out.
- Words broken inside the word: 0 at normal size; at 200 % text 0 outside
  the places §3 rule 6 names and outside words longer than their whole line,
  except on two reference sheets that are not screens: the token table of
  `sistema.html` at 320 («button» in a narrow column) [accepted: specimen].
- 200 % text: 0 sideways scroll on 45 pages at 390, 320 and 1280; the one
  exception is the 600 px e-mail table of `mensajes.html` at 320 (mail is
  laid out by the mail program) [accepted]. 0 text-box overlaps, nothing left
  under a bottom bar, no sideways scroll with a long price and a 118-character
  name in a card.
- Type off the scale: 0 (the SMS bubble is now `small` 14/20).
- Header height: 119 px at 390, 122 at 1280, under the maxima 120 and 124.
- Spacing: 0 margin, padding or gap off the scale (398 uses).
- PNGs: 66 files, all distinct, none blank or broken; lockups with 6 px of
  clear space on all four sides at 60 px; the adaptive foreground's furthest
  pixel at 57.9 % of the canvas.
- Fonts: 14 files, every one with the characters of §2.4, tabular default
  digits, U+202F, nameID 16/17 and kerning; a second run gives the same bytes.
- Strip pictures: same size; the two versions differ only in image rows
  246–367 (the strip itself, at 2x).

Not tested: real phones, screen readers, sunlight, shoppers, real mail
programs, the native builds, the fonts on a device (their name tables are
measured), haptics.

## 18. What this system does not cover yet

- Ops `catalogo/categorias` (tree) and `operacion/distritos` (canton flow with
  review), the shopper's payment panel, the seller-native Inventario views and
  the warehouse home: decided in words (§8.1), not drawn.
- Seller `productos/[id]` photo manager: the row is decided in words (§5.31);
  the upload slot states are drawn; drag-to-reorder and crop are not part of
  this rebuild.
- Pin picker and map views: decided in words (§8.1), not drawn.
- Zero search results, the empty cart, card payment return, the returns flow
  and the report form: decided in words (§8.1, §11), not drawn.
- Dark appearance: drawn for the shopper home, product and order, the vende
  home, the driver's stop and the refused scan; the other phone screens
  follow the tokens. The web stays light (decision).
- Only one Android frame (the driver's stop); the other Android screens follow
  the table of §5.23.
- English: rules decided (§19); no English drawn or measured.
- Most of the 177 screens are covered by a template page, not drawn one by one.
- Not measurable here [E]: the fonts on a real iPhone and Android phone (the
  name tables are measured; the device check is step 1), haptics, screen
  readers, sunlight, shoppers, real mail programs.
- Print outside the fiscal document, the 1024 × 500 Play feature graphic,
  CMYK values, physical delivery identity, social and slide templates.

## 19. English

English comes after the rebuild, **app by app**: each app gets its English in
the step right after its own rebuild (§20, steps 3E and 4E), not at the end.
These rules are decided now so the rebuild does not have to be redone.

1. **Money.** The same symbol and grouping in both languages: `₡19 500`
   (U+202F between thousands, decimal comma only with céntimos:
   `₡17 256,64`). It is the Costa Rican way of writing colones, and one
   `formatPrice` keeps prices, tests and receipts identical. Only the words
   around it change («Precio final, IVA incluido» / «Final price, VAT
   included»).
2. **Dates and times.** `formatDay` (§10.4) takes the locale: «hoy» / «today»,
   «ayer» / «yesterday», «viernes 27» / «Friday 27», «miércoles 2 de
   diciembre» / «Wednesday 2 December» (day before month, no comma, no
   ordinal). Times: «6:33 p. m.» / «6:33 pm», both with U+00A0 (§3 rule 8).
   Typed dates stay dd/mm/yyyy in both, with the format in the label.
3. **Units and abbreviations.** «c/u» becomes «each»; «Cédula jurídica» stays
   in Spanish on fiscal documents (legal name of the number) with «(company
   ID)» after it; Hacienda, SINPE Móvil and CABYS are never translated.
4. **Titles.** Epilogue titles may wrap differently; nothing in the layout
   depends on a title's line count (no fixed heights, §16). The 10 longest
   strings of each language must be checked at 390 and 200 % text before the
   English release: in Spanish today «Cancelar el pedido YT-100018», «Aprobar
   la devolución de ₡26 500», «Agregar esta oferta al carrito», «Abrir la
   parada 2: María Fernández Solís», «Entendido, vuelvo a leer», «Seguir al
   paso 2: Pago», «Guardar San Pedro, Montes de Oca», «Eliminar mi cuenta para
   siempre», «Esperando el pago», «Todas las categorías (14)». Buttons and
   stamps wrap between words, so a longer word costs a line, not the layout.
5. **Journeys.** Step 0b moves every journey off class and text selectors
   onto roles with accessible names, `[name=…]`, or `data-testid` /
   `testID`; where a journey must read a word, it reads it from the same
   message module the app uses (status words from `packages/core`, the rest
   from `packages/i18n`). A journey then runs once per language.
6. **Where the words live (decided).** `packages/i18n/src/<app>/es.ts` and
   `en.ts` (apps: web, seller, ops, field, shop, sellerApp, driver, warehouse,
   shared), each a typed object `as const`; `en.ts` is typed `Messages<typeof
   es>`, so a missing key fails typecheck. `packages/i18n/src/index.ts`
   exports `t(locale)` and the `Locale` type. Status words stay in
   `packages/core` (§4.3) because the database, e-mails and journeys share
   them. **Components take every word as a required prop with no default**
   (today's defaults «Saltar al contenido», «Secciones», «Cargando…» become
   required props in step 2); the shells pass them from the app's messages.
7. **Pictures with words.** Only the lockup descriptors carry words (vende,
   central, ruta, bodega, outlined in 15 SVG and 30 PNG files). They are the
   apps' names and stay Spanish in English (brand book v2 says so). No icon or
   placeholder carries a word [M: 0 `<text>` elements].

## 20. Build order

Written against the repository at main `d6b637e` (file names checked there).
Every file the rebuild touches has **one owner at a time**; two steps that run
side by side never own the same file. A builder who needs a change in a file
they do not own asks its owner, who lands it as their own commit. Each builder
works in their own lane of `tools/dev/stack.sh` (lane numbers below; lane 0 is
left for the owner), and never runs two installs or two stacks in one lane.

**Before step 1:** wave 8 is merged into main. The support desk (task 46) may
run beside steps 0–2 only inside the files listed for it in §20.2; it uses only
components with an adapter (§8.2).

### 20.1 The order

| Step | Owner (lane) | What | Starts after | Runs beside |
|---|---|---|---|---|
| 0 | Release owner R (18) | Tag `3f251c3` as the source of the shopper tester build 0.1.0 (4). No step changes a database function that build calls; no over-the-air update goes to 0.1.0. | — | — |
| 0b | Journey owner J (1) | **Journeys made safe** (§20.5): every class and text selector becomes a role with its accessible name, `[name=…]`, `data-testid` or `testID`; each journey's screen steps move into one helper file per app; status words are read from `packages/core` (after 1b). The size checks stay. | 0 | 1a, 1b |
| 1a | Brand owner B1 (2) | **Tokens, migration layer, assets**: §2.1 + §2.5 phase A in `packages/brand` (`tokens.ts` adds, `legacy.ts`, `css.ts` → `tokens.css` + `tokens.legacy.css`, `carreta-base.css`, ratchet test and one count file per app, `fonts.test.ts`, `fonts-build/`), lockups and icons into `packages/brand/assets`. | 0 | 0b, 1b |
| 1b | Core owner B2 (3) | **Words and formats** in `packages/core`: `status-words.ts` (§4.3), `formatDay`, `formatTime`, `formatQuantity` (§3 rule 8, §10.4), `formatPrice` moved in. | 0 | 0b, 1a |
| 1c | B1 (2), then the dependency owner D (17) | **Wiring**: next-kit fonts and `base.css`; expo-kit theme (`theme`, `useTheme`, `ThemeProvider`, `spacing`, `type`, `fontFamily.text/title`), fonts plugin, icons and splash in `config.ts`; each app's `layout.tsx` / `manifest.ts` (fonts, theme colour), `public/icon.svg`, native `assets/`. Then D does **the one install of the rebuild**: remove `@expo-google-fonts/inter` and `bricolage-grotesque`; add `expo-haptics` and `axe-core` (dev). One iPhone development build shows the font weights (§2.4). | 1a | 1b (if not done), 0b |
| 2a | UI owner C1 (4) | `packages/ui`: lands the **API first** (types, the new components as stubs, the adapters of §2.5.6, `formatPrice` re-exported from core) in one commit, then fills each component (§5). | 1c | 2c |
| 2b | Next-kit owner C2 (5) | `packages/next-kit` (shell, `SideNav`, `Notice`, `DataTable` of §5.13 with its adapter, forms, `FiscalDocumentView` styling, `Price`, sign-in with «Mostrar»), `packages/i18n` index and shared messages, and one story route per web app. | the API commit of 2a | 2a (rest), 2c |
| 2c | Expo-kit owner C3 (6) | `packages/expo-kit` components (§5.23: `Screen`, `StackHeader`, `AppBar`, `TabBar`, `SegmentedViews`, `RowList`, `Button` sizes, `TextField`, `Tag`, `StatusTag`, `Notice`, `Price`, icons), the `appearance` option in `config.ts`, haptics in `scanner/signal.ts`, one story screen per phone app. | 1c, 1b | 2a, 2b |
| 3 | One builder per web app: web W (7), seller S (8), ops O1 (9) and O2 (10), field F (11) | **Web apps**, template by template (§8), switching `globals.css` to `tokens.css` first (§2.5 phase B); the app's ratchet to 0. Ops is two builders (O1: Hoy, Entrega, shell and navigation; O2: Catálogo, Vendedores, Dinero, Administración). | 2a + 2b, 0b, 1b | each other; 4; 5 |
| 3E | The same builder | **English for that app** (§19): `packages/i18n/src/<app>/en.ts`, the language choice in the account, the app's journeys once per language. | that app's 3 | the others |
| 4 | One builder per phone app: shop A1 (12), seller A2 (13), driver A3 (14), warehouse A4 (15) | **Phone apps**: delete the copies first (shop-native `product.tsx`, seller-native `parts.tsx`, the extra pin and district pickers), import from expo-kit, `ThemeProvider` at the root, ratchet to 0, then `appearance: "automatic"` in the app's `app.config.ts`. | 2c, 1b, 0b | each other; 3; 5 |
| 4E | The same builder | **English for that app**, as 3E. | that app's 4 | the others |
| 5 | Messages owner M (16) | **E-mail and WhatsApp**: `packages/notifications` frame (§14, §8.1 e-mail row), the 11 Supabase templates, the lockup PNG under `apps/web/public/correo/`. 5E: the English templates. | 1a, 1b | 2, 3, 4 |
| 6 | R (18) with D (17) | **Clean-up and release**: §2.5 phase C (delete the legacy layer and the adapters), the four store builds (fonts and icons are native assets), the journeys of every app, `STATUS.md`. | every 3, 3E, 4, 4E, 5 | — |

### 20.2 Who owns which file, step by step

| Files | 0b | 1a | 1b | 1c | 2 | 3 / 3E | 4 / 4E | 5 | 6 |
|---|---|---|---|---|---|---|---|---|---|
| `package.json` (root and every package), `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `biome.json`, `turbo.json`, `tsconfig.base.json`, `.github/workflows/ci.yml` | D | D | D | D (the one install) | D | D | D | D | D |
| `tools/e2e/journeys/*.cjs`, `tools/e2e/run.mjs`, `tools/e2e/lib/{own-route,settle}.cjs`, `tools/native-e2e/journeys/*.cjs`, `tools/native-e2e/{run,serve}.mjs` | J | J | J | J | J | J (on request) | J (on request) | J | J |
| `tools/e2e/lib/{web,seller,ops,field}.cjs` (made in 0b) | J | J | J | J | J | W, S, O1 (`ops.cjs`), F | — | — | R |
| `tools/native-e2e/lib/{shop,seller,driver,warehouse}.cjs`, `tools/native-e2e/testids/<app>.json` (made in 0b) | J | J | J | J | J | — | A1–A4 | — | R |
| `tools/native-e2e/testids/expo-kit.json` | J | J | J | J | C3 | C3 | C3 | — | R |
| `tools/e2e/compare/<app>.json` and `tools/e2e/compare.mjs` (§20.6) | J | J | J | J | J | the app's builder (its json) | the app's builder | — | R |
| `apps/*/src/**`: only new `data-testid` / `testID` attributes | J | — | — | — | — | — | — | — | — |
| `packages/brand/**` except `ratchet/<app>.json` | — | B1 | — | B1 | B1 (on request) | B1 (on request) | B1 (on request) | — | R |
| `packages/brand/ratchet/<app>.json` | — | B1 (first counts) | — | — | — | the app's builder | the app's builder | — | R (deletes) |
| `packages/core/src/{status-words,dates,quantity,price}.ts` and their tests; `lifecycle.ts` labels | — | — | B2 | B2 | B2 (on request) | B2 (on request) | B2 (on request) | B2 (on request) | R |
| `packages/next-kit/fonts/**`, `src/fonts.ts`, `styles/base.css` | — | — | — | B1 | C2 | C2 (on request) | — | — | R |
| `packages/next-kit/src/**` (rest) | — | — | — | — | C2 | C2 (on request) | — | — | R |
| `packages/ui/src/**` | — | — | — | — | C1 | C1 (on request) | — | — | R |
| `packages/expo-kit/fonts/**`, `src/theme/**`, `src/config.ts`, `src/ui/fonts*.ts` | — | — | — | B1 | C3 | — | C3 (on request) | — | R |
| `packages/expo-kit/src/**` (rest, incl. `scanner/signal.ts`, `account/`, `auth/`) | — | — | — | — | C3 | — | C3 (on request) | — | R |
| `packages/i18n/src/index.ts`, `src/shared/*` | — | — | — | — | C2 | C2 (on request) | C2 (on request) | C2 (on request) | R |
| `packages/i18n/src/<app>/{es,en}.ts` | — | — | — | — | — | the app's builder | the app's builder | M (`messages/`) | R |
| `packages/notifications/**`, `supabase/templates/**`, `apps/web/public/correo/**` | — | — | — | — | — | — | — | M | R |
| `apps/{web,seller,ops,field}/src/app/{layout.tsx,globals.css}`, `apps/field/src/app/manifest.ts`, `apps/*/public/icon.svg` | — | — | — | B1 | — | the app's builder (ops: O1) | — | — | R |
| `apps/{web,seller,ops,field}/src/app/sistema-interno/page.tsx` (new, story route, `notFound()` in production) | — | — | — | — | C2 | C2 | — | — | R (deletes) |
| `apps/web/src/**`, `apps/seller/src/**`, `apps/field/src/**` (rest) | J (testids only) | — | — | — | — | W, S, F | — | — | R |
| `apps/ops/src/app/{catalogo,tarifas,vendedores,cambios-tienda,cobros,pagos-vendedores,comprobantes,personal,auditoria,seguridad}/**` | J (testids only) | — | — | — | — | O2 | — | — | R |
| `apps/ops/src/**` (rest, incl. `lib/staff.ts`, `components/*`, the three sub-navs to delete) | J (testids only) | — | — | — | — | O1 | — | — | R |
| `apps/ops/src/app/{casos,clientes,salud,versiones}/**` and three entries in `lib/staff.ts` | task-46 builder until it merges (before step 3) | | | | | O1 | — | — | R |
| `apps/*-native/src/**`, `apps/*-native/app.config.ts` | J (testIDs only) | — | — | B1 (`app.config.ts` only if an option moves) | C3 (new `sistema-interno.tsx` only) | — | A1–A4 | — | R |
| `apps/*-native/assets/*` | — | — | — | B1 | — | — | A1–A4 | — | R |
| `STATUS.md`, `docs/03-data/api-reference.md`, brand book | — | — | — | — | — | — | — | — | R (builders hand R one paragraph each) |

### 20.3 What each step must test, and what it must not touch

| Step | Must test before it is done | Must not touch |
|---|---|---|
| 0b | Every journey passes against main, unchanged screens, in lane 1 (web and native); `rg` finds 0 class selectors and 0 text selectors outside the helpers' role names; the 32 `scrollWidth` and 5 `boundingBox` checks still run; the testID lists equal today's sets (433 apps, 70 expo-kit). | any app file except added `data-testid` / `testID` attributes; any package |
| 1a | `tokens.test.ts` lists every pair of the §2 contrast table, light and dark, and fails under the threshold; `tokens.legacy.css` equals today's `tokens.css` plus the added names (snapshot); every legacy-only name has an alias in `tokens.css`; `ratchet.test.ts` passes with the first counts; `fonts.test.ts` (§2.4); `checkpng.py` on the assets; `pnpm lint && pnpm typecheck && pnpm test`. | `packages/core`, any app, the lockfile |
| 1b | Unit tests for every example of §3 rule 8 and §10.4 (es and en, character by character: U+00A0 in times and units, U+202F in money); one row per status value of §4.3 (a test fails if an enum value of the database has no word: it reads the enum lists already in `lifecycle.ts` and the `check (status in …)` lists); `pnpm test`. | `packages/brand`, `ui`, `expo-kit`, any app |
| 1c | `pnpm lint && pnpm typecheck && pnpm test`; every web app builds and every journey passes with no visible change except the fonts and icons (the legacy theme is still imported); `config.test.ts` (fonts plugin = manifest); one iPhone development build with the font test screen (§2.4); one Android development build for the themed icon. | `packages/ui`, the rest of `next-kit/src` and `expo-kit/src`, app pages |
| 2a, 2b, 2c | Per component: a render test for each state of §5 (rest, hover, focus, pressed, disabled, loading, error); an axe run on the story route or screen (0 violations); the §17 measurements on the story pages (sideways scroll, targets 44/48/56/64, ring pixels, focus not hidden, word breaks and time/unit splits at normal size and 200 %, type off the scale); every adapter has a test that the old props render the new component; testID lists unchanged. | any app page, `tools/e2e/journeys` |
| 3, 4 | The app's journeys (web: `tools/dev/stack.sh e2e <lane> <journeys of the app>`; phone: `native-e2e`), changed only in the app's helper file; the ratchet count of the app at 0; the §17 measurements on the app's main screens at 390, 320 and 1280 (phones: 390 light and dark on the Expo web export); the screenshot comparison (§20.6) looked at and attached to the report; phones: one iPhone and one Android development build with VoiceOver and TalkBack on the main path and the largest text size; testID set of the app unchanged. | `packages/*` (ask the owner), other apps, journey files, the lockfile, `STATUS.md` |
| 3E, 4E | `en.ts` typechecks against `es.ts` (no missing key); the app's journeys pass in `es` and `en`; the 10 longest strings of §19.4 at 390 and 200 % (no sideways scroll, no word broken); money, dates and times by §19.1–2. | as 3, 4 |
| 5 | Render every message to HTML and to an image; the reason line, the PNG logo from its absolute address, Arial, one button, no capitals in the header, no delivery code; a test that `brand.ts` colours equal the Carreta values; one send to a Gmail and an Outlook address (needs the messaging provider: if it is not set up, say so in the report and in `STATUS.md`). | the apps, `packages/ui`, `next-kit`, `expo-kit` |
| 6 | After the deletions, `pnpm lint && pnpm typecheck && pnpm test`, the database tests, every journey (web and native); the four store builds install on one iPhone and one Android phone; `STATUS.md` says what was verified and what was not. | — |

### 20.4 Hazards from the inventory and how each is avoided

| Hazard | How it is avoided |
|---|---|
| A rename that Tailwind drops silently; `brand`, `warning`, `achiote`, `anil` changing meaning under the same spelling. | §2.5: add, alias, ratchet per app, delete last. The ratchet patterns catch the meaning-changed names. |
| Phone `space` indexes meaning new values. | New object `spacing` with named keys; `space` untouched until step 6. |
| iOS not finding Fira weights. | nameID 16 in every file (§2.4), a name-table check in the manifest test, an iPhone development build in step 1. |
| Two builders in one file (journeys, lockfile, base.css, ops nav, core, ui→next-kit). | §20.2: one owner per file per step; helpers per app; D does every install; 2a lands its API before 2b; O1 owns `staff.ts` and the sub-navs. |
| Status words in six files. | One module in core (§4.3); a test greps for copies. |
| Journeys tied to classes and text (10 class selectors, 576 text selectors), 32 `scrollWidth` and 5 `boundingBox` checks, 503 testIDs. | Step 0b and §20.5. |
| Prices drawn by hand (105 places) and `formatPrice()` bare (190 calls). | `Price` (§5.12); ratchet pattern «a bare formatPrice in JSX». |
| 145 places naming `fontFamily.display` or a display variant; 34 `StyleSheet` blocks reading colours. | Text variant map (§2.5.4); ratchet patterns; `useTheme()` (§5.23). |
| The tester build 0.1.0 (4) cannot get the fonts. | Step 0; the new look reaches phones with the step-6 store builds. |
| `DataTable` forced `min-w-[40rem]`. | The new DataTable (§5.13) with container queries; old signature as an adapter. |
| Long files mixing data and layout (web and shop-native `pedidos/[numero]`, `photo-manager.tsx`, ops `pedidos/[numero]`, ops `comprobantes`, seller-native `editar/[id]`). | Split into data, a template component and state components before restyling (§5.31, §8.1); the file's app builder owns all of it. |
| E-mail cannot load web fonts or relative images. | §14 frame, Arial, absolute PNG address. |
| The delivery code leaking into driver or staff screens. | T5's code block and T16's code field are different components; a test asserts the code value is absent from driver and staff HTML. |
| Work built beside the rebuild (task 46) on today's components. | §8.2: adapters only; its files join step 3 ops. |
| Times, units and amounts split at the line end. | §3 rule 8; core helpers with tests; the audit check. |
| Focus hidden under sticky bars. | `scroll-padding-bottom` from the measured bar (§2.3); the focus-hidden check in step 2 and 3 measurements. |

### 20.5 The rule that keeps the journeys working

1. **Texts.** A journey finds a control by its role and accessible name, never
   by a CSS class and never by a bare text match on a container. Accessible
   names that are product words (status words, buttons) come from the same
   module the app uses (`packages/core` status words; after §19.6,
   `packages/i18n`), so a word changed in one place changes in the journey too.
2. **Test ids.** Every `testID` and `data-testid` that exists at `d6b637e`
   stays on the element that does the same job (lists in
   `tools/native-e2e/testids/*.json`, made in 0b). A rebuilt screen may add
   ids, never drop or rename one, unless the same commit changes the list and
   the app's helper file.
3. **Size checks.** The 32 `scrollWidth` and 5 `boundingBox` checks stay in
   the journey files (owned by J) and must pass after every app step at 390
   and 1280. A builder who thinks one is wrong asks J; it is never loosened in
   the same change as the screen.
4. **Helpers.** Screen steps live in `tools/e2e/lib/<app>.cjs` and
   `tools/native-e2e/lib/<app>.cjs`; the app's builder keeps them passing.
   Journey files call helpers and hold the flow and the checks.

### 20.6 Screenshots compared with the reference pages

`tools/e2e/compare.mjs` (J, step 0b) reads `tools/e2e/compare/<app>.json`
(one row per journey screenshot: the screenshot name, its template T1–T18, the
reference page and width in `docs/brand/system/shots/`) and writes one HTML page
per app with each pair side by side into `tools/e2e/screenshots/compare/<app>/`
(inside `tools/e2e/screenshots/`, which `.gitignore` already leaves out). The app's
builder adds the rows for their app, runs it at the end of the step, looks at
every pair, and attaches the page to the step's report. Nobody else edits that
app's json.
