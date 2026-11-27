"""The way from today's code to Carreta, as data: one source for SISTEMA.md
§2.5 (token, class, prop and phone mappings) and §4.3 (every status value of
the database with its sign and its words), and for migration.json, which the
step-1 owner turns into packages/brand/src/legacy.ts (aliases), the ratchet
test lists, and packages/core/src/status-words.ts.

Names on the left are exactly what the repository uses at main d6b637e
(packages/brand/src/tokens.ts, packages/expo-kit/src/theme/tokens.ts,
packages/expo-kit/src/ui/text.tsx, packages/ui/src/primitives.tsx,
supabase/migrations/*.sql). build.py writes the tables between the
MIGRATION and ESTADOS markers of SISTEMA.md.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 1. semantic names: today's name -> Carreta name, and whether the name itself survives
# kind: same = same name, same job (value changes); renamed = the old name becomes an alias of the new one;
# meaning = same spelling, different job (the dangerous ones); gone = no Carreta equivalent
SEMANTIC = [
    ('bg', 'page', 'renamed', 'bg-bg → bg-page'),
    ('surface', 'page', 'renamed', 'Carreta has one page colour; a raised white card on a tinted page does not exist.'),
    ('surfaceMuted', 'band', 'renamed', 'bg-surface-muted → bg-band'),
    ('border', 'rule', 'renamed', 'Decorative rules only. A control edge is never `rule`.'),
    ('borderStrong', 'edge', 'renamed', 'Control edges (fields, outline buttons, checkboxes): 4.90:1.'),
    ('ink', 'ink', 'same', 'añil 900 → noche'),
    ('inkMuted', 'inkMuted', 'same', 'añil 600 → humo'),
    ('brand', 'primary (as a fill or a selection) / brand (only our delivery)', 'meaning',
     'Today brand (celeste) fills primary buttons, selected options and checkbox accents. In Carreta brand is achiote and may only mark our own delivery (§4.2). Every bg-brand, border-brand, accent-(--color-brand) and colors.brand becomes primary; only the strip, the arrival date, the code block and the wheel use brand.'),
    ('onBrand', 'onPrimary (on buttons) / onBrand (on the strip and code block)', 'meaning', 'Follows brand.'),
    ('brandHover', 'primary (pressed state is the 1 px move + inner shade, §5.1)', 'gone', 'No hover colour.'),
    ('brandSoft', 'band', 'gone', 'No pastel tints.'),
    ('link', 'link', 'same', 'celeste 700 → añil, always underlined'),
    ('focus', 'focus', 'same', 'celeste 500 → añil; the ring rules of §2.3'),
    ('promo', '— (none)', 'gone', 'No sale colour. A discount is a plain stamp with the number («−18 %»).'),
    ('rating', 'ink', 'gone', 'Stars are decorative in ink; the number is written.'),
    ('success', 'success', 'same', 'selva 600 → selva #1F6B3A'),
    ('danger', 'danger', 'same', 'achiote 600 → rojo #A4161A. Achiote stops meaning error.'),
    ('warning', 'warning (a FILL with onWarning text)', 'meaning',
     'Today warning (maíz 700) is a TEXT colour (text-warning, 22 uses). Carreta warning is maíz #F2B705, a fill under noche text; as text on the page it is 1.9:1. Every text-warning becomes a Notice kind="warn" or a Tag warn.'),
]
NEW_ONLY = ['photo', 'onSuccess', 'onDanger', 'onWarning', 'appShop', 'appSeller', 'appDriver', 'appWarehouse', 'appOps', 'onApp', 'inkFixed', 'wheelRim']

# ---- 2. raw ramps: (ramp, steps) -> target as a background / as text / as a border
RAMPS = [
    ('celeste', '50–200', 'band', 'ink-muted', 'rule'),
    ('celeste', '300–500', 'band', 'link', 'edge (focus ring: focus)'),
    ('celeste', '600–700', 'primary', 'link', 'edge'),
    ('celeste', '800–950', 'primary', 'ink', 'edge'),
    ('anil', '50–200', 'band', 'ink-muted', 'rule'),
    ('anil', '300–500', 'band', 'ink-muted', 'edge'),
    ('anil', '600–950', 'primary', 'ink (600–700: ink-muted)', 'edge'),
    ('guaria', 'all', 'band (seller identity: app-seller)', 'ink', 'rule'),
    ('maiz', '50–300', 'band', 'ink', 'rule'),
    ('maiz', '400–900', 'warning (fill only; stars: ink)', 'ink (never maíz text)', 'edge'),
    ('selva', '50–300', 'band', 'success', 'rule'),
    ('selva', '400–900', 'success', 'success', 'success'),
    ('achiote', '50–300', 'band', 'danger', 'danger'),
    ('achiote', '400–900', 'danger', 'danger', 'danger'),
    ('arena', '50', 'page', 'ink-muted', 'rule'),
    ('arena', '100', 'band', 'ink-muted', 'rule'),
    ('arena', '200–300', 'band', 'ink-muted', 'rule'),
    ('arena', '400', 'band', 'ink-muted', 'edge'),
    ('white', '—', 'page', 'on-primary / on-app', 'rule'),
]

# ---- 3. other web tokens
WEB_OTHER = [
    ('font-sans (Inter)', 'font-text (Fira Sans)', 'next-kit fonts.ts binds --font-sans to Fira Sans in step 1, so `font-sans` keeps working.'),
    ('font-display (Bricolage)', 'font-title (Epilogue)', '--font-display is bound to Epilogue in step 1; the class name stays until step 6.'),
    ('text-xs (12 px)', 't-fine (13/18)', '12 px is under the minimum; no text step is smaller than 13.'),
    ('text-sm (14)', 't-small (14/20) or t-table', ''),
    ('text-base (16)', 't-body (16/24)', ''),
    ('text-lg (18)', 't-h3 (18/24)', ''),
    ('text-xl, text-2xl (20, 24)', 't-section (21/26 phone, 24/28 desktop)', ''),
    ('text-3xl (30)', 't-title (26/30, 30/34)', ''),
    ('text-4xl, text-5xl (40, 52)', 't-display (30/34, 40/44)', 'One per screen at most.'),
    ('radius sm / md (6, 10)', 'radius-control (4)', 'Buttons, fields, chips.'),
    ('radius lg / xl (16, 24)', 'radius-overlay (10)', 'Menus, sheets, dialogs only; cards have no radius (photos 0).'),
    ('radius full', 'radius-round', 'Only the wheel, radio dots, stations, the status glyph. No pills.'),
    ('shadow sm / md / lg', 'elevation-rest (none) / elevation-overlay', 'Nothing that rests has a shadow.'),
    ('min-h-11 written by hand', 'the component (Button, Field, RowList) sets the target', 'Ratchet counts it.'),
    ('uppercase tracking-wide (DataTable head and others)', 'nothing', '§3.3: no capitals.'),
]

# ---- 4. phone (expo-kit) names
PHONE = [
    ('colors.<semantic>', 'theme.colors.<carreta name> (useTheme())', 'Same table as the web (1). `colors` stays exported, unchanged, until step 6.'),
    ('colors.palette.<ramp>[step]', 'nothing (components never use palette names)', 'As the ramps above.'),
    ('colors.fieldBorder (añil 400)', 'theme.colors.edge', ''),
    ('tone.<neutral|info|success|warning|danger|promo>', 'Tag sign from the status table (§4.3), Notice kind', 'A tone is chosen by the state, not by the screen: the word, the sign and the colour come from packages/core status words.'),
    ('fontFamily.body', 'fontFamily.text = "Fira Sans"', 'body stays an alias of text until step 4 ends.'),
    ('fontFamily.display', 'fontFamily.title = "Epilogue"', 'display stays an alias of title until step 4 ends.'),
    ('fontSize.<xs..5xl>, lineHeight.<..>', 'type.<step>.phone {size, line}', 'Through Text variants only.'),
    ('radius.<sm|md|lg|xl|full>', 'theme.radii.control | tag | overlay | photo | round', 'A new object beside the old one; `radius` goes in step 6.'),
    ('touchTarget (44)', 'target.app (48), target.driverAction (56), target.driverPrimary (64)', ''),
    ('gutter (16)', 'spacing.base (16)', ''),
]
SPACE = [('space[0]', 0, 'spacing.none', 0), ('space[1]', 4, 'spacing.hair', 4), ('space[2]', 8, 'spacing.tight', 8),
         ('space[3]', 12, 'spacing.snug', 12), ('space[4]', 16, 'spacing.base', 16), ('space[5]', 20, 'spacing.loose', 24),
         ('space[6]', 24, 'spacing.loose', 24), ('space[8]', 32, 'spacing.wide', 32), ('space[10]', 40, 'spacing.section', 48),
         ('space[12]', 48, 'spacing.section', 48), ('—', None, 'spacing.page', 64)]
TEXT_VARIANTS = [('display', 'display'), ('title', 'title'), ('heading', 'section'), ('subheading', 'h3'),
                 ('body', 'bodyApp'), ('bodyStrong', 'bodyApp at weight 600'), ('small', 'small'),
                 ('smallStrong', 'small at weight 600 (label where it names a field)'), ('caption (12 px)', 'fine (13/18)'),
                 ('figure', 'price for an amount, count for a count')]
BUTTONS = [('web variant primary', 'primary'), ('web variant secondary', 'outline'), ('web variant ghost', 'link-button'),
           ('web variant danger', 'danger (inside the danger zone only)'), ('web size sm (36 px with a mouse)', 'btn-sm, 44 everywhere'),
           ('web size md', 'default, 48'), ('web size lg', 'default, 48 (no larger web button)'),
           ('phone variant primary / secondary / ghost / danger', 'primary / outline / link-button / danger'),
           ('phone size md', 'default, 52'), ('phone size sm', 'sm, 48'), ('phone size lg', 'lg, 56'),
           ('phone: driver actions (new)', 'size="driver", 56'), ('phone: the driver\'s fixed action (new)', 'size="driverFixed", 64'),
           ('on a coloured bar (new)', 'onBand / ghostBand')]
ADAPTERS = [
    ('ui Badge({tone})', 'Tag({sign, children})', 'tone → sign: neutral ○, info ◐, success ✓ ok, warning ! warn, danger ! err, promo plain. Only a fallback: states use StatusTag (below).'),
    ('ui OrderStatusBadge / ShipmentStatusBadge / InvoiceStatusBadge', 'StatusTag({kind, value, viewer})', 'Reads sign and word from packages/core status words.'),
    ('ui Alert({tone, title})', 'Notice({kind, title})', 'tone → kind: success ok, info info, warning warn, danger err.'),
    ('ui buttonClass({variant, size}) / Button', 'Button({kind, size})', 'Old prop values accepted and mapped (table above) until step 4 ends.'),
    ('next-kit PageHeader', 'PageHead', 'Same props; drops the eyebrow (no caps).'),
    ('next-kit Stat', 'Task / KeyValue (§5.17)', 'Stat({label, value}) renders a KeyValue row.'),
    ('next-kit DataTable({caption, head, children})', 'DataTable<Row>({caption, columns, rows, …}) (§5.13)', 'The old signature renders T7a cards with the head as labels, without sorting, until the 17 callers move.'),
    ('next-kit FormMessage', 'Notice at the top of the form (§5.26)', ''),
    ('expo-kit Badge, Alert, Button, Card, ListRow, InfoRow', 'Tag, Notice, Button, RowList', 'Same mapping as the web.'),
]
RATCHET = [
    ('raw ramp classes', r'\b(bg|text|border|ring|accent|fill|stroke|outline|from|to)-(celeste|anil|guaria|maiz|selva|achiote|arena)-\d+'),
    ('legacy-only semantic classes', r'\b(bg|text|border)-(bg|surface|surface-muted|border|border-strong|brand-hover|brand-soft|promo|rating)\b'),
    ('brand outside the delivery components', r'\b(bg|text|border|accent)-brand\b|--color-brand|colors\.brand|semantic\.brand'),
    ('warning used as text', r'\btext-warning\b|tint="warning"|color: *colors\.warning'),
    ('hand-written targets and arbitrary values', r'\bmin-h-(9|10|11|12)\b|\[[0-9.]+(px|rem)\]'),
    ('fonts and borders set by hand in the phone apps', r'fontFamily|borderWidth|fontSize: *\d'),
    ('legacy theme in the phone apps', r'\b(colors|tone|space|fontSize|lineHeight)(\.[A-Za-z]|\[)'),
    ('a bare formatPrice in JSX', r'>\{formatPrice\('),
    ('module-level StyleSheet reading colours (rg -U, multiline)', r'StyleSheet\.create\(\{(?s:.)*?colors\.'),
]

# ---- 5. every status value: sign, words by viewer, English
# sign: ○ hollow (.tag), ◐ half (.tag.half), ✓d done on primary (.tag.done), ✓ ok (.tag.ok), !w warn, !e err, – ended
S = {'o': '○', 'h': '◐', 'd': '✓ done', 'k': '✓ ok', 'w': '! warn', 'e': '! err', 'x': '–'}
STATES = {
    'order_status (shopper)': [
        ('pending_payment', 'w', 'Esperando el pago', 'Awaiting payment'),
        ('payment_review', 'h', 'Verificando el pago', 'Checking your payment'),
        ('confirmed', 'd', 'Pedido confirmado', 'Order confirmed'),
        ('processing', 'h', 'Preparando su pedido', 'Preparing your order'),
        ('partially_shipped', 'h', 'Parte del pedido va en camino', 'Part of your order is on its way'),
        ('shipped', 'h', 'En camino', 'On its way'),
        ('delivered', 'k', 'Entregado', 'Delivered'),
        ('completed', 'k', 'Entregado', 'Delivered'),
        ('cancelled', 'x', 'Cancelado', 'Cancelled'),
        ('refunded', 'x', 'Reembolsado', 'Refunded'),
    ],
    'order_status (seller, staff)': [
        ('pending_payment', 'w', 'Esperando el pago', 'Awaiting payment'),
        ('payment_review', 'h', 'Verificando el pago', 'Checking payment'),
        ('confirmed', 'o', 'Por preparar', 'To prepare'),
        ('processing', 'h', 'Preparando', 'Preparing'),
        ('partially_shipped', 'h', 'Parte en camino', 'Partly on its way'),
        ('shipped', 'h', 'En camino', 'On its way'),
        ('delivered', 'k', 'Entregado', 'Delivered'),
        ('completed', 'k', 'Completado', 'Completed'),
        ('cancelled', 'x', 'Cancelado', 'Cancelled'),
        ('refunded', 'x', 'Reembolsado', 'Refunded'),
    ],
    'shipment_status (seller, staff, driver; shopper where it differs)': [
        ('pending', 'o', 'Por preparar', 'To prepare'),
        ('picking', 'h', 'Preparando', 'Preparing'),
        ('packed', 'h', 'Empacado (shopper: Preparando)', 'Packed (shopper: Preparing)'),
        ('ready_for_dispatch', 'h', 'Listo para salir (shopper: Preparando)', 'Ready to leave (shopper: Preparing)'),
        ('out_for_delivery', 'h', 'En camino', 'On its way'),
        ('delivered', 'k', 'Entregado', 'Delivered'),
        ('delivery_failed', 'w', 'No se pudo entregar; with attempt_count 0 (taken off a route): Reprogramado (◐)', 'Not delivered; attempt 0: Rescheduled'),
        ('returning', 'w', 'Vuelve a la bodega', 'Returning to the warehouse'),
        ('returned', 'x', 'Devuelto a la bodega', 'Back at the warehouse'),
        ('cancelled', 'x', 'Cancelado', 'Cancelled'),
    ],
    'derived order flags (packages/core lifecycle.ts; staff only)': [
        ('isStoppedOrder', 'w', 'Detenido', 'Stopped'),
        ('waitsForNewAttempt / awaiting another route', 'w', 'Espera otra ruta', 'Waiting for another route'),
        ('needs a person (any of the above, or unpaid at the cut-off)', 'w', 'Por atender', 'Needs attention'),
    ],
    'payment_status': [
        ('pending (cash on delivery)', 'o', 'Se paga al recibir', 'Pay on delivery'),
        ('pending (SINPE, transfer)', 'w', 'Esperando el pago', 'Awaiting payment'),
        ('authorized', 'h', 'Autorizado', 'Authorised'),
        ('captured', 'k', 'Pagado', 'Paid'),
        ('failed', 'e', 'Pago rechazado', 'Payment declined'),
        ('cancelled', 'x', 'Anulado', 'Voided'),
        ('refunded', 'x', 'Devuelto', 'Refunded'),
        ('partially_refunded', 'x', 'Devuelto en parte', 'Partly refunded'),
    ],
    'return_requests.status': [
        ('requested', 'o', 'Por decidir', 'To decide'),
        ('approved', 'h', 'Aprobada: por recibir', 'Approved: to receive'),
        ('received', 'h', 'Recibida: por devolver el dinero', 'Received: refund pending'),
        ('refunded', 'k', 'Dinero devuelto', 'Refunded'),
        ('rejected', 'x', 'Rechazada', 'Declined'),
    ],
    'complaints.status': [
        ('open', 'o', 'Por responder', 'To answer'),
        ('in_progress', 'h', 'En revisión', 'In review'),
        ('resolved', 'k', 'Respondido', 'Answered'),
    ],
    'payouts.status': [
        ('scheduled', 'o', 'Programado', 'Scheduled'),
        ('paid', 'k', 'Transferido', 'Transferred'),
        ('failed', 'e', 'No se pudo transferir', 'Transfer failed'),
    ],
    'product_status': [
        ('draft', 'o', 'Borrador', 'Draft'),
        ('pending_review', 'h', 'En revisión', 'In review'),
        ('active', 'k', 'Publicado', 'Published'),
        ('rejected', 'e', 'Rechazado', 'Rejected'),
        ('archived', 'x', 'Archivado', 'Archived'),
    ],
    'offer_status (+ derived stock)': [
        ('active', 'k', 'A la venta', 'On sale'),
        ('active with stock 0', 'w', 'Sin existencias', 'Out of stock'),
        ('paused', 'x', 'En pausa', 'Paused'),
        ('archived', 'x', 'Archivada', 'Archived'),
    ],
    'product_photos.state': [
        ('uploading', 'h', 'Subiendo', 'Uploading'),
        ('pending', 'h', 'En revisión', 'In review'),
        ('approved', 'k', 'Publicada', 'Published'),
        ('rejected', 'e', 'Rechazada (the reason follows in a sentence)', 'Rejected'),
        ('removed', 'x', 'Quitada', 'Removed'),
    ],
    'invoice_status (Hacienda)': [
        ('pending', 'o', 'Por enviar', 'To send'),
        ('sent', 'h', 'Enviada', 'Sent'),
        ('accepted', 'k', 'Aceptada', 'Accepted'),
        ('rejected', 'e', 'Rechazada', 'Rejected'),
        ('voided', 'x', 'Anulada', 'Voided'),
    ],
    'inbound_status (+ derived)': [
        ('draft', 'o', 'Por enviar', 'To send'),
        ('in_transit', 'h', 'En camino', 'On its way'),
        ('receiving', 'h', 'Recibiendo', 'Receiving'),
        ('received', 'k', 'Recibido', 'Received'),
        ('received with a difference', 'w', 'Con diferencias', 'With differences'),
        ('closed', 'x', 'Cerrado', 'Closed'),
        ('cancelled', 'x', 'Cancelado', 'Cancelled'),
    ],
    'review_status': [
        ('pending', 'o', 'Por revisar', 'To review'),
        ('published', 'k', 'Publicada', 'Published'),
        ('rejected', 'x', 'No publicada', 'Not published'),
    ],
    'stop_status (driver)': [
        ('pending', 'o', 'Por entregar', 'To deliver'),
        ('arrived', 'h', 'En la puerta', 'At the door'),
        ('delivered', 'k', 'Entregado', 'Delivered'),
        ('failed', 'w', 'No se pudo entregar', 'Not delivered'),
        ('skipped', 'x', 'Quitada por Central', 'Removed by Central'),
        ('code locked (pin_attempts_left 0)', 'e', 'Código bloqueado', 'Code locked'),
    ],
    'route_status': [
        ('draft', 'o', 'Borrador', 'Draft'),
        ('assigned', 'o', 'Asignada', 'Assigned'),
        ('in_progress', 'h', 'En ruta', 'On the road'),
        ('completed', 'k', 'Terminada', 'Finished'),
        ('cancelled', 'x', 'Cancelada', 'Cancelled'),
    ],
    'seller_invitations.status': [
        ('pending', 'o', 'Pendiente', 'Pending'),
        ('pending past expires_at', 'x', 'Vencida', 'Expired'),
        ('accepted', 'k', 'Aceptada', 'Accepted'),
        ('declined', 'x', 'Rechazada', 'Declined'),
        ('revoked', 'x', 'Retirada', 'Withdrawn'),
    ],
    'shop change requests (pending, approved, rejected, withdrawn, replaced)': [
        ('pending', 'h', 'En revisión', 'In review'),
        ('approved', 'k', 'Aprobado', 'Approved'),
        ('rejected', 'e', 'Rechazado', 'Rejected'),
        ('withdrawn', 'x', 'Retirado', 'Withdrawn'),
        ('replaced', 'x', 'Reemplazado', 'Replaced'),
    ],
    'messages (notification outbox; staff only)': [
        ('pending, sending', 'h', 'Enviando', 'Sending'),
        ('sent', 'h', 'Enviado', 'Sent'),
        ('delivered', 'k', 'Entregado', 'Delivered'),
        ('failed', 'w', 'Falló: se reintenta', 'Failed: retrying'),
        ('dead', 'e', 'Detenido', 'Stopped'),
        ('skipped, expired', 'x', 'No se envió', 'Not sent'),
    ],
    'content_reports.status': [
        ('open', 'o', 'Por revisar', 'To review'),
        ('in_review', 'h', 'En revisión', 'In review'),
        ('actioned', 'k', 'Atendido', 'Acted on'),
        ('dismissed', 'x', 'Descartado', 'Dismissed'),
    ],
}


def md_migration():
    L = ['#### 2.5.1 Semantic colour names\n', '| Today (`semantic.*`, Tailwind `--color-*`) | Carreta | Kind | What changes |', '|---|---|---|---|']
    for a, b, k, why in SEMANTIC:
        L.append(f'| `{a}` | `{b}` | {"**" + k + "**" if k == "meaning" else k} | {why} |')
    L.append(f'\nNew names with no ancestor: {", ".join("`" + n + "`" for n in NEW_ONLY)}.\n')
    L += ['#### 2.5.2 Raw ramp classes (68 web uses, 36 `colors.palette` uses) by the property they colour\n',
          '| Ramp | Steps | As a background | As text | As a border |', '|---|---|---|---|---|']
    for r, st, bg, tx, bd in RAMPS:
        L.append(f'| `{r}` | {st} | `{bg}` | `{tx}` | `{bd}` |')
    L += ['\n#### 2.5.3 Other web tokens and habits\n', '| Today | Carreta | Note |', '|---|---|---|']
    for a, b, n in WEB_OTHER:
        L.append(f'| {a} | {b} | {n} |')
    L += ['\n#### 2.5.4 Phone tokens (expo-kit)\n', '| Today | Carreta | Note |', '|---|---|---|']
    for a, b, n in PHONE:
        L.append(f'| `{a}` | `{b}` | {n} |')
    L += ['\nSpacing changes **name**, never meaning under the same key: today `space` is keyed 0, 1, 2, 3, 4, 5, 6, 8, 10, 12; the new object is `spacing` with named keys, so an old index cannot silently mean a new value. `space` stays exported, unchanged, until step 6; the ratchet forbids it in a moved app.\n',
          '| Today | px | Carreta | px |', '|---|---|---|---|']
    for a, p, b, q in SPACE:
        L.append(f'| `{a}` | {"" if p is None else p} | `{b}` | {q} |')
    L += ['\n20 and 40 have no step: they round to the nearer step and ties go up (20 → 24, 40 → 48).\n',
          '| Text variant today | Type step |', '|---|---|']
    for a, b in TEXT_VARIANTS:
        L.append(f'| `{a}` | `{b}` |')
    L += ['\nThe old variant names stay accepted by `Text` (mapped as above) until step 4 ends.\n',
          '#### 2.5.5 Button kinds and sizes\n', '| Today | Carreta |', '|---|---|']
    for a, b in BUTTONS:
        L.append(f'| {a} | {b} |')
    L += ['\n#### 2.5.6 Component adapters (kept until the last caller has moved; deleted in step 6)\n', '| Today | Carreta component | How the adapter maps it |', '|---|---|---|']
    for a, b, n in ADAPTERS:
        L.append(f'| `{a}` | `{b}` | {n} |')
    L += ['\n#### 2.5.7 Ratchet patterns (packages/brand `ratchet.test.ts`, per app; a moved app must count 0)\n', '| What | Pattern (ripgrep) |', '|---|---|']
    for a, p in RATCHET:
        L.append(f'| {a} | `{p}` |')
    return '\n'.join(L)


def md_states():
    L = ['| Enum / table (viewer) | Value | Sign | Spanish word | English |', '|---|---|---|---|---|']
    for k, rows in STATES.items():
        for i, (v, s, es, en) in enumerate(rows):
            L.append(f'| {k if i == 0 else ""} | `{v}` | {S[s]} | {es} | {en} |')
    return '\n'.join(L)


def write_json():
    data = {'semantic': [dict(zip(('today', 'carreta', 'kind', 'note'), r)) for r in SEMANTIC], 'newOnly': NEW_ONLY,
            'ramps': [dict(zip(('ramp', 'steps', 'background', 'text', 'border'), r)) for r in RAMPS],
            'webOther': [dict(zip(('today', 'carreta', 'note'), r)) for r in WEB_OTHER],
            'phone': [dict(zip(('today', 'carreta', 'note'), r)) for r in PHONE],
            'spacing': [dict(zip(('today', 'px', 'carreta', 'carretaPx'), r)) for r in SPACE],
            'textVariants': dict(TEXT_VARIANTS), 'buttons': dict(BUTTONS),
            'adapters': [dict(zip(('today', 'carreta', 'mapping'), r)) for r in ADAPTERS],
            'ratchet': dict(RATCHET),
            'statusWords': {k: [dict(zip(('value', 'sign', 'es', 'en'), (v, S[s], es, en))) for v, s, es, en in rows] for k, rows in STATES.items()}}
    json.dump(data, open(os.path.join(ROOT, 'migration.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    write_json(); print(md_migration()[:400])
