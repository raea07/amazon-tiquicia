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
