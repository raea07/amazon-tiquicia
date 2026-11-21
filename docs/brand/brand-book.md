# Yuntera brand book

This is the durable, text source of the brand. A designed version of the same
content is in [`brand-book.html`](brand-book.html), which is also what is
published as an Artifact.

It documents **what is in the code today**, not an ideal. Values are quoted from
[`packages/brand/src/tokens.ts`](../../packages/brand/src/tokens.ts),
[`brand.ts`](../../packages/brand/src/brand.ts),
[`logo.tsx`](../../packages/brand/src/logo.tsx) and the shared components in
[`packages/ui`](../../packages/ui/src). Where the code disagrees with itself or
with a rule stated here, the disagreement is listed under
[Open items](#16-open-items) rather than hidden. Where this book sets a rule the
code does not enforce (clear space, minimum sizes), it says so.

Prose is in English; everything a customer reads is in Spanish, with a short
English note for readers who do not speak it.

## Contents

1. [What Yuntera is](#1-what-yuntera-is)
2. [The name and the mark](#2-the-name-and-the-mark)
3. [Personality](#3-personality)
4. [Voice and tone](#4-voice-and-tone)
5. [The app family](#5-the-app-family)
6. [Using the logo](#6-using-the-logo)
7. [Colour](#7-colour)
8. [Typography](#8-typography)
9. [Layout, spacing, radius, elevation](#9-layout-spacing-radius-elevation)
10. [The wheel band](#10-the-wheel-band)
11. [Icons and illustration](#11-icons-and-illustration)
12. [Components](#12-components)
13. [Accessibility commitments](#13-accessibility-commitments)
14. [Photography and imagery](#14-photography-and-imagery)
15. [Legal notes](#15-legal-notes)
16. [Open items](#16-open-items)

---

## 1. What Yuntera is

Yuntera is an online marketplace for Costa Rica with its own warehouse and its
own delivery. Costa Rican sellers list products; Yuntera collects the payment,
stores the stock when the seller wants that, and delivers with its own drivers,
starting in the Gran Área Metropolitana.

Four groups of people use it, and each has an app: shoppers, sellers, drivers
and warehouse staff, plus the internal team. The brand has to read as one
company to all of them — a shopper paying by SINPE Móvil, a ferretería owner
checking what she is owed, a driver at a gate asking for a delivery code.

| Fact            | Value                            | Source                  |
| --------------- | -------------------------------- | ----------------------- |
| Name            | Yuntera                          | `brand.ts`              |
| Wordmark form   | `yuntera` (always lowercase)     | `logo.tsx`              |
| Country         | Costa Rica                       | `brand.ts`              |
| Language        | Spanish, es-CR, "usted" register | `brand.ts`, `errors.ts` |
| Currency        | Colones (CRC), symbol ₡          | `brand.ts`, `money.ts`  |
| Time zone       | America/Costa_Rica               | `brand.ts`              |
| Primary tagline | **Lo que ocupa, a su puerta.**   | `brand.ts`              |

_"Lo que ocupa, a su puerta" — "What you need, at your door." In Costa Rica
"ocupar" is the everyday verb for "to need"; a shopkeeper asks "¿Qué ocupa?"_

## 2. The name and the mark

### The yunta

A _yunta_ is a pair of oxen joined by a yoke so that they pull as one. In Costa
Rica it is what pulled the _carreta_, the cart that carried the country's coffee
to port. To do something _en yunta_ is to pull together.

**Yuntera** is a coined word built on that root. It was chosen because a
marketplace is exactly that arrangement: two parties who each need the other,
joined so the load moves. The full reasoning and the availability checks are in
the [naming report](naming.md).

Say it _yoon-TEH-rah_. Write it with a capital Y in running text (Yuntera) and
in lowercase in the wordmark (yuntera). Never YUNTERA, never Yun-Tera, never
"La Yuntera".

### The mark

Two paths start apart, each from a round node, bend toward each other and merge
into a single stem.

It is meant to be read three ways, and all three are intended:

1. **The letter Y**, the initial of the name.
2. **The yoke** — the piece that joins two so they pull as one. The two nodes
   are the pair.
3. **Two routes converging on one destination** — seller and buyer, shop and
   courier, meeting at a door.

### Geometry

The mark lives on a 48 × 48 grid. It is one path and two circles, and nothing
else:

```
path     M12 12 C12 23 24 20 24 31   (left branch)
         M36 12 C36 23 24 20 24 31   (right branch, mirrored)
         M24 31 V42                  (stem)
stroke   6 units, round caps, round joins
nodes    circle at (12, 11) radius 6
         circle at (36, 11) radius 6
```

- The stroke and the node radius are the same number (6), so each node is
  exactly twice as wide as the line that leaves it.
- The drawing is symmetrical about x = 24.
- It uses `currentColor`, so it takes its colour from where it is placed.

Do not redraw it. Use the component (`YunteraMark`, `YunteraLogo`) in code and
the files in [`packages/brand/assets`](../../packages/brand/assets) everywhere
else.

## 3. Personality

Yuntera is the reliable local business that happens to run on software.

| Yuntera is                                                               | Yuntera is not                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Hard-working.** It talks about what it does: stores, delivers, pays.   | Aspirational. No lifestyle, no "reimagining commerce".           |
| **Plain.** Says the price, the date, the fee and the reason.             | Clever. No wordplay that makes someone read twice.               |
| **Respectful.** Addresses every adult as _usted_.                        | Chummy. No "mae", no "pura vida", no forced Tico slang.          |
| **Costa Rican at the root.** Señas, SINPE, colones, feriados, the GAM.   | Costume. No flags, no sloths, no tourist imagery of the country. |
| **Honest about limits.** "Todavía no entregamos en esa zona."            | A promiser. Never a date, a zone or a saving it cannot keep.     |
| **On the customer's side.** Shows rights and fees before they are asked. | Pushy. No countdowns, no "only 2 left!", no pre-ticked boxes.    |
| **Calm.** One exclamation mark in the whole product, for good news.      | Loud. No capitals for emphasis, no emoji in the interface.       |

The test for any new screen, message or advert: _would the owner of a
well-run neighbourhood shop say this to a customer's face?_

## 4. Voice and tone

### Register: usted

Everything is written in **usted**, with third-person verb forms: _ajuste_,
_revise_, _elija_, _escríbanos_. Not _vos_ (_ajustá_), not _tú_ (_ajusta_).
_Usted_ is the everyday respectful register in Costa Rica — it is how people
speak to customers, to strangers and often to family — so it is correct for a
first-time shopper, a seller and a driver alike, and it never reads as cold.

A check of the apps and of every error message finds no _vos_ or _tú_ form, no
slang, no emoji, and exactly one exclamation: _¡Recibimos su pedido!_

### Rules

1. **Say what happened, then what to do.** Two short sentences beat one long
   one.
2. **When it is our fault, say so.** When it is nobody's fault, do not assign
   one.
3. **Name the thing the person knows**, not the system's word for it: _pedido_,
   _paquete_, _repartidor_, _bodega_, _señas_, _código de entrega_.
4. **A button says exactly what will happen**, and if money moves, how much.
5. **Numbers are exact.** Dates as people say them (_lunes, 23 de noviembre_),
   prices in colones with the IVA included, fees itemised.
6. **Rights are stated as plainly as prices.** Returns, warranty and complaints
   are part of the offer, not small print.
7. **No pressure.** Urgency is only ever a real fact (a cut-off time, a refund
   deadline).
8. **Spanish words first.** Use the Spanish term where one is in everyday use.

### Do and don't

The "do" lines are real strings from the apps. The "don't" lines are written
here as examples of what to avoid.

| Do (from the product)                                                                                                                         | Don't                                                | Why                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| _No quedan suficientes unidades de uno de los productos. Ajuste la cantidad._                                                                 | _Ajustá la cantidad._ / _Ajusta la cantidad._        | _Usted_, always. ("Not enough units left… Adjust the quantity.")                                                                    |
| _Un precio cambió mientras usted compraba. Revise el nuevo total antes de confirmar._                                                         | _Error 409: price_changed_                           | What happened and what to do; never a code. ("A price changed while you were shopping…")                                            |
| _Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento._                                                                           | _Operación inválida. Verifique sus datos._           | Own the fault; do not blame the customer. ("Something went wrong on our side.")                                                     |
| _Todavía no entregamos en esa zona. Estamos trabajando para llegar pronto._                                                                   | _¡Muy pronto en todo el país!_                       | Honest about the limit, no promise with no date. ("We don't deliver in that area yet.")                                             |
| _Confirmar pedido por ₡29 800_                                                                                                                | _Continuar_ / _OK_                                   | The button says what happens and how much.                                                                                          |
| _Tiene 8 días hábiles desde que recibe para devolver, sin dar explicaciones._                                                                 | _Consulte nuestra política de devoluciones._         | State the right; do not send people to look for it. ("You have 8 business days from delivery to return it, no explanation needed.") |
| _Dígaselo al repartidor solo cuando tenga el paquete en sus manos. … nadie de Yuntera se lo va a pedir por teléfono ni por mensaje._          | _Por su seguridad, valide su código con el courier._ | Explain the security step in terms of what the person does. ("Tell the driver only when the parcel is in your hands…")              |
| _El pedido ya se está preparando y no se puede cancelar desde aquí. Escríbanos y le ayudamos; después de recibirlo también puede devolverlo._ | _No es posible cancelar este pedido._                | A "no" always comes with the way forward.                                                                                           |
| _El correo o la contraseña no coinciden._                                                                                                     | _Ese correo no está registrado._                     | Plain, and it does not reveal whether an account exists.                                                                            |
| _Sin mensualidad: solo paga una comisión cuando vende._ (to sellers)                                                                          | _¡Planes desde ₡0! Aplican condiciones._             | The whole deal in one sentence. ("No monthly fee: you only pay a commission when you sell.")                                        |
| _Publicamos todas las reseñas de compras verificadas, buenas y malas._                                                                        | _Opiniones de clientes satisfechos_                  | Say how it works, including the part that is not flattering.                                                                        |

### Words

| Use                                  | Not                                 |
| ------------------------------------ | ----------------------------------- |
| repartidor                           | courier, rider, delivery            |
| pedido / paquete                     | orden, envío express                |
| carrito / Finalizar compra           | checkout                            |
| bodega                               | fulfillment center, almacén central |
| señas (how an address is given)      | dirección línea 2                   |
| devolución / derecho de retracto     | return policy                       |
| factura electrónica                  | invoice, comprobante fiscal digital |
| SINPE Móvil, tarjeta, contra entrega | métodos de pago digitales           |
| (opcional) beside optional fields    | \* for required fields              |

### Tone by moment

| Moment           | Tone                                | Example                                                                                 |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| Browsing         | Informative, brief                  | _Precio final, IVA incluido._                                                           |
| Paying           | Exact, unhurried                    | _Precio final en colones. Incluye ₡2 387,40 de IVA._                                    |
| Good news        | Warm, short — the one exclamation   | _¡Recibimos su pedido!_                                                                 |
| Something failed | Calm, responsible, with a next step | _No es culpa suya. … no le cobraremos dos veces._                                       |
| Saying no        | Direct, with the alternative        | _El pago contra entrega no está disponible para este pedido. Elija otro medio de pago._ |
| To a seller      | Peer to peer, businesslike          | _Prometa lo que puede cumplir._                                                         |
| To staff         | Factual                             | _Todo lo que se hace aquí queda registrado con su nombre._                              |

## 5. The app family

One name, plus a plain Spanish word that says who the app is for. The flagship
carries the bare name.

| App                 | Wordmark          | For                    | Planned host         | Accent in `brand.ts` |
| ------------------- | ----------------- | ---------------------- | -------------------- | -------------------- |
| **Yuntera**         | `yuntera`         | Compradores (shoppers) | `www.yuntera.cr`     | celeste              |
| **Yuntera Vende**   | `yuntera vende`   | Vendedores y PYMEs     | `vende.yuntera.cr`   | guaria               |
| **Yuntera Ruta**    | `yuntera ruta`    | Repartidores (drivers) | `ruta.yuntera.cr`    | selva                |
| **Yuntera Bodega**  | `yuntera bodega`  | Personal de bodega     | `bodega.yuntera.cr`  | maíz                 |
| **Yuntera Central** | `yuntera central` | Operaciones internas   | `central.yuntera.cr` | añil                 |

_Vende_ — "sells". _Ruta_ — "route". _Bodega_ — "warehouse". _Central_ —
"head office".

### How a lockup is built

`YunteraLogo` draws every lockup the same way; `size` is the height of the mark.

| Part       | Rule                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| Mark       | `size` high, in the brand colour                                                            |
| Gap        | 0.30 × `size` between mark and wordmark                                                     |
| Wordmark   | `yuntera`, lowercase, Bricolage Grotesque 700, 0.86 × `size`, tracking −0.03 em, ink        |
| Descriptor | lowercase, same face and size at weight 500, 62 % opacity, 0.22 × `size` after the wordmark |

- The descriptor is **never** a different colour from the wordmark. It is the
  same ink, lighter.
- The descriptor is **never** set on a second line or in capitals.
- New surfaces follow the same pattern: _Yuntera_ + one everyday Spanish noun
  or verb. No English descriptors, no abbreviations.

The `accent` field assigns each app a palette, but **no app uses it yet**: all
of them are built with the celeste brand colour, and are told apart only by the
descriptor. See [Open items](#16-open-items).

## 6. Using the logo

The clear-space, minimum-size and misuse rules below are **set by this book**.
Nothing in the code enforces them.

### Versions

| Version                  | Use                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Lockup (mark + wordmark) | The default wherever there is room                                                             |
| Mark alone               | When the name is already present nearby, or space is very small                                |
| App icon                 | Favicon, home screen, avatar: white mark at 70 % on a brand-colour square, corner radius 11/48 |

### Colour of the mark

| Background                         | Mark               | Wordmark |
| ---------------------------------- | ------------------ | -------- |
| White, arena, any light tint       | Brand, celeste 600 | Ink      |
| Brand colour, ink, dark photograph | White              | White    |
| One-colour printing                | Ink                | Ink      |

No other colourings. In particular the mark is not drawn in guaria, maíz, selva
or achiote, and the two nodes are never different colours.

### Clear space

Keep a margin on every side equal to the diameter of one node — **a quarter of
the mark's height** (12 units on the grid).

### Minimum sizes

| Artwork    | Screen                                  | Print          |
| ---------- | --------------------------------------- | -------------- |
| Mark alone | 16 px high                              | 6 mm high      |
| App icon   | 16 px (favicon); 48 px and up for touch | 8 mm           |
| Lockup     | Mark 20 px high                         | Mark 8 mm high |

In the apps the lockup appears with the mark at 26 px (back-office headers) and
30 px (the shop).

### Do not

- Stretch, squash, rotate or slant it.
- Change the stroke weight, the node size or the spacing between mark and name.
- Set the wordmark in capitals, in another typeface, or with a capital Y.
- Add a shadow, glow, outline or gradient.
- Place it on a busy photograph or on a colour without enough contrast.
- Put it in a box, a circle or a speech bubble (the app icon is the only
  container).
- Use the mark as a letter inside a word, or as a bullet.

## 7. Colour

### What each colour is for

The palettes are named for things in Costa Rica rather than for generic colour
words.

| Palette     | Named for                         | Role                                                  |
| ----------- | --------------------------------- | ----------------------------------------------------- |
| **Celeste** | The turquoise of Río Celeste      | **The brand colour.** Buttons, links, focus, the mark |
| **Añil**    | Indigo ink                        | Text, strong borders, neutral badges, dark surfaces   |
| **Guaria**  | The guaria morada orchid's purple | Promotions and discounts — and nothing else           |
| **Maíz**    | Corn yellow                       | Ratings (500) and warnings (700)                      |
| **Selva**   | Rainforest green                  | Success, delivered, in stock                          |
| **Achiote** | Annatto red                       | Errors and destructive actions                        |
| **Arena**   | Warm sand                         | Page background, muted surfaces, hairline borders     |

Colour is never the only signal. A status always has words; an error always has
a sentence.

### Palettes

Token names are `--color-<palette>-<step>` in CSS (the file keeps `anil` and
`maiz` without accents).

| Step | Celeste   | Añil      | Guaria    | Maíz      | Selva     | Achiote   | Arena     |
| ---- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| 50   | `#ecfbfc` | `#f3f5fa` | `#fcf2fa` | `#fffaeb` | `#eefbf3` | `#fef3f2` | `#fbfaf7` |
| 100  | `#d0f4f7` | `#e4e8f2` | `#f8e1f3` | `#fdf0c4` | `#d6f5e1` | `#fee4e2` | `#f5f2ec` |
| 200  | `#a5e8ee` | `#c9d1e3` | `#f0c0e5` | `#fbe08b` | `#b0eac7` | `#fecdca` | `#eae5da` |
| 300  | `#6dd6e0` | `#a2aecb` | `#e492d0` | `#f9cf55` | `#7cd8a6` | `#fca9a4` | `#dad2c2` |
| 400  | `#33bccb` | `#7484ab` | `#d35fb6` | `#f7c12d` | `#46be80` | `#f7776f` | `#bfb49f` |
| 500  | `#12a0b0` | `#53648f` | `#bc3a9a` | `#eda515` | `#24a365` | `#ed4c43` | —         |
| 600  | `#0b7f8e` | `#3f4e76` | `#9e2a7f` | `#c97f0e` | `#17824f` | `#d92f26` | —         |
| 700  | `#0c6775` | `#313d5e` | `#812266` | `#a05c0f` | `#146842` | `#b6231c` | —         |
| 800  | `#0f5360` | `#232c47` | `#6a1f54` | `#834913` | `#135337` | `#97211b` | —         |
| 900  | `#114551` | `#161d33` | `#581d46` | `#6c3c14` | `#11442f` | `#7d221d` | —         |
| 950  | `#062d37` | `#0c1122` | —         | —         | —         | —         | —         |

Plus `white` `#ffffff`.

### Semantic tokens

Screens are written against these names, not against palette steps.

| Token           | Value                 | Used for                                   |
| --------------- | --------------------- | ------------------------------------------ |
| `bg`            | arena 50 `#fbfaf7`    | The page                                   |
| `surface`       | white `#ffffff`       | Cards, fields, the header                  |
| `surface-muted` | arena 100 `#f5f2ec`   | Table heads, quoted text, disabled fields  |
| `border`        | arena 200 `#eae5da`   | Hairlines between and around surfaces      |
| `border-strong` | añil 200 `#c9d1e3`    | Field and secondary-button outlines        |
| `ink`           | añil 900 `#161d33`    | Text                                       |
| `ink-muted`     | añil 600 `#3f4e76`    | Secondary text, hints                      |
| `on-brand`      | white `#ffffff`       | Text on the brand colour                   |
| `brand`         | celeste 600 `#0b7f8e` | Primary buttons, the mark, selected states |
| `brand-hover`   | celeste 700 `#0c6775` | Primary button on hover                    |
| `brand-soft`    | celeste 50 `#ecfbfc`  | Selected rows, ghost-button hover          |
| `link`          | celeste 700 `#0c6775` | Links                                      |
| `focus`         | celeste 500 `#12a0b0` | The focus ring                             |
| `promo`         | guaria 600 `#9e2a7f`  | Promotions                                 |
| `rating`        | maíz 500 `#eda515`    | Rating stars                               |
| `success`       | selva 600 `#17824f`   | Success                                    |
| `danger`        | achiote 600 `#d92f26` | Errors, destructive buttons                |
| `warning`       | maíz 700 `#a05c0f`    | Warnings, deadlines                        |

### Contrast the build enforces

`tokens.test.ts` fails the build if any of these pairs drops below WCAG 2.2 AA
(4.5 : 1 for text, 3 : 1 for the focus ring). Ratios below are computed with the
same formula as the test.

| Pair                          | Foreground            | Background              | Ratio     |
| ----------------------------- | --------------------- | ----------------------- | --------- |
| Body text on page             | ink `#161d33`         | bg `#fbfaf7`            | 16.00 : 1 |
| Body text on surface          | ink `#161d33`         | surface `#ffffff`       | 16.70 : 1 |
| Muted text on page            | ink-muted `#3f4e76`   | bg `#fbfaf7`            | 7.85 : 1  |
| Muted text on muted surface   | ink-muted `#3f4e76`   | surface-muted `#f5f2ec` | 7.33 : 1  |
| White on brand button         | white                 | brand `#0b7f8e`         | 4.73 : 1  |
| White on brand hover          | white                 | brand-hover `#0c6775`   | 6.54 : 1  |
| Link on page                  | link `#0c6775`        | bg `#fbfaf7`            | 6.26 : 1  |
| Link on brand-soft            | link `#0c6775`        | brand-soft `#ecfbfc`    | 6.15 : 1  |
| White on promo                | white                 | promo `#9e2a7f`         | 6.79 : 1  |
| White on success              | white                 | success `#17824f`       | 4.84 : 1  |
| White on danger               | white                 | danger `#d92f26`        | 4.79 : 1  |
| Warning text on page          | warning `#a05c0f`     | bg `#fbfaf7`            | 4.99 : 1  |
| Ink on rating yellow          | ink `#161d33`         | rating `#eda515`        | 7.95 : 1  |
| White on dark surface         | white                 | añil 900 `#161d33`      | 16.70 : 1 |
| Celeste on dark surface       | celeste 300 `#6dd6e0` | añil 900 `#161d33`      | 9.82 : 1  |
| Focus ring on page (3 : 1)    | focus `#12a0b0`       | bg `#fbfaf7`            | 3.01 : 1  |
| Focus ring on surface (3 : 1) | focus `#12a0b0`       | surface `#ffffff`       | 3.14 : 1  |

Three of these have almost no margin: **white on the brand colour (4.73)**,
**white on danger (4.79)** and **the focus ring on the page (3.01)**. Do not
lighten celeste 600, achiote 600 or celeste 500, and do not darken the page
background, without re-running the test.

Pairs used by components but **not** covered by the test (computed here):

| Pair                                                    | Ratio            | Note                                                       |
| ------------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| Badge text, every tone (900 on 100; neutral 800 on 100) | 8.04 – 11.25 : 1 | Passes                                                     |
| Alert text, every tone (900/950 on 50)                  | 8.77 – 13.75 : 1 | Passes                                                     |
| Error text on surface (danger on white)                 | 4.79 : 1         | Passes, narrowly                                           |
| Placeholder text (añil 500 on white)                    | 5.85 : 1         | Passes; enforced by the contrast test                      |
| Rating star (maíz 500 on white)                         | 2.10 : 1         | Decoration only; the rating is always also written as text |

Rules that follow:

- **Rating yellow is never a text colour.** It may carry ink text on top of it.
- **Guaria is only for promotions.** A purple button or link would dilute the
  one meaning it has.
- **Red is only for errors and destruction.** Not for discounts, not for "new".

## 8. Typography

Two families, both open source (SIL Open Font License) and self-hosted by the
apps, so no request leaves the site to load them.

| Role    | Family                  | Used for                                            |
| ------- | ----------------------- | --------------------------------------------------- |
| Display | **Bricolage Grotesque** | Headings (h1–h3), prices, the wordmark, big numbers |
| Text    | **Inter**               | Everything else: body, labels, buttons, tables      |
| Mono    | The system monospace    | Defined as a token; not used in the apps today      |

Fallbacks: `ui-sans-serif, system-ui, sans-serif` (Inter adds `-apple-system`
and `"Segoe UI"`).

### Scale

Body text is never smaller than 16 px on a phone.

| Token  | rem   | px  | Where it appears                                                |
| ------ | ----- | --- | --------------------------------------------------------------- |
| `xs`   | 0.75  | 12  | Badges, table column heads, fine print                          |
| `sm`   | 0.875 | 14  | Labels, hints, table cells, secondary text (the most used size) |
| `base` | 1     | 16  | Body text, fields, medium buttons                               |
| `lg`   | 1.125 | 18  | Lead paragraphs, large buttons, card titles                     |
| `xl`   | 1.25  | 20  | Section headings, the medium price                              |
| `2xl`  | 1.5   | 24  | Section headings on the shop, big figures                       |
| `3xl`  | 1.875 | 30  | Page titles, the large price                                    |
| `4xl`  | 2.5   | 40  | The shop's hero on a phone                                      |
| `5xl`  | 3.25  | 52  | The shop's hero on a wide screen                                |

### Weights and details

| Use                        | Family    | Weight | Details                                     |
| -------------------------- | --------- | ------ | ------------------------------------------- |
| Hero headline              | Bricolage | 800    | tracking −0.015 em, `text-wrap: balance`    |
| Page and section headings  | Bricolage | 700    | tracking −0.015 em, `text-wrap: balance`    |
| Prices and big figures     | Bricolage | 700    | tabular figures                             |
| Wordmark                   | Bricolage | 700    | tracking −0.03 em; descriptor at 500        |
| Buttons, labels, emphasis  | Inter     | 600    |                                             |
| Error text, small emphasis | Inter     | 500    |                                             |
| Body                       | Inter     | 400    | `text-wrap: pretty` on paragraphs and lists |

Headings are sentence case: _Finalizar compra_, not _Finalizar Compra_.
Capitals are used only for 12 px table column heads, with a little letter
spacing.

### Numbers and money

Money is where a marketplace earns or loses trust, so its typography is fixed:

- **The colón sign ₡ comes first, with no space:** `₡12 500`.
- **Thousands are separated by a narrow no-break space** (U+202F), not a dot or
  a comma: `₡289 000`. It cannot wrap in the middle of a price.
- **The decimal mark is a comma, and céntimos appear only when they exist:**
  `₡4 950` but `₡2 387,40`.
- **Prices use tabular figures** (`font-variant-numeric: tabular-nums`), so
  columns of amounts line up and a total does not jiggle when it changes.
- **A negative amount uses a real minus sign** (−, U+2212): `−20%`,
  `− ₡2 400`.
- **Every price a shopper sees includes the IVA**, and says so: _Precio final,
  IVA incluido._
- A discount shows the regular price struck through in 14 px muted text and a
  guaria badge with the percentage, only when the saving is 5 % or more.

All of this is one function, `format()` in `packages/core/src/money.ts`. Never
format a price by hand.

Dates are written the way they are said: _lunes, 23 de noviembre_; short form
_21 nov, 3:42 a. m._

## 9. Layout, spacing, radius, elevation

### Page

- **Width.** Content sits in `.shell`: at most 76 rem (1216 px), centred, with
  a 16 px gutter that becomes 24 px from 768 px up.
- **Phone first.** Every screen works at 390 px with no horizontal scrolling;
  wide tables scroll inside their own frame.
- **Product grids** are 2 columns on a phone, 3 on a tablet, 4 on a desktop.
- **The header is part of the page's static shell**; the parts that depend on
  who is looking arrive in placeholders of the same size, so nothing shifts.

### Spacing

There are no custom spacing tokens. The apps use the default 4 px scale of the
CSS framework (4, 8, 12, 16, 20, 24, 32, 40, 48 …). In practice: 12–16 px
inside small components, 16–20 px inside cards, 24–40 px between sections.
Space between siblings comes from `gap`, not from margins on each item.

### Radius

| Token  | Value   | Used for                           |
| ------ | ------- | ---------------------------------- |
| `sm`   | 6 px    | Small inner elements               |
| `md`   | 10 px   | Buttons, fields, alerts, skeletons |
| `lg`   | 16 px   | Cards, panels, product images      |
| `xl`   | 24 px   | Defined; rarely used               |
| `full` | 9999 px | Badges, pills, counters            |

### Elevation

Shadows are tinted with the ink colour (`rgb(22 29 51)`), never pure black, and
used lightly. Most separation comes from the hairline border.

| Token | Value                              | Used for                      |
| ----- | ---------------------------------- | ----------------------------- |
| `sm`  | `0 1px 2px rgb(22 29 51 / 0.06)`   | Cards                         |
| `md`  | `0 4px 14px rgb(22 29 51 / 0.08)`  | Things that float (skip link) |
| `lg`  | `0 12px 32px rgb(22 29 51 / 0.12)` | Reserved for overlays         |

### Touch targets

The token is 44 px. Fields and medium buttons are 44 px tall; large buttons
48 px. Small buttons are 36 px with a mouse and 44 px on touch screens.

## 10. The wheel band

The brand has one decorative element: a quiet, repeating pattern of a dot inside
a ring, on a 40 px grid. It is an original geometric pattern. It nods to the
country's tradition of painted oxcart wheels in general — a wheel, seen from the
side, repeated — without copying any real wheel's painted design.

As built (`.wheel-band` in `packages/next-kit/styles/base.css`):

- a dot of celeste 200, radius 0.3 rem;
- a ring of celeste 100, from 0.75 rem to 0.95 rem;
- both centred in a 2.5 rem tile, on a celeste 50 background.

Rules:

- **Use it sparingly.** Today it appears in exactly one place: the band behind
  the shop's home-page headline. That is about the right amount.
- Only behind a large heading and a short lead line, with plenty of empty
  space, as on the shop's home page. Never behind running text, forms, tables
  or prices.
- Only in the two lightest celeste tints. It is not recoloured in guaria or
  maíz, and it is not made bolder.
- Do not replace it with photographs or reproductions of actual painted wheels.

## 11. Icons and illustration

### The wheel glyph

The secondary glyph, for empty states and loading: a circle (radius 20, stroke
4), a hub (radius 5) and eight spokes (stroke 2.5, round ends) on the same 48
grid as the mark. In an empty state it is 48 px in celeste 300; as a spinner it
is 20 px in the brand colour and turns once every 1.4 s (and stops for people
who ask their device for reduced motion).

### Icons

The interface uses almost none. Words do the work: a button says _Agregar al
carrito_ rather than showing a cart. When an icon is added, draw it like the
mark: on a square grid, one stroke weight, round caps and joins, `currentColor`,
no fills except small solid dots. No emoji as icons.

### Product illustration (demo catalogue)

The demo catalogue has no photographs. Each product has a simple original
drawing, generated by `apps/web/scripts/gen-demo-art.mjs`:

- an 800 × 800 square;
- a flat tint background and **one** ink colour;
- 18-unit strokes with round caps and joins, plus a few solid shapes;
- the object reduced to its most recognisable outline, centred.

| Tone    | Background | Ink       |
| ------- | ---------- | --------- |
| celeste | `#d0f4f7`  | `#0c6775` |
| guaria  | `#f8e1f3`  | `#812266` |
| maíz    | `#fdf0c4`  | `#a05c0f` |
| selva   | `#d6f5e1`  | `#146842` |
| achiote | `#fee4e2`  | `#b6231c` |
| añil    | `#e4e8f2`  | `#313d5e` |
| arena   | `#f5f2ec`  | `#6c3c14` |

These are placeholders for the demo. Real listings carry the seller's own
photographs (section 14). The same style suits help pages and empty states.

## 12. Components

Shared components live in `packages/ui`. Screens use them rather than restyling
buttons and fields one by one.

### Buttons

| Variant     | Looks like                                            | For                                         |
| ----------- | ----------------------------------------------------- | ------------------------------------------- |
| `primary`   | Brand background, white text; darker on hover         | The one main action on a screen             |
| `secondary` | White, 1 px `border-strong`, ink text; muted on hover | Other actions                               |
| `ghost`     | No box, link-coloured text; `brand-soft` on hover     | Low-key actions (_Salir_, _Editar carrito_) |
| `danger`    | Achiote 600 background, white text                    | Cancelling, suspending                      |

| Size | Height | Side padding | Text  |
| ---- | ------ | ------------ | ----- |
| `sm` | 36 px  | 12 px        | 14 px |
| `md` | 44 px  | 16 px        | 16 px |
| `lg` | 48 px  | 24 px        | 18 px |

All buttons: Inter 600, radius 10 px. **Disabled:** 55 % opacity and a
not-allowed cursor. **Focus:** a 2 px ring in the focus colour, 2 px away from
the button. **While sending:** the button disables itself and its label changes
to what is happening (_Confirmando su pedido…_), so a double tap cannot submit
twice.

One primary button per screen or per card. Its label is a verb and says what
happens.

### Fields

- 44 px tall, radius 10 px, 1 px `border-strong`, white, 16 px text.
- **Label** above, always: 14 px, weight 600.
- **Required is the default and is not marked.** Optional fields say
  _(opcional)_ beside the label.
- **Hint** below in 14 px muted text; **error** replaces the hint in 14 px
  achiote text, is announced to screen readers, and turns the border red.
- **Focus:** 2 px ring, 1 px away. **Disabled:** muted surface and muted text.
- A form keeps what the person typed when a submission fails. Passwords are the
  one exception.

### Badges

Small pills for a state or a label: 12 px, weight 600, fully rounded, never
wrapping. Always a word, never just a colour.

| Tone      | Background            | Text                  | Means                              |
| --------- | --------------------- | --------------------- | ---------------------------------- |
| `neutral` | añil 100 `#e4e8f2`    | añil 800 `#232c47`    | Inactive, cancelled, not started   |
| `info`    | celeste 100 `#d0f4f7` | celeste 900 `#114551` | In progress                        |
| `success` | selva 100 `#d6f5e1`   | selva 900 `#11442f`   | Done, delivered, published         |
| `warning` | maíz 100 `#fdf0c4`    | maíz 900 `#6c3c14`    | Waiting on someone, has a deadline |
| `danger`  | achiote 100 `#fee4e2` | achiote 900 `#7d221d` | Failed, rejected, late             |
| `promo`   | guaria 100 `#f8e1f3`  | guaria 900 `#581d46`  | A discount (_−20%_)                |

Order and parcel statuses map to these tones in one place (`commerce.tsx`), so
_Entregado_ is the same green in the shop, the seller centre and the console.

### Alerts

A message that belongs to the page: radius 10 px, 1 px border, 14 px text, an
optional bold title.

| Tone      | Border      | Background | Text        | Announced as         |
| --------- | ----------- | ---------- | ----------- | -------------------- |
| `info`    | celeste 300 | celeste 50 | celeste 950 | polite (`status`)    |
| `success` | selva 300   | selva 50   | selva 900   | polite (`status`)    |
| `warning` | maíz 300    | maíz 50    | maíz 900    | polite (`status`)    |
| `danger`  | achiote 300 | achiote 50 | achiote 900 | interrupts (`alert`) |

### Cards and empty states

- **Card:** white, 1 px `border`, radius 16 px, the small shadow. A card marks
  one separate object — a product, a parcel, a route. Not every block is a card.
- **Empty state:** dashed `border-strong`, the wheel glyph, a heading that says
  what is empty, a sentence on what will appear, and the action that fills it.
- **Skeleton:** an arena 200 block of the same size as what is loading.

### Price

Bricolage 700, tabular figures, ink. Three sizes: 16, 20 and 30 px. With a real
discount: the regular price struck through beside it, and a `promo` badge.

### Rating

Five 16 px stars, filled in maíz 500 on arena 300, with half stars; then the
average as text (_4,5 de 5_) and the number of reviews (_(2 reseñas)_). With no
reviews it says _Sin reseñas todavía_ — never five empty stars, which read as a
bad rating.

## 13. Accessibility commitments

These are built into the tokens and shared components, so a screen gets them by
using the system.

1. **Contrast.** Text meets WCAG 2.2 AA (4.5 : 1); the build fails if a token
   pair regresses.
2. **Focus.** Every interactive element shows the same 2 px ring when reached by
   keyboard. It is never removed.
3. **Targets.** Controls are 44 px tall by default.
4. **Motion.** People who ask their device for reduced motion get none — one
   rule covers every animation and transition.
5. **Not colour alone.** Statuses have words; errors have sentences.
6. **Labels.** Every field has a visible label; errors are announced.
7. **Structure.** One h1 per page, real headings, real tables with captions, a
   "Saltar al contenido" link.
8. **Language.** Pages declare `es-CR`. Sentences are short, and every error
   says what to do next.
9. **Zoom.** Text can be enlarged; body text is never under 16 px on a phone.
10. **No dark patterns.** Nothing pre-selected in checkout except the shopper's
    own default address; consent boxes start unticked.

## 14. Photography and imagery

Sellers supply the photographs of their products. This guidance is for the
seller help pages and for anything Yuntera photographs itself. (Photo upload is
not built yet; the demo uses the drawings in section 11.)

**For product photographs**

- The product, whole, in focus, filling most of a **square** frame.
- A plain, light background — a white wall or a sheet of paper is enough.
  Daylight from a window beats a flash.
- The real item the buyer will receive: real colour, real size. A second photo
  with a hand or a common object for scale helps more than a description.
- More than one angle; a close-up of the label, the plug or the material.
- No text, prices, phone numbers, borders or watermarks on the image. No other
  shop's logo.
- No pictures taken from a manufacturer's or another shop's site without
  permission.

**For Yuntera's own imagery**

- Real places and people: a driver at a gate, a counter in a pulpería, a
  bodega shelf. Ask permission; do not show a customer's address, face or
  licence plate without it.
- Ordinary Costa Rica — the GAM as it is, not postcards. No flags, toucans,
  sloths or beaches standing in for "local".
- Warm, natural light; colours left as they are.
- No stock photographs of smiling models with boxes.
- Never put the wheel band or a colour wash over a photograph.

## 15. Legal notes

- **Availability was checked; nothing is registered.** On 21 November 2026 the
  domains `yuntera.com`, `yuntera.cr` and `yuntera.app` appeared free, and no
  app or business using the name was found. See the
  [naming report](naming.md) for the method and its limits.
- **The owner still has to:** register the domains (first — it is the only step
  that can be lost to someone else); run a **trademark search and file at the
  Registro Nacional** (Registro de la Propiedad Intelectual) for the name and
  the mark; reserve the social handles and the app-store names.
- The domain and app-store checks are **not** a trademark search. Do not print,
  advertise or sign contracts under the name until that search is done.
- **The mark and the wheel band are original drawings** made for this brand.
  They have not been checked against registered marks either.
- **Fonts:** Bricolage Grotesque and Inter are licensed under the SIL Open Font
  License 1.1; the licence texts are in `packages/next-kit/fonts/`.
- **Placeholders that are not yet true:** the legal name shown in the footer is
  _Yuntera (entidad en formación)_, and the support address `ayuda@yuntera.cr`
  is on a domain that has not been registered, so that mailbox does not exist.

## 16. Open items

Things found while writing this book where the code and the brand do not yet
agree, or where a decision is still needed.

1. **App accent colours are defined but not used.** `brand.ts` gives each app a
   palette (shop celeste, Vende guaria, Ruta selva, Bodega maíz, Central añil),
   but every app is built in celeste and they differ only by the descriptor.
   Decide: either apply a restrained accent per app (a header rule, the nav
   underline), or delete the field. Note that guaria is otherwise reserved for
   promotions, and maíz for ratings and warnings, so using them as app accents
   would give those colours a second meaning.
2. ~~Small buttons were 36 px tall on every device.~~ **Fixed:** `sm` is 36 px
   with a mouse and 44 px wherever the pointer is a finger.
3. ~~Placeholder text was 3.73 : 1.~~ **Fixed:** it is añil 500 (`#53648f`,
   5.85 : 1) and the pair is in the contrast test.
4. **Three secondary taglines are defined and unused.** They were reworded
   after the first review (the originals were ungrammatical, promised national
   reach, or implied drivers set their own hours) and now read _Juntos llegamos
   más lejos_, _Usted vende. Nosotros lo llevamos._ and _Cada entrega cuenta._
   A native copy editor should still read them before any is used in public.
5. **Logo files for the outside world are incomplete.** The lockups use live
   text; outlined versions, white and ink lockups, PNG exports, app-store icons,
   a maskable icon and a social sharing image do not exist yet.
6. **All apps share one favicon** and one hard-coded `theme-color`
   (`#0b7f8e` typed into each layout rather than read from the tokens).
7. **There is no dark theme.** Two dark-surface pairs are tested, but no app
   has a dark mode. Decide whether one is wanted before designing for it.
8. **English is declared (`locales: ["es-CR", "en"]`) but not built.** Error
   messages have English text; the screens do not. An English voice has not
   been defined.
9. **The font tokens name families the apps do not load by those names.** The
   apps bind the font variables in `base.css` from self-hosted files, so the
   family names in `tokens.ts` act only as fallbacks. Harmless, but confusing.
10. **Clear space, minimum sizes and misuse rules exist only in this book.**
    Nothing checks them.
11. **Photo guidance has no product behind it yet.** Sellers cannot upload
    photographs; when they can, the upload screen should enforce the square
    format and show these rules.
12. **Trademark search, domain registration and the support mailbox** — see
    section 15.
