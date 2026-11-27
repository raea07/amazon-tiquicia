# Browser journeys

Each journey uses the apps as a shopper, seller, staff member, driver or
warehouse worker would, in a real browser, against a freshly seeded database.
It fails when a step does not arrive, the browser logs an error, a response
is a 5xx, or the browser asks anything of a host that is not this machine
(`lib/local-only.cjs`, loaded before every journey by `run.mjs`). Run them in your own lane (never 0): `tools/dev/stack.sh up 1`, then
`tools/dev/stack.sh e2e 1 [journey ...]`, then `tools/dev/stack.sh down 1`.

## Rules for writing one

1. A journey file holds the flow, the checks on data and the size checks. Every
   screen step (find, click, fill, read) is a named function in
   `lib/web.cjs`, `lib/seller.cjs`, `lib/ops.cjs` or `lib/field.cjs`.
2. Find things by role and accessible name, by `[name=…]` for a form field,
   or by `data-testid`. Never by a CSS class, never by a text match.
3. The one text match allowed is `kit.withValue`, for a data value (an order
   number, a seed product's title, an e-mail address), never a product word.
4. A status word comes from `word(kind, value, { viewer })` in `lib/words.cjs`
   (later `packages/core`), with the viewer whose screen it is; never a string.
5. A message without a test id is read by its words with `kit.waitForMessage`,
   inside a helper only.
6. Size checks (`scrollWidth`, `boundingBox`) stay in the journey files, at 390
   and 1280 px. Nobody loosens one in the same change as a screen.
7. An app builder may change that app's helper file; journey files belong to the
   journey owner. A test id may be added, never renamed or dropped.
8. From the repository root, `node tools/e2e/selectors.mjs --check` (classes,
   texts, status literals) and `node tools/e2e/check-words.cjs` must pass;
   `node tools/e2e/touch-targets.cjs` (after `stack.sh env 1`) measures 44 px.
9. `node tools/e2e/compare.mjs --shots .lane/1/screenshots` puts each journey
   screenshot beside its reference page (rows in `compare/<app>.json`).

## Wave 9's journeys and helpers

Five journeys cover the support desk, system health, error reports and the
follow-ups of wave 8. Their screen steps are in the same helper files as the
others: a block at the end of `lib/ops.cjs` (Casos, a case, the customer
view, Salud del sistema, Versiones, the staff-cancel form), of `lib/web.cjs`
(the complaint form, «Sus consultas», the category breadcrumb) and of
`lib/kit.cjs` (the error pages and a sign-in form typed but not yet sent,
the same in the four websites).

| Journey             | App               | What it walks through                                                                                                                                                                                                      |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support-cases`     | `apps/web`, `ops` | A complaint from an order; Casos with the case's stamp; a note refused for a delivery code; a saved answer; the shopper reads the answer; a WhatsApp contact; «Mostrar contacto» on Auditoría; finance sees only its cases |
| `system-health`     | `apps/ops`        | The uptime ping; Salud del sistema in order, then a stopped message and a rejected document; Versiones and a phone build typed by hand, a typo removed; what support and catalogue staff see                               |
| `error-reports`     | all four          | In each website an error in the browser and one on the server; the error page at 390 px; «Intentar de nuevo»; with the stand-in tracker, what reached it carries no personal data                                          |
| `wave8-followups`   | `apps/web`, `ops` | An order stopped before it left, as the shopper reads it; the staff-cancel form's hint; the order right after a staff cancellation; two links measured at 44 px                                                            |
| `wave9-integration` | `apps/ops`, `web` | Who sees Casos and Salud del sistema for each staff role; one count of late cases on Salud, Hoy and Casos; a customer's own delivery code masked for staff                                                                 |

Two files in `lib/` are not screen helpers. `lib/local-only.cjs` is loaded
before every journey by `run.mjs` and fails it when the browser asks anything
of a host that is not this machine. `lib/tracker-standin.cjs` is the stand-in
error tracker that `ERROR_TRACKER=standin tools/dev/stack.sh up <lane>` starts:
it only records what arrives, in `.lane/<lane>/error-tracker.jsonl`, which
`error-reports` reads. With the tracker off (every ordinary lane)
`error-reports` checks that nothing is sent.
