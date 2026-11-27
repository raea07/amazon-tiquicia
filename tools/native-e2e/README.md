# Native journeys

Browser journeys through the web export of the four phone apps, in a lane:
`tools/dev/stack.sh native <lane>`, then `tools/dev/stack.sh native-e2e <lane> [journey…]`.
Each journey starts from a freshly seeded database. Rules for the next one
(SISTEMA.md §20.5):

1. A journey file holds the flow and the checks. How a screen is found and
   worked lives in the app's helper: `lib/shop.cjs`, `seller.cjs`,
   `driver.cjs`, `warehouse.cjs`; the kit's account screens in
   `lib/accounts.cjs`. A rebuilt screen changes its helper, not the journeys.
2. Find an element by its testID, or by its role and accessible name
   (`lib/screen.cjs`). Never by a CSS class, a tag or its place on the page,
   and never by a bare text match: `getByText` and `hasText` appear only in
   the helpers, on an element already found by testID or role.
3. Words on screen are checked, never used to find what to tap or fill in.
   Prefer the text of an element found by rule 2. `screenText()` (or a wait
   on the page's text) may check what the whole screen says or never says,
   or read a value from a sentence, such as a parcel number.
4. Status words come from `lib/words.cjs` (later from `packages/core`;
   `lib/words.test.cjs` keeps the switch safe).
5. Every testID in the apps and in expo-kit is listed in `testids/<app>.json`.
   `node tools/native-e2e/testids/check.mjs` (run before every journey)
   fails when a listed id is gone. Add ids freely; drop or rename one only in
   the same commit as its list (`check.mjs --write`) and the app's helper.
6. Keep every sideways-scroll and size check. Each screen a journey reaches
   gets `overflow(page) <= 0` and a screenshot; a check is never loosened in
   the same change as the screen it checks.
7. Fail on any console error, uncaught exception or 5xx, except a refusal
   the step provokes on purpose and names.
