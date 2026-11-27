"""The single source of every Carreta token.

Run `python3 -I src/build.py` from carreta-final/. This module is imported by
the page builders and writes:
  - tokens.json          (the values, for packages/brand/src/tokens.ts and
                          packages/expo-kit/src/theme/tokens.ts)
  - the :root block at the top of carreta.css
  - the token tables inside SISTEMA.md (between the TOKENS markers)
Every contrast ratio in those tables is computed here, never typed by hand.
"""

# ---------------------------------------------------------------- palette
# Costa Rican names, one value each, no ramps, no tints.
PALETTE = {
    'noche':   ('#1E1A16', 'ink: text, primary buttons, selection'),
    'humo':    ('#574E45', 'secondary text'),
    'borde':   ('#7A6F63', 'edges of controls that tell you something'),
    'regla':   ('#D9D0C3', 'decorative rules only'),
    'cal':     ('#FFFFFF', 'page'),
    'arena':   ('#F3EEE6', 'second surface, as a solid band'),
    'papel':   ('#EEEAE4', 'ground of product photos and their placeholder'),
    'achiote': ('#B8420F', "brand: Yuntera's own delivery; the shop app"),
    'maiz':    ('#F2B705', 'paint in the wheel; warning fill'),
    'anil':    ('#1F47A8', 'links and focus ring; the ruta app'),
    'selva':   ('#1F6B3A', 'done, delivered, paid'),
    'rojo':    ('#A4161A', 'errors and destructive actions'),
    'cacao':   ('#4A2A1C', 'the vende app'),
    # dark appearance (phone apps)
    'fondo':          ('#16120F', 'dark: page'),
    'superficie':     ('#231E19', 'dark: second surface'),
    'papel-oscuro':   ('#2E2823', 'dark: photo ground'),
    'texto-claro':    ('#F3EEE6', 'dark: ink'),
    'humo-claro':     ('#C9BFB2', 'dark: secondary text'),
    'borde-claro':    ('#8F8478', 'dark: control edges'),
    'regla-oscura':   ('#3A332C', 'dark: decorative rules'),
    'achiote-claro':  ('#F0804A', 'dark: brand'),
    'anil-claro':     ('#9DB4F5', 'dark: links and focus'),
    'selva-claro':    ('#6CC48A', 'dark: done'),
    'rojo-claro':     ('#FF8A80', 'dark: errors'),
}
P = {k: v[0] for k, v in PALETTE.items()}

# ---------------------------------------------------------------- semantic colours
# name, light, dark, the one job. CSS: --yt-<name>. tokens.ts: semantic.<camel>
# (light) and semanticDark.<camel>. expo-kit: colors.<camel> / colorsDark.<camel>.
SEMANTIC = [
    ('page',          'cal',     'fondo',         'Page background. Nothing else.'),
    ('band',          'arena',   'superficie',    'Second surface as a solid band: buy box, summary, filters, footer, table head. Never a card on a card.'),
    ('photo',         'papel',   'papel-oscuro',  'Ground behind product photos and the neutral placeholder.'),
    ('ink',           'noche',   'texto-claro',   'All text that is read, and icons.'),
    ('ink-muted',     'humo',    'humo-claro',    'Secondary text: seller line, counts, hints, dates in lists.'),
    ('edge',          'borde',   'borde-claro',   'Edges of fields, checkboxes, radios, outline buttons, tags: anything whose edge tells you it is a control.'),
    ('rule',          'regla',   'regla-oscura',  'Decorative rules between sections. Never the only sign of anything.'),
    ('primary',       'noche',   'texto-claro',   'Fill of the primary button, a selected choice, the current tab marker, the cart count.'),
    ('on-primary',    'cal',     'fondo',         'Text and icons on primary.'),
    ('link',          'anil',    'anil-claro',    'Links, always underlined.'),
    ('focus',         'anil',    'anil-claro',    'Focus ring on page and band. On any coloured band the ring takes the band\'s own text colour (--yt-ring).'),
    ('brand',         'achiote', 'achiote-claro', "Yuntera's own delivery only: delivery strip or its rule, arrival date, delivery code block, the wheel, 'Entregado por Yuntera'. Plus the shop app icon."),
    ('on-brand',      'cal',     'fondo',         'Text on brand.'),
    ('success',       'selva',   'selva-claro',   'Only done: Entregado, Pagado, Listo, Recibido.'),
    ('on-success',    'cal',     'fondo',         'Text on success.'),
    ('danger',        'rojo',    'rojo-claro',    'Errors and destructive actions, always with the ! glyph and a word.'),
    ('on-danger',     'cal',     'fondo',         'Text on danger.'),
    ('warning',       'maiz',    'maiz',          'Needs attention: Por atender, Esperando el pago. Fill only, never text.'),
    ('on-warning',    'noche',   'noche',         'Text on warning (stays dark in both appearances).'),
    ('app-shop',      'achiote', 'achiote',       'Shop app icon ground.'),
    ('app-seller',    'cacao',   'cacao',         'vende: top bar and icon.'),
    ('app-driver',    'anil',    'anil',          'ruta: top bar and icon.'),
    ('app-warehouse', 'cal',     'superficie',    'bodega: top bar (with a 3 px ink rule) and icon.'),
    ('app-ops',       'noche',   'noche',         'central: side bar and phone top bar.'),
    ('on-app',        'cal',     'cal',           'Text on the vende, ruta and central bars; fill of on-band buttons and side-bar counts.'),
    ('ink-fixed',     'noche',   'noche',         'Text on a fill that stays light in both appearances: on-band buttons, side-bar counts (on on-app).'),
    ('wheel-rim',     'noche',   'texto-claro',   'Rim of the painted wheel. Turns light in dark so the wheel keeps its edge; the paint does not change.'),
]

def camel(s):
    a = s.split('-')
    return a[0] + ''.join(x.title() for x in a[1:])

def lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def cr(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def sem(name, dark=False):
    for n, l, d, _ in SEMANTIC:
        if n == name:
            return P[d if dark else l]
    raise KeyError(name)

# Every pair a component draws: (label, fg semantic, bg semantic, need).
# need 4.5 text, 3 large text / control edge / focus ring.
PAIRS = [
    ('Body text on page', 'ink', 'page', 4.5),
    ('Body text on band', 'ink', 'band', 4.5),
    ('Muted text on page', 'ink-muted', 'page', 4.5),
    ('Muted text on band', 'ink-muted', 'band', 4.5),
    ('Muted text on photo ground', 'ink-muted', 'photo', 4.5),
    ('Control edge on page', 'edge', 'page', 3),
    ('Control edge on band', 'edge', 'band', 3),
    ('Primary button label', 'on-primary', 'primary', 4.5),
    ('Primary button against page', 'primary', 'page', 3),
    ('Link on page', 'link', 'page', 4.5),
    ('Link on band', 'link', 'band', 4.5),
    ('Focus ring on page', 'focus', 'page', 3),
    ('Focus ring on band', 'focus', 'band', 3),
    ('Brand text on page (date, Entregado por Yuntera)', 'brand', 'page', 4.5),
    ('Brand text on band (date in buy box)', 'brand', 'band', 4.5),
    ('Text on brand (strip, code block)', 'on-brand', 'brand', 4.5),
    ('Ring on brand (= on-brand)', 'on-brand', 'brand', 3),
    ('Success tag text', 'on-success', 'success', 4.5),
    ('Success text on page', 'success', 'page', 4.5),
    ('Danger text on page', 'danger', 'page', 4.5),
    ('Text on danger (button, refused scan)', 'on-danger', 'danger', 4.5),
    ('Text on warning', 'on-warning', 'warning', 4.5),
    ('Text on vende bar', 'on-app', 'app-seller', 4.5),
    ('Text on ruta bar', 'on-app', 'app-driver', 4.5),
    ('Text on central bar', 'on-app', 'app-ops', 4.5),
    ('On-band button label and side-bar count: `ink-fixed` on `on-app`', 'ink-fixed', 'on-app', 4.5),
    ('Refused-scan button label (on the on-danger fill)', 'danger', 'on-danger', 4.5),
    ('Wheel rim against the page', 'wheel-rim', 'page', 3),
]

# ---------------------------------------------------------------- type
TEXT = '"Fira Sans", sans-serif'
TITLE = '"Epilogue", sans-serif'
# name, face, weight, phone size/line, desktop size/line, tracking, use
TYPE = [
    ('display',  'title', 800, (30, 34), (40, 44), '-0.01em', 'Order title, empty-state title. One per screen at most.'),
    ('title',    'title', 700, (26, 30), (30, 34), '-0.01em', 'Page H1 on shop pages, product title.'),
    ('section',  'title', 700, (21, 26), (24, 28), '-0.03em', 'Section heads on shop pages; the H1 of work-tool pages.'),
    ('price-xl', 'title', 800, (32, 36), (36, 40), '0', 'Buy-box price, order total.'),
    ('price',    'title', 700, (20, 23), (22, 25), '0', 'Card price, line total, money in summaries.'),
    ('code',     'title', 800, (60, 69), (72, 83), '0.18em', 'The delivery code. Shopper screens only. The largest thing on its screen.'),
    ('h3',       'text',  600, (18, 24), (18, 24), '0', 'Sub-heads, buy-box rows, card titles in work tools.'),
    ('body',     'text',  400, (16, 24), (16, 24), '0', 'Running text and product names on the web.'),
    ('body-app', 'text',  400, (17, 24), (17, 24), '0', 'Body in the phone apps (17 pt iPhone body).'),
    ('label',    'text',  600, (15, 20), (15, 20), '0', 'Field labels, button text (buttons at 16).'),
    ('small',    'text',  400, (14, 20), (14, 20), '0', 'Secondary lines: seller, rating count, hints.'),
    ('table',    'text',  400, (15, 20), (14, 20), '0', 'Work-tool tables and lists.'),
    ('fine',     'text',  400, (13, 18), (13, 18), '0', 'Legal line, tab labels, stamps, badges. Nothing smaller anywhere.'),
    ('button',   'text',  600, (16, 20), (16, 20), '0', 'Button labels on the web (.btn); 15/20 in .btn-sm.'),
    ('button-app', 'text', 600, (17, 22), (17, 22), '0', 'Button labels in the phone apps and the 56 px driver actions.'),
    ('button-xl', 'text', 600, (20, 24), (20, 24), '0', 'The driver\'s fixed 64 px action (Llegué, Entregar) and full-screen confirmations.'),
    ('field-lg', 'text',  500, (22, 30), (22, 30), '0', 'Field apps only: señas, district, the product to pick, the cash line, the refused-scan sentence.'),
    ('loc',      'text',  700, (44, 48), (44, 48), '0.02em', 'Warehouse location code on a pick line (the one tracked Fira step besides code-entry).'),
    ('count',    'title', 800, (34, 34), (34, 34), '0', 'The count of a task on a dashboard (T6).'),
    ('code-entry', 'text', 700, (32, 40), (32, 40), '0.3em', 'The driver\'s code-entry field and the 6-digit sign-in code field.'),
]

SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64]
RADIUS = [
    ('control', 4, 'Buttons, fields, selects, chips, the quantity stepper.'),
    ('tag', 2, 'Status stamps, counts, badges, the seller monogram.'),
    ('overlay', 10, 'Menus, sheets, drawers, dialogs, the suggestion list (open side only).'),
    ('photo', 0, 'Product photos and placeholders.'),
    ('round', 999, 'Only the wheel, radio dots, route stations and the status glyph.'),
]
ELEVATION = [
    ('rest', 'none', 'Everything that rests on the page. No exceptions.'),
    ('overlay', '0 10px 30px rgba(30,26,22,.25)', 'Menus, sheets, drawers, dialogs, the suggestion list. Plus a 55 % noche scrim under drawers and sheets.'),
]
# Sticky bars (buy bar, driver action, submit bar) carry no elevation token:
# they use a 1 px or 2 px top border in rule or ink. Nothing that rests has a shadow.
MOTION = [
    ('fast', '100ms', 'ease-out', 'Feedback on a control: pressed, checked, quantity change.'),
    ('panel', '200ms', 'ease-out', 'Header hide and return, drawer, sheet, disclosure.'),
    ('none', '0ms', '', 'Everything under prefers-reduced-motion: reduce. Nothing plays on scroll.'),
]


def css_root():
    out = [':root{']
    for k, v in P.items():
        out.append(f'  --yt-{k}:{v};')
    for n, l, d, _ in SEMANTIC:
        out.append(f'  --yt-{n}:var(--yt-{l});')
    out.append('  --yt-ring:var(--yt-focus);')
    out.append(f'  --yt-font-text:{TEXT}; --yt-font-title:{TITLE};')
    for n, r, _ in RADIUS:
        out.append(f'  --yt-radius-{n}:{r}px;')
    for i, s in enumerate(SPACE):
        out.append(f'  --yt-space-{i}:{s}px;')
    for n, v, _ in ELEVATION:
        out.append(f'  --yt-elevation-{n}:{v};')
    for n, d, e, _ in MOTION:
        out.append(f'  --yt-motion-{n}:{d} {e};'.replace(' ;', ';'))
    out.append('  --yt-target:44px; --yt-target-app:48px; --yt-target-driver:56px; --yt-target-driver-fixed:64px; --yt-header-h:119px;')
    out.append('}')
    # dark appearance: phone apps (and any surface marked data-theme="dark")
    dk = [f'  --yt-{n}:var(--yt-{d});' for n, l, d, _ in SEMANTIC if l != d]
    out.append('[data-theme="dark"]{color-scheme:dark;--yt-ring:var(--yt-focus);\n' + '\n'.join(dk) + '\n}')
    return '\n'.join(out)


def css_type():
    """The .t-<step> classes, generated from TYPE (phone sizes, desktop from 900 px)."""
    out, desk = [], []
    for n, f, w, p, d, tr, _ in TYPE:
        fam = 'var(--yt-font-title)' if f == 'title' else 'var(--yt-font-text)'
        trk = '' if tr == '0' else f';letter-spacing:{tr}'
        out.append(f'.t-{n}{{font-family:{fam};font-weight:{w};font-size:{p[0]}px;line-height:{p[1]}px{trk}}}')
        if d != p:
            desk.append(f' .t-{n}{{font-size:{d[0]}px;line-height:{d[1]}px}}')
    out.append('@media (min-width:900px){\n' + '\n'.join(desk) + '\n}')
    titles = ','.join(f'.t-{n}' for n, f, *_ in TYPE if f == 'title')
    out.append(titles + ',.wordmark,.num{font-feature-settings:"lnum","tnum";font-variant-numeric:lining-nums tabular-nums}')
    out.append('.label{font:600 15px/20px var(--yt-font-text)}')
    return '\n'.join(out)


def json_tokens():
    import json
    t = {
        'palette': P,
        'semantic': {camel(n): P[l] for n, l, d, _ in SEMANTIC},
        'semanticDark': {camel(n): P[d] for n, l, d, _ in SEMANTIC},
        'font': {'text': TEXT, 'title': TITLE, 'textFamilyNative': 'Fira Sans', 'titleFamilyNative': 'Epilogue',
                 'textWeights': [400, 500, 600, 700], 'titleWeights': [600, 700, 800],
                 'files': {'web': {f'fira-sans-{w}': f'fonts/web/fira-sans-{w}.woff2' for w in (400, 500, 600, 700)} | {f'epilogue-{w}': f'fonts/web/epilogue-{w}.woff2' for w in (600, 700, 800)},
                           'phone': {f'Fira Sans {w}': f'fonts/ttf/FiraSans-{n}.ttf' for w, n in ((400, 'Regular'), (500, 'Medium'), (600, 'SemiBold'), (700, 'Bold'))}
                           | {f'Epilogue {w}': f'fonts/ttf/Epilogue-{n}.ttf' for w, n in ((600, 'SemiBold'), (700, 'Bold'), (800, 'ExtraBold'))}}},
        'type': {camel(n): {'face': f, 'weight': w, 'phone': {'size': p[0], 'line': p[1]}, 'desktop': {'size': d[0], 'line': d[1]}, 'tracking': tr}
                 for n, f, w, p, d, tr, _ in TYPE},
        'space': SPACE,
        # named keys (SISTEMA §2.5.4): an old index can never silently mean a new value
        'spacing': dict(zip(('none', 'hair', 'tight', 'snug', 'base', 'loose', 'wide', 'section', 'page'), SPACE)),
        'radius': {n: r for n, r, _ in RADIUS},
        'elevation': {n: v for n, v, _ in ELEVATION},
        'motion': {n: d for n, d, e, _ in MOTION},
        'target': {'web': 44, 'app': 48, 'driverPrimary': 64, 'driverAction': 56},
        'headerHeight': {'phone': 119, 'desktop': 122},
        'headerHeightMax': {'phone': 120, 'desktop': 124},
        # browser and title-bar colour per app (web manifests, viewport) and the Android adaptive-icon background colour
        'themeColor': {'web': 'page', 'seller': 'appSeller', 'ops': 'appOps', 'field': 'appDriver'},
        'adaptiveIconBackground': {'shop-native': 'appShop', 'seller-native': 'appSeller', 'driver-native': 'appDriver', 'warehouse-native': '#F3EEE6 (arena)'},
    }
    return json.dumps(t, ensure_ascii=False, indent=1)


def md_tables():
    L = []
    L.append('### Palette (values only; components never use these names)\n')
    L.append('| Name | Hex | What it is for |\n|---|---|---|')
    for k, (v, j) in PALETTE.items():
        L.append(f'| `--yt-{k}` | `{v}` | {j} |')
    L.append('\n### Semantic colours (the only names components use)\n')
    L.append('| CSS variable | tokens.ts / expo-kit key | Light | Dark | Its one job |\n|---|---|---|---|---|')
    for n, l, d, j in SEMANTIC:
        L.append(f'| `--yt-{n}` | `{camel(n)}` | {l} `{P[l]}` | {d} `{P[d]}` | {j} |')
    L.append('\n### Contrast pairs (computed with the WCAG 2.x formula in src/tokens.py)\n')
    L.append('| Pair | Needs | Light | Dark |\n|---|---|---|---|')
    worst = 99
    for lab, fg, bg, need in PAIRS:
        a = cr(sem(fg), sem(bg)); b = cr(sem(fg, True), sem(bg, True))
        worst = min(worst, a / need, b / need)
        ok = lambda x: f'{x:.2f}' + ('' if x >= need else ' FAIL')
        L.append(f'| {lab}: `{fg}` on `{bg}` | {need}:1 | {ok(a)} | {ok(b)} |')
    L.append(f'\nEvery pair passes in both appearances (smallest margin {worst:.2f} × its threshold). '
             '`rule` on `page` is 1.53:1 and is decorative only (WCAG 1.4.11 exempt): it may never be the only sign of a state or a control.\n')
    L.append('### Type\n')
    L.append('| Step (`.t-<name>`, `type.<camel>`) | Face | Weight | Phone size/line | Desktop size/line (≥ 900 px) | Tracking | Used for |\n|---|---|---|---|---|---|---|')
    for n, f, w, p, d, tr, u in TYPE:
        face = 'Epilogue' if f == 'title' else 'Fira Sans'
        L.append(f'| `{n}` | {face} | {w} | {p[0]}/{p[1]} | {d[0]}/{d[1]} | {tr} | {u} |')
    L.append('\n### Spacing, radius, elevation, motion\n')
    L.append('Spacing steps `--yt-space-0` … `--yt-space-8`: ' + ', '.join(f'{s}' for s in SPACE) + ' px. Every margin, padding and gap uses one of them (`carreta.css` writes them as `var(--yt-space-N)`; checked by `src/spacing.py`). The only exception: 2 px vertical padding inside stamps and badges, and 1 px corrections where a state thickens a border by 1 px.\n')
    L.append('| Radius | px | Role |\n|---|---|---|')
    for n, r, u in RADIUS:
        L.append(f'| `--yt-radius-{n}` | {r if r < 999 else "999 (fully round)"} | {u} |')
    L.append('\n| Elevation | Value | Where |\n|---|---|---|')
    for n, v, u in ELEVATION:
        L.append(f'| `--yt-elevation-{n}` | `{v}` | {u} |')
    L.append('\nSticky bars (buy bar, driver action, submit bar) have no elevation token: a 1 px `rule` or 2 px `ink` top border, never a shadow.')
    L.append('\n| Motion | Duration and easing | Where |\n|---|---|---|')
    for n, d, e, u in MOTION:
        L.append(f'| `--yt-motion-{n}` | {d} {e} | {u} |')
    return '\n'.join(L)


if __name__ == '__main__':
    print(md_tables())
