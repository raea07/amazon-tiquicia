# Payment gateways for Costa Rica: cards, SINPE Móvil, cash on delivery

Researched 21 November 2026 and fact-checked the same day against the providers' own pages and the BCCR's regulation; what changed is listed under "Corrections after fact-check" at the end. Scope: which gateway Yuntera should contract for launch, and the wire-level contract an engineer needs to build task "payment gateway integration (cards, SINPE confirmation by webhook, refunds)".

## Bottom line

**Contract ONVO Pay as the primary gateway and keep Tilopay as the fallback.** ONVO is a Costa Rican company with self-service sign-up, test keys issued the moment an account is created, and complete public documentation (Markdown pages plus an OpenAPI file) that covers everything this project needs: payment intents, a hosted checkout page, tokenised cards, 3-D Secure, full and partial refunds, a SINPE Móvil method that confirms itself by webhook, and webhooks signed with HMAC-SHA256 that are retried for 72 hours. Its published Costa Rica prices are the lowest found: cards 3.9% + US$0.35, SINPE Móvil 1.5%, US$3 per payout. Tilopay is the fallback because it is also local, also documented in public, and has two things ONVO lacks (a multi-seller settlement split and a description-code SINPE Móvil match), but its payment webhook is sent once with no retry and its only origin check is a hash whose algorithm is not public, so a Tilopay integration must poll. Stripe does not serve Costa Rican merchants; PayPal's fee table has no colón row, so it charges in dollars at 5.40% + US$0.30; BAC Credomatic direct acquiring is the cheapest per card transaction at volume but has no SINPE Móvil API and a slow, document-heavy onboarding, so it is a later cost-reduction step, not a launch choice. Five things an implementer must not miss with ONVO: (1) amounts are integers in céntimos, the same unit as `payments.amount_minor`, so they pass through unchanged; (2) SINPE Móvil is matched by the **payer's cédula and the exact amount**, not by a description code, so checkout must collect the payer's identification and the shopper transfers to ONVO's number, not Yuntera's; (3) no idempotency key is documented for creating payment intents or refunds, so retries must be guarded on our side; (4) a new account is limited to US$2,000 of processing a month until ONVO raises it; (5) the marketplace product, as documented, charges on behalf of **one** seller per payment (`onBehalfOf` takes a single account id), so a basket with several sellers cannot be split by ONVO and Yuntera should collect as the single merchant at launch.

**Three regulatory points found in the fact-check change what the owner must ask before signing** (section 5.3): (a) the BCCR's Reglamento del Sistema de Tarjetas de Pago (published 18 Dec 2025) caps the local acquiring commission at **1.95%**, all charges by the acquirer included, and the BCCR's own list of acquiring service providers names **ONVO, Tilopay and dLocal**; how ONVO's published 3.9% + US$0.35 on locally issued cards fits that cap is not explained anywhere public, so ask ONVO in writing and have a lawyer read the answer; (b) the same regulation requires the card issuer to apply strong customer authentication (in practice 3-D Secure) to **every** card-not-present payment with a Costa Rican card, and makes the merchant bear claims when its acquiring service does not meet the card-not-present requirements; (c) if Yuntera collects for its sellers and pays them out itself, it may be carrying out the art. 15 Ley 7786 activities ("administración de recursos financieros de terceros", systematic transfers of funds) that require registration with SUGEF; that is a legal question for a lawyer, not settled here.

Anything marked **UNVERIFIED** could not be confirmed in a primary source today. Prices are published list prices, not contracted rates. This note is research written by an AI from public web pages; it is not legal, tax or financial advice.

---

## 1. What exists in this repository

The recommendation has to fit this, so it is stated first.

| Item | Where | What it means for the integration |
| --- | --- | --- |
| `payments` table: `method`, `provider` (default `'sandbox'`), `status`, `amount_minor`, `currency` (`CRC`), `provider_reference`, `sinpe_reference`, `failure_reason`, `captured_at`, `refunded_at` | `supabase/migrations/20261121080600_orders.sql:99-117` | One row per order today. No table for refunds, webhook events or disputes yet |
| Unique index on `(provider, provider_reference)` | `…080600_orders.sql:120-121` | The gateway's payment id can be stored once only; a replayed webhook cannot attach it to a second order |
| Enums `payment_method` = `card`, `sinpe_movil`, `cash_on_delivery`, `bank_transfer`; `payment_status` = `pending`, `authorized`, `captured`, `failed`, `cancelled`, `refunded`, `partially_refunded` | `…080000_foundation.sql:65-68` | Enough states for the gateway; no new enum value is required |
| `private.capture_payment(p_order_id, p_provider_reference, p_cash)` — idempotent; returns silently if nothing is pending; raises `order_not_payable` if the order is already cancelled or refunded | `…081000_checkout.sql:46-92` | The webhook calls this. A payment that arrives after the order expired raises, so that case needs an automatic refund path |
| `public.confirm_sandbox_payment` refuses to run unless `payments_mode` is `sandbox` | `…081000_checkout.sql:455-478` | Stays as the local/demo path |
| `public.ops_confirm_payment(p_order_id, p_bank_reference)` — finance confirms a transfer by hand | `…081700_api_backoffice.sql:340-379` | Stays as the manual fallback when a transfer cannot be matched automatically |
| Order placement writes `provider` from the `payments_mode` setting and a `sinpe_reference` taken from the order number | `…081000_checkout.sql:420-426` | `provider` must become the gateway id (`onvo`), not the mode |
| Unpaid orders are cancelled after `reservation_minutes` (30) | `…081000_checkout.sql:517-539`, `…080000_foundation.sql:143-144` | The gateway object must be cancelled or expired at the same moment |
| Cancellation of a paid order and a refunded return emit `refund.requested` to `private.outbox_events` | `…081000_checkout.sql:143-146`, `…081700_api_backoffice.sql:247-249` | A worker turns this event into the gateway refund call |
| Money is an integer of minor units (céntimos for CRC) | `packages/core/src/money.ts:2` | Same unit ONVO uses |
| Webhook handler skeleton for a Supabase Edge Function, with the gateway-specific parts left open | `docs/research/supabase-auth-storage-wire-format.md` §5.1 | Section 6.6 below fills in the header name, encoding and signed string |
| Fee schedule assumes card 3.9% + ₡180 and SINPE Móvil 1.5% | `docs/01-product/pricing-and-fees.md:65-70` | Matches ONVO's published price page today; see section 2. Whether that card price is what ONVO may lawfully charge on Costa Rican cards is open (section 5.3) |

---

## 2. Candidates at a glance

"Open to a CR S.R.L." means a company incorporated in Costa Rica can contract it for domestic sales. Fees exclude IVA unless stated.

| Gateway | Open to a CR S.R.L. | Cards (published) | SINPE Móvil by API | Settlement | API style | Webhook authentication | Sandbox | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ONVO Pay** | Yes; self-service sign-up | 3.9% + US$0.35 | Yes, 1.5%; confirmed by webhook | Daily cut, funds next business day; CRC or USD; US$3 per payout; minimum US$30 or ₡20,000 | Payment intents, hosted checkout, web SDK | `X-Onvo-Signature: t=…,v1=…` HMAC-SHA256 over `t + "." + raw body` | Yes; test keys with the account | **Primary** |
| **Tilopay** | Yes; review in 48 business hours | 4.25% + US$0.35 | Yes, 2% + US$0.35; SDK only | Not published (**UNVERIFIED**) | Hosted page by redirect, JS SDK | None public: `OrderHash`, algorithm on request | Yes, but on the production host | **Fallback** |
| **BAC Credomatic e-commerce** | Yes, if affiliated to BAC and registered with Hacienda | Merchant rate not public (BCCR cap 1.95% local, 2.50% cross-border; see 5.3) + US$0.11–0.13 per processed transaction + US$50/month + US$175 once | No | To the merchant's BAC account; calendar not published | Third-party gateway (Cardinal, PowerTranz, Cybersource, Lyra) | Depends on the gateway (**UNVERIFIED**) | Gateway access and a test card are supplied for certification (BAC terms) | Later, for cost |
| BAC Compra Click | Same | Merchant rate + US$0.11 per transaction + US$25/month + US$50 once | No | "Directamente a tu cuenta BAC sin pasar por intermediarios" | Payment link only | — | — | Not an API product |
| Greenpay | Yes (Greenpay S.A., San José) | Not published | Not mentioned | Not published | Checkout, tokenisation API, hosted tokenisation form | Not readable (**UNVERIFIED**) | Yes (`greenpaysbx.me`) | Not enough public information |
| dLocal | **UNVERIFIED** for a domestic merchant; sales-led | Not published | Yes (`payment_method_id: "SJ"`) | Not published | Direct or redirect payments API | `Authorization: V2-HMAC-SHA256, Signature: …` over `X-Login + X-Date + body` | Yes | Built for cross-border merchants |
| Kushki | **UNVERIFIED**; Costa Rica reported as "coming soon" | Not published for CR | — | — | Documentation is password-protected | — | — | Not confirmed as available |
| PowerTranz (FAC) | Only through an acquiring bank; BAC resells it | See BAC row | No | Via the bank | Developer portal is password-protected | — | — | A component of the BAC route |
| PayPal | Yes | 5.40% + US$0.30 | No | Withdraw to a local bank: ₡625 per colón withdrawal | Not researched | Not researched | Not researched | No colón pricing; most expensive |
| Stripe | **No** | — | — | — | — | — | — | Not available |

Sources for this table are given per candidate in section 3.

### What a ₡20,000 order costs to collect

Using US$1 ≈ ₡515, the rate already assumed in `docs/01-product/pricing-and-fees.md:75`.

| Gateway and method | Calculation | Cost | Share |
| --- | --- | ---: | ---: |
| ONVO, card | 3.9% + US$0.35 | ₡960 | 4.8% |
| ONVO, SINPE Móvil | 1.5% | ₡300 | 1.5% |
| Tilopay, card | 4.25% + US$0.35 | ₡1,030 | 5.2% |
| Tilopay, SINPE Móvil | 2% + US$0.35 | ₡580 | 2.9% |
| PayPal | 5.40% + US$0.30, before a 3.5% currency conversion | ₡1,235+ | 6.2%+ |
| BAC direct, card | 1.95% (assumes BAC grants the capped rate) + US$0.12 | about ₡450 | 2.3% |

The card rows above assume the published prices are lawful as published. The BCCR caps the local acquiring commission at 1.95% including "cualquier otra retribución recibida por el adquirente de parte del afiliado relacionada con el pago", and lists ONVO and Tilopay as acquiring providers (section 5.3); if the cap applies to them for cards issued in Costa Rica, the ONVO and Tilopay card rows are overstated, and BAC's per-transaction and monthly gateway charges, when BAC itself bills them, may have to fit inside the 1.95% rather than sit on top of it. **UNVERIFIED**: no public statement from the BCCR, ONVO or Tilopay on how the cap applies to online payment facilitators was found.

Whether each gateway adds 13% IVA to its fee is not stated on the price pages (**UNVERIFIED** for ONVO; Tilopay's transaction query returns separate `iva_commission` and `cost_iva` fields, which implies it does). Hacienda's CAByS catalogue has a code for "Gestión de comisiones de tarjeta de crédito y débito, n.c.p." at 13% (`docs/research/hacienda-factura-electronica-v44.md:993`), which points the same way; budget 13% on top of the fee until ONVO confirms. ONVO also charges US$3 for each payout: paid out daily that is about US$66 a month, weekly about US$12. BAC's fixed US$50 a month plus a one-time US$175 means BAC only beats ONVO above roughly 60 card orders a month of this size, and only if the capped rate is granted.

---

## 3. Candidate details

### 3.1 ONVO Pay

| Topic | Finding | Source |
| --- | --- | --- |
| Company | ONVO Costa Rica S.A., cédula jurídica 3-101-815764. Its footer says it is registered with SUGEF for the art. 15 Ley 7786 activities "en particular la administración de recursos financieros de terceros y las transferencias sistemáticas de fondos", that this registration is for anti-money-laundering supervision only, that SUGEF does not supervise its business, security or solvency, and that it is not covered by the deposit guarantee fund. This is ONVO's own statement; SUGEF's register was not searched. Separately, the BCCR lists ONVO (and Tilopay and dLocal) among the registered acquiring service providers for cards | https://onvopay.com/pricing (footer); https://www.bccr.fi.cr/content/dam/bccr/bccr-espanol/sistema-de-pagos/tarjetas-de-pago/proveedores-adquirentes.xlsx |
| Prices, Costa Rica | Card 3.9% + US$0.35 per successful transaction. SINPE Móvil 1.5% per successful transaction. "SINPE" 2.5%, minimum US$0.50 (taken here to be the bank-transfer method the developer docs call SINPE PIN). Credix 2.50% + US$0.35 paid in one instalment | https://onvopay.com/pricing |
| Currencies | CRC and USD | same |
| Settlement | "Se realiza un corte diario y tendrás acceso a ese dinero el siguiente día hábil." Frequency daily, weekly, biweekly or monthly; US$3 per payout; minimum payout US$30 or ₡20,000 | same (FAQ text in the page source) |
| Processing limit | "El límite inicial cuando activás una nueva cuenta en ONVO es de US$2.000 al mes", raised on request with evidence of income | same |
| Withholding | "ONVO aplica el 0.777% de IVA, correspondiente a la retención que Hacienda nos traslada … No se retiene Renta. Este porcentaje puede ajustarse periódicamente." The 0.777% figure was not found in any Hacienda resolution (**UNVERIFIED**), and "no Renta" conflicts with the 2% income-tax withholding on card sales recorded at medium confidence in `docs/research/costa-rica-fact-sheet.md:32-33`; ask the accountant | same |
| Onboarding | "Proceso de afiliación 100% digital e inmediato"; home page shows identity document, facial check, OFAC/PEP screening and "Merchants listos en 24 a 48 horas". The document list for a legal entity is not public (**UNVERIFIED**) | https://onvopay.com/pricing, https://onvopay.com/ |
| API style | REST, JSON, `https://api.onvopay.com`, OpenAPI 3.1 "version 2.0". Payment intents (create, confirm, capture, cancel), hosted Checkout sessions, web SDK | https://docs.onvopay.com/openapi.yaml, https://docs.onvopay.com/en/llms-full.txt |
| Auth | `Authorization: Bearer <key>`. Keys `onvo_test_secret_key_…`, `onvo_live_secret_key_…`, `onvo_test_publishable_key_…`, `onvo_live_publishable_key_…`. The key decides test or live mode | https://docs.onvopay.com/en/authentication |
| 3-D Secure | Confirmation returns `status: "requires_action"` and `nextAction.redirectToUrl.url`; or a modal through `onvo.handleNextAction`. "When the issuer requires it" | https://docs.onvopay.com/en/payments/three-ds |
| Tokenisation | A card becomes a payment method (`id`, `card.brand`, `card.last4`, `card.expMonth`, `card.expYear`) attached to a customer; later charges send only `paymentMethodId` (and `cvv` when required) | OpenAPI `PaymentMethod`, `ConfirmPaymentIntent` |
| Refunds | `POST /v1/refunds` with `paymentIntentId` and optional `amount`; omitted amount refunds everything. Statuses `pending`, `succeeded`, `failed` | https://docs.onvopay.com/en/payments/refunds, OpenAPI `Refund` |
| Webhooks | Signed; events for payments, checkout, refunds, disputes, payouts, incoming transfers. Live retries with exponential backoff for up to 72 hours | https://docs.onvopay.com/en/webhooks |
| Idempotency keys | `Idempotency-Key` is documented **only** for subscription schedules. Nothing for payment intents or refunds | OpenAPI (the header appears once, on `/v1/subscription-schedules`) |
| Sandbox | Test keys created with the account; test cards and test SINPE Móvil numbers | https://docs.onvopay.com/en/payments/testing |
| SINPE Móvil | Supported through payment intents and through hosted Checkout (`paymentMethodTypes` accepts `mobile_number`). CRC only | https://docs.onvopay.com/en/payments/sinpe-mobile, OpenAPI `CreateOneTimeLink` |
| Marketplace | Connected seller accounts with ONVO-hosted onboarding (seller gives IBAN accounts; link expires in 7 days); charge with `onBehalfOf: <account id>`; `marketplaceAppFee` is a percentage 0–100 with two decimals; optional fixed weekly fee. One connected account per payment. Available in Costa Rica and Guatemala. Marketing page lists "Visa, Mastercard, American Express, SINPE" for marketplaces without saying whether that includes SINPE Móvil | https://docs.onvopay.com/en/payments/marketplaces, https://onvopay.com/business-model-marketplace |
| PCI scope | ONVO's own guidance: tokenise in the browser with the publishable key, or use Checkout or the SDK; "If your backend receives or transmits PAN, CVV, or full card data, that integration is in your PCI scope and may require SAQ D validation." Home page claims "PCI DSS Nivel 1" | https://docs.onvopay.com/en/payments/payment-intents |

### 3.2 Tilopay

| Topic | Finding | Source |
| --- | --- | --- |
| Company | Tilopay Soluciones Comerciales Limitada; "Participante SINPE directo · Código 369 (PSP)" | https://tilopay.com/api-bancario |
| Prices, Costa Rica | Visa, Mastercard, American Express 4.25% + US$0.35. SINPE Móvil 2% + US$0.35. No affiliation fee or monthly fee | https://tilopay.com/tarifas |
| Withholdings | The transaction query returns `commission`, `iva_commission`, `retention_iva`, `retention_rent`, `cost`, `cost_iva`, `net_to_liquidate`, so both IVA and income tax are withheld | https://tilopay.com/en/developers/api/procesos-operativos/consult |
| Onboarding | Business e-mail, legal data, documents by type of person, bank account in the merchant's name, active website or social profile; reviewed "en las próximas 48 horas hábiles". SINPE Móvil needs a CRC account configured | https://tilopay.com/guias/afiliacion/como-afiliarse-a-tilopay, https://tilopay.com/guias/pasarelas/como-activo-sinpe-movil-en-tilopay |
| API style | Four paths: plugins; hosted payment page (`POST /api/v1/processPayment` returns a URL); JavaScript SDK with card inputs on the merchant page; server-to-server only for PCI-certified merchants | https://tilopay.com/en/developers/api/caminos-de-integracion |
| Auth | `POST https://app.tilopay.com/api/v1/login` with `apiuser`, `password` → `access_token` (24 h). SDK token from `/api/v1/loginSdk` (1 h). Header `Authorization: bearer <token>`. Tokens cannot be revoked | https://tilopay.com/en/developers/api/autenticacion |
| 3-D Secure | Handled by the hosted page and by the SDK; test challenge code `3ds2` | https://tilopay.com/en/developers/tarjetas-de-prueba |
| Tokenisation | `processTokenize`, credential-on-file charges, saved-card groups | https://tilopay.com/llms.txt |
| Refunds | `POST /api/v1/processModification` with `orderNumber`, `type` (`1` capture, `2` refund, `3` reversal), `amount`, `key`. `ReasonCode: "1101"` means approved | https://tilopay.com/en/developers/api/procesos-operativos/process-modification |
| Webhooks | Purchases: **one attempt, no retry**; success is HTTP 200. "The only origin verification available is the `orderHash`, and its algorithm is not public." The `processPayment` webhook specification is sent on request | https://tilopay.com/en/developers/api/webhooks |
| Idempotency | "The Tilopay acquiring API is not idempotent." `orderNumber` is unique per merchant forever; a repeat is rejected as "Transacción duplicada". After a timeout, call `POST /api/v1/consult` first | https://tilopay.com/en/developers/reintentos-seguros |
| Sandbox | "There is no sandbox host." Test mode is a switch in the account on `app.tilopay.com`; `Tilopay.Init()` returns `environment: "TEST"` or `"PROD"`. 27 test cards | https://tilopay.com/en/developers/entornos |
| SINPE Móvil | JS SDK only: `Tilopay.getSinpeMovil()` returns `{ code, amount, number }`; the shopper writes `code` in the transfer description. Tilopay matches transfers to orders created in the last **25 minutes**. Result goes to the `redirect` and to the `webhook` URL given to `Init()` | https://tilopay.com/en/developers/sdk/reference/get-sinpe-movil |
| Split | `POST /api/v1/orders/liquidation/split` with `order_id` and `commerces: [{ email, amount }]`; only for merchants using Tilopay as payment facilitator, same country, fully approved orders | https://tilopay.com/en/developers/api/procesos-operativos/split |
| Quirks | HTTP 200 can carry an error; five different error envelopes; amounts are decimal strings in major units (`"1.00"`), not minor units; `status` and `type` are sometimes numbers and sometimes strings | https://tilopay.com/en/developers/api/procesos-operativos/errors, https://tilopay.com/en/developers/api/convenciones |
| PCI scope | Hosted page: "you never see a card number". SDK: "Card data does not pass through your server, but your page captures it" | https://tilopay.com/en/developers/hosted-payment-page, https://tilopay.com/en/developers/sdk |

### 3.3 BAC Credomatic

- **Compra Click** is a payment link hosted by BAC with 3-D Secure, not an API. Implementation US$50 + IVA, US$25 + IVA a month, US$0.11 + IVA per transaction; requires BAC affiliation and registration with Hacienda. (https://www.baccredomatic.com/es-cr/pymes/compra-click)
- **E-Commerce BAC** connects the merchant's site through a gateway. Published gateway costs, each on top of the merchant commission in the affiliation contract (not public):

  | Gateway | Enrolment | Monthly | Per processed transaction | Optional |
  | --- | --- | --- | --- | --- |
  | Cardinal | US$175 + US$75 set-up | US$50 | US$0.12 | — |
  | PowerTranz (FAC) | US$175 | US$50 | US$0.11 | Tokenisation US$0.10, Kount US$0.10 |
  | Cybersource | US$175 | US$50 | US$0.13 | Tokenisation US$0.06, Decision Manager US$0.07 |
  | Lyra | US$175 | US$50 | US$0.11 | — |

  All plus IVA. "Processed transaction" counts auth, capture, void, sale, settlement batch and refund separately. Requirements: affiliated to BAC, a published site on its own domain, TLS 1.2 or later, visible terms, privacy policy and returns policy; "toda solicitud … pasará por un análisis previo". (https://www.baccredomatic.com/es-cr/pymes/ventas-digitales)
- No SINPE Móvil through these products.
- Contract terms relevant to chargebacks are in section 5.

### 3.4 The rest

| Gateway | Finding | Source |
| --- | --- | --- |
| Stripe | "Stripe is currently supported in the following countries/regions" lists 51 entries; Costa Rica is not among them. Mexico and Brazil are the only Latin American ones | https://stripe.com/global, opened today |
| PayPal | Costa Rica sellers pay 5.40% + fixed fee on domestic and international receipts (4.40%–4.90% by volume, on approval). Fixed-fee table has no CRC row, so charges are in USD or another listed currency; conversion costs 3.50% above the base rate when receiving. Withdrawal to a bank: CRC 625 per colón withdrawal, or 1% (minimum US$10) in dollars. Chargeback fee US$10 | https://www.paypal.com/cr/webapps/mpp/merchant-fees (page dated 28 Oct 2026) |
| dLocal | Costa Rica: cards (Visa, Mastercard, Amex, Diners, Discover, JCB; minimum 100 CRC; refunds and chargeback disputes supported), SINPE (`IO`, minimum 1,000 CRC) and SINPE Móvil (`SJ`, minimum 10 CRC, "Notification delay: Immediate", refunds yes). Notifications carry the payment object, are signed like requests (HMAC-SHA256 of `X-Login + X-Date + body` in `Authorization`), and are retried until a `2xx`, "maximum attempts: 12", on a schedule of hourly for 6 hours then every 12 hours for 4 days (the schedule adds up to 14, so the page is inconsistent; ask dLocal). "dLocal for Platforms" splits a payment among several sellers. Pricing and domestic onboarding are not public | https://docs.dlocal.com/docs/costa-rica, https://docs.dlocal.com/docs/receive-notifications, https://docs.dlocal.com/docs/generate-signature, https://docs.dlocal.com/docs/platforms-overview |
| Greenpay | Cards (Visa, Mastercard, Amex), Credix, card registration, recurring, links, batch; Kount, 3-D Secure; sandbox host `tokenization.greenpaysbx.me`. No prices, no SINPE Móvil, and the API articles sit in a help centre that renders only in a browser, so the API contract and webhook signing are **UNVERIFIED** | https://greenpay.me/, https://support.greenpay.me/portal/es/home, https://cdn.jsdelivr.net/wp/greenpay-payment-service/trunk/README.md |
| Kushki | `docs.kushki.com` answers "Esta documentación requiere una contraseña para acceder". A search result describes a Kushki page listing Costa Rica as coming soon; the page itself returned 404 today, so availability is **UNVERIFIED** | https://docs.kushki.com/ |
| PowerTranz / FAC | A gateway for "the Central America and Caribbean region" integrated with banks; lists Tilopay as a partner. `developer.powertranz.com` is password-protected. In Costa Rica it is bought through BAC (table above) | https://powertranz.com/, https://developer.powertranz.com/ |

---

## 4. SINPE Móvil: receiving it and reconciling it automatically

### 4.1 Rules and limits

The BCCR pages and its "Norma complementaria SINPE Móvil" returned HTTP 404 from this environment today, so the figures below come from press reports and from the project's own fact sheet, which read the BCCR page earlier. Treat them as medium confidence until someone opens the BCCR text.

| Rule | Value | Source |
| --- | --- | --- |
| Currency | Colones only; one account per phone number | `docs/research/costa-rica-fact-sheet.md:141-142` |
| Free to the sender | Up to ₡100,000 accumulated per day; above that banks charge US$2–3 per transfer | fact sheet; La Nación, 17 Mar 2025 |
| Daily sending cap, SMS and WhatsApp | ₡100,000, from 1 June 2026, and only if the user has set that amount (reform of the Reglamento del Sistema Nacional de Pagos Electrónicos) | El Financiero, 14 Apr 2026 |
| Daily sending cap, bank apps | Unchanged: up to ₡500,000, set by each user | same |
| Per-bank examples | Banco Nacional ₡500,000/day free; BCR ₡200,000; BAC ₡100,000 then US$3 each | La Nación, 17 Mar 2025 |
| Receiving | ₡2,000,000 a month free; Banco Popular charges 0.25% on the excess | fact sheet; La Nación, 17 Mar 2025 |
| Tax | Decreto 45953-H (16 Oct 2026): taxpayers register the SINPE Móvil numbers they collect on; e-invoice payment code `06` | `docs/research/costa-rica-fact-sheet.md:61-63,80-82` |
| Finality | A SINPE Móvil transfer is a push payment with no card-style chargeback. **UNVERIFIED** against the BCCR text | — |

Consequence for checkout: a shopper whose bank limit is ₡100,000 a day cannot pay a larger order by SINPE Móvil. Show that warning above ₡100,000 and offer card. ONVO's "SINPE PIN" (bank transfer to an IBAN, 2.5%, minimum US$0.50, enabled on request, real-time transfers only) covers larger amounts.

### 4.2 Ways to get an automatic confirmation

| Option | How a transfer is tied to an order | Confirmation | Cost | Notes |
| --- | --- | --- | --- | --- |
| **ONVO payment intent** (recommended) | Payer's identification + exact amount, checked **before** SINPE sends the transfer; an unmatched transfer is refused and the money never leaves the payer's account | Webhook `payment_intent.succeeded` | 1.5% | Shopper transfers to ONVO's number `+506 7019 6686`, or to a custom number ONVO assigns on request. Source: https://docs.onvopay.com/en/payments/sinpe-mobile |
| ONVO custom number | Same, plus every incoming transfer is reported | Webhook `mobile_transfer.received`; `GET /v1/mobile-transfers/list` (`paymentIntentId: null` = unmatched) | On request (**UNVERIFIED**) | Lets finance see transfers that did not match |
| Tilopay SDK | Code written in the transfer description + exact amount, orders from the last 25 minutes | Browser redirect and an unsigned call to `webhook`; confirm with `POST /api/v1/consult` | 2% + US$0.35 | Matches the `sinpe_reference` idea already in the schema |
| Tilopay Banking API | Deposits validated against purchase orders; "los depósitos no asociados se rechazan automáticamente" | Webhook `payin.posted`, body `{"data":"<base64>"}` encrypted with AES-256-GCM, key = SHA-256 of the shared secret, 12-byte nonce prefix, up to 3 attempts | Not published; access on request | A separate product from the gateway, with its own host `api-baas.tilopay.com`. Source: https://tilopay.com/developers/api-bancario/webhooks |
| dLocal `SJ` | dLocal's own reference | Signed notification to `notification_url` | Not published | Cross-border product |
| BAC Simple Pay | Validates SINPE Móvil payments received on a BAC account "al instante"; web portal with reports | A screen, not an API (no API is documented) | Not published | Needs a BAC account and a SINPE Móvil number linked to it. Source: https://www.baccredomatic.com/es-cr/pymes/herramientas-de-venta |
| Davivienda "SINPE Móvil Empresarial" | Reported to validate payments and integrate by API | **UNVERIFIED**: the article could not be opened | — | Ask the bank |
| Manual | Finance reads the bank statement and types the reference | `public.ops_confirm_payment` | Staff time | Exists today; keep as the exception path |

No public BCCR API for merchants was found; every automatic option goes through a payment provider or one bank's own tool.

---

## 5. Card data, PCI scope and chargebacks

### 5.1 Storing nothing but tokens

| Rule | Detail | Source |
| --- | --- | --- |
| What may be stored | The gateway's ids (`paymentMethodId`, `customerId`, `paymentIntentId`, refund and dispute ids), `card.brand`, `card.last4`, `card.expMonth`, `card.expYear` | ONVO returns exactly these on a payment method (OpenAPI `PaymentMethod`) |
| What must never reach our servers, logs or database | Card number, CVV, and anything typed into a card field | ONVO: a backend that "receives or transmits PAN, CVV, or full card data" is in PCI scope "and may require SAQ D validation" |
| Webhooks are safe to store whole | "It never includes card numbers, tokens, full IBANs, identification numbers, or secrets" | https://docs.onvopay.com/en/webhooks/events |
| Hosted page by redirect → SAQ A | The script-protection criterion added to SAQ A in PCI DSS v4.0.1 "does not apply" to merchants that redirect customers to the processor | PCI SSC FAQ 1588 (Feb 2025), https://www.pcisecuritystandards.org/faqs/1588/ |
| Processor's iframe embedded in our page → SAQ A with a condition | The merchant must confirm the page "is not susceptible to attacks from scripts": either apply PCI DSS requirements 6.4.3 and 11.6.1 to the page, or get the provider's written confirmation that its embedded solution protects against script attacks | same |
| Our page builds the form and posts from the browser → SAQ A-EP | "If any element of a payment page originates from the merchant's website, the implementation is not eligible for SAQ A." | PCI SSC FAQ 1292, https://www.pcisecuritystandards.org/faqs/1292/ |
| Local acquirer's position | BAC does not require PCI DSS certification under one million transactions a year, but the merchant "es responsable de garantizar que la integración de la pasarela de pagos cumpla con los estándares de seguridad" | BAC e-commerce terms F-CRI-0006171 V5, §3 |
| Saved cards are personal data | A token tied to a person needs the consent and notice that Ley 8968 requires | `docs/research/costa-rica-fact-sheet.md:117-131` |

Which SAQ each integration path lands in:

| Path | Who renders the card fields | SAQ |
| --- | --- | --- |
| ONVO hosted Checkout by redirect | ONVO, on `checkout.onvopay.com` | A |
| ONVO web SDK (`onvo.pay(...).render("#container")`) | **UNVERIFIED**: `sdk.onvopay.com/sdk.js` refused an automated download, so whether it mounts an ONVO-hosted iframe could not be checked | A if it is an iframe (with the script condition), otherwise A-EP |
| Our own form calling `POST /v1/payment-methods` with the publishable key | Us | A-EP |
| Tilopay hosted payment page | Tilopay | A |
| Tilopay JS SDK | Our page (inputs `tlpy_cc_number`, `tlpy_cvv`) | A-EP |
| SINPE Móvil, cash on delivery | No card data | Out of scope |

**Use the hosted Checkout redirect for cards at launch.** It is SAQ A without conditions, needs no change to the Content-Security-Policy, and works unchanged inside a native app's system browser.

### 5.2 Chargebacks in Costa Rica

| Point | Detail | Source |
| --- | --- | --- |
| Who decides | Visa and Mastercard rules, applied by the issuer and passed down through the acquirer or gateway | BAC terms §7 |
| Cardholder's window | **60 calendar days** after the transaction is recorded, or after the date the product was due to arrive for sales delivered later. Every card transaction can be disputed, whatever its type or amount, and the card brands must run chargebacks for all of them. (Card-network rules can give a longer window for some reasons; El Financiero, 26 Dec 2022, reported up to 120 calendar days at one bank) | Reglamento del Sistema de Tarjetas de Pago (BCCR, published 18 Dec 2025), art. 25 |
| Provisional refund to the cardholder | Within **5 business days** for "constatación inmediata" cases, which include any card-not-present payment the issuer authorised without strong authentication when the issuer did not ask for it, and any charge presented more than 30 calendar days after authorisation through the acquirer's fault | same, art. 26 |
| Time to resolve | Issuer investigates within **45 business days**, at most 90 business days with a documented reason. The acquirer bears the claim for duplicate, late or defective processing; the merchant (afiliado) bears it, passed on by the acquirer, when a card-not-present payment "fue ejecutada con un servicio de adquirencia que no cumple con los requerimientos establecidos para este tipo de operaciones" | same, art. 27 |
| Strong authentication | For a card-not-present payment with a card issued in Costa Rica, "sin importar el monto", the **issuer** must require strong customer authentication based on information other than what is printed on the card. The acquirer must make sure the merchant meets the applicable PCI requirements, and a merchant that charges card-not-present payments without meeting the industry standards "debe asumir la responsabilidad sobre todas las operaciones reclamadas por el cliente" | same, arts. 15 and 33 |
| Fraud liability | With 3-D Secure correctly integrated, Visa and Mastercard transactions "no serán objeto de reclamo por motivo de fraude"; without it "el comercio asume el 100% de la responsabilidad por cualquier contracargo por fraude". 3-D Secure does not cover other dispute reasons, nor corporate Visa cards issued in the USA and Costa Rica | BAC terms §§II.l, 7.5 |
| Evidence duty | Keep transaction records at least 18 months; answer the acquirer's request within 3 business days or lose the dispute; lost disputes are deducted from future settlements | BAC terms §§7.3, 7.4 |
| Shipping rule | The merchant may not submit a charge "si el producto o servicio no ha sido apropiadamente enviado o prestado"; an authorisation lasts 5 calendar days | BAC terms §§2.1, 2.3 |
| ONVO's process | Events `dispute.created`, `dispute.updated`, `dispute.closed`; statuses `needs_response`, `under_review`, `won`, `lost`; a deadline in `responseDueAt`; a closed dispute can be reversed later. How evidence is submitted, the dispute fee and whether ONVO holds a reserve are not documented (**UNVERIFIED**) | https://docs.onvopay.com/en/webhooks/events |
| PayPal | US$10 per chargeback | PayPal fee page |

The BAC terms bind only BAC's own merchants, but they are the one public statement of how a Costa Rican acquirer allocates liability, and a gateway's contract will pass the same card-network rules down. The BCCR regulation applies to every provider in the card system. What this project already records is strong evidence for "item not received": the 4-digit delivery code checked on the server, the driver, the time and the position. Keep those 18 months. Because the cardholder's 60 days run from the date the product was due for goods delivered later, the clock for an order starts at its promised delivery date, not at payment. The consumer-law duties (refund by the same payment method within 8 calendar days of a withdrawal) are in `docs/research/costa-rica-fact-sheet.md:88-92`.

### 5.3 Regulation that applies to the gateway and to Yuntera

| Point | Detail | Source |
| --- | --- | --- |
| Card fee caps in force | Local acquiring commission (what the acquirer charges the merchant) at most **1.95%**, since 19 Feb 2024; local interchange at most **1.00%**, since 20 Feb 2025; cross-border acquiring at most **2.50%** and cross-border interchange at most 1.00%. 1.50% for service stations, EV charging, tolls, ARESEP-regulated transport and charities. An acquirer may add at most ₡14,000 a month per point-of-sale terminal (not relevant online). The 2026 ordinary review was in public consultation on 21 Nov 2026; press reports say it proposes no change (**UNVERIFIED** as final) | Reglamento del Sistema de Tarjetas de Pago, arts. 44–48 (approved by the BCCR board in session 6298-2025, 17 Dec 2025; published in Alcance 163 to La Gaceta 238, 18 Dec 2025); BCCR tables "Comisiones máximas de adquirencia / intercambio 2020-2026"; Ley 9831 |
| What the cap includes | The local acquiring commission includes "los pagos netos, descuentos, incentivos o cualquier otra retribución recibida por el adquirente de parte del afiliado relacionada con el pago … tales como … los montos mínimos de facturación, la tecnología de comunicación … y el acceso a información". Excluded: charges for lost or damaged terminals, the issuer's instalment charges, and services "que no estén relacionados directamente con el pago", such as invoicing, accounting, inventory or data analysis | Reglamento, art. 2 ("Comisión de adquirencia local"), art. 45 |
| Who is an acquirer | "Proveedor de servicios que ha suscrito un contrato con un afiliado, para la aceptación y el procesamiento de operaciones con dispositivos de pago que reporten una transferencia de fondos al afiliado." A "pasarela de pagos" is a separate defined role. The BCCR's list of acquiring providers includes ONVO, Tilopay and dLocal besides the banks | Reglamento, art. 2; BCCR `proveedores-adquirentes.xlsx` |
| Consequence | If ONVO or Tilopay is the acquirer for a payment with a Costa Rican card, the published 3.9% + US$0.35 and 4.25% + US$0.35 are above 1.95% on their face. Whether those providers treat part of the price as a non-payment service, act only as a gateway in front of a bank acquirer, or apply the cap only to some cards, is not public (**UNVERIFIED**). Ask in writing, have a lawyer read the answer, and do not put 3.9% into seller fees as a regulated cost until then | analysis of the above |
| Settlement rule | Acquirers must credit colón card payments to the merchant's account "a más tardar dos horas después" of BCCR settlement. ONVO publishes next-business-day access after a daily cut, and payouts at a chosen frequency; how the two fit is a question for ONVO | Reglamento, art. 22 |
| Registration of Yuntera itself with SUGEF | Art. 15 of Ley 7786 makes non-financial legal persons that systematically and substantially carry out, among others, transfers of funds or the administration of third-party resources register with SUGEF for anti-money-laundering supervision (Acuerdo SUGEF 11-18). Press summaries put "sustancial" at US$400,000 or more in 12 months and "sistemática" as organised and habitual. A marketplace that collects the buyer's money as the single merchant and later pays sellers their share may fall in this; one that has the gateway pay each seller directly (ONVO `onBehalfOf`, Tilopay split) may not. **UNVERIFIED**: the current text of art. 15 was not opened in a primary source (the SCIJ page did not render), the thresholds come from El Financiero (3 Feb 2019, secondary), and whether a marketplace's seller settlement is covered is a legal judgement | ONVO's own footer (which describes these activities); https://www.elfinancierocr.com/economia-y-politica/quienes-estan-obligados-a-inscribirse-ante-sugef/MH2BCNDUMNFCHP7YXWQI557MNA/story/ |
| Recent change to Ley 7786 | Ley 10961 (published 19 Jun 2026 per a law firm's summary; in force three months later) adds art. 15 quater for virtual-asset service providers. It does not change the analysis above as far as was read; ONVO's crypto method is not used here | Text of Ley 10961 (bufetedecostarica.com copy, secondary) |
| Card-not-present authentication | See 5.2: the issuer must authenticate every card-not-present payment with a Costa Rican card. 3-D Secure through the gateway is therefore not optional in practice; the open question in section 11 about a 3-D Secure mandate is answered for cards issued in Costa Rica | Reglamento, art. 15 |

---

## 6. Primary gateway: ONVO Pay integration specification

Everything in this section is quoted from https://docs.onvopay.com/en/llms-full.txt and https://docs.onvopay.com/openapi.yaml as fetched today, unless marked.

### 6.1 Configuration

| Key | Example | Where it lives |
| --- | --- | --- |
| `ONVO_SECRET_KEY` | `onvo_test_secret_key_…` / `onvo_live_secret_key_…` | Server only (Edge Function secret). Never in an app bundle |
| `ONVO_PUBLISHABLE_KEY` | `onvo_test_publishable_key_…` | Browser, only if the SDK or 3-D Secure modal is used |
| `ONVO_WEBHOOK_SECRET` | `whsec_…` | Server only; one per webhook endpoint and per mode |
| `ONVO_SINPE_NUMBER` | `+50670196686` (default) | Server setting; replaced if ONVO assigns a custom number |
| Base URL | `https://api.onvopay.com` | Same host for test and live; the key selects the mode |

Errors: validation errors are `{ "statusCode": 400, "message": ["…"], "error": "Bad Request" }`; domain errors are `{ "statusCode", "type": "OnvoAPIError", "code", "message", "path", "timestamp", "details"? }`. Status codes 400, 401, 403, 404, 409, 422, 500. Successful creates return **201**.

Amounts: "integers in the currency's smallest unit: `500000` in `CRC` is ₡5,000.00". Minimum US$0.50 or its colón equivalent. `metadata`: up to 50 pairs, string keys of at most 40 characters and string values of at most 500.

### 6.2 Card payment, launch path: hosted Checkout by redirect

Server, with the secret key:

```http
POST https://api.onvopay.com/v1/checkout/sessions/one-time-link
Authorization: Bearer onvo_test_secret_key_…
Content-Type: application/json

{
  "lineItems": [
    { "quantity": 1, "unitAmount": 2150000, "currency": "CRC", "description": "Pedido YT-100123" }
  ],
  "customerName": "Nombre Apellido",
  "customerEmail": "comprador@example.com",
  "customerPhone": "+50688880000",
  "redirectUrl": "https://<shop>/pedidos/<order_id>/pago/retorno",
  "cancelUrl": "https://<shop>/pedidos/<order_id>/pago",
  "paymentMethodTypes": ["card"],
  "metadata": { "orderId": "<order uuid>", "paymentId": "<payment uuid>", "orderNumber": "YT-100123" }
}
```

Response `201`, a Checkout Session. Fields in the schema: `id`, `accountId`, `url` (for example `https://checkout.onvopay.com/pay/<id>`), `status` (`open`, `complete`, `expired`), `paymentStatus` (`unpaid`, `paid`), `paymentIntentId`, `successUrl`, `cancelUrl`, `lineItems`, `mode`, `createdAt`, `updatedAt`.

- Send **one line item for the order total** (items plus shipping, IVA included) so the amount charged is exactly `payments.amount_minor`.
- Store `session.id` on the payment row immediately; store `paymentIntentId` when it is known, because refunds need it.
- Client step: navigate the browser to `url`. In a native app open `url` in the system browser session and return through a deep link placed in `redirectUrl`.
- The shopper comes back to `redirectUrl` or `cancelUrl`. What query parameters ONVO appends is not documented (**UNVERIFIED**), so put the order id in the path yourself and treat the return as a hint: show "confirmando el pago" and wait for the webhook, or read `GET /v1/checkout/sessions/{id}`.
- When the order expires or is cancelled unpaid: `POST /v1/checkout/sessions/{id}/expire`.
- Confirmation: webhook `checkout_session.succeeded` (object fields `id`, `status`, `paymentStatus`, `paymentMode`, `amountSubtotal`, `amountTotal`, `currency`, `paymentIntentId`, `customerId`, `clientReferenceId`, `metadata`, `expiresAt`, `createdAt`, `updatedAt`). Whether the payment intent created by a session inherits the session's `metadata` is not stated (**UNVERIFIED**), so resolve the order from the session event, not from the intent event.
- Manual capture is "not available for Checkout or the embedded payment SDK": the card is charged when the shopper pays.
- A marketplace charge would add `"onBehalfOf": "<connected account id>"`. Not used at launch.

### 6.3 Card payment, later path: payment intent on our own page

For a checkout that never leaves the site. Requires the SAQ answer from section 5.1 first.

```http
POST https://api.onvopay.com/v1/payment-intents
Authorization: Bearer <secret key>
Content-Type: application/json

{ "amount": 2150000, "currency": "CRC", "description": "Pedido YT-100123",
  "metadata": { "orderId": "<uuid>", "paymentId": "<uuid>" } }
```

Response `201`, a Payment Intent: `id`, `amount`, `baseAmount`, `exchangeRate`, `capturableAmount`, `receivedAmount`, `captureMethod` (`automatic` default, `manual`), `currency`, `customerId`, `description`, `charges[]`, `lastPaymentError`, `mode`, `status`, `metadata`, `onBehalfOf`, `nextAction`, `createdAt`, `updatedAt`.

`status` values: `requires_payment_method` (initial, and again after a decline), `requires_action`, `requires_capture`, `processing`, `succeeded`, `failed`, `refunded`, `partially_refunded`, `canceled`.

Client, with the SDK:

```html
<script src="https://sdk.onvopay.com/sdk.js"></script>
<div id="container"></div>
<script>
  onvo.pay({
    publicKey: "onvo_test_publishable_key_…",
    paymentIntentId: "<id from the server>",
    paymentType: "one_time",
    customerId: "<optional ONVO customer id>",
    locale: "es",
    onSuccess: (data) => { /* show "confirmando"; the webhook decides */ },
    onError: (data) => { /* data.details?.card?.reason: issuer_declined | gateway_declined | onvo_declined | processor_error | unknown */ }
  }).render("#container");
</script>
```

Without the SDK the steps are: `POST /v1/payment-methods` from the **browser** with the publishable key (`type: "card"`, `card: { number, expMonth, expYear, cvv, holderName }`) → send only the returned `id` to our server → `POST /v1/payment-intents/{id}/confirm` with `{ "paymentMethodId": "…", "returnUrl": "https://…" }`. If the response has `status: "requires_action"`, redirect to `nextAction.redirectToUrl.url`; ONVO returns the shopper to `returnUrl?payment_intent_id=<id>`; then `GET /v1/payment-intents/{id}` and wait for the webhook. The same step can be done in a modal with `<script src="https://js.onvopay.com/v1/"></script>` and `ONVO(publishableKey).handleNextAction({ paymentIntentId })`. That script also offers `startSignalSession({ paymentIntentId })` for fraud signals, recommended for API-only integrations.

Content-Security-Policy for this path must allow at least `sdk.onvopay.com`, `js.onvopay.com` and `api.onvopay.com`; the `js.onvopay.com/v1/` script also references `songbird.cardinalcommerce.com` and `h.online-metrix.net` (seen in the file fetched today). The hosted-redirect path needs none of this.

### 6.4 SINPE Móvil

Three server calls with the secret key, then our own instructions screen. No card data is involved, so this can be a fully native screen.

```http
POST /v1/payment-intents
{ "amount": 2150000, "currency": "CRC", "description": "Pedido YT-100123",
  "metadata": { "orderId": "<uuid>", "paymentId": "<uuid>" } }

POST /v1/payment-methods
{ "type": "mobile_number",
  "mobileNumber": { "identification": "01-1393-1919", "identificationType": 0, "number": "+50688888888" },
  "billing": { "name": "Nombre Apellido", "email": "comprador@example.com" } }

POST /v1/payment-intents/<intent id>/confirm
{ "paymentMethodId": "<payment method id>" }
```

After the confirm the intent is `processing`, meaning "ONVO is waiting to receive and associate the transfer". Then show the shopper the destination number and the exact amount, and wait for `payment_intent.succeeded`.

| Rule | Detail |
| --- | --- |
| Matching | "ONVO accepts it only if there's a payment intent in `processing` with the same identification and the same amount as the transfer." No partial or higher amounts |
| No match | "ONVO rejects the transfer before it's sent: the money never leaves the buyer's account." So confirm the intent **before** showing the instructions |
| `mobileNumber.number` | The **payer's** SINPE Móvil number, `+506` plus 8 digits (12 characters) |
| `identification` | Exactly as the payer's bank reports it, dashes included; 12 characters |
| `identificationType` | `0` national individual `0#-####-####` · `1` resident `1###########` · `2` state entity `2-###-######` · `3` legal entity `3-###-######` · `4` autonomous institution `4-000-######` · `5` diplomat `5###########` · `9` foreign national `9###########` |
| Paying from a company account | Use type `3` and the company's legal id |
| Destination | `+506 70196686` by default; a custom number is assigned by ONVO support on request |
| Events | `payment_intent.processing` when the wait starts (can repeat), then `payment_intent.succeeded`. `mobile_transfer.received` only for merchants with a custom number |
| Expiry | Not documented. Cancel the intent ourselves with `POST /v1/payment-intents/{id}/cancel` when the 30-minute reservation ends; after that a late transfer is refused by ONVO instead of arriving for a cancelled order |
| Reconciliation | `GET /v1/mobile-transfers/list` with filters `status` (`pending`, `received`, `attempt_not_found`, `charge_not_found`, `expired`, `canceled`), `SINPERefNumber` (25 characters), `originId`, `originName`, `description`, `createdAt[gte]` …; returns `400` unless the account has a custom number |
| Checkout form | Must ask whose account pays: identification type and number, and the SINPE Móvil phone. Pre-fill from the profile; validate with the identifier helpers in `packages/core/src/cr` |

The existing `payments.sinpe_reference` is not used by ONVO for matching. Keep showing the order number as the suggested description, because it helps a person reading a bank statement, and it is what Tilopay's flow would need.

### 6.5 Webhooks

Endpoints are created in the Dashboard under **Developers > Webhooks**; they "cannot be created or changed with API keys". The URL must be `https://` on port 443, a domain name that resolves to public addresses, at most 2,048 characters, and not an ONVO domain. Up to 16 endpoints per mode; test and live are separate, each with its own `whsec_…` secret. "Selecting all stores the current list: event types ONVO adds later are not subscribed automatically."

Request headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json; charset=utf-8` |
| `User-Agent` | `ONVO-Webhooks` |
| `X-Onvo-Signature` | `t=1785758400,v1=5257a8…` |
| `X-Onvo-Event-Id` | `evt_…`, the same across endpoints, retries and resends |
| `X-Onvo-Delivery-Id` | `whd_…` |
| `X-Onvo-Attempt-Id` | `wha_…`, new for each attempt |

Envelope: `{ "id": "evt_…", "object": "event", "createdAt": "<ISO 8601 UTC>", "mode": "test" | "live", "accountId": "…", "type": "…", "data": { "object": { "object": "<resource type>", … }, "previousAttributes"?: { … } } }`. Unknown fields must be ignored; optional fields without a value are omitted.

Events to subscribe to:

| Event | When | What to do |
| --- | --- | --- |
| `checkout_session.succeeded` | A hosted session was paid | Capture the order (card path) |
| `payment_intent.succeeded` | An intent succeeded; for a payment made of several transfers, only once the full amount arrived | Capture the order (SINPE Móvil path) |
| `payment_intent.processing` | Waiting for a transfer; one per attempt | Nothing, or mark "esperando transferencia" |
| `payment_intent.failed` | One attempt failed (decline, failed 3-D Secure). "The intent can still succeed with another attempt" | Store the reason in `failure_reason`; do **not** cancel the order |
| `payment_intent.canceled` | The intent was cancelled | Mark the payment `cancelled` if still pending |
| `refund.created` | ONVO accepted a refund request | Record the refund id |
| `refund.succeeded` | Refund completed | Mark refunded, post the ledger refund |
| `refund.failed` | Refund failed for good; `failure.code` is `insufficient_funds`, `merchant_cannot_process`, `declined` or `unknown` | Alert finance; refund by another means |
| `dispute.created`, `dispute.updated`, `dispute.closed` | Chargeback lifecycle | Open a case; hold the affected seller payout; on `lost`, book it |
| `payout.created`, `payout.paid`, `payout.failed` | ONVO pays our bank account | Reconcile the bank deposit; amounts arrive as strings |
| `mobile_transfer.received` | Custom number only | Reconcile unmatched transfers |
| `webhook_endpoint.test` | "Test connection" button; cannot be subscribed, not retried | Verify the signature, answer 200 |

Success, as printed in the documentation:

```json
{
  "id": "evt_vx7r5r6m33g2x9m2p8j2k1a4",
  "object": "event",
  "createdAt": "2026-10-21T16:10:01.000Z",
  "mode": "live",
  "accountId": "clacct0001",
  "type": "payment_intent.succeeded",
  "data": { "object": {
    "object": "payment_intent", "id": "clpiment0001", "amount": 500000, "currency": "CRC",
    "status": "succeeded",
    "createdAt": "2026-10-21T16:09:50.000Z", "updatedAt": "2026-10-21T16:10:01.000Z" } }
}
```

Every `payment_intent.*` object can carry: `id`, `amount`, `capturableAmount`, `receivedAmount`, `currency`, `description`, `status`, `captureMethod`, `customerId`, `paymentMethodId`, `metadata`, `lastPaymentError` (`type`, `code`, `message`, `paymentMethodType`), `latestCharge` (`id`, `amount`, `currency`, `status`, `failureCode`, `failureMessage`, `createdAt`, `updatedAt`), `createdAt`, `updatedAt`.

Failure, as printed:

```json
{
  "id": "evt_k5ufdj5r8btq7t8esdhbpwe7", "object": "event", "createdAt": "2026-10-21T16:12:00.000Z",
  "mode": "test", "accountId": "clacct0001", "type": "payment_intent.failed",
  "data": { "object": {
    "object": "payment_intent", "id": "clpiment0002", "amount": 250000, "capturableAmount": 0,
    "receivedAmount": 0, "currency": "CRC", "status": "requires_payment_method",
    "customerId": "clcus0002", "metadata": { "orderId": "order_1002" },
    "lastPaymentError": { "type": "processing_error", "code": "declined",
                          "message": "Transaction declined", "paymentMethodType": "card" },
    "latestCharge": { "id": "clch0002", "amount": 250000, "currency": "CRC", "status": "failed",
                      "failureCode": "declined", "failureMessage": "Transaction declined",
                      "createdAt": "2026-10-21T16:11:58.000Z", "updatedAt": "2026-10-21T16:12:00.000Z" },
    "createdAt": "2026-10-21T16:11:50.000Z", "updatedAt": "2026-10-21T16:12:00.000Z" } }
}
```

Refund. The documentation prints only the failed case; a successful one has the same object with `"status": "succeeded"` and no `failure` fields:

```json
{
  "id": "evt_eqf1z262w9lqzccagn8dzvjh", "object": "event", "createdAt": "2026-10-21T17:00:05.000Z",
  "mode": "test", "accountId": "clacct0001", "type": "refund.failed",
  "data": { "object": {
    "object": "refund", "id": "clref0001", "amount": 500000, "currency": "CRC", "status": "failed",
    "failureReason": "declined", "paymentIntentId": "clpiment0001", "chargeId": "clch0001",
    "createdAt": "2026-10-21T17:00:00.000Z", "updatedAt": "2026-10-21T17:00:05.000Z",
    "failure": { "code": "declined", "message": "The refund was declined." } } }
}
```

Refund object fields: `id`, `amount`, `currency`, `description`, `reason`, `status`, `type`, `paymentIntentId`, `chargeId`, `authorizationNumber`, `referenceNumber`, `transactionReference`, `failureReason`, `failure`, `createdAt`, `updatedAt`.

Delivery rules:

| Rule | Value |
| --- | --- |
| Success | Any `2xx` within **10 seconds**. A `3xx` counts as a failure |
| Retries | Live: exponential backoff for up to 72 hours. Test: up to three retries over up to 24 hours |
| Back-pressure | Answer `429` or `503` with `Retry-After`; ONVO waits at least that long, up to 12 hours live and 6 hours test |
| Automatic pause | After 10 failed attempts in a row the endpoint is paused and probed with growing delays up to one hour; account owners are e-mailed in live mode |
| Guarantees | At least once; **no ordering guarantee**. Deduplicate on the event `id`; when order matters compare the object's `updatedAt` or fetch it |
| Resend | Manual, from the Dashboard, for 15 days; same event id and body, new delivery id and signature; a resend is a single attempt with no automatic retry |
| Retention | Events and attempts 180 days |
| Secret rotation | For 24 hours each request carries two `v1` values, one per secret |
| Old format | Header `X-Webhook-Secret`, hyphenated names such as `payment-intent.succeeded`, a single attempt with no retry. New endpoints are always the signed format; ignore any tutorial that shows the old one |

### 6.6 Signature verification

Algorithm from https://docs.onvopay.com/en/webhooks/verify-signatures:

```text
function verify_onvo_webhook(raw_body: bytes, header: string, secret: string, now_seconds: int) -> bool
    # header example: "t=1785758400,v1=5257a869…,v1=…"
    parts      = [ split(trim(p), "=", limit 2) for p in split(header, ",") ]
    t          = integer value of the part whose key is "t"          # reject if missing or not an integer
    candidates = values of every part whose key is "v1"              # two during a secret rotation

    if abs(now_seconds - t) > 300: return false                      # replay window: 300 seconds

    signed   = utf8(decimal string of t) + "." + raw_body            # the body exactly as received
    expected = HMAC_SHA256(key = utf8(secret), message = signed)     # 32 bytes

    for c in candidates:
        if c matches /^[0-9a-f]{64}$/i and constant_time_equal(hex_decode(c), expected):
            return true
    return false
```

Handler order:

1. Read the raw body first (`await request.text()`), before any JSON parsing. Re-serialised JSON will not verify.
2. `verify_onvo_webhook(raw, request.headers.get("X-Onvo-Signature") ?? "", ONVO_WEBHOOK_SECRET, now)`. On failure answer `400` and do nothing else.
3. Parse. Check `event.mode` matches the deployment (`live` in production) and, once known, that `event.accountId` is ours.
4. Insert `event.id` into a table with a unique key. If it already exists, answer `200`.
5. Do the work in the same request only if it is one fast database call; otherwise store and answer `200`, then process.
6. Answer `2xx` for event types the code does not handle.

`secret` is the whole `whsec_…` string as UTF-8 text. The server clock must be synchronised. On Supabase the function needs `verify_jwt = false` (see `docs/research/supabase-auth-storage-wire-format.md` §5.1).

### 6.7 Refunds

```http
POST https://api.onvopay.com/v1/refunds
Authorization: Bearer <secret key>
Content-Type: application/json

{ "paymentIntentId": "<intent id>", "amount": 100000,
  "reason": "requested_by_customer", "description": "Devolución pedido YT-100123" }
```

| Field | Rule |
| --- | --- |
| `paymentIntentId` | The intent that was paid. For a card paid through Checkout, the session's `paymentIntentId` |
| `amount` | Optional, minor units. Omitted = the whole intent. Cannot exceed the intent amount |
| `reason` | `requested_by_customer` (default), `fraudulent`, `duplicate`, `other` |
| Response `201` | `id`, `amount`, `currency`, `paymentIntentId`, `description`, `mode`, `status` (`pending`, `succeeded`, `failed`), `reason`, `failureReason`, `createdAt`, `updatedAt` |
| Read back | `GET /v1/refunds/{id}` |
| Final result | Webhook `refund.succeeded` or `refund.failed`. A request rejected with `4xx` creates no refund and sends no event |
| After refunds | The intent's `status` becomes `partially_refunded` or `refunded` and `receivedAmount` changes |

There is no idempotency key. Before calling, write our own refund row keyed by the outbox event; if the call times out, read `GET /v1/payment-intents/{id}` and compare `receivedAmount` and `status`, and watch for `refund.created`, before trying again.

Whether a **SINPE Móvil** payment can be refunded through this endpoint is not stated (the documentation only says crypto refunds are not supported) — **UNVERIFIED**, and it matters because the law requires the refund through the same payment method within 8 calendar days.

### 6.8 Sandbox and test data

Test keys work as soon as the account exists; nothing touches real networks. Test payment methods are rejected with live keys. Cards take any future expiry, any valid CVV and any name.

| Scenario | Card |
| --- | --- |
| Approved, Visa | `4242424242424242` |
| 3-D Secure challenge, Visa | `4000000000003220` |
| Approved, Mastercard | `5555555555554444` |
| Approved, American Express | `378282246310005` |
| Declined | `4000000000000002` |
| Payment method creation fails verification | `4000000000000127` |
| External processor error | `4000000000000119` |

| SINPE Móvil scenario | `mobileNumber.number` | Behaviour |
| --- | --- | --- |
| Success | `+50688888888` | Transfer simulated 15 seconds after confirming |
| Success, delayed | `+50688884444` | Simulated 6 minutes later |
| Failed | `+50688889521` | No transfer; the intent stays as it is |
| Partial | `+50688883333` | 50%, then the other 50% |

SINPE PIN (`bank_deposit`) test identifications: `00-0000-8888` success after 15 s, `00-0000-9521` failed, `00-0000-4444` success after 30 s, `00-0000-3333` partial.

ONVO's own pre-production checklist: create an intent, confirm a successful payment, test a payment-method error, test a refund, validate webhook delivery and signature verification, confirm idempotent retries. The Dashboard's **Test connection** sends a signed `webhook_endpoint.test`. A webhook endpoint needs a public HTTPS URL, so local development uses the sandbox provider of section 8 or a tunnel.

### 6.9 Mapping to this repository

| Gateway fact | Database action |
| --- | --- |
| Order placed with `card` or `sinpe_movil` in live mode | Server creates the ONVO object and stores `provider = 'onvo'` plus the session or intent id on the `payments` row. Today `provider` is filled from `payments_mode` (`…081000_checkout.sql:423-425`); that has to change |
| `checkout_session.succeeded` or `payment_intent.succeeded` | Find the payment by the stored id, **not** by trusting `metadata` alone. Check `currency = 'CRC'` and that the amount equals `payments.amount_minor`. Then `private.capture_payment(order_id, '<payment intent id>', false)`. A mismatch goes to `payment_review`, never to capture |
| `capture_payment` raises `order_not_payable` (order already cancelled) | Money arrived for a dead order: refund it automatically and tell the shopper. Cancelling the intent or expiring the session when the order expires makes this rare |
| `payment_intent.failed` | `payments.failure_reason = lastPaymentError.code`; the order stays `pending_payment` until it expires |
| Order expires (`private.expire_unpaid_orders`) or is cancelled unpaid | Outbox event → `POST /v1/payment-intents/{id}/cancel` or `POST /v1/checkout/sessions/{id}/expire` |
| Outbox `refund.requested` with `order_id` (full) or `order_id`, `return_request_id`, `amount_minor` (partial) | `POST /v1/refunds`; store the refund id |
| `refund.succeeded` | `payments.status = 'refunded'` or `'partially_refunded'`, `refunded_at = now()`; for a cancelled order run `private.post_order_refund` and set the order to `refunded`, as the sandbox branch does at `…081000_checkout.sql:136-142` |
| `dispute.created` | New table; freeze the seller's payable for that order |
| `payout.paid` | Match `payoutNet` against the bank statement |
| Cash on delivery | Untouched: `provider = 'cash'`, captured by the driver |

Schema additions the integration needs (for the implementer to design): a webhook-event table with a unique event id, a refunds table (one payment can have several partial refunds), a disputes table, and a column for the checkout session id next to `provider_reference`. The webhook function calls `private.capture_payment` through a `security definer` wrapper granted only to the service role.

### 6.10 Gotchas

- **No idempotency key** on payment intents, sessions or refunds. Create the gateway object once per `payments` row and store its id before returning to the client; a second attempt reuses it.
- **The shopper pays ONVO's number.** Their bank shows a recipient that is not Yuntera. Say so on the instructions screen. A custom number avoids it; cost and lead time are unknown.
- **Payer identity is required for SINPE Móvil** and must match the account that pays. A shopper paying from a relative's or a company's account must enter that holder's id. This is personal data sent to a processor: add it to the privacy notice.
- **The documentation contradicts itself on partial transfers:** the SINPE Móvil page says ONVO "doesn't accept partial payments or higher amounts", while the testing page simulates a 50% + 50% transfer and the events page describes "a payment completed across several transfers". Ask which applies to the default number.
- **`payment_intent.failed` is per attempt**, not final. Only expiry or cancellation ends an unpaid order.
- **US$2,000 monthly limit** on a new account: request the increase before launch day, with the documents ONVO asks for.
- **US$3 per payout** and a minimum of US$30 or ₡20,000: pick weekly payouts at first. This cost is not in the fee schedule.
- **Fixed fee in dollars on colón sales**: the exchange rate ONVO applies to US$0.35 is not published.
- **Events for `onBehalfOf` payments go to the platform account**, including their refunds and disputes.
- **One URL per endpoint per mode**, and a `3xx` is a failure: point ONVO at the final URL, with no redirect in front.
- **Custody.** ONVO holds the money between the charge and the payout and is not a supervised bank. Daily or weekly payouts keep the exposure small.

### 6.11 Native apps

| Method | In an Expo app |
| --- | --- |
| Card | Create the session on the server, open `url` in the system browser session, return by deep link in `redirectUrl`. No card field ever exists in the app, and the stores allow external payment for physical goods (`docs/research/expo-native-apps.md`, section "Payments — physical goods are outside in-app purchase") |
| SINPE Móvil | Native screens only: collect payer id and phone, call our server, show number and amount, offer "copy" buttons, poll our own order status until the webhook lands |
| Cash on delivery | No gateway |
| Google Pay | Documented for "your own site or app" (Android): gateway `onvopay`, `gatewayMerchantId` = the ONVO account id, then `POST /v1/confirmation-tokens`. Needs Google's own production approval |
| Apple Pay | Documented for Checkout and for websites. A native iOS integration is not documented (**UNVERIFIED**) |

---

## 7. Fallback: Tilopay in brief

Enough to size the adapter; every line is from the Tilopay pages cited in section 3.2.

| Step | Call |
| --- | --- |
| Token | `POST https://app.tilopay.com/api/v1/login` `{ "apiuser", "password" }` → `{ "access_token", "token_type": "bearer", "expires_in": 86400 }`. Cache for 24 hours |
| Create a card payment | `POST /api/v1/processPayment` with `redirect`, `key`, `amount` (`"21500.00"`, a decimal string in colones), `currency` (`"CRC"`), `orderNumber`, `capture` (`"1"`), `billToFirstName`, `billToLastName`, `billToAddress`, `billToAddress2`, `billToCity`, `billToState` (`"CR-SJ"`), `billToZipPostCode`, `billToCountry`, `billToTelephone`, `billToEmail`, `subscription` (`"0"`), `platform` (`"api"`), `returnData`, `hashVersion` (`"V2"`), `token_version` (`"v2"`) → `{ "type": "100", "html": "Use url redirect", "url": "https://secure.tilopay.com/htmls/…" }` |
| Client | Redirect to `url`. Return is a GET to `redirect` with `code` (`1` = approved), `description`, `auth`, `order`, `tpt`, `tilopay-transaction`, `OrderHash`, `returnData` |
| Confirm | `POST /api/v1/consult` `{ "key", "orderNumber" }` → `response[0].code == "1"`. Mandatory, because the redirect is in the shopper's hands and the webhook has one attempt |
| Refund | `POST /api/v1/processModification` `{ "orderNumber", "type": "2", "amount": "1.00", "key" }` → `ReasonCode: "1101"` approved |
| SINPE Móvil | Browser SDK `https://app.tilopay.com/sdk/v2/sdk_tpay.min.js`: `Tilopay.Init({ token, currency: "CRC", amount, orderNumber, typeDni, dni, webhook, redirect, … })`, then `Tilopay.getSinpeMovil()` → `{ "message": "Success", "code": "863", "amount": 10, "number": "70599200" }`. 25-minute window. No server-only path is documented, so a native app would need a web view |
| Test cards | `4111111111111111` approved; `4012000000020071` approved with 3-D Secure challenge (code `3ds2`); `4012000000020121` declined; `4112613451591116` insufficient funds with challenge |

Adapter differences from ONVO: amounts converted from minor units to decimal strings; `orderNumber` must be generated and stored before the call and never reused; polling instead of trusting a webhook; a guard that refuses to start if `environment` is not what the deployment expects.

---

## 8. Provider-neutral interface

Both `onvo` and a local `sandbox` provider implement this; `tilopay` can too. It lives on the server only.

```ts
export type GatewayId = "onvo" | "tilopay" | "sandbox";
export type OnlineMethod = "card" | "sinpe_movil";

/** Costa Rican identification as ONVO types it; other adapters map from this. */
export interface PayerId {
  kind: "national" | "resident" | "state_entity" | "legal_entity" | "autonomous_institution" | "diplomat" | "foreigner";
  /** Digits and letters only; the adapter applies the provider's format. */
  number: string;
}

export interface CreatePaymentInput {
  paymentId: string;          // payments.id — our idempotency anchor
  orderId: string;
  orderNumber: string;        // shown to the shopper and to finance
  amountMinor: number;        // céntimos, integer
  currency: "CRC";
  method: OnlineMethod;
  customer: { name: string; email: string; phone?: string };
  /** Required when method is "sinpe_movil". */
  sinpe?: { payerId: PayerId; payerPhoneE164: string };
  returnUrl: string;          // web URL or app deep link
  cancelUrl: string;
  expiresAt: Date;            // when our reservation ends
}

export type NextAction =
  | { kind: "redirect"; url: string }
  | { kind: "sinpe_transfer"; destinationPhoneE164: string; amountMinor: number;
      /** Text the shopper must write in the description; null when the provider matches by payer id. */
      requiredDescription: string | null; suggestedDescription: string }
  | { kind: "none" };

export type GatewayPaymentStatus =
  | "requires_action" | "processing" | "succeeded" | "failed" | "cancelled"
  | "refunded" | "partially_refunded";

export interface GatewayPayment {
  gateway: GatewayId;
  /** The id refunds are made against (ONVO: payment intent id). May be unknown until paid. */
  reference: string | null;
  /** The id of the hosted session, when there is one. */
  sessionReference: string | null;
  status: GatewayPaymentStatus;
  amountMinor: number;
  currency: "CRC";
  nextAction: NextAction;
  failure?: { code: string; message: string };
}

export interface RefundInput {
  refundId: string;           // our row id — our idempotency anchor
  reference: string;          // GatewayPayment.reference
  amountMinor?: number;       // omitted = full
  reason: "requested_by_customer" | "fraudulent" | "duplicate" | "other";
  note?: string;
}

export interface GatewayRefund {
  reference: string;
  status: "pending" | "succeeded" | "failed";
  amountMinor: number;
  failure?: { code: string; message: string };
}

export type GatewayEvent =
  | { type: "payment.succeeded"; eventId: string; occurredAt: Date; payment: GatewayPayment; metadata: Record<string, string> }
  | { type: "payment.processing" | "payment.failed" | "payment.cancelled"; eventId: string; occurredAt: Date; payment: GatewayPayment; metadata: Record<string, string> }
  | { type: "refund.succeeded" | "refund.failed"; eventId: string; occurredAt: Date; paymentReference: string; refund: GatewayRefund }
  | { type: "dispute.opened" | "dispute.updated" | "dispute.closed"; eventId: string; occurredAt: Date; paymentReference: string;
      dispute: { reference: string; status: "needs_response" | "under_review" | "won" | "lost"; amountMinor: number; reason?: string; respondBy?: Date } }
  | { type: "payout.paid" | "payout.failed"; eventId: string; occurredAt: Date; payout: { reference: string; netMinor: number; currency: string } }
  | { type: "ignored"; eventId: string; providerType: string };

export class WebhookSignatureError extends Error {}

export interface PaymentGateway {
  readonly id: GatewayId;
  /** Must be safe to call twice for the same paymentId: the caller stores the result before returning it. */
  createPayment(input: CreatePaymentInput): Promise<GatewayPayment>;
  /** Source of truth when a webhook is late or a redirect comes back first. */
  getPayment(ref: { reference?: string; sessionReference?: string }): Promise<GatewayPayment>;
  /** Stops a payment that has not succeeded (ONVO: cancel intent / expire session). */
  cancelPayment(ref: { reference?: string; sessionReference?: string }): Promise<void>;
  refund(input: RefundInput): Promise<GatewayRefund>;
  getRefund(reference: string): Promise<GatewayRefund>;
  /** Verifies authenticity on the raw body, then normalises. Throws WebhookSignatureError. */
  parseWebhook(request: { rawBody: string; headers: Headers; now?: Date }): Promise<GatewayEvent>;
}
```

Sandbox provider: `createPayment` returns a redirect to a local "pay / decline" page for cards and a `sinpe_transfer` with a made-up number for SINPE Móvil; a button on that page makes it POST an event to the same webhook route, signed with the **same scheme as ONVO** (`t=…,v1=…` over `t.body`) using a local secret. That way the signature code, the deduplication and the capture path are exercised in every local run and in CI, and `public.confirm_sandbox_payment` remains only as the shortcut it is today.

---

## 9. Confirm with ONVO before signing

| # | Question | Why |
| --- | --- | --- |
| 1 | Contracted rates for cards, SINPE Móvil and SINPE PIN, and whether 13% IVA is added to the fee | Sets the payment fee passed to sellers |
| 2 | The exchange rate applied to the US$0.35 fixed fee on colón sales, and to the US$3 payout fee | Fee schedule uses ₡180 as a guess |
| 3 | Documents required from an S.R.L., and time to approval | Launch date |
| 4 | Raising the US$2,000 monthly limit: evidence needed and the new ceiling | A handful of orders a day exceeds it |
| 5 | Is there an idempotency mechanism for `POST /v1/payment-intents`, `/v1/checkout/sessions/one-time-link` and `/v1/refunds`? | None documented |
| 6 | Can SINPE Móvil and SINPE PIN payments be refunded by `POST /v1/refunds`? How long does it take, and where does the money land? | Legal duty to refund by the same method in 8 days |
| 7 | Custom SINPE Móvil number: cost, lead time, the name the payer sees, and who registers it with Hacienda under Decreto 45953-H | Trust at checkout; open question 28 |
| 8 | Partial and excess SINPE Móvil transfers on the default number: refused or accepted? | The documentation contradicts itself |
| 9 | How long does a `processing` SINPE Móvil intent stay open if we do not cancel it? | Late payments for expired orders |
| 10 | Is 3-D Secure applied to every card payment or only when the issuer asks? The BCCR regulation (art. 15) requires issuers to authenticate every card-not-present payment with a Costa Rican card. Who bears fraud chargebacks with and without it, and does ONVO's service meet the card-not-present requirements the regulation refers to (art. 27 b iii)? | Chargeback exposure |
| 10a | Is ONVO the acquirer or a gateway for Costa Rican cards, and how does 3.9% + US$0.35 comply with the 1.95% local acquiring cap (Reglamento del Sistema de Tarjetas de Pago, art. 45)? Which part of the price, if any, is for services outside the cap? When are card funds credited relative to BCCR settlement (art. 22)? | Fees passed to sellers; regulatory exposure |
| 11 | Dispute process: how evidence is submitted, deadlines, fee per dispute, and any rolling reserve or right to withhold payouts | Cash planning |
| 12 | Does the web SDK render card fields in an ONVO-hosted iframe? Will ONVO give the written script-protection confirmation PCI SSC FAQ 1588 describes? Can ONVO share its PCI attestation of compliance? | SAQ A versus A-EP for an on-site form |
| 13 | Does the payment intent created by a Checkout Session inherit the session's `metadata`? What query parameters are added to `redirectUrl`? Default session expiry? | Webhook-to-order mapping |
| 14 | Marketplace: can one payment be split among several connected accounts? Does `onBehalfOf` work with SINPE Móvil? Who is merchant of record and who issues the withholding certificates? | Decides whether sellers are ever paid by ONVO directly; open questions 7 and 24 |
| 15 | Which acquirer and processor sit behind ONVO, and where are funds held before payout | Custody risk |
| 16 | API rate limits, and whether a status page and an SLA exist | Not documented |
| 17 | Native iOS Apple Pay and any mobile SDK | App roadmap |
| 18 | Are the 0.777% IVA withholding and "no Renta" still current, and how are they certified for our accountant | Tax filing |

The same list, shortened, applies to Tilopay if the fallback is used; add: the `OrderHash` algorithm, the `processPayment` webhook specification, the settlement calendar, and whether SINPE Móvil can be started without the browser SDK.

---

## 10. What the owner must do

1. **Have the company and its tax registration.** Every option needs a legal entity registered with Hacienda and a business bank account in colones in the company's name (a second one in dollars only if dollar sales are wanted).
2. **Create the ONVO account now, in test mode.** Sign-up at onvopay.com is self-service and gives test keys immediately; development can start before any contract. Use a company e-mail that will outlive any one person.
3. **Complete ONVO's onboarding** with the representative's identity document and the facial check the home page describes, plus whatever company documents ONVO requests. Add the bank account for payouts. Choose weekly payouts to begin with.
4. **Send ONVO the questions in section 9** (sales contact on the pricing page; support at `ayuda@onvopay.com`) and get the answers in writing. Ask for the limit increase and, if wanted, a custom SINPE Móvil number in the same message.
5. **Publish the pages a processor checks** before asking for live mode: terms, privacy policy, returns and withdrawal policy, company identity and contact details. They are already required by consumer law.
6. **Create the live webhook endpoint in ONVO's Dashboard** when the production URL exists, copy the `whsec_…` secret straight into the server's secret store, and press "Test connection". Do the same for test mode. Never paste a key into chat, e-mail or the repository.
7. **Register as a Tilopay developer** (tilopay.com/developers/registro) so sandbox credentials exist if the fallback is ever needed. It costs nothing.
8. **Ask the accountant** how the card withholdings and the gateway's fee invoices are booked, and whose SINPE Móvil number is registered under Decreto 45953-H when the gateway collects.
9. **Later, when card volume justifies it,** ask BAC for an e-commerce affiliation quote (merchant rate, and which of its four gateways it proposes, and whether the gateway charges count inside the 1.95% cap).
10. **Ask a lawyer, before signing,** two things: whether the published card prices of ONVO and Tilopay comply with the BCCR acquiring cap (section 5.3), and whether Yuntera collecting for its sellers and paying them out requires registration with SUGEF under art. 15 of Ley 7786, and from what volume. The answer to the second decides whether sellers are paid by Yuntera or by the gateway directly.

---

## 11. Could not verify

- BCCR's own text on SINPE Móvil limits, fees and finality (the BCCR site returned 404 from this environment).
- ONVO: IVA on fees; the document list for a legal entity; dispute handling and fees; refunds of SINPE Móvil payments; SDK rendering (iframe or not); session-to-intent metadata; redirect parameters; rate limits; the acquirer behind it; whether marketplace charges support SINPE Móvil or several sellers per payment; native iOS Apple Pay. ONVO's terms and conditions could not be downloaded.
- Tilopay: settlement calendar; the `OrderHash` algorithm and the `processPayment` webhook fields (both stated as available on request); whether the hosted page offers SINPE Móvil.
- Greenpay: prices, API contract, webhook signing, SINPE Móvil support.
- Kushki: availability in Costa Rica.
- dLocal: prices and whether a company selling only domestically can contract it.
- BAC: the merchant commission; any API for SINPE Móvil confirmation.
- Davivienda "SINPE Móvil Empresarial".
- ~~Whether Costa Rican regulation mandates 3-D Secure~~: answered; the BCCR regulation obliges the issuer to apply strong authentication to every card-not-present payment with a Costa Rican card (section 5.3). Whether it names 3-D Secure specifically: it does not; it requires "autenticación reforzada" and EMVCo standards.
- How the BCCR 1.95% acquiring cap applies to ONVO's and Tilopay's published card prices.
- Whether Yuntera's own seller settlement requires SUGEF registration under art. 15 Ley 7786; the current text of art. 15 in SCIJ.
- The 0.777% IVA withholding ONVO cites, and whether income tax is withheld on card sales collected through ONVO.
- The final 2026 ordinary review of card fee caps (in public consultation on 21 Nov 2026).

---

## Sources

All web pages were opened on 21 November 2026.

**ONVO Pay**

- https://docs.onvopay.com/en/llms.txt and https://docs.onvopay.com/en/llms-full.txt (full documentation in Markdown). Pages relied on: `/en/authentication`, `/en/getting-started`, `/en/checkout/overview`, `/en/checkout/one-time-links`, `/en/integrations/sdk`, `/en/payments/overview`, `/en/payments/payment-intents`, `/en/payments/sinpe-mobile`, `/en/payments/sinpe-pin`, `/en/payments/refunds`, `/en/payments/three-ds`, `/en/payments/manual-capture`, `/en/payments/marketplaces`, `/en/payments/fraud-monitoring`, `/en/payments/google-pay`, `/en/payments/testing`, `/en/reference/errors`, `/en/reference/pagination`, `/en/webhooks`, `/en/webhooks/events`, `/en/webhooks/verify-signatures`, `/en/webhooks/upgrade`, `/en/webhooks/legacy`
- https://docs.onvopay.com/openapi.yaml (OpenAPI 3.1, `info.version: "2.0"`)
- https://onvopay.com/pricing (prices, FAQ answers, regulatory notice)
- https://onvopay.com/ and https://onvopay.com/business-model-marketplace
- https://soporte.onvopay.com/portal/es/home
- https://js.onvopay.com/v1/ (script contents, for the third-party hosts it loads)

**Tilopay**

- https://tilopay.com/llms.txt, https://tilopay.com/tarifas
- https://tilopay.com/en/developers, `/en/developers/api/autenticacion`, `/en/developers/api/caminos-de-integracion`, `/en/developers/hosted-payment-page`, `/en/developers/api/hosted-payment-page/process-payment`, `/en/developers/api/procesos-operativos/process-modification`, `/en/developers/api/procesos-operativos/consult`, `/en/developers/api/procesos-operativos/split`, `/en/developers/api/procesos-operativos/errors`, `/en/developers/api/convenciones`, `/en/developers/api/webhooks`, `/en/developers/reintentos-seguros`, `/en/developers/entornos`, `/en/developers/tarjetas-de-prueba`, `/en/developers/sdk`, `/en/developers/sdk/reference/init`, `/en/developers/sdk/reference/get-sinpe-movil`, `/en/developers/server-to-server`, `/en/developers/api-bancario`
- https://tilopay.com/developers/api-bancario/webhooks, https://tilopay.com/api-bancario
- https://tilopay.com/guias/afiliacion/como-afiliarse-a-tilopay, https://tilopay.com/guias/afiliacion/finalizar-proceso-de-afiliacion, https://tilopay.com/guias/pasarelas/como-activo-sinpe-movil-en-tilopay

**BAC Credomatic**

- https://www.baccredomatic.com/es-cr/pymes/compra-click
- https://www.baccredomatic.com/es-cr/pymes/ventas-digitales
- https://www.baccredomatic.com/es-cr/pymes/herramientas-de-venta
- https://www.baccredomatic.com/es-cr/personas/landing/sinpe-movil
- https://www.baccredomatic.com/sites/default/files/2024-07/cr_carga_de_terminos_condiciones_e-commerce.PDF (F-CRI-0006171, "Términos y Condiciones de Procesamiento de Comercio Electrónico V5")

**Other gateways**

- https://stripe.com/global
- https://www.paypal.com/cr/webapps/mpp/merchant-fees
- https://docs.dlocal.com/docs/costa-rica, https://docs.dlocal.com/docs/receive-notifications, https://docs.dlocal.com/docs/generate-signature, https://docs.dlocal.com/docs/platforms-overview, https://docs.dlocal.com/llms.txt
- https://greenpay.me/, https://support.greenpay.me/portal/es/home, https://cdn.jsdelivr.net/wp/greenpay-payment-service/trunk/README.md
- https://docs.kushki.com/ (password wall), https://www.kushkipagos.com/en/fees-and-commissions
- https://powertranz.com/, https://developer.powertranz.com/ (password wall)

**Regulators and law**

- https://www.bccr.fi.cr/cr/es/sistema-de-pagos/tarjetas-de-pago/tarjetas-de-pago-debito-y-credito.html (index of the card regulation, studies and lists)
- https://www.bccr.fi.cr/content/dam/bccr/bccr-espanol/sobre-bccr/gobierno-corporativo/reglamentos/reglamento-sistemas-tarjetas-de-pago.pdf (Reglamento del Sistema de Tarjetas de Pago, edition 6, in force 18 Dec 2025; arts. 2, 15, 22, 25–27, 33, 44–48 relied on)
- https://www.bccr.fi.cr/content/dam/bccr/bccr-espanol/sistema-de-pagos/tarjetas-de-pago/comisiones-maximas-adquirencia-2020-2026.pdf and `…/comisiones-maximas-intercambio-2020-2026.pdf` (cap history)
- https://www.bccr.fi.cr/content/dam/bccr/bccr-espanol/sistema-de-pagos/tarjetas-de-pago/proveedores-adquirentes.xlsx (registered acquiring providers)
- https://www.elfinancierocr.com/economia-y-politica/quienes-estan-obligados-a-inscribirse-ante-sugef/MH2BCNDUMNFCHP7YXWQI557MNA/story/ (art. 15 Ley 7786 thresholds, 3 Feb 2019, secondary)
- https://bufetedecostarica.com/wp-content/uploads/2026/10/reforma-de-la-ley-7786-ley-sobre-estupefacientes-sustancias-psicotropicas-drogas-de-uso-no-autorizado-actividades-conexas-legitimacion-de-capitales-y_10961.pdf (Ley 10961, law firm's copy)

**Standards and press**

- https://www.pcisecuritystandards.org/faqs/1588/ (SAQ A eligibility for scripts, Feb 2025)
- https://www.pcisecuritystandards.org/faqs/1292/ (direct post versus iframe and redirect)
- https://www.elfinancierocr.com/finanzas/nuevo-limite-en-sinpe-movil-cambiara-la-forma-de/A5BV5RHR7VCNPONGYGPNJHIFQI/story/ (14 Apr 2026)
- https://www.nacion.com/economia/cuanto-se-puede-transferir-por-sinpe-movil-sin/2LYGHB3IKZDUJGMCMJVT3MSBXE/story/ (17 Mar 2025)
- https://www.elfinancierocr.com/finanzas/que-hago-si-me-hicieron-un-cobro-indebido-en-la/WVR5TM2IABEVXKZDZUZHD5I3MM/story/ (26 Dec 2022)
- Not opened (HTTP 404 or 403 from this environment): https://www.bccr.fi.cr/content/dam/bccr/publicaciones/sistemas-de-pagos/norma-complementaria-sinpe-movil.pdf, the BCCR SINPE Móvil page, https://revistasumma.com/?p=242791, `https://sdk.onvopay.com/sdk.js`

**This repository**

- `supabase/migrations/20261121080000_foundation.sql:65-68,137-144`
- `supabase/migrations/20261121080600_orders.sql:99-121,217-233`
- `supabase/migrations/20261121081000_checkout.sql:46-92,131-151,420-426,455-478,517-539`
- `supabase/migrations/20261121081700_api_backoffice.sql:247-249,340-379`
- `packages/core/src/money.ts:2`
- `docs/research/costa-rica-fact-sheet.md` (sections 1, 2, 3 and 5), `docs/01-product/pricing-and-fees.md:59-85`, `docs/08-open-questions.md` (questions 6–8, 24, 28), `docs/research/supabase-auth-storage-wire-format.md` §5.1, `docs/research/expo-native-apps.md`

## Corrections after fact-check

Fact-check of 21 November 2026. About seventy claims were re-checked against primary sources fetched today: ONVO's price page (page source, including the FAQ and footer), `docs.onvopay.com/en/llms-full.txt`, `docs.onvopay.com/openapi.yaml` and the webhook pages; Tilopay's price and webhook pages; BAC's Compra Click and e-commerce pages; dLocal's Costa Rica and notification pages; PCI SSC FAQ 1588; Stripe's country list; and the BCCR's card regulation, cap tables and list of acquiring providers. Confirmed as written: every ONVO price, currency, payout fee, minimum payout, settlement sentence and US$2,000 initial limit; the webhook header, signed string (`t + "." + raw body`), HMAC-SHA256 hex, 300-second window, two `v1` values during rotation, 10-second success window, 72-hour live and 3-retries/24-hour test schedules, at-least-once with no ordering, 16 endpoints per mode; `Idempotency-Key` only on subscription schedules (and subscriptions documented as not idempotent); SINPE Móvil matching by identification and exact amount before the transfer is sent, default number `+506 70196686`, CRC only; refunds by `POST /v1/refunds` with optional amount, reason enum, `201` on create; crypto refunds not supported through the Refunds API; marketplace `onBehalfOf` with one connected account, `marketplaceAppFee` 0–100 with two decimals, 7-day onboarding link; Tilopay 4.25% + US$0.35 cards, 2% + US$0.35 SINPE Móvil, no monthly fee, webhook with no second attempt and an `orderHash` whose algorithm is given only through support; BAC gateway and Compra Click prices; dLocal's Costa Rica methods and minimums; the SAQ A redirect/iframe distinction in FAQ 1588; Costa Rica absent from Stripe's list. The ₡20,000 cost table was recomputed and is arithmetically right. PayPal's fee page answered 403 and was not re-checked.

| # | Where | What the note said | What is right | Source |
| --- | --- | --- | --- | --- |
| 1 | Bottom line, 2, 5.3 (new), 9, 10 | BCCR rules on card fees mentioned only as "BCCR cap 1.95% local" in the BAC row | Cap confirmed and dated: local acquiring 1.95% since 19 Feb 2024, local interchange 1.00% since 20 Feb 2025, cross-border acquiring 2.50%, in the Reglamento del Sistema de Tarjetas de Pago published 18 Dec 2025 (arts. 44–48). The cap includes every charge the acquirer takes from the merchant for the payment, and the BCCR lists **ONVO, Tilopay and dLocal as acquiring providers**. So ONVO's and Tilopay's published card prices are above the cap on their face; how they comply is unknown and is now the first question to ONVO and to a lawyer | Reglamento arts. 2, 45; BCCR cap tables 2020–2026; BCCR `proveedores-adquirentes.xlsx` |
| 2 | Bottom line, 5.3 (new), 10 | Recommends that Yuntera collect as the single merchant and pay sellers, with no regulatory comment on doing so | Holding buyers' money and paying sellers may be an art. 15 Ley 7786 activity (transfers of funds, administration of third-party resources) that requires SUGEF registration above "substantial" volume (US$400,000 in 12 months per press). Flagged as a legal question; not resolved | El Financiero, 3 Feb 2019 (secondary); ONVO footer wording |
| 3 | 5.2 | Cardholder window "MEIC: 60 business days"; resolution "8 days … 45–120 days" (press, 2022) | Regulation: claim within **60 calendar days** of the transaction or of the promised delivery date; provisional refund within 5 business days for immediate-verification cases; investigation 45 business days, at most 90 | Reglamento arts. 25–27 |
| 4 | 5.2, 9 #10, 11 | Whether Costa Rican regulation mandates 3-D Secure "could not verify" | Issuer must apply strong authentication to every card-not-present payment with a Costa Rican card, whatever the amount; a merchant charging card-not-present payments without the industry standards bears all claims | Reglamento arts. 15, 26, 27, 33 |
| 5 | 3.1 | ONVO "registered with SUGEF under art. 15 … (anti-money-laundering only)" | Same, plus the activities the footer names: administration of third-party financial resources and systematic transfers of funds; noted that this is ONVO's own statement | https://onvopay.com/pricing (footer) |
| 6 | 3.1 | Withholding: "0.777% de IVA … No se retiene Renta" quoted without comment | Quote completed; marked UNVERIFIED against Hacienda, and the "no Renta" conflict with the fact sheet's 2% income-tax withholding on card sales is stated | ONVO FAQ; `docs/research/costa-rica-fact-sheet.md:30-33` |
| 7 | 2 | IVA on gateway fees UNVERIFIED with no other pointer | Still UNVERIFIED for ONVO, but Hacienda's CAByS has a 13% code for card commission management; budget 13% on top | `docs/research/hacienda-factura-electronica-v44.md:993` |
| 8 | 6.5 | `Retry-After` honoured "up to 12 hours live"; resend "new signature" | Also up to 6 hours in test; a resend gets a new delivery id and is a single attempt | https://docs.onvopay.com/en/webhooks |
| 9 | 3.4 | dLocal notifications "retried up to 12 times (hourly for 6 hours, then every 12 hours for 4 days)" | The page states both a 12-attempt maximum and a schedule that adds up to 14; inconsistency noted | https://docs.dlocal.com/docs/receive-notifications |
| 10 | 1 | Fee schedule "confirmed today against ONVO's own price page" | Matches the published price; lawfulness on Costa Rican cards open (item 1) | as item 1 |

Still **UNVERIFIED** after the fact-check: how the 1.95% cap applies to ONVO and Tilopay; whether Yuntera's seller settlement needs SUGEF registration, and the current art. 15 text (SCIJ did not render); the final 2026 cap review; the 0.777% IVA withholding and income-tax withholding through ONVO; IVA on ONVO's fee; the BCCR's own SINPE Móvil text (limits still from press: the norm and the SINPE Móvil page returned 404 again today); SINPE Móvil refunds through ONVO; ONVO's SDK iframe, dispute fees, reserves and legal-entity document list; Tilopay's settlement calendar and `OrderHash`; Greenpay, Kushki, Davivienda; dLocal pricing and domestic onboarding; PayPal's current fee page (403 today).
