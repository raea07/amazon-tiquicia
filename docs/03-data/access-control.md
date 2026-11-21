# Access control

Who can reach what, and how that is enforced. The short version: every request
arrives at the database as one of two unprivileged roles, with the signed-in
user's identity attached; three independent layers then decide what it may do;
and no app holds a key that skips them.

Source: `supabase/migrations/20261121081400_access_control.sql` for grants and
policies, `…080100_identity.sql` for the role helpers, and the checks inside
each function. Tested by `supabase/tests/020_access.sql` and `070_api.sql`,
which run as real API roles with real claims.

## The roles a request can have

| Postgres role   | Who it is                                                                   | How a request gets it                                                     |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `anon`          | A visitor who is not signed in                                              | The publishable key alone                                                 |
| `authenticated` | Any signed-in person: shopper, seller, driver, warehouse associate or staff | The publishable key plus the user's session token                         |
| `service_role`  | Bypasses row-level security                                                 | A secret key. **No app has one.** Reserved for future server-side workers |

Everything a signed-in person is beyond "a shopper" comes from rows, not from
the token:

| They are…                       | Because of a row in…            | Checked by                                                            |
| ------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Internal staff, with a role     | `staff_members` (`active`)      | `private.is_staff()`, `private.has_staff_role(…)`                     |
| A member of a seller account    | `seller_members`                | `private.is_seller_member(seller)`, `private.is_seller_admin(seller)` |
| A warehouse associate at a site | `warehouse_staff`               | `private.works_at(warehouse)`                                         |
| An active driver                | `drivers` (`status = 'active'`) | `private.my_driver_id()`, `private.drives_route(route)`               |

Because these are looked up on every request, removing the row removes the
access immediately. A token that is still valid for an hour does not keep a
dismissed employee in the console.

**Staff and a second factor.** `private.staff_session_ok()` is part of every
staff check. When the setting `require_staff_mfa` is true, it requires the
session token's `aal` claim to be `aal2` — that is, the person completed
multi-factor sign-in for this session. With the setting on, a staff member who
signed in with a password alone has exactly a shopper's access. The setting
ships as `false` and must be turned on before launch.

## Three layers

```mermaid
flowchart TD
  r["Request as anon or authenticated"] --> g{"GRANT<br/>May this role attempt<br/>this operation at all?"}
  g -- no --> x1[permission denied]
  g -- yes --> f{"Function check<br/>Is this caller allowed<br/>to do this business action?"}
  f -- no --> x2["error code: forbidden,<br/>not_authenticated, …"]
  f -- yes --> p{"Row-level security<br/>Which rows may this<br/>caller see or touch?"}
  p --> ok[Result]
```

### 1. Grants: least privilege, stated explicitly

The migrations start by revoking everything from `anon` and `authenticated` —
tables, sequences, functions — and from `public` on functions, and they switch
off the default privileges that would grant new objects automatically. Nothing
is reachable until a later statement grants it on purpose.

What is then granted:

- **Functions.** `EXECUTE` on a named list. Visitors get the browsing
  functions only. Signed-in users get the rest; each of those checks its caller.
- **Tables, read.** `SELECT` where a policy can sensibly scope it.
- **Tables, write.** Rare, and by column. A shopper may update four columns of
  their own profile, not `phone_verified_at`. A seller may write listing
  content columns of `products` and `skus`, not the ranking and summary
  columns, and only while the listing is not published: a trigger refuses
  content changes to a published listing, and new variants on it, unless the
  caller is catalogue staff. Edits to a published listing go through
  `seller_update_listing` and wait for review (`product_change_requests`
  is readable by the listing's seller and catalogue staff, and written only by
  those functions). Not yet locked: the photos of a published listing
  (`product_images`), which a seller can still change directly. Orders,
  payments, shipments, stock, ledger, routes and stops have **no** write grant
  at all: they change only inside functions.

Supabase's own guidance is the same two-layer model — grants decide whether a
role can touch an object, policies decide which rows — and the platform is
moving its defaults toward revoking automatic grants. The migrations do not
depend on which default a project has: they revoke first either way.

### 2. Function checks

A `security definer` function runs with its owner's rights, so row-level
security does not constrain it; the function is responsible for checking the
caller. Every one of them does, in its first lines, and refuses with a stable
error code (`not_authenticated`, `forbidden`, or a "not found" that does not
reveal whether the thing exists).

Read functions run with the **caller's** rights (`security invoker`) wherever
the caller's own row access is exactly what the screen should show —
`search_products`, `get_product`, `my_orders`, `list_categories`. Those cannot
return more than the policies allow, whatever the function body says.

### 3. Row-level security

Enabled on every table in `public` and `private`. A table with no matching
policy returns nothing.

Policy style, which matters for both correctness and speed:

- Role checks are wrapped in a sub-select — `(select private.is_staff())` — so
  Postgres evaluates them once per statement, not once per row.
- Checks that need another table go through the `security definer` helpers in
  `private`, so a policy on table A can consult table B without recursing into
  B's own policies.
- In a sub-query inside a policy, **every reference to the outer table's column
  is qualified with the table name.** The reason is the bug described
  [below](#a-real-bug-and-what-it-taught).

## What each kind of user can do

A summary; the migration is authoritative.

### Visitor (`anon`)

| Can                                                                           | Cannot                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Search and browse active products from active sellers; read published reviews | See drafts, rejected listings, or anything from a pending or suspended seller |
| Read categories, districts, zones, holidays, the fee schedule                 | Read any profile, address, order, stock level or seller's private details     |
| Get a delivery estimate and a checkout quote                                  | Place an order                                                                |
| Report a listing, review or shop that is public, giving an e-mail address     | Read the report queue; report something that does not exist or is not public  |

### Shopper (any signed-in user)

| Can                                                                                   | Cannot                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Read and edit their own profile (name, phone, locale, marketing choice)               | Mark their own phone as verified                                                          |
| Add, edit and soft-delete their own addresses                                         | See anyone else's                                                                         |
| Place, pay (in sandbox), cancel and read their own orders, including the delivery PIN | Read another person's order — it answers "not found", the same as one that does not exist |
| Review a product they received; request a return; file a complaint                    | Review something they did not buy, or twice                                               |
| Record and withdraw their own consents, dated by the database                         | Back-date a consent, change one, or undo a withdrawal                                     |

### Seller member

| Can                                                                                                                                                               | Cannot                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read their seller's private details, members, listings, offers, stock, statements and payouts                                                                     | Read another seller's                                                                                                                                                      |
| Create listings as draft or pending review; edit their content; set price, handling time and status of their offers                                               | Publish a listing; change a published listing except through a reviewed edit; write ranking, rating or summary columns                                                     |
| See the order lines they sold and each line's progress, with the shopper's first name, district and cantón                                                        | See the shopper's full name, phone, e-mail, address or map pin — Yuntera delivers, so the seller never needs them                                                          |
| Set stock at their own location; announce stock sent to a warehouse; mark their own parcels packed                                                                | Change stock held in a Yuntera warehouse                                                                                                                                   |
| Reply to a review of their product                                                                                                                                | Remove or edit a review                                                                                                                                                    |
| Admins and owners: invite members (they must accept), remove staff, ask for a change of payout account, shop name, fiscal details or contact (staff approve each) | Add anyone without their acceptance; change the payout account, name, fiscal details or contact directly; read an account number in full; create, alter or remove an owner |

### Warehouse associate

| Can                                                                                                   | Cannot                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| At the sites they are assigned to: see the floor board, pick lists, bins, stock and inbound shipments | See other sites                                             |
| Receive, put away, pick, pack, adjust stock with a note                                               | See shoppers' addresses or phones, prices paid, or payments |

### Driver

| Can                                                                                                                         | Cannot                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| See routes assigned to them and, for each stop: recipient name, phone, _señas_, pin location, parcels, cash to collect      | See the delivery PIN, the order's contents or price, or any other order of that shopper |
| Start a route, arrive, complete a stop with the shopper's PIN, record a failed attempt with a reason, report their position | Read a route's stops more than 24 hours after it was completed                          |
| See their own cash settlements                                                                                              | See another driver's route or position                                                  |

### Staff

Admin implies every role below.

| Role      | Reach                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops`     | Orders, sellers' private details, drivers, warehouses and staff assignments, zones and calendar, dispatch board, routes, settlements, returns; approve or suspend sellers |
| `support` | Orders and timelines, profiles, addresses, consents, sellers' private details, stock levels, returns, complaints, content reports; cancel an order for a shopper          |
| `finance` | Orders, fee schedule, seller statements, the ledger, settlements, invoices; decides sellers' bank-detail requests; previews, creates and settles payout runs              |
| `catalog` | Categories, brands, synonyms, all listings; approve or reject a listing; moderate reviews and content reports                                                             |
| `admin`   | All of the above, plus staff membership, settings, and the audit log                                                                                                      |

Sensitive changes by staff — to staff membership, seller status and private
details, drivers, warehouse assignments, settings, fees, payouts — are written
to `private.audit_log` with the acting user, and that log cannot be altered.
A bank account number is never copied into it: only its last four digits.

Two rules about people and money are enforced below the functions, on the
tables themselves. The platform always keeps one active administrator: a
trigger on `staff_members` refuses the change that would remove the last one.
And nobody writes a seller's payout account or a payout directly: sellers ask
with `seller_request_payout_details`, finance decides with
`ops_decide_payout_details`, and `payouts`, `payout_runs` and
`payout_detail_requests` have no grant to any API role at all. The full account
number is readable only through two finance functions (a request awaiting a
decision, and a run's transfer list). Finance confirms a change by calling the
shop's phone on file, so sellers cannot change that phone or the contact e-mail
directly either, and a request made within 30 days of a change to them is
flagged. Nobody in finance decides a request they made, or one for a shop they
belong to.

## Access that ends at once

Every check reads the row that grants the access, on every call, so taking
the row away ends the access with the next request. What each kind of
account keeps, tested function by function in `supabase/tests/120_limits.sql`
(each prefix is called with every argument it takes, and every call must
refuse):

| Account                                 | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Driver suspended, offboarded or pending | `driver_today` returns their own record and no routes; every other driver function refuses. Their routes go back to dispatch at once (a trigger on `drivers`, whatever path changed the status): a route not started becomes a draft without driver; of a route being driven, the stops still to do move to a new draft route and the old one closes with its cash count for the driver who collected the money. `ops_released_routes` lists them on the dispatch screen, with the parcels still in that driver's hands. |
| Staff member switched off               | Every `ops_*` function and the audit trail refuse (`forbidden`): `has_staff_role` reads `active`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Warehouse worker removed from a site    | Every `wms_*` function refuses for that site.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Member removed from a shop              | Every `seller_*` function refuses for that shop; nothing of it stays readable.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shop pending (not yet verified)         | Reads its data, keeps drafts, invites its team, asks for changes. Cannot send a listing for review, edit a published one or announce stock to a warehouse (`shop_not_active`).                                                                                                                                                                                                                                                                                                                                           |
| Shop suspended                          | As pending, and also cannot put an offer back on sale or reply publicly to a review. It can still pause offers, count stock, pack what it already sold and be paid what it is owed later.                                                                                                                                                                                                                                                                                                                                |
| Shop closed                             | Reads only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Limits against abuse

The database cannot trust a caller's network address: the apps call it from
their own servers, and anyone with the publishable key can call it directly
and claim any address. So no limit below depends on one. They are of four
kinds: the thing acted on must exist and be public; a repeat is the same
thing, not a second one; one account can have only so much open at a time;
and what a visitor can send is bounded before any work is done. Each is a
setting in `app_settings` (an administrator changes it without a migration)
or a named constant in the function, and each is tested at its edge.

| Limit                                      | Value                                                               | Where                                                                                                                      | Why this number                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shops waiting for verification per account | 1 (`max_pending_shops_per_account`)                                 | `create_seller`                                                                                                            | Nobody honest needs two at once; the second can be registered as soon as the first is decided.                                                                                                                                                   |
| Listings in review per shop                | 50 (`max_listings_in_review_per_seller`)                            | `seller_create_listing`, `seller_update_listing`                                                                           | New listings and edits of published ones together. Enough for a shop's first catalogue upload; more waits as drafts.                                                                                                                             |
| Drafts per shop                            | 200 (`max_draft_listings_per_seller`)                               | `seller_create_listing`                                                                                                    | Drafts are never reviewed; this only stops a table from filling up.                                                                                                                                                                              |
| Open inbound shipments per shop            | 10 (`max_open_inbounds_per_seller`)                                 | `seller_create_inbound`                                                                                                    | Each is an expected delivery on the dock's board; ten covers a week of daily deliveries.                                                                                                                                                         |
| Lines per inbound shipment; units per line | 100; 100 000                                                        | `seller_create_inbound`                                                                                                    | A shipment is a truckload, not the catalogue. A repeated product is refused (`invalid_lines`).                                                                                                                                                   |
| Open reports per signed-in account         | 20 (`max_open_reports_per_account`)                                 | `report_content`                                                                                                           | Someone reporting genuinely rarely has more waiting; a repeat of an open report (same target and reason) returns the same report.                                                                                                                |
| Visitor reports per hour, whole platform   | 300 (`visitor_reports_per_hour`)                                    | `report_content`                                                                                                           | A safety valve, about ten times the expected volume. Above it a visitor is asked to write to support, except about something nobody has reported yet: that first report always gets in, so a flood cannot silence the reports about one listing. |
| Open complaints per account                | 5 (`max_open_complaints_per_account`)                               | `file_complaint`                                                                                                           | The same complaint again (same order, category and text) returns the first.                                                                                                                                                                      |
| Invitations waiting per shop; team size    | 20; 50 (`max_pending_invitations_per_shop`, `max_members_per_shop`) | `seller_invite_member`                                                                                                     | A small business's team, with room.                                                                                                                                                                                                              |
| Search text                                | 200 characters, 12 words                                            | `search_products`, `suggest_products`                                                                                      | Longer input is cut, not refused. The same numbers are `SEARCH_INPUT_LIMITS` in `packages/core/src/search.ts`, kept equal by a unit test.                                                                                                        |
| Lines in a checkout quote                  | `max_lines_per_order` (40)                                          | `checkout_quote`                                                                                                           | Counted before any pricing work; malformed lines are answered as an issue.                                                                                                                                                                       |
| Staff queues                               | 100 per page, oldest first                                          | `ops_care_queues` (with totals), `ops_listings_for_review`, `wms_board` (with `inbound_total`), `ops_shop_change_requests` | The payload no longer grows with whatever was filed.                                                                                                                                                                                             |
| Report details; complaint text             | 2 000; 10–4 000 characters                                          | `report_content`, `file_complaint`                                                                                         | What a person writes about one problem.                                                                                                                                                                                                          |

Reports must be about a listing, review or shop a shopper can see. The
e-mail a visitor types is recorded only as a contact detail staff may use by
hand: nothing sends a message to it, and the event the report emits does not
carry it. The same rule holds for invitations to a shop: the event names the
invited account (whose address its owner proved), never the address typed.

Shop registration accepts an identification number another shop uses, with
the same answer as any other registration, so it reveals nothing; staff see
the clash (`ops_seller_id_clashes`) and only one shop can ever be verified with
a number (a partial unique index). A name that contains "yuntera" (ignoring
spaces and punctuation), sounds like the platform speaking (soporte, ayuda,
oficial…), uses another alphabet, or reads the same as another active shop's
name is refused, at registration and when a change of name is requested.

## Changes only a function makes

| Change                                   | How                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Joining a shop                           | `seller_invite_member` (owner or admin; only the owner offers "admin"), then the invited account's `seller_answer_invitation`. The invitation is bound to the account that had the address when it was sent, expires after 14 days, and the owner (or an admin, for staff) can revoke it. `seller_remove_member` and `seller_set_member_role` replace direct writes; nobody changes the owner.            |
| The shop's name, fiscal details, contact | `seller_request_shop_change`, decided with `ops_decide_shop_change`: ops decide names and fiscal details, finance decides the contact (it is the phone finance calls to confirm a new payout account). A change of contact is refused while a payout-account request waits, and an approved one flags the next payout-account request. Nobody decides their own request or one for a shop they belong to. |
| Consents                                 | `record_consent` (only the policy version in force, in `app_settings.policy_versions`; agreeing again adds nothing) and `withdraw_consent`. A trigger dates every consent and withdrawal with the database's clock and refuses any other change, whoever makes it.                                                                                                                                        |
| Fees                                     | **Not through the API at all.** Commission rates, warehouse and payment fees and shipping prices change in a migration, where the parity test with `packages/core/src/fees.ts` keeps both sides equal. No API role has a write grant on the fee tables, `categories` or `delivery_zones`, and every change to them (and to holidays and zone closures) is in the audit log.                               |
| Payout account approval                  | Approving a request stamps `payout_approved_at`. An account on file that finance never approved is not paid (it counts as no approved account).                                                                                                                                                                                                                                                           |
| Packages sent to a warehouse             | Triggers on `offers` and `skus` refuse a warehouse offer whose package exceeds the largest fee tier (30 kg, 120 cm a side), whatever path tries.                                                                                                                                                                                                                                                          |

## Rules for `security definer` functions

These functions are the most powerful code in the system. The rules they follow:

1. **`set search_path = ''`**, and every object schema-qualified
   (`public.orders`, `private.fail`, `extensions.gen_random_bytes`). Without
   this, a caller who can create objects in any schema on the search path could
   plant a function or table with the same name and have it run with the
   owner's rights.
2. **Identify the caller from the token, never from an argument.** Functions
   use `(select auth.uid())`. No function accepts a user id to act as.
3. **Check before reading.** The permission check comes before any query whose
   result could leak through an error message or timing.
4. **Lock what you will change.** Rows that will be updated are selected
   `for update` first, in a consistent order, so concurrent calls cannot both
   pass a check and then both write.
5. **Fail with a code.** `private.fail('code')` raises SQLSTATE `P0001` with a
   stable message the client maps to text. Internal messages never reach a
   user.
6. **Granted explicitly.** `EXECUTE` is revoked from `public` and granted only
   to the role that should call it.

The `private` schema is not exposed by the API at all. `anon` and
`authenticated` have `USAGE` on it only so that policies and invoker-rights
functions can call the handful of helpers they are granted
(`is_staff`, `has_staff_role`, `is_seller_member`, `is_seller_admin`,
`my_seller_ids`, `my_driver_id`, `my_warehouse_ids`, `works_at`,
`drives_route`, `fold`, `like_escape`, `category_descendants`, `fail`).
Everything else in `private` — the audit log, the outbox, the functions that
capture payments and post to the ledger — is unreachable from outside.

## Checklist: adding a function safely

Before the migration is merged, answer each of these in the pull request.

- [ ] **Who may call it?** Name the role or relationship. If the answer is
      "anyone signed in", say what stops them acting on someone else's data.
- [ ] **Invoker or definer?** Use invoker rights if the caller's own row access
      is exactly what should be returned. Use definer only when the function
      must cross that boundary, and then:
  - [ ] `set search_path = ''` and schema-qualify everything.
  - [ ] First statement checks the caller and fails with a code.
  - [ ] No argument can name another user to act as.
- [ ] **What does it return to the wrong caller?** "Not found" for things that
      belong to someone else; never a different error that confirms existence.
- [ ] **Does it return personal data?** List the fields and why each is needed
      by this audience. A seller does not need a shopper's phone; a driver does
      not need the order's contents.
- [ ] **Does it write?** Lock rows first; make it safe to call twice.
- [ ] **Grant.** `grant execute … to authenticated` (or `anon, authenticated`
      for browsing). Nothing is callable without it.
- [ ] **Errors.** Every `private.fail('code')` has a message in
      `packages/db/src/errors.ts`. A unit test enforces this.
- [ ] **Client.** A method in `packages/db/src/api.ts` and a schema in
      `schemas.ts`.
- [ ] **Tests.** In `supabase/tests/070_api.sql`: one block proving the right
      caller gets the payload, and one proving each wrong caller is refused or
      gets nothing. In `contract.test.ts`: the response matches the schema.

Adding a table has a shorter list: enable row-level security (the
access-control migration does it for every table present when it runs — a
later migration must do it itself), grant the minimum, write a policy for each
operation granted, qualify outer columns, and add a block to
`020_access.sql`.

## A real bug, and what it taught

During testing, a driver signed in and saw an empty route: stops but no
parcels. The policy on `shipments` was meant to say "a driver sees the parcels
on stops they can see":

```sql
-- As first written. Wrong.
or exists (select 1 from public.route_stops rs where rs.shipment_id = id)
```

Inside the sub-query, the bare `id` does not mean `shipments.id`. Postgres
resolves an unqualified name against the innermost table first, and
`route_stops` has its own `id`. The condition was silently comparing a stop's
`shipment_id` to that same stop's `id` — never true. No error, no warning: the
policy simply matched nothing.

```sql
-- As it is now.
or exists (select 1 from public.route_stops rs where rs.shipment_id = shipments.id)
```

This one failed closed: the driver saw too little. The same mistake with the
logic the other way round would fail open and show too much, just as silently.

What changed as a result:

- Every policy sub-query was rewritten to qualify outer columns with the table
  name, and the rule is in the checklist above.
- The access tests gained **positive** cases. The suite had proved that a
  driver could not see other people's parcels; it had not proved that a driver
  could see their own. A test that only checks refusals passes when everything
  is refused.

The general lesson for this codebase: a row-level-security mistake does not
raise an error. The only defence is a test, per role, for both what must be
visible and what must not.

## What is not in place yet

- **Rate limiting by time.** The limits above cap what one account can have
  open and bound what a visitor can send; nothing counts calls per minute, and
  sign-in attempts are limited only by the platform. Supabase Auth counts the
  app server's address, not the visitor's, because sign-in runs on the
  server. A request body size limit at the API gateway is also not set here.
- **Row-level security is enabled, not forced.** Table owners acting directly
  in the database are not subject to it. API roles are, which is what matters
  for requests; it means SQL run by an administrator in the dashboard sees
  everything.
- **Storage policies.** No buckets are defined, so no upload path exists.
- **Secret-key workers.** The first server-side worker (payment webhook, outbox)
  will hold a secret key. It should call narrowly scoped functions rather than
  write tables freely, and its key should be one created for it alone so it can
  be revoked independently.
- **Multi-factor enforcement is off** until `require_staff_mfa` is set to true.
- **Verified on local PostgreSQL only**, with a shim that copies Supabase's
  roles and permissive defaults. Re-run the access tests against the real
  project before trusting it with real data
  ([runbook](../07-deployment/runbook-first-deploy.md)).
