# Notifications: e-mail, WhatsApp/SMS and push — research note

Researched 21 November 2026 for the "build notifications" phase (outbox worker,
e-mail, WhatsApp/SMS, push). Nothing in this note was installed, sent or
configured: no Bird, Meta, Supabase or Expo resource was created or changed, and
no message was sent. Every claim comes from a document or file opened that day.
Source tags such as `[B1]`, `[S2]`, `[L3]` refer to [Sources](#sources).
Anything that could not be confirmed from a primary source is marked
**UNVERIFIED**. Legal sections are an engineer's reading of the texts, not legal
advice; the lawyer questions are listed at the end of section 5.

## Bottom line

Use **Bird's new platform API** (`https://{us1|eu1}.platform.bird.com`, bearer
key `bk_{region}_…`) for e-mail, WhatsApp and SMS, and the **Expo Push API** for
the native apps, all behind one provider-neutral `ChannelAdapter` interface
driven by a database queue. **E-mail is the base channel** for every event (it is
also the durable receipt the consumer rules ask for): render Spanish HTML and text
in our own code and send it inline with `category: "transactional"`, an
`Idempotency-Key` and tracking switched off; Bird's stored templates are not
needed. **WhatsApp** is worth it only for the time-critical messages (out for
delivery, failed delivery, seller's new order): it needs the owner's own number
connected to a Meta WhatsApp Business Account, Spanish **utility** templates
approved by Meta (Bird's ready-made `bird_*` utility templates are English-only
and sent from a Bird-branded US number), and an explicit opt-in; to Costa Rica it costs
**US$0.0163 per utility message** (Bird US$0.0050 + Meta US$0.0113) against
**US$0.10 per SMS segment**, and an alphanumeric SMS sender is overwritten by the
carriers, so SMS is a last-resort fallback only. **Supabase Auth e-mails**
(confirmation, recovery, e-mail change) should go through the **Send Email Hook**
to an Edge Function that uses the same renderer and the same Bird adapter, with
Bird's SMTP relay (`us1.smtp.bird.com`, user `bird`, password = API key)
configured as the standby that takes over when the hook is switched off. The
existing `private.outbox_events` table is a good event log but cannot be the
delivery queue as it stands (one `processed_at` for several consumers, no
back-off, no lease, no dedupe): add a per-consumer job row written by a trigger,
a SQL planner that turns an event into one **delivery row per recipient and
channel**, and a worker that claims deliveries with `FOR UPDATE SKIP LOCKED` plus
a lease, retries with exponential back-off inside Bird's 3-hour idempotency
window (with a new key after any retained `4xx` such as `402`), dead-letters, and keeps per-order FIFO. Trigger it with `pg_net` (kick on
insert) plus `pg_cron` (sweep), and keep all logic in a Node-testable package
with a thin Deno entry file. On this note's reading of the Costa Rican texts
(a lawyer must confirm it), the order, delivery, refund and account messages are
not "venta directa" and need no marketing consent; anything promotional needs
prior express consent, a free and immediate opt-out and a clearly identified
sender (Ley 8642 art. 44, Decreto 35205 arts. 31–32, Decreto 37899 art. 200,
Ley 8968 art. 5).

---

## 0. What the database records today

### 0.1 The outbox table

`supabase/migrations/20261121080600_orders.sql:217-234`:

```sql
create table private.outbox_events (
  id bigint generated always as identity primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts smallint not null default 0,
  last_error text
);
create index outbox_unprocessed_idx on private.outbox_events (id) where processed_at is null;
-- private.emit(p_topic text, p_payload jsonb): security definer, plain insert
```

Nothing reads it (`docs/02-architecture/decisions.md:344-360`, decision 12). The
`authenticated` role cannot select it (`supabase/tests/020_access.sql:538`).
`pg_cron` is already used, guarded for environments without it
(`supabase/migrations/20261121081300_moderation.sql:176-190`).

### 0.2 Every topic emitted today

17 call sites, 16 distinct topics. Payloads carry ids only, never personal data.

| Topic | Payload fields | Emitted by | File:line |
| --- | --- | --- | --- |
| `order.placed` | `order_id` | `public.place_order` | `…081000_checkout.sql:431` |
| `order.released` | `order_id` | `private.release_order_to_fulfillment` (after payment, or at once for cash on delivery) | `…081000_checkout.sql:41` |
| `payment.captured` | `order_id` | `private.capture_payment` | `…081000_checkout.sql:88` |
| `invoice.requested` | `order_id` | `private.capture_payment` | `…081000_checkout.sql:90` |
| `order.cancelled` | `order_id`, `reason` | `private.cancel_order_internal` | `…081000_checkout.sql:153` |
| `refund.requested` | `order_id` | `private.cancel_order_internal` (only outside sandbox mode, lines 136-146) | `…081000_checkout.sql:145` |
| `refund.requested` | `order_id`, `return_request_id`, `amount_minor` | `public.ops_complete_return` | `…081700_api_backoffice.sql:248` |
| `shipment.delivered` | `shipment_id` | `public.driver_complete_stop` | `…081100_fulfillment.sql:497` |
| `shipment.delivery_failed` | `shipment_id`, `reason` | `public.driver_fail_stop` | `…081100_fulfillment.sql:542` |
| `return.requested` | `return_request_id` | `public.request_return` | `…080900_trust.sql:180` |
| `return.decided` | `return_request_id`, `approved` | `public.ops_decide_return` | `…081700_api_backoffice.sql:167` |
| `complaint.filed` | `complaint_id` | `public.file_complaint` | `…081500_api_shopper.sql:609` |
| `complaint.answered` | `complaint_id`, `closed` | `public.ops_resolve_complaint` | `…081700_api_backoffice.sql:284` |
| `content.reported` | `report_id` | `public.report_content` | `…081500_api_shopper.sql:639` |
| `report.resolved` | `report_id`, `actioned` | `public.ops_resolve_report` | `…081700_api_backoffice.sql:329` |
| `product.reviewed` | `product_id`, `approved` | `public.ops_review_product` | `…081300_moderation.sql:72` |
| `seller.status_changed` | `seller_id`, `status`, `note` | `public.ops_set_seller_status` | `…081300_moderation.sql:114` |

Gotchas for the consumer:

- `refund.requested` has **two payload shapes**. Treat `return_request_id` and
  `amount_minor` as optional.
- In sandbox mode a cancellation refunds in the books and emits **no**
  `refund.requested` (`…081000_checkout.sql:136-142`).

### 0.3 Events the requested notifications need and nothing emits

| Needed for | Missing event (proposed name and payload) | Where to emit |
| --- | --- | --- |
| "Shipped" (parcel planned on a route; the playbook says shoppers are told the evening before, `docs/06-operations/logistics-playbook.md:106`) | `shipment.scheduled` `{shipment_id, route_id}` | `public.ops_create_route`, where the shipment becomes `ready_for_dispatch` (`…081100_fulfillment.sql:322-323`) |
| "Out for delivery" | `shipment.out_for_delivery` `{shipment_id, route_id}` | `public.driver_start_route`, inside the loop that sets `out_for_delivery` (`…081100_fulfillment.sql:406`) |
| "Refund paid" | `refund.completed` `{order_id, amount_minor, return_request_id?}` | wherever the gateway refund is confirmed (payment-gateway task); in sandbox mode next to `private.post_order_refund` (`…081000_checkout.sql:141`) |
| Driver "route assigned" push | `route.assigned` `{route_id, driver_id}` | `public.ops_assign_route` (`…081100_fulfillment.sql:331`) |
| Password reset, e-mail confirmation, e-mail change | none: these come from Supabase Auth, not from the outbox | section 3 |

"Seller: new order" needs no new event: derive it from `order.released` (one
delivery per seller that has lines in the order). "Listing approved/rejected" is
`product.reviewed`. "Payment received" is `payment.captured`.

---

## 1. Bird e-mail

All of this is Bird's current platform API. It is **not** the older
`api.bird.com/workspaces/{id}/channels/…` API that older tutorials describe.

### 1.1 Basics

| Item | Value | Source |
| --- | --- | --- |
| Base URL | `https://us1.platform.bird.com` or `https://eu1.platform.bird.com`; must match the key's region. Wrong host: `421` (`misdirected_error`) | [B2] [B14] |
| Auth header | `Authorization: Bearer bk_{region}_…` (workspace key). Missing/invalid `401`; missing scope `403` | [B2] [B14] |
| Key scopes | `{scope, level}` pairs, `write` includes `read`. Worker key: `emails:write`, `whatsapp:write`, `sms:write`. Add `webhooks:write`, `domains:write`, `email_management:write`, `whatsapp_management:read` only on a separate setup key. A key cannot create keys | [B14] |
| Key handling | shown once at creation; rotate with a 24-hour grace period; a rotated key cannot be rotated again | [B14] |
| Send one e-mail | `POST /v1/email/messages` → `202 Accepted`, body has `id` (`em_…`) and `status: "accepted"` | [B1] [B2] |
| Send up to 100 | `POST /v1/email/batches`, validated all-or-nothing | [B1] |
| Read state | `GET /v1/email/messages/{id}`, `…/{id}/recipients`, `…/{id}/events`; list filter `?reference=` (exact) | [B1] [B6] |
| Error envelope | `{"error":{"type":"rate_limit_error","code":"E01003","name":"RateLimited","message":"…","doc_url":"…","request_id":"req_…"}}`; branch on `type`/`code`, not on `message` | [B9] |
| TypeScript SDK | `@messagebird/sdk` (`new BirdClient({ apiKey })`); not installed in this repo. Plain `fetch` is enough and keeps the adapter runnable under Deno and Node | [B14]; version **UNVERIFIED** |

### 1.2 Request

```http
POST /v1/email/messages HTTP/1.1
Host: us1.platform.bird.com
Authorization: Bearer bk_us1_REDACTED
Content-Type: application/json
Idempotency-Key: yt/prod/7b0c…-delivery-uuid/0
```

```json
{
  "from": { "email": "pedidos@<SENDING_DOMAIN>", "name": "Yuntera" },
  "to": [{ "email": "<recipient>", "name": "<name>" }],
  "reply_to": ["ayuda@<ROOT_DOMAIN>"],
  "subject": "Recibimos su pedido YT-000123",
  "html": "<!doctype html>…",
  "text": "Recibimos su pedido YT-000123…",
  "category": "transactional",
  "track_opens": false,
  "track_clicks": false,
  "tags": [{ "name": "template", "value": "order_placed" }, { "name": "env", "value": "prod" }],
  "metadata": { "delivery_id": "7b0c…", "topic": "order.placed" },
  "reference": "7b0c…"
}
```

| Field | Rules that bite | Source |
| --- | --- | --- |
| `from` | string, RFC 5322 mailbox string, or `{email, name}`; must be on a domain verified in this workspace (else `422`) | [B1] [B2] |
| `to`, `cc`, `bcc` | 1–50 `to`; up to 50 each for the others. **Billing is per recipient** | [B1] |
| `subject` | required for inline sends, ≤ 998 chars | [B1] |
| `html`, `text` | at least one, each ≤ 524,288 chars; send both | [B1] |
| `category` | `transactional` or `marketing`. **Default is `marketing`** when there is no template: an order e-mail sent without it gets an unsubscribe link and is blocked by a newsletter opt-out | [B1] [B11] |
| `parameters` | **omit it.** If present (even `{}`), subject and body are processed as Liquid and `{{ … }}` in our content is interpreted | [B1] [B2] |
| `track_opens`, `track_clicks` | default `true`; click tracking rewrites links. Turn both off for transactional and auth mail (links carry one-time token hashes) | [B1] |
| `tags` | ≤ 20, name ≤ 32, value ≤ 64, only `[A-Za-z0-9_-]`. A dotted topic such as `order.placed` is **not** a legal value; use `order_placed`. Names starting `__bird` rejected | [B1] |
| `metadata` | JSON ≤ 2 KB, echoed on webhooks. Put `delivery_id` here. No personal data | [B1] [B6] |
| `reference` | 1–255 chars, exact-match filter on the message list; use the delivery id for reconciliation | [B1] |
| `headers` | ≤ 25 custom headers; transactional sends may set `List-Unsubscribe`; `From`, `Return-Path`, `DKIM-Signature` etc. are refused | [B1] |
| `attachments` | ≤ 20, base64, whole message ≤ 20 MB (keep raw files ≤ 15 MB) | [B1] [B2] |
| `scheduled_at` | 30 s to 30 days ahead; counts against a plan allowance | [B2] |
| Recipient domains | `example.com/.net/.org/.edu`, `test.com` and the TLDs `.test`, `.example`, `.invalid`, `.localhost` are rejected with `422`. **The seed accounts are `…@yuntera.example`**, so a worker pointed at Bird with seed data fails every send permanently | [B1]; `supabase/seed*` |

What `202` means: durably accepted, delivery is asynchronous. Fixable problems
come back at once as `422`. A suppressed recipient still returns `202` and
later shows as `rejected` / `recipient_suppressed`. A read right after the `202`
can briefly return `404` [B1] [B2].

### 1.3 Idempotency

| Rule | Value | Source |
| --- | --- | --- |
| Header | `Idempotency-Key`, any non-empty string ≤ 255 chars; recommended `<event-type>/<entity-id>` | [B3] |
| Scope and retention | per workspace; completed response kept **3 hours** | [B3] |
| Replay | same key and identical request → original status and body, plus `Idempotency-Replay: true` | [B3] |
| Different body, same key | `409 E01005 IdempotencyKeyReuse`. The comparison covers method, path, query and the **raw body including JSON whitespace** | [B3] |
| Still in flight | `409 E01004 RequestInProgress`; lock expires within 30 s; retry same key | [B2] [B3] |
| Protection unavailable | `503 E01033 IdempotencyUnavailable`, attempt not executed; retry same key | [B3] |
| `5xx` | not retained; retry with the same key and body | [B3] |
| Retained `4xx` | a retained rejection is replayed for the same key, so **after fixing a `422` use a new key**. The guide does not limit this to `422`: a `402 WalletInsufficientBalance` retried with the same key after the wallet is topped up can come back as the replayed `402`. Whether a `429` is retained is not stated (**UNVERIFIED**; it is refused before execution, so probably not) | [B3] |

Consequences for our worker: freeze the exact request body text before the
first attempt and resend those bytes; keep the whole retry horizon under 3
hours; add a generation suffix to the key when a human requeues a dead message,
**and also when retrying after any `4xx` other than `409 E01004` and `429`**
(for example after a `402`, once the wallet is funded).

### 1.4 Sending domain and DNS

Register with `POST /v1/email/domains` `{ "domain": "<SENDING_DOMAIN>",
"return_path": {"name":"send"}, "tracking": {"name":"links"} }` or in
**Email > Domains**. The response carries the DKIM selector and a `dns_records`
array with exact `name`, `host`, `value` to copy [B4].

| Record | Type | Host | Value | Needed to send | Source |
| --- | --- | --- | --- | --- | --- |
| DKIM | TXT | `<selector>._domainkey.<SENDING_DOMAIN>` | `v=DKIM1; k=rsa; p=<public-key>` (per organisation; copy, never construct) | yes | [B4] [B5] |
| Return-path | CNAME | `send.<SENDING_DOMAIN>` | `<region>.bounce.bird.com` (copy from dashboard) | yes | [B4] [B5] |
| DMARC | TXT | `_dmarc.<SENDING_DOMAIN>` (a record on the parent domain also counts) | any valid `v=DMARC1` policy; Bird suggests `v=DMARC1; p=none; rua=mailto:dmarc-agg@dmarc.bird.com;` | yes | [B4] [B5] |
| Tracking | CNAME | `links.<SENDING_DOMAIN>` | `<region>.links.bird.com` | no (only for branded open/click tracking) | [B5] |
| Inbound MX | MX | sending domain | Bird's MX | **no; do not publish** unless receiving through Bird: on a domain that already has mailboxes it reroutes their mail | [B4] |
| SPF | — | — | **No SPF record is needed at the apex.** SPF is checked against the return-path host, which the CNAME covers. An `include:` at the apex does nothing for Bird | no | [B5] |

Other facts: use a dedicated subdomain, not the apex [B4]. The send gate is
`capabilities.sending`, verified only when DKIM, return-path CNAME and DMARC are
all in place; `status` alone only reflects DKIM [B4]. Checks are automatic
(minutes after propagation; `POST /v1/email/domains/{id}/verify` forces one); a
domain left unverified for about 14 days is removed [B4]. A verified record that
breaks is downgraded only after 24 hours of failing checks [B4]. Domain state is
per region [B4]. Sending-domain allowance: 1 on the Free e-mail plan, 10 on
Startup [P1].

### 1.5 Templates: render ourselves

Bird has stored templates (`/v1/email/templates`, slug, draft/published
versions, up to 25 languages, Liquid, `template: {slug, parameters, language}`
on the send) [B12]. **Recommendation: do not use them for transactional mail.**

| Concern | Bird stored template | Our own renderer (recommended) |
| --- | --- | --- |
| Versioning | draft → `submit` → numbered version, by API or dashboard [B12] | in git with the code; reviewed and tested like code |
| Formatting money and dates | `money`, `format_date`, `format_time` filters are rejected at publish [B12] | `packages/core` already formats colones and dates |
| Variables | flat single-word names only; a missing one is a `422` at send time [B12] | typed function arguments; a missing one fails `tsc` |
| Local development | needs the provider | renders to a string; a dev adapter can store it |
| Same template for Auth mail | not reachable from Supabase SMTP | the Send Email Hook calls the same function |
| Provider lock-in | high | none |
| Idempotent retries | fine | fine, provided the rendered body is frozen (1.3) |

Provider-side templates are unavoidable only for WhatsApp (section 2).

### 1.6 Webhooks

Bird follows the **Standard Webhooks** specification [B6]. This is the same
scheme Supabase Auth uses for HTTP hooks [S2], so one verifier serves both.

| Item | Value | Source |
| --- | --- | --- |
| Create | dashboard **Platform tools > Webhooks**, or `POST /v1/webhooks` `{url, events[], description}` (scope `webhooks:write`) | [B6] |
| URL | HTTPS, ≤ 2048 chars, publicly reachable | [B6] |
| Events | explicit list, ≤ 100 types, **no wildcards**, new types are not auto-subscribed | [B6] |
| Secret | `whsec_<base64>`, returned **once** in the create response | [B6] |
| Headers | `webhook-id` (same on retries and replays), `webhook-timestamp` (Unix seconds of this attempt), `webhook-signature` (`v1,<base64>`; several, space-separated, during rotation) | [B6] |
| **Signature** | `base64( HMAC-SHA256( key, "{webhook-id}.{webhook-timestamp}.{raw body}" ) )`, where `key` = base64-decode of the secret **after removing `whsec_`** | [B6] |
| Checks we must do | constant-time compare against every `v1,` entry; reject if timestamp is more than 5 minutes off; dedupe on `webhook-id` (delivery is at-least-once) | [B6] |
| Body | one event per POST, JSON `{type, timestamp, data}`; verify over the raw bytes, never re-serialised JSON | [B6] |
| Our response | any `2xx` within **15 s** = success. A non-2xx is retried; there is no status that stops retries | [B6] |
| Retry schedule | 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h (±20 %): 8 attempts over about 27.5 h; honours `Retry-After` up to twice the scheduled delay | [B6] |
| Ordering | **not ordered**; sort by the payload `timestamp` | [B6] |
| Operations | `POST /v1/webhooks/{id}/test`; `…/replay` (failed deliveries only, 3-day log, 20 per day); `…/rotate-secret` (both secrets sign for 24 h, max 5); auto-pause after about 5 days of continuous failure | [B6] |
| Endpoint allowance | 3 on Free and Startup plans (allowances of several product plans add up) | [B13] [P1] |

E-mail event types [B7]: `email.accepted`, `email.processed`, `email.delivered`,
`email.deferred`, `email.bounced`, `email.out_of_band_bounce`, `email.rejected`,
`email.complained`, `email.opened`, `email.clicked`, `email.unsubscribed`,
`email.list_unsubscribed`, `email.scheduled`, `email.canceled`, `email.received`;
plus `email_suppression.created` [B10] and the cross-channel `preference.granted`,
`preference.revoked`, `preference.deleted` [B6].

```json
{
  "type": "email.bounced",
  "timestamp": "2026-07-23T14:51:47.107Z",
  "data": {
    "email_id": "em_01…", "recipient_id": "er_01…", "workspace_id": "ws_01…",
    "recipient": "<address>", "recipient_role": "to",
    "tags": [{ "name": "template", "value": "order_placed" }],
    "metadata": { "delivery_id": "7b0c…" },
    "broadcast_id": null, "brand_id": null,
    "bounce_type": "hard", "bounce_class": 10, "bounce_code": "550",
    "bounce_description": "…", "sending_ip": "…"
  }
}
```

| Event | Extra `data` fields | What we do |
| --- | --- | --- |
| `email.delivered` | none | delivery → `delivered` (accepted by the receiving server, not "in inbox") |
| `email.deferred` | `bounce_type`, `bounce_class`, `defer_reason`, `sending_ip` | nothing; Bird retries |
| `email.bounced`, `email.out_of_band_bounce` | `bounce_type` (`hard`, `soft`, `block`, `admin`, `undetermined`), `bounce_class`, `bounce_code`, `bounce_description` | delivery → `bounced`; on `hard` flag the account's address as undeliverable and fall back to WhatsApp/push. An out-of-band bounce can arrive **after** `delivered` |
| `email.rejected` | `rejection_reason`: `recipient_suppressed`, `transmission_failed`, `generation_failure`, `policy_rejection`, `domain_unverified`, `quota_exceeded`, `recipient_not_allowed`, `workspace_suspended` (list grows) | delivery → `failed`; `quota_exceeded`, `domain_unverified`, `workspace_suspended` raise a staff alert |
| `email.complained` | `feedback_type` | record; never send marketing to this address again |
| `email.unsubscribed`, `email.list_unsubscribed` | none; `tags`/`metadata` may be null | set `marketing_opt_in = false`, stamp the consent row revoked |
| `email_suppression.created` | `email`, `reason`, `suppression_id` | mirror |

Bounce classes: `10`, `30` hard; `20–24`, `40`, `70`, `100` soft; `25` admin;
`50–54` block; `1` and anything else undetermined [B7].

### 1.7 Suppression

| Reason | Added by | Blocks marketing | Blocks transactional | Removable by API key |
| --- | --- | --- | --- | --- |
| `hard_bounce` | automatically on a hard bounce | yes | **yes** | yes |
| `complaint` | automatically on a spam complaint | yes | no | **no** (dashboard only; `422 SuppressionNotRemovableByAPIKey`) |
| `manual` | us (`POST /v1/email/suppressions {email}`; idempotent, `201` or `200`) | yes | **yes** | yes |

Source [B10]. A complaint that Bird can attribute to a Brand does **not** create
a `complaint` suppression: it records a revoked preference (`origin: complaint`)
for that Brand, fires `preference.revoked` and **no** `email_suppression.created`.
Only unattributed complaints land in the table above [B7] [B10]. Unsubscribes are stored as **preferences**, not suppressions; an
opt-out recorded with coverage "all messages" blocks transactional mail too
[B10] [B11]. Look up with `GET /v1/email/suppressions?email=` (prefix match:
compare the full address yourself); addresses never go in a URL path [B10].
Suppression removals have **no webhook**: reconcile the list periodically [B10].
Sandbox addresses for tests: `delivered@`, `bounce@`, `complaint@`,
`suppressed@messagebird.dev`; they run through the real event and webhook
pipeline and write nothing to the suppression list [B10] [B18].

### 1.8 Rate limits

One limit per organisation and region for each named policy, shared by all keys
and workspaces. E-mail sends use `email_send`; batches use `email_batch` (one
unit per request, whatever the recipient count); SMTP `DATA` shares `email_send`
[B9].

```text
RateLimit-Policy: "email_send";q=1000;w=60     # quota per window (seconds)
RateLimit: "email_send";r=842;t=35             # remaining, seconds to reset
```

On exhaustion: `429` with `Retry-After` (seconds) and `error.type =
"rate_limit_error"`. The limiter fails open [B9]. Published values [P1] [P2]:

| Plan | Monthly deposit | `email_send` | `email_batch` | Notes |
| --- | --- | --- | --- | --- |
| E-mail Free | none | 10 / min | 5 / min | 1,000 e-mails/month, **50/day**, no overage |
| E-mail Startup | US$15 | 30 / min | 10 / min | US$0.40 per 1,000 |
| E-mail Growth | US$250 | 100 / min | 30 / min | US$0.45 per 1,000; dedicated IPs possible |

| Product plan | Monthly deposit | Send API | Source |
| --- | --- | --- | --- |
| WhatsApp pay-as-you-go | none | `whatsapp_send` 10 / min | [P4] |
| WhatsApp Startup | US$15 | 60 / min | [P4] |
| WhatsApp Growth | US$100 | 2,400 / min | [P4] |
| SMS pay-as-you-go | none | `sms_send` 60 / min | [P2] |
| SMS Startup | US$15 | 120 / min | [P2] |

At 10 WhatsApp sends per minute on pay-as-you-go, a 60-stop route start takes
six minutes to notify; the worker must pace itself per channel from the
`RateLimit` header and the US$15 WhatsApp plan is worth having. The response
headers are authoritative; read them rather than hard-coding.

### 1.9 Pricing model

- Every organisation has an e-mail plan. **Free: 1,000 e-mails per month, capped
  at 50 per day (reset midnight UTC), no overage**: sends are rejected at the cap
  [B13]. With 3 to 5 e-mails per order plus seller copies this covers about ten
  orders a day.
- Paid e-mail plans are **funding plans**: the monthly payment becomes wallet
  balance, spendable on any Bird product, unused balance carries over, every
  e-mail is charged from the wallet at the plan's rate per 1,000, and sending
  stops when the wallet is empty [B13].
- SMS, WhatsApp and voice are pay-as-you-go from the same wallet; a WhatsApp
  message is charged twice (Bird's fee at processing, Meta's share on delivery)
  [B13] [B15].
- Figures on 21 Nov 2026 [P1]: Startup US$15 deposit and US$0.40 per 1,000
  (about 37,500 e-mails from the deposit); Growth US$250 and US$0.45; Scale from
  US$1,000 and US$0.35.

### 1.10 SMTP relay (used by Supabase Auth, section 3)

| Item | Value |
| --- | --- |
| Host | `us1.smtp.bird.com` or `eu1.smtp.bird.com` (must match the key's region; wrong region → `535`) |
| Ports | `465` implicit TLS, `587` STARTTLS, `2525` STARTTLS. Port 25 not offered. TLS 1.2+ |
| Auth | `AUTH PLAIN` or `LOGIN`; username is the literal `bird`; password is an API key with the `emails` scope |
| From | `MAIL FROM` and the `From` header must be on a verified domain |
| Category, tags, tracking, IP pool | come from the **key's SMTP configuration** (**Email > SMTP**). An unconfigured key sends as `transactional` with **tracking enabled**: turn tracking off for the Auth key |
| Limits | ≤ 50 recipients, 20 MB; 10 concurrent connections per organisation by default (Free), 20 on Startup |
| Idempotency | header `X-Bird-Idempotency-Key` in the message |
| Replies | `250 2.0.0 Ok: queued as em_…`; `550` permanent (unverified domain, reserved recipient domain); `452` transient (quota, wallet, rate limit) |

Source [B8] [P1].

---

## 2. Bird WhatsApp and SMS

### 2.1 WhatsApp prerequisites

| Step | Who | Detail | Source |
| --- | --- | --- | --- |
| Meta business portfolio | owner | created or selected inside Meta's Embedded Signup, opened from Bird's **WhatsApp > Numbers** page | [B16] [B17] |
| A phone number | owner | three paths: a dedicated number bought from Bird and allocated to the workspace (Bird receives Meta's code); **a number from another provider ("I have my own number", Meta sends the code by SMS or voice)**; or an existing WhatsApp Business app number through **coexistence**. A number on personal WhatsApp either moves to the WhatsApp Business app and then connects by coexistence, or has its WhatsApp account deleted (wait up to three minutes) before connecting; coexistence cannot take a personal-app number directly. Connecting a number to WhatsApp carries no extra Bird charge; a number bought from Bird is still a paid number subscription | [B17] [B19] |
| WhatsApp Business Account (WABA) | created in the same flow | templates live on the WABA; `from` must be a number on the same WABA as the template (`422 E15023 WhatsAppSenderWABAMismatch` otherwise; a number the workspace cannot send from is `422 WhatsAppSenderNotFound`) | [B15] [B23] |
| Business verification (Meta) | owner | **not** required to author utility or marketing templates; required to author authentication templates. It raises the limits: an unverified portfolio is limited to 2 numbers and 250 unique customers per 24 h for business-initiated messages, scaling to 2,000; Meta's decision can come within minutes or take up to 14 business days | [B20] [B21] [B24] |
| Templates approved by Meta | us | every business-initiated message outside the 24-hour window must be an approved template | [B15] [B22] |
| Opt-in | us | section 2.5 | [B19] [M1] |
| Wallet balance | owner | a send the wallet cannot cover returns `402 WalletInsufficientBalance` | [B15] |

Whether Bird can allocate a Costa Rican (+506) number, and which +506 number
types Meta accepts, is **UNVERIFIED**; the documented fallback is the owner's own
number from a local operator.

**Bird's ready-made templates do not fit.** The managed catalog (`bird_…`, for
example `bird_order_confirmation`, `bird_delivery_update`) needs no number or
approval, but every managed utility template is registered **in English only**
(`on_missing_language: fail`), is sent from the shared "Bird Notify" sender (a
US number showing Bird's name), cannot receive replies and cannot send free-form
messages [B19] [B23] [B25]. Useful for a smoke test, not for Spanish-speaking
shoppers.

Coexistence matters here because the support plan is a published WhatsApp
Business number (`docs/06-operations/customer-service.md:18`): a coexistence
number keeps working in the app, is limited to 20 messages per second through
the API, and its profile is editable only in the app [B26]. A separate
"notifications" number avoids mixing automated traffic with support chats.

### 2.2 Template categories and review

| Category | Use | Our messages | Notes |
| --- | --- | --- | --- |
| `utility` | follows up something the recipient did: order, payment, delivery, account notice | all order, delivery, refund, return, seller-order messages | must be non-promotional and specific; "an order confirmation with an added discount or upsell is marketing"; a survey tied to a completed order can be utility [B20] |
| `authentication` | one-time codes, Meta's preset wording, copy-code button | phone verification, if ever done over WhatsApp | authoring needs a verified business; Bird's `bird_otp` works without [B22] |
| `marketing` | offers, announcements, general feedback requests | none at launch | sent from our own WABA only [B22] |

Rules that cause rejections or surprises [B20] [B21] [B23] [B27]:

- Category is fixed at creation; the slug (lowercase letters, digits,
  underscores; `bird_` reserved) is fixed after the first submission.
- **Meta can re-categorise a utility template as marketing**, and the message
  keeps sending at the marketing price. Price follows Meta's category per
  language.
- Limits: body 1,024 chars; text header 60 (one variable); footer 60 (no
  variables); button label 25; URL button one variable at the end of the URL.
- Named variables (`{{order_number}}`, lowercase, digits, underscores) for
  utility and marketing; never start or end the body with a variable; every
  variable needs a sample value; too many variables for too little text is
  rejected.
- Approval is per language and asynchronous: `pending`, `approved`, `rejected`,
  `submit_failed`, `paused`, `disabled`, `limit_exceeded`, `in_appeal`. A send
  can only use a language listed in `available_languages`, and only from the
  template's `live_version_id`. No guaranteed review time.
- Per-language time to live (`message_send_ttl_seconds`): utility 30 s to 12 h;
  **if it is not set, utility defaults to 30 days**. It counts from the hand-off
  to Meta. Set a short one on "out for delivery" so a late message is dropped;
  changing only the TTL needs no new review.
- The language tag for Spanish (`es` versus a regional code) should be read from
  the template editor; which Spanish codes are offered is **UNVERIFIED**.

### 2.3 Sending a template

`POST /v1/whatsapp/messages`, one recipient per request, no batch endpoint,
`202` with `id` (`wam_…`) and `status: "accepted"` [B15].

```http
POST /v1/whatsapp/messages
Authorization: Bearer bk_us1_REDACTED
Content-Type: application/json
Idempotency-Key: yt/prod/<delivery-uuid>/0
```

```json
{
  "to": "+506XXXXXXXX",
  "from": "+506YYYYYYYY",
  "template": {
    "slug": "shipment_out_for_delivery",
    "language": "es",
    "parameters": {
      "first_name": "Ana",
      "order_number": "YT-000123",
      "window": "entre 1 p. m. y 5 p. m.",
      "button_url": "YT-000123"
    }
  },
  "tags": [{ "name": "template", "value": "shipment_out_for_delivery" }],
  "metadata": { "delivery_id": "7b0c…" },
  "reference": "7b0c…"
}
```

| Field | Rule | Source |
| --- | --- | --- |
| `to` | E.164; an impossible number is `422 WhatsAppInvalidRecipient` before any charge | [B15] |
| `from` | required for our own templates and for free-form messages (`422 WhatsAppSenderRequired`); must be **omitted** for `bird_` templates (`422 WhatsAppSenderNotAllowed`) | [B15] |
| `template.parameters` | one object keyed by variable name; `button_url` fills a URL button's numbered suffix (send the bare value, not the full URL); `header_url` for a media header; ≤ 16 KB; a missing required key is refused before any charge | [B15] [B23] |
| `template.components` | Meta's shape; **not** checked for parameter count on our own templates before charging. Prefer `parameters` | [B23] |
| `tags`, `metadata`, `reference` | same limits as e-mail; echoed on every webhook event | [B15] |
| Free-form (`text`, `image`, …) | only inside the 24-hour window and only from our own number | [B15] |
| Errors | `422` unknown slug/language, `WhatsAppTemplateParameterMismatch`, `E15044 WhatsAppServiceWindowClosed`; `402 WalletInsufficientBalance`; after acceptance `rejected` with `insufficient_balance`, `price_not_found` or `recipient_suppressed` | [B15] [B28] |
| Idempotency | same header and rules as e-mail | [B15] [B3] |

Status flow: `accepted` → `sent` (handed to WhatsApp) → `delivered` or `failed`;
`rejected` means it never reached WhatsApp; a read is a separate `read_at` and
`whatsapp.read` event, not a status [B15]. Cost is not in events: read
`GET /v1/whatsapp/messages/{id}` → `cost.transaction_amount` (Bird) and
`cost.passthrough_amount` (Meta) [B15].

### 2.4 The 24-hour customer service window

- Opens when the user messages or calls our number; lasts 24 hours; each new
  inbound message resets it. Nothing we send opens it [B29].
- Inside it: free-form "service" messages from our own number. Outside it: only
  an approved template. Bird refuses a free-form send into a closed window with
  `422 E15044`; if it closes between accept and dispatch the message fails with
  `service_window_expired` (Meta code `131047`) [B15] [B29] [B30].
- Bird's shared numbers never receive messages and carry templates only [B19].

### 2.5 Opt-in and opt-out

- Meta: "Businesses must clearly state that a person is opting in to receive
  communication from the business" and "must clearly state the business's name";
  the method is the business's choice; "Businesses must comply with applicable
  law" [M1]. Bird: opt-in is required "for anything you start"; Meta enforces
  after the fact through quality ratings and template pauses [B19].
- Opt-out: Bird ships a keyword catalogue on our own numbers. The worldwide set
  is `stop`, `stop all`, `stopall`, `unsubscribe`, `cancel`, `end`, `quit`,
  `revoke`, `optout`; `start` and `unstop` reverse it. Matching is on the whole
  message, ignoring case, accents and trailing punctuation, so "cancelar mi
  pedido" does not opt anyone out. Our own rule (`POST
  /v1/whatsapp/keyword-rules`, `operation: "opt_out"`, `keywords`, `reply`)
  adds keywords and a Spanish reply; it never removes Bird's unless
  `excluded_keywords` says so [B28] [B31]. Bird may hold a larger set per
  sender country; whether that set for `CR` already contains Spanish words such
  as `baja` is **UNVERIFIED** (it is readable with `GET
  /v1/whatsapp/keyword-rules?country=CR&scope=system`, not run here); add them
  as our own rule with `country: "CR"`.
- A blocked send is accepted and then fails asynchronously with
  `whatsapp.rejected`, `error.code: "recipient_suppressed"` [B28]. Opt-outs also
  arrive as `preference.revoked` with `channel: "whatsapp"` [B6].

### 2.6 Price to Costa Rica

Per outbound message, USD, read from Bird's public page for Costa Rica on
21 Nov 2026 [P3]:

| Category | Bird fee | Meta fee | Total |
| --- | --- | --- | --- |
| Utility | 0.0050 | 0.0113 | **0.0163** |
| Authentication | 0.0050 | 0.0113 | 0.0163 |
| Service (free-form inside the window) | 0.0050 | 0.0113 | 0.0163 |
| Marketing | 0.0050 | 0.074 | **0.079** |
| Authentication (international) | Contact sales | | |

Model [B15] [B32]: priced **per message**, by template category and recipient
country. Bird's fee is charged when the send is processed and is kept even if
delivery later fails; Meta's share is charged on the `delivered` or `read`
receipt. Inbound messages are free. **Since 1 October 2026** service messages
and utility templates sent inside an open window are charged too, with 1,000
free service messages per business number per month (confirmed on Meta's own
pricing pages, which also say Meta charges only for delivered messages) [M2]. Bird pays Meta on our
behalf from the wallet; no Meta payment method is needed. A Scale plan
discounts only Bird's fee [P4].

Three utility messages per order cost about US$0.05; the same three by SMS cost
at least US$0.30.

### 2.7 Delivery webhooks

Event types: `whatsapp.accepted`, `whatsapp.sent`, `whatsapp.delivered`,
`whatsapp.read`, `whatsapp.failed`, `whatsapp.rejected`, `whatsapp.received`
(inbound), `whatsapp.reacted` [B6] [B30]. Same envelope and signature as e-mail.

```json
{
  "type": "whatsapp.failed",
  "timestamp": "2026-07-23T14:51:40.201Z",
  "data": {
    "direction": "outbound",
    "whatsapp_id": "wam_01…", "workspace_id": "ws_01…",
    "from": { "phone_number": "+506YYYYYYYY" }, "to": { "phone_number": "+506XXXXXXXX" },
    "tags": null, "metadata": { "delivery_id": "7b0c…" },
    "error": { "code": "service_window_expired", "description": "…",
               "meta_error_code": "131047", "occurred_at": "2026-07-23T14:51:40.201Z" }
  }
}
```

### 2.8 SMS to Costa Rica (+506)

| Item | Finding | Source |
| --- | --- | --- |
| Endpoint | `POST /v1/sms/messages` `{to, from, text, category}`; `category` is required: `transactional`, `marketing`, `authentication`, `service`. Batch: `POST /v1/sms/batches` (≤ 100) | [B33] |
| Destination allowlist | the workspace starts with an **empty** country allowlist (the organisation's home country is added automatically); a send elsewhere is `422 SMSDestinationNotEnabled`. Enable Costa Rica under **SMS > Destinations** and set a daily spend limit there. A sending key cannot change either | [B33] |
| **Alphanumeric sender ID** (`Yuntera`, 3–11 chars) | accepted by the API, but for Costa Rica "registration is unavailable and the sender ID is overwritten with another sender ID" (a short or long code). **One-way only.** The shopper will not see our name | [P5] [P6] |
| Short code | sender ID preserved, two-way, no registration; short codes are allocated by Bird, not self-service | [P5] [P6] [B34] |
| Long code | not listed for Costa Rica | [P5] [P6] |
| Registration | none required; no template pre-approval | [P5] [P6] |
| Content rules | "Political, adult, gambling traffic is prohibited"; "Mobile operators do not allow promotional messages from other operators to be delivered to their subscribers"; quiet hours "apply" but the window is not stated | [P6] |
| Price | **US$0.10 per segment** outbound (alphanumeric or short code); US$0.0010 inbound on a short code; no carrier fee listed | [P5] |
| Segments | 160 chars (GSM-7) or 70 (UCS-2) per single segment; capped at 12 segments; `options.smart_encoding` swaps typographic characters only | [B33] |
| Spanish accents | Bird's character-limits page confirms `á`, `í`, `ú` force UCS-2 (70 chars per single segment, 67 per part) and `é` does not [B38]. `ó` outside and `ñ`, `¿`, `¡` inside GSM-7 come from the GSM 03.38 alphabet, not opened today (**UNVERIFIED**). Write SMS copy without `á í ó ú` or budget two segments; the response's `segments.encoding` (`GSM_7BIT` or `UCS2`) shows what was billed | [B38] |
| Events | `sms.accepted`, `sms.sent`, `sms.delivered`, `sms.undelivered`, `sms.failed`, `sms.rejected`, `sms.expired`; failures carry `error {code, description, carrier_error_code, occurred_at}`. Also `sms.received` (inbound) and `sms_suppression.created`: a `STOP` reply suppresses only that sender-and-subscriber pair | [B35] |
| Not supported | `scheduled_at` and several other fields return `422 SMSUnsupportedFeature` | [B33] |

Conclusion: SMS to Costa Rica is six times the price of a WhatsApp utility
message and unbranded. Keep it for phone verification codes and as a fallback
for "out for delivery" / "delivery failed" when the shopper has neither WhatsApp
opt-in nor a push token. Delivery quality per operator is **UNVERIFIED**.

---

## 3. Supabase Auth e-mails through the same provider

Background that still applies (already researched in
`docs/research/supabase-auth-storage-wire-format.md`): the built-in mailer only
reaches organisation members at 2 messages per hour; use token-hash links
(`…/auth/confirm?token_hash=…&type=…` then `verifyOtp`); build links from the
redirect URL because the four apps live on different hosts.

### 3.1 The two mechanisms

| | Custom SMTP | Send Email Hook |
| --- | --- | --- |
| What it is | Auth sends its own Go-template e-mails through an SMTP server | Auth calls **our** endpoint with the token; we send the e-mail |
| Bird side | SMTP relay, section 1.10 | `POST /v1/email/messages`, section 1.2 |
| Templates | Supabase's (dashboard, `config.toml`, Management API); a second template system | **our renderer**, same as order e-mails |
| Code to write | none | one Edge Function |
| Failure mode | Auth reports `over_email_send_rate_limit` or an SMTP error | our status code decides (below) |
| Plans | all | Free and Pro [S2] |

They are mutually exclusive at run time [S1]:

| E-mail provider | Send Email Hook | Result |
| --- | --- | --- |
| Enabled | Enabled | hook sends; **SMTP not used** |
| Enabled | Disabled | SMTP sends (custom if configured) |
| Disabled | any | e-mail sign-ups disabled |

**Recommendation.** Configure both. Day one: Bird SMTP, so password reset and
confirmation work with no code. Then enable the hook so Auth mail uses our
renderer and adapter. If the hook function breaks, disabling the hook falls back
to SMTP at once.

### 3.2 Custom SMTP settings

Dashboard **Authentication > SMTP**, or the Management API [S3]:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{ "external_email_enabled": true, "mailer_autoconfirm": false,
        "mailer_secure_email_change_enabled": true,
        "smtp_admin_email": "cuenta@<SENDING_DOMAIN>", "smtp_sender_name": "Yuntera",
        "smtp_host": "us1.smtp.bird.com", "smtp_port": 587,
        "smtp_user": "bird", "smtp_pass": "<Bird key with emails:write>" }'
```

- After custom SMTP is saved, Auth sends to any address but starts at **30
  messages per hour**; raise it on the Rate Limits page [S3].
- Supabase's own advice: separate Auth mail from marketing mail (domain and From
  address), keep Auth templates plain, and set DKIM/DMARC/SPF [S3].
- Use a dedicated Bird key for this, with its SMTP configuration set to
  `transactional` and tracking **off** (section 1.10).
- Edge Functions cannot open ports 25 or 587 [S4]; that affects our functions,
  not the Auth server. From an Edge Function always use Bird's HTTP API.

### 3.3 Send Email Hook contract

| Item | Value | Source |
| --- | --- | --- |
| Configure | dashboard **Authentication > Hooks**; locally `[auth.hook.send_email] enabled = true`, `uri = "https://<ref>.supabase.co/functions/v1/auth-email"`, `secrets = "env(SEND_EMAIL_HOOK_SECRETS)"` | [S1] [S2] |
| Kinds | HTTP endpoint, or a Postgres function `pg-functions://postgres/<schema>/<fn>` taking and returning `jsonb` | [S2] |
| Signature | Standard Webhooks: headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; secret format `v1,whsec_<base64>` (strip `v1,whsec_` before use) | [S2] |
| Edge Function | deploy with `--no-verify-jwt` / `verify_jwt = false`: the hook runs before any JWT exists; the signature is the authentication | [S1] [S2] |
| Payload limit | 20 KB, sent uncompressed | [S2] |
| Success | `200` (also `202`, `204`) with `Content-Type: application/json`; an empty `{}` body is enough | [S1] [S2] |
| Errors | body `{"error":{"http_code":<n>,"message":"…"}}`. `429` or `503` **with a non-empty `retry-after` header** are retried up to 3 times with a 2 s back-off; `400`/`403` become a 500 to the user. **Total time budget 5 s including retries** | [S2] |
| Postgres-function hooks | errors are not retryable; run inside a short transaction | [S2] |

Payload [S1]:

```json
{
  "user": { "id": "…", "email": "<current address>", "new_email": "<only on change>",
            "user_metadata": { }, "app_metadata": { } },
  "email_data": {
    "token": "305805",
    "token_hash": "7d5b7b19…",
    "redirect_to": "https://<app host>/auth/confirm",
    "email_action_type": "signup",
    "site_url": "https://<site>",
    "token_new": "", "token_hash_new": "",
    "old_email": "", "old_phone": "", "provider": "", "factor_type": ""
  }
}
```

`email_action_type` values [S1]: `signup`, `invite`, `magiclink`, `recovery`,
`email_change`, `email`, `reauthentication`, and the notices
`password_changed_notification`, `email_changed_notification`,
`phone_changed_notification`, `identity_linked_notification`,
`identity_unlinked_notification`, `mfa_factor_enrolled_notification`,
`mfa_factor_unenrolled_notification`. Handle unknown values with a generic
notice and a `200`, never an error, or a new Auth release can break sign-in.

**E-mail change, the trap** [S1]. With Secure Email Change on, two e-mails must
be sent and the field names are reversed:

| Send to | Code | Hash for the link |
| --- | --- | --- |
| current address (`user.email`) | `token` | `token_hash_new` |
| new address (`user.new_email`) | `token_new` | `token_hash` |

With it off, one e-mail goes to the new address using `token_hash`.

Link to put in the e-mail (token-hash flow, see the other note §1):
`{redirect_to}?token_hash={hash}&type={signup→email | recovery | email_change |
magiclink→email | invite}`. Also show the 6-digit `token` so the native apps can
verify by code.

Design choice: **send synchronously from the hook**, not through the outbox.
Auth mail is latency-sensitive, the hook already gives the user an error if
sending fails, and queuing would park a live token hash in a table. Use
`Idempotency-Key: auth/<webhook-id>` so Auth's own retries cannot double-send.
If Bird answers `5xx` or times out, return `503` with `retry-after: 1`. Because
Auth's 5-second budget covers the first call, a 2-second back-off and the
retries, give the Bird call its own timeout of about 2 seconds, or a slow first
attempt leaves no room for the retry.

Auth's hourly e-mail limit **does** still apply with the hook: the rate-limits
page lists "emails sent" as configurable "when you use custom SMTP or the Send
Email hook" [S12]. Raise it on the Rate Limits page in both set-ups.

**UNVERIFIED:** the exact timeout of Postgres-function hooks (the page renders
it from a config value that was not shown).

---

## 4. Expo push notifications

Client-side setup (permissions, channels, config plugin) is in
`docs/research/expo-native-apps.md` §4d. This section is the server side.

### 4.1 Token lifecycle

| Fact | Source |
| --- | --- |
| The app gets the token with `getExpoPushTokenAsync({ projectId })`; it can reject on network failure, so wrap in `try/catch` and retry later | [E3] |
| On Android 13+ a notification channel must exist before asking for the token | [E3] |
| The token is stable across app upgrades. On Android a reinstall may change it; on iOS it survives uninstall and reinstall. It changes if the `applicationId` or the Expo project changes. **It never expires** | [E2] |
| `addPushTokenListener` fires in the rare case the token changes while the app runs; re-register | [E3] |
| When the app is uninstalled or permission is revoked, Expo eventually reports `DeviceNotRegistered`; this "takes an undefined amount of time" | [E1] [E2] |
| Remote push does not work in Expo Go on Android from SDK 53 (the FAQ says Expo Go in SDK 53 and later does not support push at all); use a development build on both platforms | [E2] [E3] |

Rules for our server:

1. Register on every app start after sign-in (upsert by token; a phone shared
   by two accounts moves the token to the last signed-in user).
2. On sign-out delete or disable the token, or the next user of the phone gets
   the previous user's order updates.
3. On `DeviceNotRegistered` (ticket or receipt) disable the token at once.
4. Tokens belong to one Expo project. **Never mix tokens of two apps in one
   request** (`PUSH_TOO_MANY_EXPERIENCE_IDS`); the queue therefore stores the app.

### 4.2 Storage the database needs (proposed; nothing exists today)

```sql
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('shop', 'seller', 'driver', 'warehouse')),  -- one Expo project each
  expo_token text not null unique,          -- "ExponentPushToken[…]"
  platform text not null check (platform in ('ios', 'android')),
  device_id text,                           -- stable per installation, for "sign out this device"
  locale text, app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text                      -- 'DeviceNotRegistered' | 'signed_out'
);
-- RLS: no direct access. public.register_push_token(app, token, platform, device_id)
-- and public.unregister_push_token(token) for the signed-in user; only the worker reads tokens.
```

Per delivery, store the **ticket id** returned by the send, so the receipt can
be fetched later. Tokens are bearer credentials unless push security is on
(4.5): do not expose them to any other user or to staff screens.

### 4.3 Push API

| Item | Value | Source |
| --- | --- | --- |
| Send | `POST https://exp.host/--/api/v2/push/send` | [E1] |
| Headers | `host: exp.host`, `accept: application/json`, `accept-encoding: gzip, deflate`, `content-type: application/json`; gzip request bodies optional | [E1] |
| Body | one message object or an array of **up to 100**, all for the same project; `to` may itself be an array of tokens | [E1] |
| Payload | total at most **4096 bytes** per notification | [E1] |
| Rate limit | **600 notifications per second per project**; limit concurrent connections (the Node SDK uses 6) | [E1] [E2] |
| Cost | free; no SLA | [E1] [E2] |
| Delivery guarantee | at-least-once to FCM/APNs; duplicates are possible but rare | [E1] |
| Receipts | `POST https://exp.host/--/api/v2/push/getReceipts` `{ "ids": [...] }`, up to **1000** ids | [E1] |

Message fields we use [E1]: `to`, `title`, `body`, `data` (for example
`{ "url": "/pedidos/YT-000123" }`), `sound: "default"` (iOS), `channelId`
(Android; **if the channel does not exist on the device the notification is not
shown**), `priority: "high"` for delivery-day messages, `ttl` (seconds; set a
few hours on "out for delivery"; a very low `ttl` with normal priority may never
reach an Android phone in doze), `collapseId` (one per order: on iOS it also
replaces a notification already on screen, **on Android it only coalesces
messages still in transit**), `tag` (Android only: replaces a notification
already displayed with the same tag, so send it too, with the same value),
`badge`.

```json
[{ "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "title": "Su pedido va en camino",
   "body": "YT-000123 llega hoy entre 1 p. m. y 5 p. m.", "data": { "url": "/pedidos/YT-000123" },
   "channelId": "pedidos", "priority": "high", "ttl": 14400,
   "collapseId": "order-YT-000123", "tag": "order-YT-000123" }]
```

### 4.4 Tickets, receipts and errors

Two stages [E1]:

1. **Ticket** (immediate response, same order as the request):
   `{"data":[{"status":"ok","id":"<receipt id>"} | {"status":"error","message":"…","details":{"error":"DeviceNotRegistered"}}]}`.
   `ok` means Expo accepted it, not that the phone has it. A whole-request
   failure is HTTP 4xx/5xx with `errors: [{code, message}]`.
2. **Receipt** (after Expo handed the message to FCM/APNs):
   `{"data":{"<id>":{"status":"ok"} | {"status":"error","message":"…","details":{"error":"…"}}}}`.
   Ids without a receipt yet are simply absent. Check **about 15 minutes** after
   sending; receipts are **deleted after 24 hours**. Receipt `ok` still does not
   prove the device showed it.

| Where | Error | Action |
| --- | --- | --- |
| ticket, receipt | `DeviceNotRegistered` | disable the token; do not retry |
| receipt | `MessageTooBig` (> 4096 bytes) | dead-letter; it is a bug |
| receipt | `MessageRateExceeded` (too many to one device) | retry with back-off |
| receipt | `MismatchSenderId`, `InvalidCredentials` | credentials problem: staff alert, pause the push channel |
| request | `TOO_MANY_REQUESTS` (HTTP 429) | back off and retry |
| request | `PUSH_TOO_MANY_EXPERIENCE_IDS` | bug: tokens of two apps in one request |
| request | `PUSH_TOO_MANY_NOTIFICATIONS` (> 100), `PUSH_TOO_MANY_RECEIPTS` (> 1000) | bug: chunking |
| request | `UNAUTHORIZED` | push security is on and the access token is missing or wrong |
| network, HTTP 5xx | — | exponential back-off |

There is no idempotency key on the Expo API. A retry after a lost response can
show the notification twice; `collapseId` (iOS) and `tag` (Android) limit the
damage on the device.

### 4.5 Security

- By default the API "does not require any authentication": anyone holding a
  token can push to that device [E1].
- Turn on **enhanced push security** in the Expo dashboard (access tokens
  settings) and send `Authorization: Bearer <EXPO_ACCESS_TOKEN>`; after that,
  requests without it fail with `UNAUTHORIZED` [E1]. Store the token as an Edge
  Function secret.
- Expo does not store notification contents beyond delivery, but staff
  debugging the service may see them [E2], and lock screens show them. **Never
  put the delivery code, an address or an amount owed in a push**; say what
  happened and deep-link into the app.
- Apple App Review Guideline 4.5.4: push "should not be used to send sensitive
  personal or confidential information", must not be required for the app to
  work, and must not be used "for promotions or direct marketing purposes
  unless customers have explicitly opted in to receive them via consent
  language displayed in your app's UI", with an in-app way to opt out [A1]. So
  marketing push needs its own unticked in-app consent (separate from the OS
  permission prompt) and a switch in the app's settings. No push-specific
  Google Play clause was found; Play's spam and deceptive-notification policies
  apply generally (**UNVERIFIED** beyond that).

---

## 5. Costa Rican rules: commercial versus transactional messages

### 5.1 The texts

| Text | What it says | Source |
| --- | --- | --- |
| **Ley 8642 (General de Telecomunicaciones), art. 44 "Comunicaciones no solicitadas"** | "Se prohíbe la utilización de sistemas de llamada automática por voz, fax, correo electrónico o cualquier otro dispositivo **con fines de venta directa**, salvo la de los abonados que hayan dado su consentimiento previamente." Exception: an address obtained from a customer "en el contexto de la venta de un producto o servicio" may be used by the same person for direct sale of its own similar products. "En cualquier momento, el cliente podrá pedirle al remitente que suspenda los envíos de información y no podrá cobrársele ningún cargo". Always forbidden: messages for direct sale "en los que se disimule o se oculte la identidad del remitente, o que no contengan una dirección válida a la que el destinatario pueda enviar una petición de que se ponga fin a tales comunicaciones" | [L1] |
| Ley 8642 arts. 67 b) 7) and 68 b) | using automatic call, fax or e-mail systems or other devices against the law is a **serious** infraction; serious infractions are fined 0.025 % to 0.5 % of the previous year's gross income of the "operador o proveedor" | [L1] |
| **Decreto 35205-MINAET (Reglamento sobre medidas de protección de la privacidad de las comunicaciones), arts. 31–33** | Art. 31 repeats the prohibition with two exceptions: (a) prior consent to receive such communications; (b) the existing-customer case, where "en el momento de recabarse la información, debe informarle al cliente sobre su uso ulterior". Art. 32: messages must let the recipient "identificar con facilidad al remitente y el propósito de su contenido" and "contener una dirección válida a la que el destinatario pueda enviar una petición de suspender, sin costo alguno, el envío". Art. 33: non-automated sales calls only to people who asked for them | [L2] |
| **Decreto 37899-MEIC (Reglamento a la Ley 7472), art. 200** (e-commerce chapter, consolidated text printed 11 Feb 2026) | "El comerciante debe abstenerse de enviar comunicaciones por cualquier medio electrónico; cuando las mismas no han sido previamente solicitadas por los consumidores". The merchant must implement "procedimientos efectivos y fáciles de usar" so consumers "elijan si desean recibir o no **mensajes comerciales** y, cuando elijan no recibirlos, su decisión debe ser acatada de forma **inmediata**". A communication made with automatic systems without prior consent, or hiding its origin, without a way to stop it, is unsolicited. SUTEL may refer merchants to the Comisión Nacional del Consumidor | [L3] |
| **Ley 8968, arts. 5 and 6** | before collecting data, inform of the database, purposes, recipients, rights and the controller's identity and address; consent must be **express and in writing, physical or electronic**, and "podrá ser revocado de la misma forma, sin efecto retroactivo"; art. 6.4: data must not be used for purposes incompatible with those stated | [L4] |
| **Decreto 37554-JP (Reglamento a la Ley 8968), arts. 4–8** | consent must be free, **specific** ("referido a una o varias finalidades determinadas"), informed, express and individual; given in a document "de forma independiente de cualquier otro documento"; **the burden of proof is on the controller** (art. 6); revocation by "mecanismos expeditos, sencillos y gratuitos" (art. 7), acted on within five business days (art. 8) | [L5] |
| **Ley 10946 (Gobernanza de los Servicios Digitales y el Comercio Electrónico)**, published 24 Jun 2026 (per secondary sources), "entrará en vigencia 12 meses después de su publicación" (Transitorio único) | **Art. 9**: commercial communications, invitations and offers "deberán ser claramente identificables como tales", with the sender's name identifiable; by e-mail they "incluirán al comienzo del mensaje la palabra publicidad, invitación u oferta, según corresponda"; promotions (discounts, prizes) must be labelled with their conditions accessible. **Art. 29**: the merchant must not send commercial communications "por cualquier medio" that were not previously requested or consented to, "o cuando no se deriven de una relación contractual o precontractual existente"; easy opt-out, honoured "de forma inmediata"; and "**No se podrá supeditar la transacción comercial o la prestación del servicio a la aceptación del consumidor de recibir comunicaciones comerciales**". SUTEL may refer cases to the Comisión Nacional del Consumidor | [L7] (full text as reproduced by a law firm); [L6] (summary). The La Gaceta print was not opened, so the publication date is **UNVERIFIED** |
| Meta WhatsApp policy | opt-in naming the business, for any business-initiated message; the business must also comply with local law | [M1] |

The copy of Decreto 37554-JP consulted is the TSE print; whether it includes
every later reform was not confirmed (**UNVERIFIED**).

### 5.2 Reading for this product

The statutory prohibition (Ley 8642 art. 44, Decreto 35205 art. 31) is about
messages "con fines de venta directa", and art. 200 regulates the choice to
receive "mensajes comerciales". A message that only tells a person about an
order they placed, a payment they made, a delivery they are waiting for, a
refund they are owed or the security of their account is not direct sale; it
performs the contract and is covered by the purposes in the privacy notice
accepted at account creation (`docs/05-security-compliance/privacy.md:186-203`).
That is this note's reading. The first sentence of art. 200 is broader
("comunicaciones por cualquier medio electrónico… no previamente solicitadas"),
so make the order messages **solicited in fact**: say at checkout which channels
will be used for updates.

| Message | Class | Consent needed | Opt-out |
| --- | --- | --- | --- |
| Order placed, payment received, payment instructions, scheduled, out for delivery, delivered, delivery failed, cancelled, refund, return and complaint answers | transactional | privacy-notice consent for order processing; channel notice at checkout | not for e-mail (it is the durable receipt). WhatsApp, SMS and push can each be switched off |
| Password reset, e-mail confirmation, e-mail change, security notices | transactional (account) | none beyond the account | none |
| Seller: new order, cancellation, listing approved or rejected, account status, payout notice | transactional (contract with the seller) | seller agreement | channel switches except e-mail |
| Staff and driver alerts | internal | employment or contractor relationship | — |
| **Review request after delivery** | grey: tied to one completed order (Meta accepts this as utility [B20]) but its purpose serves the business | treat as transactional only if it contains nothing promotional; otherwise marketing | include a "no more review requests" switch |
| **Abandoned cart, back in stock, price drop, recommendations, newsletter, coupons, "buy again", seller-recruitment mail** | **marketing** | prior, express, specific, unticked opt-in per art. 31 a) and Ley 8968; record text version and time | in every message, free, effective immediately |
| A promotional line or banner inside an order e-mail | turns the whole message into marketing (also for Meta's categories and for Bird's `category`) | do not do it | — |

The existing-customer exception (art. 44 second paragraph) covers only e-mail,
only our own similar products, and only if the customer was told at collection.
Do not rely on it for a marketplace selling third parties' products without the
lawyer's view.

### 5.3 Mechanics the build must include

1. **Consent records.** `public.consents` already stores purpose, policy
   version, granted and revoked times (`…080100_identity.sql:138-146`); today's
   purposes are `terms, privacy, marketing, location, driver_terms,
   seller_terms`. Add `whatsapp_updates` (order updates over WhatsApp: needed
   for Meta, and it makes the messages "solicited"). Keep `marketing` separate
   and unticked (`profiles.marketing_opt_in` defaults to false,
   `…080100_identity.sql:10-19`).
2. **Checkout wording.** State the channels: for example "Le avisaremos por
   correo sobre este pedido" plus an explicit choice "Recibir avisos de este
   pedido por WhatsApp de Yuntera".
3. **Sender identification** in every message: "Yuntera" as the From name or
   WhatsApp display name; in e-mail a footer with the legal name, cédula
   jurídica, postal address and a contact address that is read
   (art. 32 a; Ley 8642 art. 44 third paragraph).
4. **Stop address** in every commercial message: an unsubscribe link and a
   monitored reply address, free of charge (art. 32 b). For marketing e-mail,
   Bird adds one-click `List-Unsubscribe` headers and a visible link to every
   `category: "marketing"` send [B36]; our handler must mirror
   `email.unsubscribed`, `email.list_unsubscribed` and `preference.revoked` into
   `profiles.marketing_opt_in` and `consents.revoked_at`.
5. **Immediate effect** (art. 200): the database is the source of truth and is
   checked when a delivery is planned **and again when it is claimed**.
6. **From mid-2027** (Ley 10946 art. 9, in force 12 months after publication):
   marketing e-mail starts with the word "Publicidad", "Invitación" or "Oferta".
   The text says "al comienzo del mensaje", which is not necessarily the
   subject line; put it at the start of the subject **and** of the body until
   the lawyer or the regulation says which. Art. 29 also forbids making a
   purchase conditional on accepting commercial messages: the marketing box at
   checkout or sign-up must never be required to continue.
7. **Quiet hours.** No Costa Rican rule fixing hours was found in these texts
   (**UNVERIFIED**; Bird's country page only says quiet hours "apply" for SMS
   [P6]). Product rule proposed: no WhatsApp, SMS or push between 21:00 and
   07:00 `America/Costa_Rica` except "out for delivery" and "delivery failed".
8. **Processors abroad.** Bird, Meta and Expo receive names, phone numbers,
   e-mail addresses and order references. They must appear in the privacy
   notice's list of providers and countries
   (`docs/05-security-compliance/privacy.md:194-195`).

### 5.4 Questions for the lawyer

1. Do order-status messages by WhatsApp or SMS need consent separate from the
   privacy notice, or is a clear notice at checkout enough?
2. Does art. 44's existing-customer exception extend to a marketplace's
   recommendations of third-party sellers' products?
3. Is a post-delivery review request a commercial message?
4. Do Ley 8642's sanctions (aimed at an "operador o proveedor") apply to a
   merchant, or is the exposure through the Comisión Nacional del Consumidor
   (art. 200) and PRODHAB only?
5. Ley 10946 art. 29 treats communications that "se deriven de una relación
   contractual o precontractual existente" as not unsolicited: from mid-2027,
   does that widen what may be sent to existing customers without the
   marketing opt-in, and does Ley 8968's specific consent still require it?
   Does "al comienzo del mensaje" (art. 9) mean the subject line? Its
   regulation when issued.

---

## 6. Outbox worker on Supabase

### 6.1 Why the current table is not enough

| Need | Today | Change |
| --- | --- | --- |
| Several consumers (notifications, e-invoices, gateway refunds, search) | one `processed_at` for all | one **job row per consumer**, written by a trigger in the same transaction |
| One event, many messages (shopper e-mail + push, one WhatsApp per seller) | one row | one **delivery row per recipient and channel** |
| Retry timing | `attempts` only | `available_at`, back-off, `max_attempts` |
| A worker that dies mid-send | nothing | lease: `locked_by`, `locked_until` |
| No duplicates | nothing | unique `dedupe_key`; provider idempotency key; frozen request body |
| Ordering per order | none | `ordering_key`, `sequence`, head-of-line rule |
| Give up | nothing | `dead` status, visible to staff, requeue |

Do not read the outbox with a "last id seen" cursor: identity values are
assigned before commit, so a transaction with a lower id can commit after a
higher id was read and be skipped for ever.

Supabase Queues (`pgmq`) was considered as the delivery queue: it offers
durable messages with "exactly once" delivery "within a customizable visibility
window" [S13]. It does not give per-order FIFO across retries, a frozen request
body or a staff-visible dead-letter row on its own, so the plain tables below
remain the recommendation; `pgmq` would only replace the lease columns.

### 6.2 Schema (proposed)

```sql
-- (1) Per-consumer jobs, fanned out in the transaction that wrote the event.
create table private.outbox_routes (
  topic text not null, consumer text not null, primary key (topic, consumer));

create table private.outbox_jobs (
  event_id bigint not null references private.outbox_events (id) on delete cascade,
  consumer text not null,                      -- 'notify' | 'invoice' | 'refund' | …
  status text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempts smallint not null default 0,
  last_error text,
  primary key (event_id, consumer));
create index outbox_jobs_pending_idx on private.outbox_jobs (consumer, event_id) where status = 'pending';

-- after insert on private.outbox_events for each row:
--   insert into private.outbox_jobs (event_id, consumer)
--   select new.id, r.consumer from private.outbox_routes r where r.topic = new.topic;

-- (2) One row per message to one recipient on one channel.
create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id bigint references private.outbox_events (id),
  dedupe_key text not null unique,     -- '<event id>/<template>/<recipient user id or role>/<channel>'
  ordering_key text not null,          -- 'order:<uuid>' | 'seller:<uuid>' | 'user:<uuid>'
  sequence bigint not null,            -- the event id: order inside ordering_key
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'push')),
  category text not null check (category in ('transactional', 'marketing', 'authentication')),
  template text not null,
  locale text not null default 'es-CR',
  recipient_user_id uuid references auth.users (id) on delete cascade,
  recipient_role text,                 -- 'ops' | 'finance' | 'support' for staff mailboxes
  context jsonb not null,              -- ids only: {"order_id": "…", "shipment_id": "…"}
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'expired', 'dead')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 10,
  available_at timestamptz not null default now(),
  expires_at timestamptz,              -- do not send after this (stale "va en camino")
  locked_by text, locked_until timestamptz,
  generation smallint not null default 0,   -- bumped by a manual requeue → new idempotency key
  request_body text,                   -- exact bytes of the provider request, frozen before attempt 1
  provider text, provider_message_id text, push_ticket_ids text[],
  last_error_code text, last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz, last_event_at timestamptz);

create index notification_due_idx on private.notification_deliveries (available_at)
  where status in ('pending', 'sending');
create index notification_order_idx on private.notification_deliveries (ordering_key, channel, sequence);
```

The queue stores ids, not addresses or message text. The recipient's address
and the template variables are resolved when the row is claimed
(`private.notify_resolve(delivery)`), so an opt-out or a corrected e-mail
address between event and send is honoured. `request_body` holds personal data
once frozen: null it when the row reaches a terminal status plus a retention
period the privacy document should set.

The existing columns `processed_at`, `attempts` and `last_error` on
`private.outbox_events` stay unused under this design (one flag cannot describe
several consumers). Leave them in place; `private.emit` and every function that
calls it are unchanged. Each consumer registers its topics in
`private.outbox_routes` from its own migration, which lets the invoicing and
payment work proceed without touching the notification code.

### 6.3 Stage 1, planning (SQL, exactly once)

`private.notify_plan(p_limit)` claims pending `notify` jobs and, in the **same
transaction**, inserts the deliveries and marks the job `done`. Being pure SQL
with no I/O, it needs no lease and is testable in `supabase/tests`.

```sql
with picked as materialized (
  select j.event_id from private.outbox_jobs j
  where j.consumer = 'notify' and j.status = 'pending'
  order by j.event_id limit p_limit
  for update of j skip locked)
-- for each picked event: insert deliveries per the table in section 8
--   (… on conflict (dedupe_key) do nothing), then
update private.outbox_jobs j set status = 'done'
from picked where j.event_id = picked.event_id and j.consumer = 'notify';
```

`SKIP LOCKED` is the documented tool for this: "any selected rows that cannot be
immediately locked are skipped… can be used to avoid lock contention with
multiple consumers accessing a queue-like table" [PG1]. Because the row's own
`status` is in the `WHERE` clause and is updated by the winner, a second planner
that waited re-checks the row and skips it.

### 6.4 Stage 2, claim with lease

The provider call happens outside any database transaction, so the claim is an
update, not a held lock.

```sql
create or replace function private.notify_claim(
  p_worker text, p_limit int default 20, p_lease_seconds int default 120)
returns setof private.notification_deliveries
language sql security definer set search_path = '' as $$
  with picked as materialized (
    select d.id
    from private.notification_deliveries d
    where ((d.status = 'pending' and d.available_at <= now())
        or (d.status = 'sending' and d.locked_until < now()))      -- lease expired: worker died
      and not exists (                                             -- per-order FIFO
        select 1 from private.notification_deliveries e
        where e.ordering_key = d.ordering_key and e.channel = d.channel
          and e.recipient_user_id is not distinct from d.recipient_user_id
          and e.sequence < d.sequence
          and e.status in ('pending', 'sending'))
    order by d.available_at, d.sequence
    limit p_limit
    for update of d skip locked)
  update private.notification_deliveries d
  set status = 'sending', attempts = d.attempts + 1,
      locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_seconds)
  from picked where d.id = picked.id
  returning d.*;
$$;
```

Notes: the `materialized` CTE keeps `LIMIT` and the lock in one pass; "if a
`LIMIT` is used, locking stops once enough rows have been returned" [PG1]. A
batch can come back smaller than `p_limit` when other workers hold rows; that is
expected. Rows past `expires_at` are set to `expired` by the same function
before claiming. Every completion call filters on `locked_by = p_worker and
status = 'sending'`, so a worker whose lease expired cannot overwrite the result
of the worker that took over.

### 6.5 Retries, back-off, dead letter

```sql
-- private.notify_fail(p_id, p_worker, p_code, p_message, p_permanent, p_retry_after_seconds)
update private.notification_deliveries d
set status = case when p_permanent or d.attempts >= d.max_attempts then 'dead' else 'pending' end,
    available_at = now() + make_interval(secs =>
        greatest(coalesce(p_retry_after_seconds, 0), least(3600, 15 * power(2, d.attempts - 1)))
        * (0.8 + random() * 0.4)),
    last_error_code = p_code, last_error = left(p_message, 500),
    locked_by = null, locked_until = null
where d.id = p_id and d.locked_by = p_worker and d.status = 'sending';
```

Waits: 15 s, 30 s, 1, 2, 4, 8, 16, 32, 60 min. Ten attempts span about 2 h 04 min
(2 h 29 min with the worst jitter), **inside Bird's 3-hour idempotency
retention** [B3], so a retry of a send whose response was lost cannot produce a
second message.

| Provider answer | Class | Action |
| --- | --- | --- |
| `202` (Bird), ticket `ok` (Expo) | success | `sent`, store `provider_message_id` or ticket id |
| network error, timeout, `5xx` | retry | same key, same bytes |
| `429` | retry | wait `Retry-After` [B9] |
| `409 E01004`, `503 E01033` | retry | wait at least 30 s, same key [B3] |
| `409 E01005` | permanent | bug: key reused with a different body |
| `400`, `404`, `422` (validation, unknown template or language, parameter mismatch, reserved recipient domain, closed service window) | permanent | `dead` at once; needs a code or template fix, then requeue with a new `generation` |
| `401`, `403`, `421` | configuration | `dead` and staff alert; stop claiming that channel |
| `402`, e-mail `quota_exceeded`, SMS `SMSDestinationDailySpendExceeded` | account | do not burn attempts: push `available_at` out 15 min, alert staff, and **bump `generation` and re-freeze the body before the next attempt**: a retained `402`/`422` is replayed for the same key for 3 hours [B3] |
| Expo `DeviceNotRegistered` | recipient | disable token, `skipped` |
| recipient opted out or has no address at claim time | recipient | `skipped` |

Reconciliation after an unknown outcome older than 3 hours:
`GET /v1/email/messages?reference=<delivery id>` before sending again [B1].
Dead rows show in the staff console with `last_error`; requeue bumps
`generation` and resets `attempts` (a new idempotency key, so a duplicate is
possible; say so on the button).

### 6.6 Idempotency towards providers

| Channel | Key | Body |
| --- | --- | --- |
| Bird e-mail, WhatsApp, SMS | header `Idempotency-Key: yt/<env>/<delivery id>/<generation>` (≤ 255 chars) | `request_body`, stored before attempt 1 and resent byte for byte |
| Bird SMTP (Auth standby) | header `X-Bird-Idempotency-Key` [B8] | — |
| Auth hook | `Idempotency-Key: auth/<webhook-id>` | deterministic render of the hook payload |
| Expo | none available | `collapseId` (iOS) and `tag` (Android) per order |
| Inbound webhooks (Bird) | unique index on `webhook-id`; status changes are monotonic and compare the event `timestamp`, because deliveries are unordered [B6] | — |

### 6.7 Ordering per order

- `ordering_key = 'order:<id>'`, `sequence = event id`. The claim only takes the
  oldest unfinished row per (key, channel, recipient), so "va en camino" cannot
  overtake "pedido recibido" on the same channel, while e-mail and push proceed
  independently.
- Head-of-line blocking is bounded by the retry horizon (about two hours), after
  which the blocker is `dead` and the next row flows.
- `expires_at` stops stale messages: for example "scheduled" until the route
  starts, "out for delivery" 4 hours, auth mail not queued at all.
- Cross-channel order is not guaranteed and does not need to be.
- Provider delivery order is out of our hands; WhatsApp template TTL and push
  `ttl`/`collapseId` (sections 2.2, 4.3) keep late arrivals from confusing.

### 6.8 Triggering the worker

| Mechanism | What it is | Use |
| --- | --- | --- |
| `pg_cron` → `pg_net` → Edge Function | scheduled SQL that queues an HTTP POST | **the sweep**: retries, expired leases, anything missed |
| `pg_net` call from the planner or fan-out trigger | async HTTP POST "not started until the transaction is committed" [S6] | **the kick**: sub-second latency for new events |
| Database Webhooks | "just a convenience wrapper around triggers using the `pg_net` extension"; payload is the whole row [S8] | not needed: same thing as the kick, with a payload we do not want |

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<random 32+ bytes>', 'notify_worker_token');   -- only good for waking the worker

select cron.schedule('notify-worker', '30 seconds', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/notify-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'notify_worker_token')),
    body := '{}'::jsonb, timeout_milliseconds := 5000)
  where exists (select 1 from private.outbox_jobs where consumer = 'notify' and status = 'pending')
     or exists (select 1 from private.notification_deliveries
                where (status = 'pending' and available_at <= now())
                   or (status = 'sending' and locked_until < now()));
$$);
```

Facts behind this:

- Sub-minute schedules use the `'[1-59] seconds'` form and need Postgres image
  15.1.1.61 or later [S7]. Plain cron syntax bottoms out at one minute.
- `cron.job_run_details` is never cleaned automatically; schedule a weekly
  delete [S7] [S10]. A job name is an upsert key [S7].
- `pg_net`: default request timeout 2,000 ms; requests and responses live in
  **unlogged** tables (lost on a crash), responses kept 6 hours in
  `net._http_response`; about 200 requests per second; JSON POST only [S6].
  Hence the kick is best-effort and the sweep is what guarantees progress.
- Use a dedicated worker token, not a Supabase secret key: the decrypted header
  sits in `net.http_request_queue` until sent (see the other note §5.2). The
  token only lets a caller run a worker that is safe to run at any time.
- The function sets `verify_jwt = false` and checks `x-worker-token` itself.
- Reply `202` at once and do the work in `EdgeRuntime.waitUntil(runOnce())`
  [S9]; the instance lives until the promise settles, within the limits below.
  Locally the CLI needs `[edge_runtime] policy = "per_worker"` for that [S9].
- Edge Function limits: 256 MB; **2 s CPU per request** (async I/O excluded);
  wall clock **150 s on Free, 400 s on paid**; outgoing ports 25 and 587
  blocked [S4]. Loop "plan, claim 20, send, complete" until the queue is empty
  or about 100 s have passed, then stop; the next kick or sweep continues.
- Guard `pg_net`/`pg_cron` calls the way the existing migration does
  (`…081300_moderation.sql:176-190`), so local Postgres without them still runs.
- A second scheduled job checks Expo receipts for push deliveries sent more
  than 15 minutes ago (≤ 1000 ids per call) [E1].

How the worker reaches the database: through `public.worker_*` wrapper functions
granted to `service_role` only, called over the Data API with the secret key in
the `apikey` header (the pattern in the other note §5.1). **`tools/dev-api` runs
calls only as `anon` or `authenticated` today (`tools/dev-api/src/rpc.ts:129`);
it needs a `service_role` path** for the worker to run locally.

### 6.9 Keeping it testable under Node

```text
packages/notifications/            pure TypeScript, web-standard globals only (fetch, crypto.subtle)
  src/templates/*.ts               (variables, locale) → { subject, html, text } | { title, body, data } | WhatsApp params
  src/channels/bird-email.ts       ChannelAdapter; fetch injected
  src/channels/bird-whatsapp.ts
  src/channels/bird-sms.ts
  src/channels/expo-push.ts
  src/channels/dev-mailbox.ts      local adapter: records messages, sends nothing
  src/webhooks/standard.ts         signature check shared by Bird webhooks and the Auth hook
  src/worker.ts                    runOnce({ queue, channels, clock, logger })
supabase/functions/notify-worker/index.ts   Deno entry: env → deps → runOnce
supabase/functions/bird-webhook/index.ts    verify → queue.applyUpdate
supabase/functions/auth-email/index.ts      verify → render → bird-email
```

| Layer | Test | Runs in |
| --- | --- | --- |
| Templates | snapshot of subject/text; HTML contains order number, legal footer, no `{{` | Vitest, Node |
| Adapters | fake `fetch`; assert URL, headers (`Authorization`, `Idempotency-Key`), exact body; table-driven mapping of status codes to `SendResult` | Vitest, Node |
| Signature | fixed secret/body/timestamp vectors; tampered body, old timestamp, rotated secret pair | Vitest, Node |
| Worker loop | in-memory `DeliveryQueue` fake and a scripted adapter: success, retry then success, permanent failure, lease loss | Vitest, Node |
| SQL | planner fan-out per topic; two sessions claiming concurrently get disjoint rows; back-off arithmetic; FIFO rule; dead-letter | `supabase/tests/*.sql` on local Postgres |
| End to end | local Postgres + dev-api + a local HTTP server standing in for Bird and Expo | Node |
| Provider contract | staging key, Bird sandbox addresses `delivered@`, `bounce@`, `complaint@`, `suppressed@messagebird.dev`, which emit real webhooks [B18] | manual or nightly |

Signature check that runs unchanged under Deno and Node 22:

```ts
export async function verifyStandardWebhook(
  rawBody: string, headers: Headers, secrets: string[], nowMs = Date.now(),
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;            // 5-minute tolerance
  const data = new TextEncoder().encode(`${id}.${ts}.${rawBody}`);
  const offered = sig.split(" ").filter((s) => s.startsWith("v1,")).map((s) => fromBase64(s.slice(3)));
  for (const secret of secrets) {                                          // several during rotation
    const keyBytes = fromBase64(secret.replace(/^v1,/, "").replace(/^whsec_/, ""));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
    if (offered.some((o) => constantTimeEqual(o, mac))) return true;
  }
  return false;
}
```

Read the body with `await req.text()` before anything parses it.

---

## 7. Provider-neutral channel interface

```ts
export type Channel = "email" | "whatsapp" | "sms" | "push";
export type Category = "transactional" | "marketing" | "authentication";
export type AppId = "shop" | "seller" | "driver" | "warehouse";

export type Recipient =
  | { channel: "email"; email: string; name?: string }
  | { channel: "whatsapp" | "sms"; phoneE164: string }                 // "+506XXXXXXXX"
  | { channel: "push"; app: AppId; tokens: string[] };

/** What a template function returns; one variant per channel. */
export type Rendered =
  | { channel: "email"; subject: string; html: string; text: string; replyTo?: string }
  | { channel: "whatsapp"; templateSlug: string; language: string; parameters: Record<string, string> }
  | { channel: "sms"; text: string }
  | { channel: "push"; title: string; body: string; data: Record<string, string>;
      channelId?: string; collapseId?: string; tag?: string; ttlSeconds?: number };

export interface OutboundMessage {
  deliveryId: string;          // our uuid: reference, metadata.delivery_id
  idempotencyKey: string;      // "yt/<env>/<deliveryId>/<generation>"
  category: Category;
  template: string;            // "order_placed"
  to: Recipient;
  content: Rendered;
  /** Exact request bytes from an earlier attempt; when present the adapter must resend them. */
  frozenRequestBody?: string;
}

export type SendResult =
  | { ok: true; provider: string; providerMessageId: string; requestBody: string; pushTicketIds?: string[] }
  | { ok: false; provider: string; requestBody?: string;
      kind: "retry" | "permanent" | "config" | "account" | "recipient";
      code: string; message: string; retryAfterSeconds?: number; disableTokens?: string[] };

export interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: "bird" | "expo" | "dev";
  send(message: OutboundMessage, io: { fetch: typeof fetch; signal: AbortSignal }): Promise<SendResult>;
  /** Providers without webhooks (Expo receipts). */
  confirm?(providerIds: string[], io: { fetch: typeof fetch; signal: AbortSignal }): Promise<DeliveryUpdate[]>;
}

export interface DeliveryUpdate {
  provider: string;
  providerMessageId: string;
  deliveryId?: string;                       // from echoed metadata
  status: "sent" | "delivered" | "read" | "bounced" | "failed" | "rejected" | "complained" | "unsubscribed";
  permanent: boolean;
  occurredAt: string;                        // provider timestamp; updates are applied monotonically
  reason?: string;
  recipientAddress?: string;                 // for suppression mirroring only
}

export interface WebhookAdapter {
  verify(rawBody: string, headers: Headers, secrets: string[]): Promise<boolean>;
  parse(rawBody: string): { eventId?: string; updates: DeliveryUpdate[] };
}

export interface DeliveryQueue {
  plan(limit: number): Promise<number>;
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedDelivery[]>; // includes resolved recipient + variables
  freeze(id: string, workerId: string, requestBody: string): Promise<void>;
  complete(id: string, workerId: string, result: Extract<SendResult, { ok: true }>): Promise<void>;
  fail(id: string, workerId: string, result: Extract<SendResult, { ok: false }>): Promise<void>;
  skip(id: string, workerId: string, reason: string): Promise<void>;
  applyUpdate(update: DeliveryUpdate, webhookId?: string): Promise<void>;
}
```

---

## 8. Events → audience → channels → template

Channel legend: **E** e-mail (always, unless hard-bounced), **P** push (if a live
token exists for that app), **W** WhatsApp utility template (only with
`whatsapp_updates` consent and a number), **S** SMS fallback (only when neither P
nor W is possible). Template names are the same slug on every channel; WhatsApp
slugs must be lowercase letters, digits and underscores [B15]. All copy in
Spanish (`es-CR`); money already formatted by `packages/core`.

| Event (topic) | Audience | Channels | Template | Variables |
| --- | --- | --- | --- | --- |
| `order.placed` | shopper | E, P | `order_placed` | `first_name`, `order_number`, `total`, `payment_method_label`, `payment_instructions` (SINPE or transfer: amount, destination, reference, deadline; empty for card and cash), `promise_window`, `items[]` (name, qty, line total; e-mail only), `ship_summary`, `order_url`, `withdrawal_deadline` |
| `order.placed` with SINPE or bank transfer | staff, finance | E to role mailbox | `staff_payment_to_confirm` | `order_number`, `total`, `payment_method_label`, `console_url` |
| `payment.captured` | shopper | E, P | `payment_received` | `first_name`, `order_number`, `amount`, `payment_method_label`, `order_url` |
| `order.released` | each seller with lines in the order | E, W, P (seller app) | `seller_new_order` | `shop_name`, `order_number`, `line_count`, `unit_count`, `pack_by`, `fulfillment_label` (own location or warehouse), `seller_order_url` |
| `shipment.scheduled` (to add) — "shipped" | shopper | E, P | `shipment_scheduled` | `first_name`, `order_number`, `delivery_date`, `window`, `cash_due` (cash on delivery only), `tracking_url` |
| `shipment.out_for_delivery` (to add) | shopper | P, W, E; S as fallback | `shipment_out_for_delivery` | `first_name`, `order_number`, `window`, `cash_due`, `tracking_url` (WhatsApp: `button_url` = order number). Reminder text to have the delivery code ready; **never the code itself** |
| `shipment.delivered` | shopper | E, P | `shipment_delivered` | `first_name`, `order_number`, `delivered_at`, `order_url`, `withdrawal_deadline`, `warranty_until`, `review_url` |
| `shipment.delivery_failed` | shopper | P, W, E; S as fallback | `shipment_delivery_failed` | `first_name`, `order_number`, `reason_label`, `next_step`, `support_whatsapp`, `tracking_url` |
| `shipment.delivery_failed` | staff, ops | E to role mailbox | `staff_delivery_failed` | `order_number`, `tracking_code`, `reason`, `attempt_count`, `console_url` |
| `order.cancelled` | shopper | E, P | `order_cancelled` | `first_name`, `order_number`, `reason_label`, `refund_note`, `order_url` |
| `order.cancelled` | sellers in the order | E, P | `seller_order_cancelled` | `shop_name`, `order_number`, `seller_order_url` |
| `refund.requested` | shopper | E | `refund_initiated` | `first_name`, `order_number`, `amount` (if present), `refund_method_label`, `eta_text` |
| `refund.completed` (to add) | shopper | E, P | `refund_completed` | `first_name`, `order_number`, `amount`, `refund_method_label` |
| `return.requested` | shopper | E | `return_received` | `first_name`, `order_number`, `return_number`, `next_step` |
| `return.requested` | staff, support | E to role mailbox | `staff_return_requested` | `order_number`, `return_number`, `console_url` |
| `return.decided` | shopper | E, P | `return_approved` or `return_rejected` (by `approved`) | `first_name`, `order_number`, `return_number`, `instructions` or `reason_text`, `order_url` |
| `complaint.filed` | shopper | E | `complaint_received` | `first_name`, `complaint_number`, `response_deadline` |
| `complaint.filed` | staff, support | E to role mailbox | `staff_complaint_filed` | `complaint_number`, `order_number`, `console_url` |
| `complaint.answered` | shopper | E | `complaint_answered` | `first_name`, `complaint_number`, `closed`, `complaint_url` |
| `content.reported` | staff, trust | E to role mailbox (digest is enough) | `staff_content_reported` | `report_id`, `target_label`, `console_url` |
| `report.resolved` | reporter | E | `report_resolved` | `first_name`, `outcome_label` |
| `product.reviewed`, `approved = true` | seller members | E, P | `seller_listing_approved` | `shop_name`, `product_title`, `product_url` |
| `product.reviewed`, `approved = false` | seller members | E, P | `seller_listing_rejected` | `shop_name`, `product_title`, `reason_text`, `edit_url` |
| `seller.status_changed` | seller owner | E | `seller_account_status` | `shop_name`, `status_label`, `note`, `seller_url` |
| `route.assigned` (to add) | driver | P (driver app) | `driver_route_assigned` | `route_date`, `stop_count`, `route_url` |
| `invoice.requested` | — | none; consumed by e-invoicing. A later `invoice.issued` would send E with the documents | — | — |
| Dead-lettered delivery, channel paused | staff, ops | console; daily E digest (sent outside this queue to avoid loops) | `staff_notification_failures` | `dead_count`, `oldest_at`, `top_errors`, `console_url` |
| Auth hook `signup` | account holder | E (direct, not queued) | `auth_confirm_signup` | `confirm_url`, `code`, `expires_minutes` |
| Auth hook `recovery` | account holder | E (direct) | `auth_recovery` | `reset_url`, `code`, `expires_minutes` |
| Auth hook `email_change` | current and new address | E (direct, two messages) | `auth_email_change_current`, `auth_email_change_new` | `new_email`, `confirm_url`, `code` |
| Auth hook `reauthentication` | account holder | E (direct) | `auth_reauthentication` | `code` |
| Auth hook `*_notification` | account holder | E (direct) | `auth_security_notice` | `notice_label`, `occurred_at`, `account_url` |

WhatsApp templates to submit first (all `utility`, language Spanish):
`seller_new_order`, `shipment_out_for_delivery`, `shipment_delivery_failed`.
Add `shipment_delivered` and `order_placed` only if shoppers ask for them; each
costs US$0.0163 per message.

Where the data lives: shopper e-mail in `auth.users.email`; phone and locale in
`public.profiles` (`phone` is constrained to `+506` numbers,
`…080100_identity.sql:10-19`); the order's own `ship_phone`
(`…080600_orders.sql`, `orders` table) is the delivery contact and may differ
from the account phone: decide which one WhatsApp uses (see owner decisions).
Seller audience: `public.seller_members`; staff: role mailboxes kept as
settings, not each staff member's inbox.

---

## 9. DNS records the owner must add (placeholders)

`<ROOT_DOMAIN>` is whichever domain becomes the brand's primary
(`packages/brand/src/brand.ts:45-49` currently says `yuntera.cr`, not yet
bought). `<SENDING_DOMAIN>` is a subdomain used only for mail sent by the
platform, for example `mail.<ROOT_DOMAIN>`. Copy every value from Bird's
**Email > Domains** page after registering the domain; the DKIM selector and the
region in the CNAME targets are specific to the account.

| # | Type | Host | Value | Purpose |
| --- | --- | --- | --- | --- |
| 1 | TXT | `<DKIM_SELECTOR>._domainkey.<SENDING_DOMAIN>` | `v=DKIM1; k=rsa; p=<DKIM_PUBLIC_KEY>` | DKIM: ownership and signing (required) |
| 2 | CNAME | `send.<SENDING_DOMAIN>` | `<BIRD_REGION>.bounce.bird.com` | return-path: bounces and SPF alignment (required) |
| 3 | TXT | `_dmarc.<SENDING_DOMAIN>` | `v=DMARC1; p=none; rua=mailto:<DMARC_REPORTS_MAILBOX>` | DMARC (required; start at `p=none`, tighten later) |
| 4 | CNAME | `links.<SENDING_DOMAIN>` | `<BIRD_REGION>.links.bird.com` | optional: only if open/click tracking is ever enabled |
| — | MX | `<SENDING_DOMAIN>` | — | **do not add** Bird's inbound MX unless receiving mail through Bird |
| — | TXT (SPF) | `<ROOT_DOMAIN>` | — | **nothing to add for Bird.** The mailbox provider for `ayuda@<ROOT_DOMAIN>` needs its own SPF, DKIM and DMARC records, set up separately |

If the long DKIM value is refused by the DNS host as one string, split it into
quoted segments (Bird has a splitter tool) [B4].

For the other domains bought defensively (`.com`, `.app`, or `.cr` if it is not
the primary): send no mail from them and say so in DNS, so nobody can spoof
them. Standard practice, not re-verified against the RFCs today:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `<PARKED_DOMAIN>` | `v=spf1 -all` |
| TXT | `_dmarc.<PARKED_DOMAIN>` | `v=DMARC1; p=reject;` |
| MX | `<PARKED_DOMAIN>` | `0 .` (null MX) |

From addresses proposed: `pedidos@<SENDING_DOMAIN>` (orders),
`cuenta@<SENDING_DOMAIN>` (Auth), `vendedores@<SENDING_DOMAIN>` (sellers);
`Reply-To: ayuda@<ROOT_DOMAIN>`, which must be a real, read mailbox (it is the
"dirección válida" the law asks for).

---

## 10. What the owner must set up

### In Bird

1. Check the organisation's **region** (key prefix `bk_us1_` or `bk_eu1_`); it
   fixes the API host, SMTP host and DNS targets, and cannot be mixed.
2. Complete any pending check in **Identity Center** (several operations answer
   `412` until it is done) [B34].
3. **E-mail plan:** the Free plan stops at 50 e-mails a day. Move to Startup
   (US$15 monthly deposit, spendable on WhatsApp and SMS too) before real orders.
4. **Sending domain:** add `<SENDING_DOMAIN>` under **Email > Domains**, publish
   records 1–3 of section 9, wait until sending shows as verified.
5. **API keys** (**Platform tools > API keys**), one set per environment:
   worker key (`emails:write`, `whatsapp:write`, `sms:write`); Auth SMTP key
   (`emails:write` only), then under **Email > SMTP** set that key to
   transactional with open and click tracking off. Hand the keys over through
   the secret store, never in chat or git.
6. **Webhook endpoint** (**Platform tools > Webhooks**) pointing at the
   `bird-webhook` function once it is deployed; events: `email.delivered`,
   `email.bounced`, `email.out_of_band_bounce`, `email.rejected`,
   `email.complained`, `email.unsubscribed`, `email.list_unsubscribed`,
   `email_suppression.created`, `preference.revoked`, `preference.granted`,
   `preference.deleted`, `whatsapp.sent`, `whatsapp.delivered`, `whatsapp.read`,
   `whatsapp.failed`, `whatsapp.rejected`, `sms.delivered`, `sms.undelivered`,
   `sms.failed`, `sms.rejected`, `sms.expired`. Save the `whsec_` secret when it
   is shown; it is shown once.
7. **Wallet:** add funds and a low-balance alert; a WhatsApp or SMS send with
   an empty wallet is refused.
8. **WhatsApp:** connect the number (below), fill the business profile, create
   and submit the Spanish utility templates of section 8, add Spanish opt-out
   keywords.
9. **SMS (only if the fallback is wanted):** enable Costa Rica under
   **SMS > Destinations** and set a daily spend limit; claim the sender ID
   `Yuntera` knowing carriers overwrite it.
10. Decide whether Bird may **store e-mail bodies** (up to 30 days when content
    storage is on [B1]); off is the privacy-friendly default.

### In Meta

1. A **Meta business portfolio** in the company's legal name, with two-factor
   authentication on the admin accounts.
2. A **phone number** for notifications that can receive an SMS or voice code
   and is not registered on WhatsApp; decide whether it is the same number as
   support (then use coexistence) or a separate one.
3. **Display name** "Yuntera" and business profile (logo, description, address,
   website, support e-mail).
4. **Business verification** with the company documents: lifts the 250-recipient
   daily cap and the 2-number cap. Start early; Meta's decision can take up to
   14 business days [B24].
5. Approve Bird's access in the Embedded Signup popup.
6. A live website with the privacy policy and terms on the domain; Meta's
   reviewers look at it.

### In Expo, Apple and Google (push)

1. Expo account and one project per app (see the native-apps note).
2. Enable **enhanced push security** and create an access token for the worker.
3. Apple push key and Firebase (FCM v1) service account uploaded to EAS.

### In Supabase

1. Auth custom SMTP with the Bird SMTP key; raise the hourly e-mail limit.
2. Send Email Hook pointing at the `auth-email` function; store its secret.
3. Vault secrets `project_url` and `notify_worker_token`; Edge Function secrets
   for the Bird key, webhook secret and Expo token.
4. Extensions `pg_cron` and `pg_net` enabled.

---

## Open points and unverified items

| # | Item | Status |
| --- | --- | --- |
| 1 | Whether Bird allocates +506 numbers and which +506 number types Meta accepts for WhatsApp | UNVERIFIED |
| 2 | Spanish language codes offered in Bird's WhatsApp template editor; whether Spanish opt-out keywords are in Bird's default catalogue | UNVERIFIED |
| 3 | Which short or long code replaces an alphanumeric sender in Costa Rica; delivery quality per operator; the SMS quiet-hours window | UNVERIFIED |
| 4 | GSM-7 treatment of `ó` (Bird confirms `á í ú` force UCS-2) | UNVERIFIED for `ó` only |
| 5 | Postgres-hook timeout (the hourly e-mail limit does apply with the hook, see 3.3) | UNVERIFIED |
| 6 | Ley 10946: articles 9 and 29 and the 12-month vacatio read from a law firm's reproduction of the full text; La Gaceta print and the exact publication date not opened | partly UNVERIFIED |
| 7 | Whether the consulted print of Decreto 37554-JP includes all reforms | UNVERIFIED |
| 8 | Whether transactional WhatsApp/SMS need consent separate from the privacy notice; reach of the existing-customer exception; whether Ley 8642 fines reach a merchant | legal question |
| 9 | Version of `@messagebird/sdk`; whether Bird's `email_send` defaults differ from the pricing page | UNVERIFIED; read `RateLimit-Policy` at run time |
| 10 | Prices and limits were read from public pages on 21 Nov 2026 and change | re-check before budgeting |
| 11 | Whether `pg_net` cancelling a timed-out request stops an Edge Function mid-run | UNVERIFIED; `EdgeRuntime.waitUntil` avoids depending on it |
| 12 | Null-MX and `-all` records for parked domains | standard practice, not re-verified today |

---

## Sources

Bird documentation, read on 21 Nov 2026 through Bird's documentation tools
(the URL is the page):

- [B1] <https://bird.com/docs/guides/email/sending-email>
- [B2] <https://bird.com/docs/api/reference/create-email-message>
- [B3] <https://bird.com/docs/guides/idempotency>
- [B4] <https://bird.com/docs/guides/email/sending-domains>
- [B5] <https://bird.com/docs/guides/email/dkim-spf-dmarc>
- [B6] <https://bird.com/docs/guides/webhooks>
- [B7] <https://bird.com/docs/guides/email/events>
- [B8] <https://bird.com/docs/guides/email/smtp>
- [B9] <https://bird.com/docs/guides/rate-limits>
- [B10] <https://bird.com/docs/guides/email/suppressions>
- [B11] <https://bird.com/docs/guides/email/categories>
- [B12] <https://bird.com/docs/guides/email/templates>
- [B13] <https://bird.com/docs/knowledge-base/billing/plans-and-pricing>
- [B14] <https://bird.com/docs/guides/authentication>
- [B15] <https://bird.com/docs/guides/whatsapp/sending-whatsapp>
- [B16] <https://bird.com/docs/guides/whatsapp/numbers/connect>
- [B17] <https://bird.com/docs/guides/whatsapp/numbers/overview>
- [B18] <https://bird.com/docs/guides/email/testing-sandbox> (search extract)
- [B19] <https://bird.com/docs/knowledge-base/faq/whatsapp-sending>
- [B20] <https://bird.com/docs/guides/whatsapp/authoring-templates/utility>
- [B21] <https://bird.com/docs/guides/whatsapp/authoring-templates>
- [B22] <https://bird.com/docs/guides/whatsapp/templates>
- [B23] <https://bird.com/docs/guides/whatsapp/templates/utility>
- [B24] <https://bird.com/docs/knowledge-base/whatsapp/unverified-business-account> (search extract)
- [B25] <https://bird.com/docs/guides/whatsapp/numbers/default>
- [B26] <https://bird.com/docs/guides/whatsapp/coexistence> (search extract)
- [B27] <https://bird.com/docs/knowledge-base/whatsapp/template-guidelines>
- [B28] <https://bird.com/docs/guides/whatsapp/opt-outs>
- [B29] <https://bird.com/docs/knowledge-base/whatsapp/customer-service-window>
- [B30] <https://bird.com/docs/guides/whatsapp/webhooks/message-status>
- [B31] <https://bird.com/docs/guides/whatsapp/opt-outs/keyword-rules> (search extract)
- [B32] <https://bird.com/docs/knowledge-base/whatsapp/october-2026-pricing-changes>
- [B33] <https://bird.com/docs/guides/sms/sending-sms>
- [B34] <https://bird.com/docs/guides/sms/senders>
- [B35] <https://bird.com/docs/guides/sms/events> and <https://bird.com/docs/api/reference/list-sms-message-events> (search extracts)
- [B36] <https://bird.com/docs/guides/email/unsubscribe-links> and <https://bird.com/docs/knowledge-base/deliverability/gmail-yahoo-requirements> (search extracts)
- [B37] <https://bird.com/docs/guides/whatsapp/overview>
- [B38] <https://bird.com/docs/guides/sms/character-limits> (fact-check)

Bird public pricing and country pages, fetched 21 Nov 2026:

- [P1] <https://bird.com/pricing/email>
- [P2] <https://bird.com/pricing/sms>
- [P3] <https://bird.com/pricing/whatsapp/cr>
- [P4] <https://bird.com/pricing/whatsapp>
- [P5] <https://bird.com/pricing/sms/cr>
- [P6] <https://bird.com/sms-api/features/destinations/costa-rica>

Supabase documentation, read through Supabase's documentation search:

- [S1] <https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook>
- [S2] <https://supabase.com/docs/guides/auth/auth-hooks>
- [S3] <https://supabase.com/docs/guides/auth/auth-smtp>
- [S4] <https://supabase.com/docs/guides/functions/limits>
- [S5] <https://supabase.com/docs/guides/functions/schedule-functions>
- [S6] <https://supabase.com/docs/guides/database/extensions/pg_net>
- [S7] <https://supabase.com/docs/guides/cron/quickstart>
- [S8] <https://supabase.com/docs/guides/database/webhooks>
- [S9] <https://supabase.com/docs/guides/functions/background-tasks>
- [S10] <https://supabase.com/docs/guides/platform/upgrading> (`pg_cron` records)
- [S11] <https://supabase.com/docs/guides/ai/automatic-embeddings> (queue + `pg_cron` + `pg_net` + Edge Function pattern)
- [S12] <https://supabase.com/docs/guides/auth/rate-limits> (fact-check)
- [S13] <https://supabase.com/docs/guides/queues> (fact-check)

Expo documentation, read through Expo's documentation tools:

- [E1] <https://docs.expo.dev/push-notifications/sending-notifications/>
- [E2] <https://docs.expo.dev/push-notifications/faq/>
- [E3] <https://docs.expo.dev/versions/latest/sdk/notifications/>

Meta and PostgreSQL:

- [M1] <https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in>
- [M2] <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing> and <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages> (fact-check)
- [A1] <https://developer.apple.com/app-store/review/guidelines/> §4.5.4 (fact-check)
- [PG1] <https://www.postgresql.org/docs/16/sql-select.html> (the locking clause)

Costa Rican texts:

- [L1] Ley 8642, Ley General de Telecomunicaciones, arts. 44, 67, 68 — <https://www.sutel.go.cr/sites/default/files/normativas/ley_general_de_telecomunicaciones.pdf>
- [L2] Decreto 35205-MINAET, arts. 31–35 — <https://sutel.go.cr/sites/default/files/normativas/reglamento_sobre_medidas_de_proteccion_de_la_privacidad_de_las_comunicaciones_decreto_ejecutivo_35205-minaet.pdf>
- [L3] Decreto 37899-MEIC, art. 200, consolidated SCIJ text printed 11 Feb 2026 — <https://faolex.fao.org/docs/pdf/cos135900.pdf>
- [L4] Ley 8968, arts. 5 and 6 — <https://www.tse.go.cr/pdf/normativa/leydeprotecciondelapersona.pdf>
- [L5] Decreto 37554-JP, arts. 4–8 — <https://www.tse.go.cr/pdf/normativa/reglamentoleyproteccionpersona.pdf>
- [L6] ECIJA, report on the Ley de Gobernanza de los Servicios Digitales y el Comercio Electrónico (secondary) — <https://files.griddo.ecija.com/ecija-informe-ley-de-gobernanza-de-servicios-digitales-y-comercio-electronico.pdf> and <https://www.ecija.com/actualidad-insights/nueva-ley-de-comercio-electronico-en-costa-rica-guia-para-adaptar-su-negocio-en-los-12-meses-que-tiene-de-plazo>
- [L7] Ley 10946, full text as reproduced by Bufete de Costa Rica, arts. 9 and 29 and Transitorio único — <https://bufetedecostarica.com/wp-content/uploads/2026/07/gobernanza-de-los-servicios-digitales-y-el-comercio-electronico_10946.pdf> (fact-check; not the official La Gaceta print)

Files in this repository:

- `supabase/migrations/20261121080600_orders.sql:217-234` (outbox table, `private.emit`)
- `supabase/migrations/20261121080900_trust.sql:180`
- `supabase/migrations/20261121081000_checkout.sql:41, 88, 90, 136-146, 153, 431`
- `supabase/migrations/20261121081100_fulfillment.sql:322-323, 331, 383-410, 497, 542`
- `supabase/migrations/20261121081300_moderation.sql:72, 114, 176-190`
- `supabase/migrations/20261121081500_api_shopper.sql:609, 639`
- `supabase/migrations/20261121081700_api_backoffice.sql:167, 248, 284, 329`
- `supabase/migrations/20261121080100_identity.sql:10-19, 42-47, 99-105, 138-146`
- `supabase/tests/020_access.sql:538`
- `tools/dev-api/src/rpc.ts:129`
- `packages/brand/src/brand.ts:45-53`
- `docs/02-architecture/decisions.md:344-360`
- `docs/05-security-compliance/privacy.md:180-212`
- `docs/06-operations/customer-service.md:18-22`, `docs/06-operations/logistics-playbook.md:106`
- `docs/research/supabase-auth-storage-wire-format.md` (§1, §5, §6)
- `docs/research/expo-native-apps.md` (§4d)

## Corrections after fact-check

Fact-check of 21 November 2026. About 120 load-bearing claims were re-verified
independently of the note's own citations: Bird through its documentation tools
only (no account tool was called; nothing was sent, bought or configured), Bird's
public pricing and country pages, Supabase's documentation search, Expo's
documentation tools, Meta's developer pages, Apple's App Review Guidelines, and
the Costa Rican texts downloaded and read in full (Ley 8642 from SUTEL, Decreto
35205 from SUTEL, Decreto 37899 consolidated SCIJ print of 11 Feb 2026, Ley 8968
and Decreto 37554 from the TSE). Every re-checked claim not listed below was
confirmed as written, including: base URLs and the `421` wrong-region answer;
`Authorization: Bearer bk_{region}_…`; key scopes, one-time display and 24-hour
rotation grace; `POST /v1/email/messages`, `/v1/email/batches` (100,
all-or-nothing), `/v1/whatsapp/messages` (one recipient, no batch),
`/v1/sms/messages` and `/v1/sms/batches` (100) with their field limits; the
error envelope; every idempotency code (`E01004` lock within 30 s, `E01005`,
`E01033`, 3-hour retention, raw-body comparison); the rate-limit headers and
every published plan figure; the Standard Webhooks signature recipe, headers,
15-second deadline, retry schedule, replay and rotation limits; the e-mail event
and rejection-reason catalogues and bounce classes; suppression reasons and
category rules (default `marketing`); DKIM TXT, return-path CNAME and DMARC as the
send gate with no apex SPF; SMTP hosts, ports, `bird` username, key-level
configuration and `X-Bird-Idempotency-Key`; WhatsApp prices for Costa Rica
(US$0.0163 utility, US$0.079 marketing) and the 1 October 2026 change; the
coexistence 20 messages per second; the SMS Costa Rica page (alphanumeric
overwritten, one-way; short code preserved; US$0.10 per segment); the Send Email
Hook payload, action types, reversed e-mail-change hash names, `v1,whsec_`
secret, 20 KB limit, status-code handling and 5-second budget; custom SMTP's
30-per-hour start; Edge Function limits; `pg_net`, `pg_cron` and Database
Webhook facts; the Expo endpoints, 100-message and 1,000-receipt limits, 600 per
second, 4096 bytes, ticket and receipt shapes, error codes, 15-minute and
24-hour receipt timing and enhanced push security; and every quoted Costa Rican
article (Ley 8642 arts. 44, 67 b) 7) and 68 b); Decreto 35205 arts. 31–33;
Decreto 37899 art. 200; Ley 8968 art. 5.2 and the "adecuación al fin" principle
in art. 6; Decreto 37554 arts. 4–8).

| # | Where | What the note said | What is right | Source |
| --- | --- | --- | --- | --- |
| 1 | 1.3, 6.5, 6.6 | Retained `4xx` replayed for the same key: "after fixing a `422` use a new key"; account errors (`402`, quota) retried later with the same key | Bird retains `4xx` rejections in general, not only `422`. A `402` retried with the same key after a top-up can be replayed as `402` for 3 hours, so the message never goes. The worker now bumps `generation` (new key, new frozen body) after any `4xx` except `409 E01004` and `429`. Whether `429` is retained is not stated | [B3] |
| 2 | 4.3, 4.4, 6.6, 7 | `collapseId` per order "replaces an older one" and limits duplicates on the device | On Android `collapseId` only coalesces messages in transit; replacing a notification already on screen needs `tag` (Android only). Both are now sent; `tag` added to the `Rendered` push type. Low `ttl` with normal priority may never reach a dozing Android phone | [E1] |
| 3 | 5.1, 5.3, 5.4 | Ley 10946 known only from a law-firm summary; e-mail "subjects" begin with "Publicidad"… | Full text (law-firm reproduction) read: art. 9 says "al comienzo del mensaje", not the subject; art. 29 bans unconsented commercial messages "por cualquier medio" unless they derive from an existing contractual or pre-contractual relationship, requires immediate opt-out, and forbids making a purchase conditional on accepting commercial messages; in force 12 months after publication. Advice changed to subject **and** body start, and a lawyer question added on the contractual-relationship wording | [L7] |
| 4 | 3.3, open point 5 | Whether Auth's hourly e-mail limit applies with the hook "UNVERIFIED" | It applies and is configurable with custom SMTP or the hook; raise it in both set-ups. Also added: give the Bird call a ~2 s timeout so Auth's 5 s budget leaves room for one retry | [S12]; [S2] |
| 5 | 4.5 | No Apple/Google push-content rules | Apple 4.5.4: no sensitive personal data in push, no marketing push without explicit in-app consent and an in-app opt-out. No push-specific Google Play clause found | [A1] |
| 6 | 2.1 | Personal WhatsApp number "must have that account deleted first"; "no extra Bird charge"; `422 E15023` without a name | Personal-app number: either move to the Business app and use coexistence, or delete the account and wait up to three minutes. Connection is free but a number bought from Bird is a paid subscription. `E15023` is `WhatsAppSenderWABAMismatch`; `WhatsAppSenderNotFound` added | [B15] [B17] [B19] [B23] |
| 7 | 2.2 | Template statuses `pending/approved/rejected/paused/disabled`; utility TTL range only | Also `submit_failed`, `limit_exceeded`, `in_appeal`; sends use `live_version_id`. Utility TTL **defaults to 30 days** when not set, counted from hand-off to Meta | [B21] |
| 8 | 2.5 | Default WhatsApp opt-out keywords: `STOP`/`START` | Full worldwide list (nine opt-out words, `start`/`unstop`), whole-message matching ignoring case and accents, and how to add Spanish words with `country: "CR"` | [B31] |
| 9 | 2.8, open point 4 | `á í ó ú` outside GSM-7 "UNVERIFIED" | Bird confirms `á`, `í`, `ú` force UCS-2 and `é` does not; `ó`, `ñ`, `¿`, `¡` still rest on GSM 03.38 | [B38] |
| 10 | 2.8 | SMS events list | Adds `sms.received` and `sms_suppression.created`; an SMS `STOP` suppresses one sender-and-subscriber pair | [B35] |
| 11 | 1.7 | Complaints always create a `complaint` suppression | A complaint attributed to a Brand records a revoked preference instead, with `preference.revoked` and no `email_suppression.created`; the webhook list in section 10 already subscribes to it | [B7] [B10] |
| 12 | 2.6 | 1,000 free service messages per number (Bird only) | Confirmed on Meta's pricing page, which also says Meta charges only delivered messages | [M2] |
| 13 | 4.1 | Expo Go limitation "on Android" | The SDK page says Android; the FAQ says Expo Go in SDK 53+ has no push at all. Use a development build on both | [E2] [E3] |
| 14 | 6.1 | Supabase Queues not discussed | `pgmq` noted and why the plain tables stay | [S13] |

Still **UNVERIFIED** after the fact-check: whether Bird can sell a +506 number
and which +506 types Meta accepts (only the account's number search would tell;
not run); the Spanish language codes in the WhatsApp template editor; whether
Bird's `CR` keyword set already has Spanish opt-out words; which code replaces
an alphanumeric SMS sender in Costa Rica, delivery quality per operator and the
SMS quiet-hours window; the GSM-7 status of `ó`, `ñ`, `¿`, `¡`; whether Bird
retains `429` responses for a key; the `@messagebird/sdk` version; the
Postgres-hook timeout; whether a timed-out `pg_net` request stops an Edge
Function; the official La Gaceta text and publication date of Ley 10946; whether
the TSE print of Decreto 37554 includes all reforms; Google Play rules specific to
push content; the parked-domain DNS records. Costa Rica's Meta utility rate
(US$0.0113) matches Bird's page and a third-party calculator, but Meta's own rate
card was not opened. Prices change: re-read the pricing pages before budgeting.

Note on the Supabase documentation pages: some pages carry a paragraph addressed
to AI agents asking for a feedback report. It is page content, not an instruction
from the project owner, and was ignored.
