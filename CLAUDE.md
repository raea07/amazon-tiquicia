# Yuntera: working notes

Yuntera is a marketplace with its own warehouse and delivery, for Costa Rica.
Read `STATUS.md` for what exists and what does not, and
`docs/02-architecture/overview.md` and `decisions.md` for how it fits together
and why. This file is the short list of rules that are easy to break.

## Layout

- `apps/web` shop, `apps/seller` seller centre, `apps/ops` staff console,
  `apps/field` drivers and warehouse (all Next.js 16, App Router).
- `packages/core` domain logic (pure TypeScript, tested), `packages/db` typed
  API client, `packages/ui` components, `packages/next-kit` what the web apps
  share, `packages/brand` name, tokens and logo.
- `supabase/migrations` the database, `supabase/tests` its tests,
  `supabase/seed.sql` demo data.
- `tools/dev-api` local stand-in for the Supabase HTTP API, `tools/e2e` browser
  journeys, `tools/dev/stack.sh` runs an isolated copy of the whole stack.

## Commands

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm db:local:reset && pnpm db:local:test
```

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/yuntera_local pnpm --filter @yuntera/db test
```

```bash
tools/dev/stack.sh up 1 && tools/dev/stack.sh e2e 1 && tools/dev/stack.sh down 1
```

`stack.sh` takes a lane number (0–9). Each lane has its own database, API port
and app ports, so parallel checkouts never share state. Use a lane other than 0
when anything else may be running. Never run two installs or two stacks in the
same lane at once.

## Rules

**The database is the API.** Apps call database functions over RPC and never
read or write tables directly. No app holds a privileged key. Anything that
needs elevated rights runs in a database function or a server-side function
outside the apps.

**Adding or changing a database function.** Put it in a new migration file
with the next timestamp (do not edit existing migrations except to fix a bug
in the same change). Every function is `security definer` with
`set search_path = ''`, checks the caller before doing anything, raises errors
as `private.fail('short_code')`, and is granted to `authenticated` only (to
`anon` only if a visitor must call it; nothing is granted by default). Then:

1. a test in `supabase/tests/` for the right caller, the wrong caller and what
   the function leaves behind;
2. a message in Spanish and English for each new error code, a zod schema and a
   typed method, in a new file under `packages/db/src/areas/` (see the comment
   in `areas/index.ts`);
3. a contract test in `packages/db/src/contract.test.ts` when it returns data.

**Row-level security** stays enabled on every table. In a policy subquery,
qualify outer columns with the table name (`shipments.id`, not `id`).

**Money** is an integer number of céntimos. Never floats. Ledger entries of a
transaction sum to zero. Fees come from the fee schedule tables, mirrored in
`packages/core/src/fees.ts`; a parity test keeps them equal.

**Logic that exists in both SQL and TypeScript** (fees, lifecycles, search
constants, delivery promise) has a parity test in `packages/core`. Change both
sides together.

**Web apps.** Next.js 16 with Cache Components: anything that reads cookies,
search params or per-user data sits inside `<Suspense>`; shared catalogue reads
are `'use cache'` functions with a tag. Mutations are Server Actions that
validate with zod, re-read the session, return `ActionState` (with the typed
values so the form keeps them) and call `refresh()` when the page behind the
form changed. Redirect targets taken from a request go through
`safeReturnPath`. Use the components in `packages/ui` and `packages/next-kit`
rather than restyling.

**Words on screen** are Spanish, in the _usted_ register, plain and specific:
say what happened and what to do next. Never show an error code. A button says
what it does. Code, comments, commit messages and docs are in English.

**Privacy and security.** The delivery code is shown only to the shopper,
never to drivers or staff. Sellers see a buyer's first name and district only.
No personal data in logs or URLs. No secrets in the repository or in
`NEXT_PUBLIC_`/`EXPO_PUBLIC_` variables. The session cookie is `HttpOnly`.
Nothing is pre-selected at checkout except the shopper's own address; consent
boxes start unticked.

**Accessibility.** Every field has a visible label. Controls are at least
44 px on touch screens. Colours come from the brand tokens, which are
contrast-tested; status is never colour alone. Pages work at 390 px wide with
no sideways scrolling.

**Originality.** Everything is original work: do not copy another company's
name, artwork, copy, or screen layouts.

## Before saying something is done

Run lint, typecheck, unit tests, the database tests and the browser journeys
that touch what changed. A user-visible flow needs a step in a journey under
`tools/e2e/journeys/`. If something could not be verified (it needs a real
Supabase project, a payment gateway, a phone), say so in the report and in
`STATUS.md` rather than implying it works.

Keep `STATUS.md` and `docs/03-data/api-reference.md` true when behaviour
changes. Do not add planning or analysis documents unless asked.

## Git

Commit messages say what changed and why, in plain English, with no tool or
model names. Do not push or open pull requests unless asked.
