# English translation plan, researched on 24 November 2026

Prepared 24 November 2026. Read-only audit of the repository at `35e70ce`
(`main`). Nothing in the repository was changed.

## The answer first

Adding English means translating about **4,340 distinct texts, about 33,300
words**. They are spread over the 8 apps and the shared packages. The 446 error
messages already have English, and a type check keeps it complete.

Three things must be fixed before any English ships:

1. Saving a name or phone today **resets the language to Spanish**. Every
   profile save does this, including in the app testers have now.
2. Some order history lines are **written in Spanish inside the database**, and
   the shopper sees them.
3. The phone apps need a **new store build (version 0.2.0)**. English must
   never reach the tester build 0.1.0 as an over-the-air update.

Recommended design. Web: English lives under `/en/…`, and every current
Spanish address keeps working unchanged. Phones: Spanish stays first, an
English phone is offered English, and the choice is remembered. All 8 apps
share one catalogue of words.

Effort, **estimated**: 1 builder for 3–4 days on the foundation, then up to
8 builders in parallel for 4–7 days each. A native English copy editor and a
Costa Rican Spanish copy editor review the result.

The decisions needed from you are in [section 7](#7-decisions-for-the-owner).

---

## 1. What was counted and how

A script parsed every TypeScript source file with the TypeScript compiler. It
skipped tests, generated folders and `node_modules`. It counted text that a
person reads:

- text inside JSX;
- string and template literals that look like sentences or labels;
- labels, placeholders, titles and `aria-label`/`accessibilityLabel` values.

It skipped CSS class names, paths, codes, imports, cache tags and comparisons.
Texts already held as `{ "es-CR": …, en: … }` pairs were counted apart. The
same script also counted the database migrations, the sign-in e-mail templates
and the WhatsApp templates.

The counting script, a second script that checked the completeness of the
existing pairs, and the raw counts are not kept in the repository. Re-running
the count means writing the script again from the description above.

**Accuracy.** A random sample of 45 flagged texts held 43 real screen texts and
2 whitespace fragments. So the counts are **estimates, accurate to about ±10%**.
"Words" counts every run of letters or digits, so `₡12 500` counts as two.

### 1.1 Counts per app and package (texts still Spanish only)

| Where                                 | Files with text |     Texts | Words (approx.) | Dates formatted | Hard-coded `"es-CR"` | Plural-like spots |
| ------------------------------------- | --------------: | --------: | --------------: | --------------: | -------------------: | ----------------: |
| `apps/web` (shop)                     |              52 |       686 |           4,705 |              24 |                    5 |                13 |
| `apps/seller` (seller centre)         |              47 |       926 |           6,295 |              16 |                    3 |                 9 |
| `apps/ops` (staff console)            |              86 |     1,970 |          11,729 |              66 |                   16 |                48 |
| `apps/field` (drivers, warehouse web) |              31 |       286 |           1,410 |               3 |                    3 |                17 |
| **Web apps, total**                   |         **216** | **3,868** |      **24,139** |                 |                      |                   |
| `apps/shop-native`                    |              40 |       604 |           3,701 |              20 |                    4 |                16 |
| `apps/seller-native`                  |              45 |       835 |           5,814 |              14 |                    3 |                 7 |
| `apps/driver-native`                  |              14 |       161 |           1,171 |               1 |                    0 |                 4 |
| `apps/warehouse-native`               |              15 |       245 |           1,272 |               4 |                    0 |                 5 |
| **Phone apps, total**                 |         **114** | **1,845** |      **11,958** |                 |                      |                   |
| `packages/next-kit`                   |              19 |       316 |           2,140 |               3 |                    7 |                 4 |
| `packages/expo-kit`                   |              20 |       196 |           1,740 |               5 |                   10 |                 3 |
| `packages/notifications` (messages)   |              16 |       465 |           3,921 |               0 |                    1 |                 3 |
| `packages/ui`                         |               1 |        16 |              43 |               4 |                    3 |                 1 |
| `packages/core`                       |               9 |        35 |             266 |               1 |                   14 |                 0 |
| `packages/db` (outside the pairs)     |               — |        67 |            ~700 |               0 |                    — |                 2 |
| `packages/brand`                      |               1 |        18 |              53 |               0 |                    3 |                 0 |
| `packages/invoicing`                  |               8 |        84 |             184 |               0 |                    0 |                 0 |
| `packages/payments`                   |               2 |         3 |               6 |               0 |                    0 |                 0 |
| **All code, total**                   |                 | **6,913** |      **45,167** |                 |                      |                   |
| **All code, distinct texts**          |                 | **4,337** |      **33,318** |                 |                      |                   |

The distinct count is lower because the phone apps reuse much of the websites'
wording. The distinct figure is the translation volume.

Not in the table:

- **Sign-in e-mails** (`supabase/templates/*.html`): 11 files, about 477 words.
  They are the fallback for the built-in sender. With the Send Email Hook, the
  same e-mails come from `packages/notifications/src/templates/auth.ts`, which
  the table counts.
- **WhatsApp templates** (`packages/notifications/whatsapp/*.json`): 4 files,
  about 287 words. None is submitted to Meta yet
  (`docs/06-operations/notifications.md`, around line 304).
- **Database migrations**: 164 Spanish sentence literals in 20 migrations, plus
  about 159 place names. See [section 2.1](#21-words-built-in-the-database).
- **Help and legal page** (`apps/web/src/app/ayuda/page.tsx`, 177 lines): in the
  `apps/web` count. It holds delivery, returns, payments, complaints, ranking,
  terms and privacy.
- **Store listings and permission prompts**: no listing text is kept in the
  repository. The App Store record was created with primary language "Spanish
  (Mexico)" (`docs/07-deployment/store-testing.md`, line 270). The permission
  prompts are in each `apps/*-native/app.config.ts`. For example, the shop
  has 2 Spanish location prompts.
- **Product photos for the demo** (`apps/web/public/demo/products/*.svg`, 27
  files): none contains text. No image with words was found in any app.

### 1.2 What is already bilingual

- **Error messages: complete.** 446 `{ "es-CR", en }` pairs are spread over
  `packages/db/src/errors.ts`, the 22 area files, `packages/core` (order status
  labels in `lifecycle.ts`, line 142) and `packages/brand` (taglines). The check
  found **0 pairs missing English, 0 missing Spanish, and 0 where the English
  is a copy of the Spanish**. The type `Messages` makes both languages
  required (`packages/db/src/areas/types.ts`, line 4). No native English
  speaker has reviewed this English.
- **Unused today.** Every caller asks for Spanish:
  `error.userMessage("es-CR")` (`packages/next-kit/src/server/actions.ts`,
  line 23; `account-actions.ts`, line 410; `invoices.ts`, lines 50 and 53;
  `packages/expo-kit/src/account/flows.ts`, line 172). The status badge reads
  `ORDER_STATUS_LABEL[status]["es-CR"]` (`packages/ui/src/commerce.tsx`,
  line 121).
- **Category names: both languages exist.** `categories.name_es` and
  `name_en` are filled for all 14 departments and their sub-categories
  (`supabase/migrations/20261121080450_catalog_reference.sql`). The shop's
  reads return both fields.
- **A language per person exists.** `profiles.locale` allows `es-CR` or `en`
  (`20261121080100_identity.sql`, line 15). Each planned message
  (`notification_deliveries.locale`) and each push device also carries one.
  The brand declares `locales: ["es-CR", "en"]` (`packages/brand/src/brand.ts`,
  line 24).
- **An empty `packages/i18n` folder exists.** It is a placeholder
  (`docs/02-architecture/repository.md`, line 51).
- **English spelling today is British.** It has 43 × "cancelled", 18 ×
  "catalogue", "licence", "recognise" and "colour", and 1 × "catalog".

### 1.3 What the documents already say

- English is planned for the shopper at Launch. "Internal apps are Spanish only
  until there is a reason otherwise" (`docs/01-product/scope-by-app.md`,
  line 21). The roadmap puts the "English interface" in Phase 2, the public
  launch (`docs/01-product/roadmap.md`, line 125).
- `STATUS.md`, line 885 lists English under "Later". The brand book, open item
  8, says "An English voice has not been defined"
  (`docs/brand/brand-book.md`, line 781).
- Search indexes Spanish only. An English query matches only through shared
  words or a synonym (`docs/04-algorithms/search-ranking.md`, line 233).

---

## 2. The hard cases

### 2.1 Words built in the database

The 164 Spanish sentences fall into 4 kinds.

| Kind                                     | Examples (file:line)                                                                                                                                                                                                          | Who reads it                                                             | Recommendation                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order history notes                      | `'Pedido recibido'` (`081000_checkout.sql:429`), `'Pago recibido'` (`:79`), `'Cancelado por el cliente'` (`:510`), `'Reembolso completado'` (`083400_payments.sql:522`), `'Devolución recibida'` (`082900_integrity.sql:662`) | **Shopper** (`apps/web/src/app/pedidos/[numero]/page.tsx:589`) and staff | Add a `note_code` and `note_params` beside `note` in a new migration. The apps render the code in the reader's language. Keep the Spanish `note` for old rows and old app builds. |
| Ledger and payment-matching descriptions | `'Pago del pedido ' \|\| number` (`080800_finance.sql:275`), `'El monto no es el del pedido.'` (`083400_payments.sql:1487`)                                                                                                   | Finance staff                                                            | Keep in Spanish. They are accounting records. Translate them only if staff tools get English (owner decision D6).                                                                 |
| Account names of the chart of accounts   | `'Ingresos por envío'` (`080800_finance.sql:176`)                                                                                                                                                                             | Finance staff, accountant                                                | Keep in Spanish (accounting records).                                                                                                                                             |
| Reference data                           | Category names (both languages exist); zone names such as `'Resto del país'` (`080300_geography_data.sql:22`); provinces, cantons and districts                                                                               | Shopper                                                                  | Place names are proper nouns and stay as they are. Zone names a shopper sees need an English column or a code (one migration).                                                    |

A free-text reason a customer typed (for example a cancellation reason) stays
as they wrote it.

### 2.2 Saving a profile resets the language (a defect)

`public.update_profile` has `p_locale text default 'es-CR'` and sets
`locale = p_locale` unconditionally. The latest definition is in
`supabase/migrations/20261121082600_notifications.sql`, lines 1615–1636. The
shop's profile form calls it without a locale
(`apps/web/src/app/actions.ts`, line 365). So does the shopper app
(`apps/shop-native/src/app/(tabs)/cuenta.tsx`, line 43), including the build on
testers' phones. So a shopper who chose English would be set back to Spanish
the next time they save their name.

**Fix, in a new migration, before anything else:**

1. A null locale means "keep the current one".
2. Add a separate `set_locale(p_locale)` function, granted to `authenticated`,
   with its own test, error messages and contract test.

PostgreSQL may refuse to change an existing argument default with
`create or replace`. The builder must check this. If it refuses, drop and
recreate the function in the same migration.

### 2.3 Dates, money, numbers and plurals

- **Dates.** There are about 161 date-formatting calls across the apps and packages. Each
  one hard-codes `"es-CR"` through `Intl.DateTimeFormat`
  (`packages/ui/src/commerce.tsx`, line 162; `packages/expo-kit/src/format.ts`,
  line 17; `packages/core/src/promise.ts`, line 224). `promise.ts` already
  takes a locale. The time zone stays `America/Costa_Rica` in both languages.
- **Money.** `packages/core/src/money.ts`, line 153 builds `₡12 500` by hand,
  with a space between thousands and a comma before céntimos. It ignores the
  locale, so it is identical in both languages unless you choose otherwise
  (owner decision D9).
- **Numbers.** Ratings use `toLocaleString("es-CR")`
  (`packages/ui/src/commerce.tsx`, line 73;
  `packages/next-kit/src/listing-changes.tsx`, line 23). In English they would
  show "4.5" instead of "4,5".
- **Plurals.** There are about 132 spots where code picks a word by count
  (`n === 1 ? … : …`). Spanish and English both have the same two forms (one,
  other), so a two-form rule is enough. `Intl.PluralRules` is not needed. That
  matters because its support in the phones' JavaScript engine (Hermes) varies
  by version and was **not verified** (sources [S9], [S10]).
- **Gender and agreement.** Spanish sentences that splice in a word (for
  example a status inside a sentence) must become whole sentences per language.
  Translators cannot fix word order inside a spliced fragment.

### 2.4 Legal texts and the tax invoice

**For the lawyer or accountant to confirm.** None of this is settled law
advice.

- **Terms must exist in Spanish.** The repository already settles this.
  `docs/05-security-compliance/compliance-costa-rica.md`, line 59 lists "terms
  in Spanish" among the mandatory disclosures. Line 240 says it "Needs lawyer".
  So the Spanish terms, privacy notice, withdrawal and warranty conditions and
  the complaint channel must stay in Spanish and stay complete. An English
  version can only be added **beside** them, never in their place. Whether the
  English version should say "the Spanish text prevails" is for the lawyer to
  confirm.
- **Mandatory identity and disclosures** (legal name, cédula jurídica, address)
  appear in both languages unchanged.
- **The electronic invoice for Hacienda** is an XML document. Its field names
  and codes are fixed by the tax authority's schema
  (`docs/research/hacienda-factura-electronica-v44.md`), so it is not
  translated. Whether its printed version (`packages/next-kit/src/fiscal-document.tsx`)
  may carry English labels beside the Spanish is for the accountant to
  confirm. Recommended: keep it Spanish only.
- **Consumer complaints** must be free and possible in Spanish
  (`docs/06-operations/customer-service.md`, line 171). Accepting a complaint
  in English is extra and does not replace that.
- **E-mail footers** must name the sender (Decreto 35205 art. 32, per
  `docs/06-operations/notifications.md`). The footer is the same in both
  languages.

### 2.5 Messages and sign-in e-mails

- **Templates ignore the language.** `packages/notifications/src/templates/render.ts`
  builds one Spanish copy per template. The delivery row already carries
  `locale` (`packages/notifications/src/types.ts`, line 146), so each template
  needs an English copy and a language parameter.
- **WhatsApp.** Meta lists `es_CR` and `en_US` among its template languages
  [S7]. Each English version is a separate template text to submit through the
  provider. None of the 4 Spanish templates is submitted yet. The provider's
  ready-made templates are English only and do not fit
  (`docs/research/notifications-email-whatsapp-push.md`, line 424).
- **Sign-in e-mails.** Supabase's built-in templates are one per project. They
  can branch on `{{ .Data }}` (the person's `user_metadata`) [S8]. The repository
  already plans the Send Email Hook, which receives the user and their metadata
  [S8]. The hook picks the language from `user_metadata.locale`. That value
  is written at sign-up and whenever the person changes language, because the
  hook should not need a database read. The preview still uses Supabase's
  default English templates (`STATUS.md`, line 244). That is a separate open
  item.
- **Links in messages.** With the address scheme below, a link is `/pedidos/…`
  for Spanish and `/en/pedidos/…` for English. Every link already sent stays
  valid.

### 2.6 Things that cannot be translated

- **Sellers' own words.** Product titles, descriptions, shop names, shop
  descriptions and reviews are content, not interface. They stay as written
  (owner decision D46).
- **Brand and proper nouns.** These stay as they are: Yuntera, SINPE Móvil,
  ONVO, Hacienda, place names, señas.
- **The delivery code.** It is a code, not words, so nothing changes. It is
  still shown only to the shopper.
- **Search.** The index stays Spanish. English shoppers will search in English,
  and the synonym list (staff tool, `083700`) can bridge the common words.
  Search logs do not exist yet, so which words to add cannot be measured
  (`docs/04-algorithms/search-ranking.md`).

---

## 3. What the frameworks recommend

### 3.1 Next.js 16 with Cache Components (the four web apps)

The repository uses `next@16.4.6` (`apps/web/package.json`, line 22) with
`cacheComponents: true` (`packages/next-kit/config.mjs`, line 95).

- **The language goes in the address.** Next.js's own guide puts every route
  under `app/[lang]`. It detects the preferred language in Proxy from
  `Accept-Language` and loads a dictionary per language on the server. It notes
  that dictionaries in Server Components add nothing to the browser's
  download [S1].
- **`next/root-params` (from 16.3.0).** Any Server Component can read `lang`
  without passing it down. Inside a `'use cache'` function, "Only those root
  parameters become part of the cache key". With Cache Components, "each root
  parameter must have at least one value" in `generateStaticParams`, or the
  build fails. Root params work in Server Components but **not in Client
  Components, Server Actions or Route Handlers** [S2].
- **next-intl** has moved its Cache Components support onto root params. Its
  blog says a locale override is still needed in Server Actions and Route
  Handlers [S3]. That source is a library blog, not framework documentation.
- **A cookie instead of the address is the wrong fit here.** Reading
  `cookies()` makes a page dynamic. The repository's rule is that anything
  reading cookies sits inside `<Suspense>` (project rules, "Web apps"). The root
  layout's `<html lang>` and the shared header are in every page's prepared
  shell (`apps/web/src/app/layout.tsx`; `CATEGORY_MENU_TAG` in
  `packages/next-kit/src/cache-tags.ts`). A cookie-chosen language would
  either push the whole shell out of the prepared page or show one language in
  the shell and another in the body. The address makes the shell per language
  and keeps it prepared.
- **Search engines.** Google advises "using different URLs for each language
  version of a page rather than using cookies or browser settings". It advises
  against automatic redirects from one language version to another, and marks
  URL parameters (`?lang=`) "Not recommended" [S5]. `hreflang` links must be
  reciprocal ("each language version must list itself as well as all other
  language versions"), fully qualified, and use ISO 639-1 language codes with
  optional ISO 3166-1 regions (`es-CR` is valid). `x-default` names the
  fallback [S4].

### 3.2 Expo SDK 58 with expo-router (the four phone apps)

The apps use `expo ~58.0.26` and `expo-router ~58.0.32`
(`apps/shop-native/package.json`, lines 27 and 39).

- **Device language.** `expo-localization` exposes `getLocales()` and the
  `useLocales()` hook, which "will rerender with a new list of locales" when the
  phone's settings change. On Android the app is not restarted, so re-read on
  return to the foreground. On iOS "the results will remain the same while the
  app is running" [S6a], [S6b].
- **Per-app language in system settings.** This needs the `supportedLocales`
  option of the `expo-localization` config plugin [S6a], [S6b].
- **The app name and iOS permission prompts.** These are translated through
  `locales` JSON files in the app config, with
  `ios.infoPlist.CFBundleAllowMixedLocalizations: true` [S6a].
  Today `packages/expo-kit/src/config.ts`, line 260 sets
  `CFBundleDevelopmentRegion: "es"` because the apps are Spanish only.
- **Libraries.** Expo's guide uses `i18n-js` and lists Lingui, React i18next and
  others. For dates and numbers it recommends the built-in `Intl` APIs [S6a].
- **`expo-localization` is a native module and not installed** in any app
  today. The apps use `runtimeVersion: { policy: "appVersion" }`
  (`packages/expo-kit/src/config.ts`, line 334). An over-the-air update for
  version 0.1.0 therefore reaches the tester build. If that update called a
  native module the build does not contain, the app would fail. **The English
  work must ship as version 0.2.0, a new store build.**

---

## 4. Recommended architecture

### 4.1 One catalogue of words: `packages/i18n`

The recommendation is a small typed catalogue in the existing placeholder
package, with no third-party translation library. Reasons:

- It runs unchanged in Node (web apps, workers), on Hermes (phones) and in
  Deno (Supabase Edge Functions for notifications).
- It continues the pattern the 446 messages already use, and the type check
  that keeps them complete.
- It needs nothing a library would add here. Spanish and English need only two
  plural forms, and formatting comes from `Intl`.

Layout:

```
packages/i18n/src/
  locales.ts        Locale = "es-CR" | "en"; DEFAULT = "es-CR"; negotiate(header|device) -> Locale
  format.ts         date, dateTime, number, money (calls packages/core money.format), plural(n, one, other)
  t.ts              t(messages, key, params) with typed {placeholders}
  messages/
    common.ts       shared words (Cancel, Save, Back…): { "es-CR": {...}, en: {...} }
    shop.ts         apps/web + apps/shop-native
    seller.ts       apps/seller + apps/seller-native
    staff.ts        apps/ops
    field.ts        apps/field + driver-native + warehouse-native
    messages.ts     packages/notifications (e-mail, SMS, push, WhatsApp parameters)
  check.test.ts     same keys in both languages; same {placeholders}; no empty value; English is not a copy of Spanish
```

- **One file per area.** Each workstream edits only its own file, so parallel
  builders do not collide. Only the foundation builder edits `common.ts`.
- **Each entry is an object with both languages**, as in `errors.ts`. The type
  makes a missing English fail the build.
- **Error messages stay in `packages/db`** and keep their tests. The apps stop
  passing `"es-CR"` and pass the reader's language instead.
- **`packages/ui`** components take labels as properties, or a `locale`
  property for the few words they hold (16 texts).

### 4.2 Web apps

1. **Addresses.** Spanish stays where it is (`/pedidos/YT-123`). English adds
   `/en` in front (`/en/pedidos/YT-123`). The path segments stay Spanish in
   both languages (owner decision D8).
2. **Routes.** Every app moves `src/app/*` under `src/app/[lang]/`. The root
   layout reads `lang` through `next/root-params`, sets
   `<html lang="es-CR" | "en">`, and lists
   `generateStaticParams() → [{lang:"es"}, {lang:"en"}]`. The URL value `es`
   maps to the locale `es-CR`.
3. **Proxy.** The proxy already runs on every request (`apps/web/src/proxy.ts`).
   A path without `/en` is **rewritten**, not redirected, to `/es/…`, so the
   visitor's address does not change. A path with `/en` passes through.
   `/es/…` typed by hand is redirected to the unprefixed address, so there is
   one address per page. The existing not-found and renamed-category handling
   stays, applied after the language is stripped.
4. **No automatic redirect by browser language** (per [S5]). A visitor whose
   browser prefers English sees a one-line offer on a Spanish page (text
   below). The offer sits inside `<Suspense>` because it reads a request
   header.
5. **Remembering the choice.** The switch is a plain link to the same page in
   the other language. It also sets a `lang` cookie (`HttpOnly`, `SameSite=Lax`,
   1 year) and, for a signed-in person, calls `set_locale`. The proxy uses the
   cookie only for the bare home page `/`: if the cookie says `en`, the proxy
   redirects `/` to `/en`. That is the person's own earlier choice, not a guess.
   Every other address shows the language it carries.
6. **Shared cached catalogue reads stay language-free.** `getCategories`,
   `getMenuCategories` and the product, shop and search reads
   (`apps/web/src/lib/data.ts`) already return both `name_es` and `name_en`.
   They must not read `lang`, so one cache entry serves both languages. The
   component that renders picks the name. Each prepared shell exists per
   language, keyed by the root param [S2]. No cache tag changes are needed.
   A `'use cache'` function that builds words (for example metadata) reads
   `lang()` inside itself, so the key includes it [S2].
7. **Server Actions** cannot read root params [S2]. Every form carries a hidden
   `locale` field that is validated by zod against the two values, with Spanish
   as the fallback. The action uses it for its `ActionState` messages and for
   `error.userMessage(locale)`. `safeReturnPath` must accept and keep the
   `/en` prefix (`packages/next-kit/src/paths.ts`).
8. **Search engines.** Each public shop page sets `alternates.languages`
   (`es-CR` → the unprefixed address, `en` → the `/en` address,
   `x-default` → the Spanish address) with absolute URLs [S4]. The canonical
   stays per language. Today's canonicals are relative (`/p/${slug}`) and need
   the prefix. A sitemap lists both versions. `openGraph.locale` switches
   between `es_CR` and `en_US`. The private apps (seller, staff, field) are
   kept out of search as today.
9. **Seller, staff and field apps** use the same layout, for one pattern
   everywhere. They are dynamic per person, so the shell matters less, but the
   same proxy, switch and hidden field apply.

### 4.3 Phone apps

1. **First start.** The app reads the phone's language with `expo-localization`.
   If the phone is set to English, the app starts in English. Otherwise it
   starts in Spanish (owner decision D7).
2. **A switch in the account screen** ("Idioma / Language"). The choice is
   stored in `AsyncStorage`, which the apps already use for the cart, because
   it is not sensitive. For a signed-in person it is also stored with
   `set_locale` and read back after sign-in, so web and phone agree.
3. **System per-app language.** The `supportedLocales` plugin option is set to
   `["es", "en"]` [S6b]. A change in system settings is honoured on the next
   return to the foreground (Android) or the next start (iOS).
4. **A provider in `packages/expo-kit`** holds the current language, re-renders
   on change, and passes it to `t()`, the formatters and
   `error.userMessage(locale)`.
5. **Permission prompts and app name** get an `en.json` and an `es.json` under
   `locales` for each app, with `CFBundleAllowMixedLocalizations` [S6a]. Two
   apps carry camera and location prompts, so these must be checked on a real
   iPhone.
6. **Release as version 0.2.0** with a new runtime. Do not send the English
   JavaScript as an over-the-air update to 0.1.0.

### 4.4 Keeping the tester build (0.1.0, built from `3f251c3`) working

These are verified in the code, not on a phone.

- **Only add fields; never rename or remove one.** The tester build reads
  responses with zod schemas that drop unknown keys. No schema in `packages/db`
  uses `.strict()` (checked), so new fields such as `note_code` are ignored by
  the old build.
- **Do not change any function's argument list** in a way that breaks an old
  call. `update_profile` keeps its arguments. Only the null-means-keep
  behaviour changes, which also stops the old build from resetting a
  shopper's English (section 2.2).
- **Keep the Spanish `note`** on order events, and keep the old Spanish
  addresses.
- **Do not publish any update to runtime 0.1.0** that imports
  `expo-localization`.
- The old build shows Spanish and ignores `profiles.locale`. A push or e-mail
  sent in English to a person who chose English on the web is still correct.

### 4.5 What the database must return differently

| Change                                                                                                             | Why                                               | Old build              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------- |
| `update_profile`: null locale keeps the current one; new `set_locale(p_locale)`                                    | Section 2.2                                       | Fixes it too           |
| Order events: add `note_code`, `note_params` (jsonb); fill them in every function that writes a note               | The shopper sees these lines in their language    | Ignores the new fields |
| `category_name_en` beside `category_name` where only `name_es` is returned (`082400_fixes.sql`, lines 612 and 792) | Seller and staff screens                          | Ignores the new field  |
| Shopper-visible zone names: an English column or a code                                                            | `'Resto del país'` and the other zone names       | Ignores it             |
| Nothing for product titles, descriptions, shop names or reviews                                                    | Sellers' own words (owner decision D46)           | —                      |
| Nothing for place names, ledger texts or the tax document                                                          | Proper nouns, accounting records, Hacienda schema | —                      |

Each function change follows the project rules: a new migration, `security definer`,
`set search_path = ''`, caller checked, `private.fail` codes with Spanish and
English messages, a database test and a contract test.

---

## 5. Workstreams

The order is W0 first. Then W1–W9 run in parallel. W10 and W11 come last.
Each builder works in its own lane of `tools/dev/stack.sh` (lanes 1–12).

| #        | Workstream                      | Owns (files only it edits)                                                                                                                                                                                                                                           | Depends on           | Estimate (builder-days, estimated) |
| -------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------: |
| **W0**   | Foundation                      | `packages/i18n` (all), `messages/common.ts`; the locale proxy, switch, `alternates` helper and hidden-field helper in `packages/next-kit`; the provider and formatters in `packages/expo-kit`; `packages/ui` labels; the "no Spanish left" checker; **no app files** | —                    |                                3–4 |
| **W-DB** | Database                        | New migration(s): `update_profile` fix, `set_locale`, order-event codes, English category and zone names; tests; `packages/db/src/areas/locale.ts`                                                                                                                   | — (parallel with W0) |                                2–3 |
| W1       | Shop website                    | `apps/web`, `messages/shop.ts` (web keys); help page in English beside the Spanish legal text                                                                                                                                                                        | W0, W-DB             |                                5–7 |
| W2       | Seller centre                   | `apps/seller`, `messages/seller.ts`                                                                                                                                                                                                                                  | W0                   |                                4–6 |
| W3       | Staff console (if D6 option A)  | `apps/ops`, `messages/staff.ts`                                                                                                                                                                                                                                      | W0                   |                                6–8 |
| W4       | Field web app                   | `apps/field`, `messages/field.ts` (web keys)                                                                                                                                                                                                                         | W0                   |                                2–3 |
| W5       | Shopper phone app               | `apps/shop-native`, its `locales/*.json`, version 0.2.0                                                                                                                                                                                                              | W0, W1 keys          |                                4–5 |
| W6       | Seller phone app                | `apps/seller-native`                                                                                                                                                                                                                                                 | W0, W2 keys          |                                4–5 |
| W7       | Driver and warehouse phone apps | `apps/driver-native`, `apps/warehouse-native`                                                                                                                                                                                                                        | W0, W4 keys          |                                3–4 |
| W8       | Messages                        | `packages/notifications` templates, `messages/messages.ts`, English WhatsApp JSON files, the hook's language choice, `supabase/templates` branching on `.Data`                                                                                                       | W0                   |                                3–4 |
| W9       | Docs                            | `STATUS.md`, `docs/03-data/api-reference.md`, brand book English voice section                                                                                                                                                                                       | all                  |                                  1 |
| W10      | Store listings and prompts      | Listing text (ES and EN) as files under `docs/07-deployment/`; the owner enters it in the stores                                                                                                                                                                     | W5–W7                |                                  1 |
| W11      | Language review                 | Comments only; builders apply fixes                                                                                                                                                                                                                                  | W1–W8                |                      see section 6 |

Rules that prevent collisions:

1. Phone apps reuse the website's keys of the same area. W5 adds keys to
   `shop.ts` only under a `native.` prefix.
2. Shared words go to `common.ts` by request to W0. Until W0 adds a word, a
   builder keeps it in its own area file. W0 de-duplicates at the end.
3. No workstream edits another's app folder or area file.
4. Only W-DB writes migrations. They are numbered after the last one on `main`
   at the time of writing.

### 5.1 What each workstream must test

- **Key check (W0, runs for everyone).** Both languages have the same keys,
  the same `{placeholders}`, no empty values, and no English identical to the
  Spanish (an allow-list holds proper nouns such as "SINPE Móvil").
- **"No Spanish left" check (W0, in CI).** It reuses this audit's heuristic.
  It flags any sentence-like text in JSX or labels outside `packages/i18n` and
  `packages/db` errors. An allow-list covers proper nouns, place names and the
  legal Spanish text. **The goal is 0 findings per app.**
- **A browser journey in English per app** under `tools/e2e/journeys/`:
  - shop: search, product, cart, checkout, order page and help, all under
    `/en`;
  - seller: sign in, list a product, see an order;
  - staff: open an order, verify a seller;
  - field: start a route, deliver.

  Each journey also asserts `<html lang="en">` and that no text from a Spanish
  list of common words (for example "Pedido", "Usted") appears.
- **A phone journey in English** for each native app under
  `tools/native-e2e/journeys/`.
- **Cache check (W1).** Load `/en/p/<slug>`, then `/p/<slug>`, then
  `/en/p/<slug>` again, and assert the language each time. Change a category's
  English name, refresh the `categories` tag, and assert both shells update.
- **Search engine check (W1).** Each public page lists both versions plus
  `x-default`, with absolute URLs, and each version lists the other.
- **Old-build check (W-DB, W5).** The 0.1.0 response schemas, taken from
  `3f251c3`, still parse every changed function's response. A profile saved
  without a locale keeps `en`.
- **Database tests (W-DB).** For `set_locale`: the right caller, the wrong
  caller, and what it leaves behind. For order events: the code and params are
  written, and the Spanish note is still written.
- **Messages (W8).** Each template renders in both languages. The existing
  message rules still pass: no delivery code, no address and the sender named.
- **Formats.** In English, dates read as English dates, ratings use a decimal
  point, and money follows owner decision D9.

### 5.2 Order of release

1. W-DB migration to the preview first. It is safe for the tester build.
2. Shop website and messages in English (W1, W8).
3. Seller centre (W2).
4. Phone apps as version 0.2.0 to testers (W5–W7). The stores need the English
   listing (W10).
5. Staff and field tools, if chosen (W3, W4).

---

## 6. Who reviews the words

- **English.** A native English copy editor reads all ~33,300 words plus the
  446 existing messages. They set the English voice: plain, specific, polite
  "you", the same rules as the Spanish voice in the brand book. No rate was
  researched, so ask 2 freelance editors for a quote on 33,300 words.
  **Assumption:** the review is about 1 week of work. Verify with the quotes.
- **Spanish.** A Costa Rican Spanish copy editor reads every Spanish text that
  changed while sentences were split into whole sentences (section 2.3). The
  brand book already asks for a native copy editor for the taglines
  (`docs/brand/brand-book.md`, open item 4).
- **Legal.** The lawyer reviews the English terms, privacy notice and
  complaint text, and confirms that the Spanish text prevails.
- **Accountant.** The accountant confirms that the printed tax document stays
  Spanish only.
- **Code review.** Each workstream's code is reviewed against the rules in
  the project rules before it is merged.

Machine-translated drafts are acceptable as a starting point for the editor.
They are never shipped without the editor's review.

---

## 7. Decisions for the owner

Words customers will see, in both languages:

| Spanish (usted)                                                             | English                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **English** (link on Spanish pages)                                         | **Español** (link on English pages)                                           |
| ¿Prefiere ver Yuntera en inglés? Ver en inglés                              | Prefer Yuntera in English? View in English                                    |
| Idioma                                                                      | Language                                                                      |
| Descripción escrita por la tienda, en español.                              | Description written by the shop, in Spanish.                                  |
| Este texto en inglés es una traducción. El texto en español es el que rige. | This English text is a translation. The Spanish text is the one that applies. |

The last line is for the lawyer to confirm.

The eight questions this plan raises are asked once, in the
[owner decisions](../00-strategy/owner-decisions.md) list: which apps get
English and in what order (D6), what language a person sees first (D7), what
English addresses look like (D8), how money looks in English (D9), copy
editors (D37), English spelling (D45), sellers' own words (D46) and legal
pages in English (D47).

### What you will have to do later (not now)

These are listed here and belong on the owner's steps page once the work
starts. Labels marked "(?)" are not verified.

1. **App Store Connect.** Open appstoreconnect.apple.com. Click My Apps, then
   Yuntera, then App Information (?). Open the language menu at the top right
   (?). Choose "English (U.S.)". Paste the English text from W10.
2. **Google Play Console.** Open play.google.com/console. Click Yuntera, then
   Grow users (?), then Store presence, then Main store listing. Click
   "Manage translations" (?), then "Add your own translations". Choose
   "English (United States)". Paste the English text from W10.
3. **WhatsApp.** Once the messaging provider is set up, submit the 4 English
   templates beside the 4 Spanish ones.

---

## 8. Risks

- **Size.** Staff tools are 26% of all words (11,729 of 45,167). Skipping them
  for now (D6 option B) saves the largest block.
- **The prepared pages double.** Each public page is prepared once per
  language, so the build time and the number of prepared pages grow. This was
  not measured.
- **Text grows in English or Spanish.** Spanish is usually longer than English,
  so layouts sized for Spanish rarely overflow in English. Buttons with short
  English words can look sparse. The 390 px check in each journey covers this.
- **Hermes and `Intl`.** English date formats on the phones depend on the
  engine's `Intl` data. This is **not verified on a phone**. Check
  `formatDate` on both an iPhone and an Android phone in English.
- **The layout redesign touches the same files.** If both run at
  once, every app file conflicts. Do the English foundation (W0, W-DB) first,
  then the redesign per app together with the English for that app, by the
  same builder.

## 9. What was not verified

- Nothing ran on a phone. Hermes `Intl` support and the iOS English permission
  prompts are unverified.
- The PostgreSQL behaviour of changing a default with `create or replace` was
  not tested here (section 2.2).
- Whether the provider approves the English WhatsApp templates was not checked.
- The cost of copy editors was not researched.
- The store console labels in section 7 are unverified, so they are marked
  "(?)".
- The counts are heuristic, accurate to about ±10%.

## Sources

All read on 24 November 2026.

- [S1] Next.js, "Internationalization" guide, https://nextjs.org/docs/app/guides/internationalization (page dated 2026-11-06).
- [S2] Next.js, "next/root-params", https://nextjs.org/docs/app/api-reference/functions/next-root-params (page dated 2026-06-24; introduced in v16.3.0).
- [S3] next-intl blog, "Next.js root params", https://next-intl.dev/blog/nextjs-root-params (library blog, found through a search result; not framework documentation).
- [S4] Google Search Central, "Tell Google about localized versions of your page", https://developers.google.com/search/docs/specialty/international/localized-versions.
- [S5] Google Search Central, "Managing multi-regional and multilingual sites", https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites.
- [S6a] Expo, "Localization" guide, https://docs.expo.dev/guides/localization/.
- [S6b] Expo, "Localization" SDK reference (v58.0.0), https://docs.expo.dev/versions/latest/sdk/localization/.
- [S7] Meta for Developers, WhatsApp template supported languages, https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/supported-languages.
- [S8] Supabase, "Customizing emails by language", https://supabase.com/docs/guides/troubleshooting/customizing-emails-by-language-KZ_38Q, and "Send Email Hook", https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook (found through a search result summary; read the pages before building).
- [S9] FormatJS, "React Native Hermes" guide, https://formatjs.github.io/docs/guides/react-native-hermes (found through a search result summary).
- [S10] FormatJS, `Intl.PluralRules` polyfill, https://formatjs.github.io/docs/polyfills/intl-pluralrules (found through a search result summary).

Repository facts cite the file and line in the text. They were read at
`35e70ce` on 24 November 2026.
