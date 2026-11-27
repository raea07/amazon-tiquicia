# Error tracking

Error reports from the four websites (`apps/web`, `apps/seller`, `apps/ops`,
`apps/field`) go to Sentry, with personal data removed before anything is
sent. The owner decided this on 24 November 2026 (decision 57). The phone apps
are not part of it yet (see the last section).

**State.** Built and tested on this machine only: unit tests, a stand-in
tracker in the tests, and a browser journey in a lane with the websites built
to report to a stand-in. No Sentry project exists yet and nothing has been
sent to Sentry. Every website is off until its address is set.

Everything lives in one place, `packages/next-kit/src/error-reports/`, which
the four websites use through three small files each: `src/instrumentation.ts`
(server), `src/instrumentation-client.ts` (browser) and `src/app/global-error.tsx`
with `src/app/error.tsx` (the error pages). The SDK is `@sentry/nextjs`
11.12.0, pinned exactly.

## What is sent and what never is

Each report is built anew from a short list of allowed fields
(`scrub.ts`, `scrubEvent`); a field the SDK adds in a later version is left
out until someone allows it.

| Sent                                                                                                                   | Never sent                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The error's type and message, with personal data removed (below)                                                       | Cookies and every request header (so no session, no browser name, no address it came from)                            |
| The stack: file, function, line, column                                                                                | The request body and the form fields; a Server Action's arguments                                                     |
| Which website (`app` tag), environment (`production`, `preview`, `local`) and commit (the release)                     | Query strings and fragments of any address                                                                            |
| The page's address without its query (browser and server), and on the server the route pattern (`/pedidos/[numero]`)   | The user: no id, no e-mail, no IP address (Sentry is also told never to infer one)                                    |
| For a database error: its short code (`insufficient_stock`) and, for an answer of the wrong shape, the function's name | A database error's detail text and the text of its cause                                                              |
| The runtime (Node.js version)                                                                                          | Breadcrumbs: clicks, typed text, console lines, visited addresses                                                     |
|                                                                                                                        | Source lines and local variables of the stack; extra data; every other context; screenshots, session replay, feedback |
|                                                                                                                        | Performance traces, profiles, sessions, reports about dropped events                                                  |

Every string that is kept goes through `redactText`, which replaces:
e-mail addresses, also as written in an address (`ana%40example.com`); Costa
Rican phone numbers (8 digits starting 2, 4–8, with or without +506, written
whole, 4+4, 4+2+2 or in pairs); identity numbers, bank accounts and card
numbers (any run of 9 or more digits, a short cédula such as `1-234-567`,
IBAN `CR…`); a 4- to 6-digit number up to 60 characters after, or just
before, the word for the delivery code (_código de entrega_, _codigoEntrega_,
_pin_, _delivery_pin_, _deliveryPin_, _code_; the code is 4 digits today); IP
addresses; JSON Web Tokens, the project's keys, `Bearer …`, and
`password=…`-style pairs; UUIDs and other long random strings; and any quoted
text except a short lower-case identifier (`reading 'name'` stays,
`"Ana Pérez"` does not). A number ends where a digit no longer follows, so a
full stop, comma or bracket after it does not hide it. Only the first 4,000
characters of a string are read (8 times the 500 kept), and the word or number
the cut falls on is dropped; every rule is bounded, so a long message costs
milliseconds, not seconds (a unit test holds each hostile pattern of 1 MB
under 50 ms).

**What cannot be recognised.** A name or a street address written into an
error message without quotes cannot be told apart from ordinary words. Nothing
from the page or the database is attached automatically, so such text could
only arrive if code wrote it into an error's message. A unit test
(`scrub.test.ts`) fails if code in the websites or their shared packages
builds an error message from a value with a name such as `name`, `email`,
`phone`, `address` or `pin`. Sentry's own server-side scrubbing (below) is a
second net, not the first.

The delivery code is never on a staff or driver page, and is shown only to the
shopper; it can reach an error only through such a message, and the rule
above removes it there.

## Switching it on, per website

The address is the project's DSN, a public value by design (it says where to
send, and carries no secret). It is read when the website is **built**, so a
change needs a new deployment.

1. In Sentry, open the website's project: Settings → Projects → `yuntera-web`
   (or `-seller`, `-ops`, `-field`) → Client Keys (DSN). Copy the DSN.
2. In Vercel, open the same website's project → Settings → Environment
   Variables.
3. Add `NEXT_PUBLIC_SENTRY_DSN` with that DSN, for Production and Preview
   only. Never for Development.
4. Redeploy that project.

A DSN with a secret part (`https://key:secret@…`, the old format), anything
that is not https (plain http is accepted only to this machine) or a
malformed one is refused, and the website stays off. With no DSN, the website
loads no tracker code and makes no request; the tests prove it
(`off.test.ts`) and every browser journey fails if the browser asks anything
of a host that is not this machine (`tools/e2e/lib/local-only.cjs`).

The Content-Security-Policy (`packages/next-kit/config.mjs`) adds one entry
to `connect-src` when the DSN is set: the project's ingest address
(`https://o….ingest….sentry.io/api/<project>/envelope/`), nothing broader. No
script, frame or image comes from Sentry, and there is no tunnel route.

## Switching it off at once

- **In seconds, without a deployment:** Sentry → the project → Settings →
  Client Keys (DSN) → disable the key (?). Sentry then refuses every report
  from that website. The browser still loads the SDK until the next
  deployment, and the error page still says "Ya le avisamos al equipo de
  Yuntera." (the page cannot see that Sentry refused the report), so follow
  this with the complete switch-off below.
- **Completely:** remove `NEXT_PUBLIC_SENTRY_DSN` from the Vercel project and
  redeploy. The website then loads no tracker code at all.

## What the supervisor creates in Sentry

Only projects whose names start with `yuntera` (decision 57).

1. Four projects, platform Next.js: `yuntera-web`, `yuntera-seller`,
   `yuntera-ops`, `yuntera-field`.
2. In each project: Project Settings → Security & Privacy → section "DATA
   SCRUBBING". Keep "Data Scrubber" (?) and "Use Default Scrubbers" (?) on. In
   "Additional Sensitive Fields" add `email`, `correo`, `phone`, `telefono`,
   `cedula`, `address`, `direccion`, `senas`, `pin`, `delivery_pin`,
   `delivery_code`, `password`, `token`. Switch on "Prevent Storing of IP
   Addresses" (?). (If the organisation has the same settings, they apply on
   top.) Sentry's documentation names the section and "Additional Sensitive
   Fields"; the other labels marked (?) were not seen in the account.
3. In each project: Alerts → an issue alert "a new issue is created" (?) →
   send an e-mail to the owner.
4. Required, to protect the shared free quota (5,000 errors a month for all
   four projects together; the DSN is public, so anyone can post with it):
   - In each project: Project Settings → Inbound Filters (?) → "Allowed
     Domains" (?): list that website's own hosts, production and preview,
     one by one. Do not enter `*.vercel.app`: it would let every website
     on Vercel through. Sentry then refuses browser reports from any other
     site.
     It checks only requests that carry an `Origin` or `Referer` header, so
     it does not cover a script posting directly.
   - Settings → Spike Protection (?): switch it on for the four projects
     ("Enable All" (?)). It cuts a sudden storm from one project.
   - A rate limit per client key (Client Keys (DSN) → Configure) is, by
     Sentry's documentation (read 27 November 2026), only on the Business
     and Enterprise plans, so it is not available on the free plan.
5. One uptime monitor (the free plan has one): method POST, address
   `https://<project-ref>.supabase.co/rest/v1/rpc/health_ping`, headers
   `apikey: <the project's publishable key>` and
   `content-type: application/json`, body `{}`, every 5 minutes. The
   publishable key is public by design. `health_ping` is the database's
   health function from the system-health work (granted to visitors, returns
   only that the database answers); until it exists on the project, the
   monitor has nothing to call. Then an alert rule on uptime issues, by
   e-mail.
6. Then set each website's DSN as above, and check one report arrives by
   opening a page and making an error happen (the drill page below exists
   only on this machine).

**Why the four test websites are not watched from outside.** The preview
websites sit behind Vercel's sign-in wall (Deployment Protection): an outside
robot gets the sign-in page, not the website. Letting it through would mean
weakening the wall or giving Sentry the bypass secret, and neither is allowed.
So the uptime monitor calls the database's health function, which is public,
and the websites themselves report their own errors from inside. When the
production websites are public, each can get its own uptime check (a paid
plan has more than one).

## Releases and environments

Each report carries `release: yuntera-<website>@<first 12 characters of the
commit>` and `environment: production | preview` (from Vercel's `VERCEL_ENV`;
`local` in the lanes). The commit comes from Vercel's `VERCEL_GIT_COMMIT_SHA`
at build time, or from git on this machine, and is put into the build as
`YUNTERA_COMMIT` (with `YUNTERA_ENVIRONMENT`) by `baseConfig` in
`packages/next-kit/config.mjs`; a page that wants to say which version runs
can read the same value. A commit is not a secret.

## Free plan quota, and tracing later

The free Developer plan (read on sentry.io/pricing, 27 November 2026): 5,000
errors a month for the whole organisation, one user, one uptime monitor, one
cron monitor, 30 days of history; the Team plan is $26 a month billed yearly.
These websites send **error events only**: no spans, replays, profiles,
sessions or client reports, so only the error count is used. Identical errors
in a row from one browser or server are sent once. Whether 5,000 a month is
enough at pilot volume is an estimate; the filters in step 4 limit a storm.

To switch tracing on later (it uses the plan's span quota):

1. In `packages/next-kit/src/error-reports/options.ts`, add
   `tracesSampleRate: 0.05` and stop dropping the `Http` integration.
2. In `browser-sdk.ts`, add `browserTracingIntegration()` to the list.
3. Let `scrubEvent` pass events of type `transaction` through its own
   scrubbing of names and paths (today it drops them), and add a test.
4. Measure the browser download again (tracing adds code).

## Readable stack traces (source maps)

Not set up. Reports name the built files (`/_next/static/chunks/1qz4….js`,
line 2, column 4499), which a person can still follow but slowly. Uploading
source maps would let Sentry show our source files and lines.

What it needs, when wanted: an auth token from Sentry with permission to
upload (Settings → Auth Tokens), kept **only** in each Vercel project's
environment variables as `SENTRY_AUTH_TOKEN` (never in the repository, never
`NEXT_PUBLIC_`); the website's build wrapped with `withSentryConfig` from
`@sentry/nextjs/config` (with telemetry off and the maps deleted after upload,
so they are not served to visitors); and the build ids Sentry matches on,
which the reports already keep. Nothing in this repository uploads anything
today, and no token is needed to build.

## What it costs a shopper

Measured on the shop's home page and a product page in a production build
(lane 18, Chromium, 27 November 2026), the JavaScript downloaded, compressed
with gzip:

| Build                | Home page, before the page is usable | Product page, before the page is usable | Downloaded afterwards |
| -------------------- | ------------------------------------ | --------------------------------------- | --------------------- |
| Before this work     | 140,456 bytes                        | 148,650 bytes                           | —                     |
| Tracker off (no DSN) | 144,592 bytes (+2.9%)                | 152,786 bytes (+2.8%)                   | nothing               |
| Tracker on           | 144,225 bytes (+2.7%)                | 152,419 bytes (+2.5%)                   | 25,196 bytes, once    |

Measured again after the redaction fixes (27 November 2026, lane 18,
Chromium, cache off, bytes as sent on the wire with headers, against the
reviewer's base build of 147,748 and 156,990 bytes): tracker off 152,904
(+3.5%) and 162,139 (+3.3%); tracker on 153,185 (+3.7%) and 162,459
(+3.5%), plus one SDK download of 26,580 bytes after the load event.

The SDK itself is 25 KB compressed, 18% of the home page's first load, above
the 15% limit, so it is never part of the first load: it is fetched once the
page has loaded and the browser is idle (`client.ts`). Errors that happen
before it arrives are kept (up to 20) and sent, marked unhandled as the SDK's
own handlers would mark them, when it starts. An error thrown before the
website's own start-up script runs (while the page's first scripts are still
arriving) is not caught by any scheme that loads later. The 4 KB added either way
are the error pages and the start-up check. (The SDK's own browser start-up
for Next.js would have added 82 KB, because it always brings tracing code; the
client is therefore put together from named parts in `browser-sdk.ts`.)

## Checking it on this machine

- `pnpm --filter @yuntera/next-kit test`: every scrubbing rule, real-shaped
  events (a checkout with an address and a phone, an order page with a
  delivery code, a sign-in with an e-mail and a password, a staff page
  showing a customer), the "not configured sends nothing" test, the error
  pages, and per website the real SDK reporting to a stand-in tracker
  (`standin.<website>.test.ts`). `SHOW_EVENTS=1` prints what arrived.
- `ERROR_TRACKER=standin tools/dev/stack.sh up <lane>` builds the websites to
  report to a stand-in on this machine (the lane's API port + 6), which only
  records what arrives in `.lane/<lane>/error-tracker.jsonl`. Then
  `tools/dev/stack.sh e2e <lane> error-reports` signs in on each website,
  makes errors happen in the browser and on the server, and checks what
  arrived. Without `ERROR_TRACKER=standin` the same journey checks that
  nothing is sent.
- Each website serves `/prueba-de-errores`, a page that fails on purpose
  (only on this machine and in the lanes; a plain 404 on any deployment).
  `?en=navegador` makes it fail while rendering in the browser instead;
  `?una-vez=<mark>` makes it fail once and then work, which the journey uses
  to check that "Intentar de nuevo" fetches the page again.

**The error pages.** "Intentar de nuevo" calls the framework's `retry`, which
fetches the page from the server again, so a passing failure is fixed by the
button. The sentence "Ya le avisamos al equipo de Yuntera." appears only once
the report was handed to the SDK: in the browser, when the SDK has started
and taken the error (not while it loads, not if it could not load, not past
the 20 kept errors); for an error from the server, when this build reports
errors (the server reported it). Whether Sentry then accepted it (a disabled
key, a blocked address) cannot be seen from the page.

**Known limits.**

- With a DSN set, the server prints one line at start-up, "[Sentry] Failed to
  register diagnostics-channel injection hooks", because a tracing helper of
  the SDK cannot be found under pnpm. It affects tracing only, which is off.
- An error a page catches and turns into a message on the form (the usual
  Server Action pattern) is not an error to the tracker and is not sent.
- No page of these websites runs on the edge runtime, so only the Node.js
  server is set up.

## The phone apps

They wait for store version 0.2.0: Sentry for React Native is a native module,
so it needs a new store build (the build from commit `3f251c3` on testers'
phones cannot change). Then: one project per app (`yuntera-shop-native`,
`yuntera-seller-native`, `yuntera-driver-native`, `yuntera-warehouse-native`),
the same allowed-fields rules (move `scrub.ts`, which is plain TypeScript,
to a package both kinds of app can use), the DSN as an `EXPO_PUBLIC_` value,
and native crash reports with the same scrubbing.
