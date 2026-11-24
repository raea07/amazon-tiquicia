# Go-to-market strategy

**What this is.** How Yuntera wins its first sellers and shoppers, through which channels, at what cost, and how the owner knows it is working.
**Conclusion 1.** Start with 5 to 10 sellers the owner can visit in person, in 3 to 5 adjacent cantons of the GAM core, and with the shoppers those sellers already have.
**Conclusion 2.** Most early channels cost the owner's time, not money; paid advertising waits until the pilot has delivered 100 orders to standard.
**Conclusion 3.** The product cannot yet say which channel brought a shopper, nor the 60-day repeat rate; both must be counted by hand or built before money goes into ads.
**Conclusion 4.** Cash out is ₡441,000–₡978,000 a month in the pilot and ₡2.89M–₡4.57M at launch, before founder pay. From week 1 to 13 weeks after launch the business needs about ₡2.1M in the central case and up to about ₡11.6M in the worst case (§9, all estimates).
**The owner must decide** the six questions in "Decisions" at the end (pilot cantons, promotions, market figures, budget level, draws, start of paid ads).

All amounts are colones. US dollars are converted at **₡450 per US$**, the bank
selling rate of 18 November 2026 (₡450–₡452, read 24 November 2026; the dollar
fell 10.6% in 2026, so re-check). Every number carries its source or is marked
_assumption_ with a range and a way to check it. Sources are listed at the end.

Related: [business model](business-model.md), [market and wedge](market-and-wedge.md),
[roll-out plan](rollout-plan.md), [team structure](team-structure.md),
[pricing and fees](../01-product/pricing-and-fees.md). The pricing proposal and
the marketing copy are written separately in the same pack; this document does
not set prices.

---

## 1. What limits the plan today

These come from `STATUS.md` (23 November 2026). Nothing in this plan promises a
customer something on this list.

| Limit                                                                                                                                            | Consequence for go-to-market                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No trademark search done yet; `yuntera.cr` not registered                                                                                        | The name may not be used in public (flyers, posts, fairs) until the search at the Registro Nacional is done (`STATUS.md`, "What needs you" 1) |
| Payments are simulated; no gateway contract                                                                                                      | No real order before the ONVO contract and the switch to `live` (roll-out phase 2)                                                            |
| No electronic invoice reaches Hacienda; no issuer set up                                                                                         | Real sales need the Hacienda registration first                                                                                               |
| No message reaches a real person; **commercial messages are not built** (no template, no unsubscribe page)                                       | No marketing e-mail, WhatsApp or SMS can be sent from the product. Marketing messages go only by hand, to people who asked for them           |
| No promotions or coupons in the product (`STATUS.md`, "Later")                                                                                   | Any offer is run by hand, with its dates and stock written down (see §7)                                                                      |
| The complaint form promised in `customer-service.md` is not wired to the shop; the help page says "2 días hábiles" where the policy says 1 and 5 | Fix before the first real order (support research, step 2). It touches the law                                                                |
| Every web address is behind a Vercel login; no public site                                                                                       | Nobody outside can see the shop until roll-out phase 4 (open launch)                                                                          |
| No error tracking, uptime checks or alerts                                                                                                       | An outage would be reported by a customer first                                                                                               |
| Seller, driver and warehouse phone apps have not run on a phone; shopper app only in test tracks                                                 | Sellers, drivers and the warehouse use the web apps; the shopper app is not promoted in public                                                |
| English is not built                                                                                                                             | Marketing to English readers waits for the shopper-facing English release                                                                     |
| No analytics, no "how did you hear about us", no campaign tag captured                                                                           | Which channel brought an order is not measurable in the product (§6)                                                                          |

---

## 2. Who the first customers are

### 2.1 First sellers

**Who.** Small businesses (PYMEs) that already sell through Instagram,
Facebook and WhatsApp, collect by SINPE Móvil and ship by motorbike messenger
or Correos. That is the seller persona in
[personas and journeys](../01-product/personas-and-journeys.md). Their pains
are verified in press: fake SINPE receipts, courier cost and control, and no
one who answers for the delivery (market research §3.5 and §4.3).

**Which ones first.** Sellers who meet all five tests:

1. Sell in a launch category from [market and wedge](market-and-wedge.md):
   urgent replacements (chargers, cables, small appliances, printer supplies,
   tools, hardware), bulky goods (home, small furniture, pet food, cleaning
   supplies), electronics with a local warranty, or packaged _hecho en Costa
   Rica_ goods (coffee, packaged food, crafts). No perishables, chilled goods,
   medicines or ultra-cheap fashion.
2. Have products with a barcode. Label printing for unlabelled units is a
   Launch feature in [scope by app](../01-product/scope-by-app.md), not built.
3. Have their own customers to bring (open question 10 in
   [open questions](../08-open-questions.md)).
4. Are in or near the pilot cantons, so the owner can visit and stock can be
   dropped off by appointment ([logistics playbook](../06-operations/logistics-playbook.md)).
5. Already issue electronic invoices. A seller in the Régimen Simplificado
   is accepted only once the accountant answers whether an online-only
   seller can be in that regime at all, and what the listing must say
   (_for the accountant to confirm_, [compliance](../05-security-compliance/compliance-costa-rica.md) §3 and §10 question 6).

**How many exist.** 36,098 small businesses were registered with MEIC in May
2026 and 12,050 people in its entrepreneur register; nearly 55,000 companies
use SINPE Móvil; 20,400 small businesses were Correos Pymexpress clients in
2024 (market research §4.1). **How many sell online: not found.** The pool is
large enough that the limit in the first year is the owner's time, not supply.

### 2.2 First shoppers

**Who.** The shopper persona: lives or works in the GAM, buys from a phone,
has SINPE Móvil, may not have a card that works online, and has been let down
by a late parcel. Checked against sources:

- 96% of adults with a mobile phone use WhatsApp and 80% use Facebook (UCR
  telephone survey of 792 adults with a mobile phone, August 2025, published
  27 May 2026; source opened 24 November 2026). That survey gives no figure
  for Instagram or TikTok.
- SINPE Móvil had more than 3.6 million individual users and 747.5 million
  transfers in 2025 (Tico Times, 17 June 2026; the article names no data
  source).
- In the 2022 UCR e-commerce survey, buyers were 36.8% from San José province,
  16.4% Alajuela and 12.8% Heredia; 65.3% bought on a phone (press report,
  2022; the only survey of its kind found).

**Which ones first.** In the pilot: the chosen sellers' own customers, plus
the owner's friends and family, who live in the pilot cantons. In the open
launch: anyone in the served cantons, which grow one at a time by the rule in
the [roll-out plan](rollout-plan.md) §3 until all 16 core cantons are served.

**Not the first target.** Bargain hunters comparing with Amazon Bazaar or
Temu on cheap imported goods. Amazon Bazaar ships free from ₡10,000 and many
items cost under US$10 (El Financiero, November 2025). Yuntera loses that
fight ([market and wedge](market-and-wedge.md), "Where Yuntera loses").

### 2.3 Which districts first

The product defines 16 core cantons with next-day delivery and a 14:00 cutoff
(`supabase/migrations/20261121080300_geography_data.sql`, zone `gam-core`):

| Province | Core cantons                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| San José | Central, Escazú, Desamparados, Goicoechea, Santa Ana, Alajuelita, Tibás, Moravia, Montes de Oca, Curridabat |
| Cartago  | La Unión                                                                                                    |
| Heredia  | Central, Santo Domingo, Belén, Flores, San Pablo                                                            |

**The pilot serves only 3 to 5 adjacent cantons**, not all 16. The reason is
route density: a driver-day costs the same ₡45,000 at 8 stops as at 25
([business model](business-model.md), "Break-even logic"). Below about 25
stops an own driver costs more than Correos' volume tariff (§6). Below about
11 stops each order loses money (₡45,000 ÷ (₡1,800 + ₡2,334) = 10.9, from the
business model's ₡20,000 order). Scattered orders over 16 cantons cannot fill
one route.

The cluster follows the warehouse, and the warehouse follows the first
sellers (open questions 13 and 14). Three candidate clusters, each of adjacent
core cantons:

| Cluster  | Cantons                                                          | For                             | Against                                                                                                 |
| -------- | ---------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A. East  | San José Central, Montes de Oca, Curridabat, Goicoechea, Moravia | Central to the rest of the core | Traffic; no density figure by canton was found                                                          |
| B. West  | Escazú, Santa Ana, Belén                                         | Close together                  | A fulfilment competitor (Boxful) opened in Guachipelín de Escazú in December 2025 (Delfino, March 2026) |
| C. North | Heredia Central, Santo Domingo, San Pablo, Flores                | Compact                         | Heredia was 12.8% of buyers in 2022, a third of San José                                                |

No source gives order density by canton, so no source tells the three
clusters apart. San José province's 36.8% of 2022 online buyers covers
clusters A and B alike and is close to the province's share of the
population. The choice is checked after 4 weeks of the pilot against
delivered stops per route (§6).

**How it is switched on.** Staff in the console, **Operación → Zonas** and
**Distritos**, mark the districts outside the cluster as not served; the shop
then says "Por ahora no entregamos aquí. Elija otra dirección." at checkout
and "Por ahora no entregamos en la zona elegida." in the cart
(`apps/web/src/components/checkout-form.tsx`, `apps/web/src/app/carrito/page.tsx`;
[decision 41](../02-architecture/decisions.md)). On the hosted preview a
district change does not reach the shop while the Vercel login is on
(`STATUS.md`); check it on the production shop in roll-out phase 2. The
rule for adding a canton is in the [roll-out plan](rollout-plan.md), §3.

---

## 3. The promise, one sentence per side

Each sentence is only true once the roll-out phase named in the last column
is reached. Before that, it must not be printed.

| To      | Español (usted)                                                                                                                                                                                                                                                                         | English                                                                                                                                                                                                                                                    | True from                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Shopper | En productos de nuestra bodega, pida de lunes a sábado antes de las 2 p. m. y por lo general le llega el siguiente día de entrega, en [cantones]. La fecha exacta la ve antes de pagar. Pague con SINPE Móvil o contra entrega. Si algo sale mal, nosotros respondemos y lo resolvemos. | For items in our warehouse, order Monday to Saturday before 2 p.m. and it usually arrives the next delivery day, in [cantons]. You see the exact date before you pay. Pay by SINPE Móvil or cash on delivery. If something goes wrong, we take care of it. | Phase 3 (pilot): payments `live`, a driver on the route, the complaint form wired |
| Seller  | Usted nos manda el producto una vez; nosotros lo guardamos, lo empacamos, lo entregamos y le cobramos al cliente por usted, y usted ve cada rebajo antes de publicar.                                                                                                                   | You send us the product once; we store it, pack it, deliver it and collect the money from the customer for you, and you see every deduction before you list.                                                                                               | Phase 3 (pilot): warehouse open, payouts by hand from the console                 |

Why each part can be kept:

- **The cutoff and delivery days** are what `computeDeliveryPromise` computes
  for the core zone (`packages/core/src/promise.ts`), and only under its
  conditions: stock in the Yuntera warehouse (a seller-shipped item adds its
  handling days), an order on a processing day (Monday to Saturday, not a
  holiday; a Sunday order arrives Tuesday), and a delivery day with capacity
  left and no zone closure. Hence "en productos de nuestra bodega", "por lo
  general" and "la fecha exacta la ve antes de pagar". An unconditional
  promise could be read as misleading advertising (Decreto 37899-MEIC art. 55;
  _for the lawyer to confirm_). The first half of the sentence is true for the
  whole pilot only if every pilot seller stocks the warehouse.
- **SINPE Móvil and cash on delivery** are built; cards are built too but the
  [roll-out plan](rollout-plan.md) proposes adding them at the open launch
  (decision 1 there). If cards are on in the pilot, add "o tarjeta / or card".
- **"Nosotros respondemos y lo resolvemos" / "we take care of it"** rests on the policy in
  [customer service](../06-operations/customer-service.md): the shopper gets
  the remedy first and Yuntera settles with the seller afterwards.
- **"You see every deduction before you list"**: the seller centre shows an
  itemised fee preview on each listing (`STATUS.md`, "What is built").
- **Payouts.** A seller's money becomes available 10 days after delivery,
  from ₡5,000 (a setting, true today). Finance then pays it in a payout run
  started by hand, and no schedule for those runs is set (`STATUS.md`, "Paying
  sellers"). Say "su dinero queda disponible 10 días después de la entrega y
  se lo transferimos", not "le pagamos a los 10 días" or "automáticamente".

**Words to avoid** in any customer text, because the regulation or the brand
book forbids them or the product cannot back them:

- Any share of Costa Ricans who buy online. The three sources disagree (80%,
  48.5%, 18%), and statistics in advertising need identified, checkable
  sources (Decreto 37899-MEIC art. 55 g, read in the consolidated text of
  7 January 2026). See decision 3.
- "Garantía" or "garantizado" for anything that is only the legal minimum:
  art. 55 h allows the word only for conditions better than the legal
  warranty, and the advert must say what they are. _For the lawyer to confirm_
  how to state the legal 30-business-day warranty in an advert.
- "Envío gratis" without the threshold and the zone next to it.
- "Todo el país", "en minutos", "automático".

---

## 4. Winning sellers, channel by channel

Costs are per month unless stated. "Owner hours" are an _assumption_ of the
time each channel takes; the owner checks them against a diary in the first
two weeks.

**A rule that applies to every seller channel.** Ley 8642 art. 44 prohibits
automated calls, e-mail "o cualquier otro dispositivo" for direct sales
without the recipient's prior consent, and always requires the sender's
identity and a way to stop the messages (law text read 24 November 2026).
Whether this covers a first business-to-business WhatsApp or e-mail to a shop
is _for the lawyer to confirm_. Until then: **contact a shop in person, by a
phone call the owner makes himself, or in reply to a message the shop sent
first.** No bulk messages, no bought lists.

### 4.1 The first 50 sellers (pilot and first 4 weeks of launch)

| Channel                                                               | What happens                                                                                                                                                                                                                                                                                                                                                     | Cost                                                                                                     | Measured by                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Owner's own network                                                   | Owner lists 30 shops he or people he knows buy from, in the launch categories                                                                                                                                                                                                                                                                                    | Owner time (assumption: 5–10 hours a week)                                                               | A list kept by the owner: contacted, interviewed, said yes             |
| Seller interviews with the worked statement                           | 10–15 interviews showing the ₡20,000 statement from [pricing and fees](../01-product/pricing-and-fees.md); ask what they net today through Instagram and a courier                                                                                                                                                                                               | Owner time (assumption: 1 hour each with travel)                                                         | Number who say yes to the pilot; target 5 (roadmap phase 0 exit)       |
| Shop visits in the pilot cantons                                      | Walk the commercial streets of the chosen cluster; leave the seller flyer with shops in launch categories                                                                                                                                                                                                                                                        | Fuel and printing. Printing price **not found**: assumption ₡30,000–₡60,000 for 500 flyers; get 2 quotes | Seller registrations in the console, **Vendedores** (status `pending`) |
| Public fairs as a visitor                                             | Talk to exhibitors at free fairs. Still ahead: Feria Nacional de Economía Social y Solidaria, 4–6 Dec 2026, Parque Nacional (search result, dates unconfirmed; visit only, nothing handed out under the name before the trademark search). Expo Pyme CR (free entry) held its 2026 edition on 3–4 Oct: an example for 2027; ask the organisers for the 2027 date | ₡0 entry; owner time                                                                                     | Same list; registrations                                               |
| Instagram and Facebook: reply to shops that post in launch categories | The owner follows and comments; a direct message only after the shop has written first (art. 44 above)                                                                                                                                                                                                                                                           | ₡0                                                                                                       | Conversations started by the shop                                      |

**Exit test.** The roadmap's phase 0 exit asks only that 5 sellers say yes
to the pilot. This plan adds a stricter test of its own: 5 sellers active
with stock received in the warehouse (counted in **Vendedores**, status
`active`, with at least one listing, and in **Bodegas** for inbound
received).

### 4.2 From 50 to 200 sellers (first 90 days of launch)

| Channel                              | What happens                                                                                                                                                                                                                    | Cost                                                                                                                                        | Measured by                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| One sales agent (seller recruitment) | Visits and calls; signs sellers; helps with the first listing                                                                                                                                                                   | ₡584,100 a month fully loaded at the legal minimum for "Agente de ventas" (TOCG ₡419,755.80, 2026; see [team structure](team-structure.md)) | Active sellers per week per agent; assumption to verify: 5–10 a week         |
| Seller referrals                     | Each active seller is asked for 2 names. A reward is a promotion: if one is offered, its dates, quantity and conditions are written and published (art. 55 i and j)                                                             | ₡0 without a reward                                                                                                                         | The agent's list notes who referred whom (the product has no referral field) |
| MEIC's EXPOPYME fairs                | Ask MEIC for its 2027 calendar, then for a stand or a talk slot at a regional edition (about 40 businesses each; the 2026 Quepos edition, 24–25 Oct, is an example) or the main fair (235 businesses at Antigua Aduana in 2026) | Exhibitor fee **not found**; ask MEIC                                                                                                       | Registrations in the week after the fair                                     |
| Partner talks (§8)                   | A short session for a group of small businesses: Correos Pymexpress clients, esencial COSTA RICA licensees (more than 700)                                                                                                      | Owner time                                                                                                                                  | Registrations naming the session (asked by the agent)                        |
| Seller page on the shop              | A public page "Venda en Yuntera" with the fee table and the worked statement                                                                                                                                                    | Build time; not built                                                                                                                       | Registrations; no visit counts (no analytics)                                |

### 4.3 From 200 to 1,000 sellers (after the launch exit test)

Only after the roadmap's phase 2 exit (positive contribution for 4 weeks,
25% repeat in 60 days). Until then more sellers add catalogue but not
density.

| Channel                                                  | Cost                                                                                                                     | Measured by                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| A second and third sales agent, by category              | ₡584,100 each a month (legal minimum, loaded)                                                                            | Active sellers per agent; listings per seller                                    |
| Paid social ads aimed at shop owners, to the seller page | Test ₡25,000 first; **no reliable Costa Rican cost per thousand views found** (one agency's ₡3,500–₡7,500 has no method) | Cost per registration, read from the ad platform's own report plus registrations |
| Distributors of electronics and appliances (authorised)  | Owner and agent time                                                                                                     | Listings with a manufacturer warranty                                            |
| Bulk listing upload                                      | Build time; "Later" in `STATUS.md`                                                                                       | Listings per new seller in the first week                                        |

---

## 5. Winning shoppers, channel by channel

| Phase                    | Channel                                                                                                                                                                                                      | Cost                                                            | Measured by                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pilot                    | Sellers share their own shop page (`/tienda/<slug>`) with their followers                                                                                                                                    | ₡0                                                              | Orders per seller, from each seller's statements in the seller centre and **Pedidos** in the console     |
| Pilot                    | Owner's friends and family in the pilot cantons, invited one by one                                                                                                                                          | ₡0                                                              | Distinct shoppers; target 40 (roadmap phase 1 exit)                                                      |
| Pilot and launch         | A printed card in every parcel: how returns, the delivery code and complaints work, and an invitation to come back                                                                                           | Printing price not found; assumption ₡20–₡60 a card, get quotes | Second orders by the same shopper (not counted by the product; see §6)                                   |
| Launch                   | WhatsApp Business app: a status update and replies to people who wrote first                                                                                                                                 | ₡0 in the phone app (support research §2.1)                     | Conversations a day, counted by hand                                                                     |
| Launch                   | Facebook, Instagram and TikTok organic posts (Facebook 80% of adults with a mobile phone, UCR survey, August 2025; Instagram 47% and TikTok 58% in UCR Mediápolis CICOM 2025, which does not state its base) | Owner or a contractor's time                                    | Platform's own reach and clicks                                                                          |
| Launch, after pilot exit | Paid social test of ₡25,000, then a monthly cap the owner sets                                                                                                                                               | ₡25,000 test; cap by budget level (§9)                          | Cost per click from the ad platform; orders in the campaign's days compared with the days before (rough) |
| Bold level only          | Radio (61% listened in the last 30 days on a traditional set; Kantar IBOPE TGI 2025, press)                                                                                                                  | **Price list not found**; ask 2 stations for a quote            | Orders in the campaign weeks compared with the weeks before (rough)                                      |

**What is not used, and why.**

- **Marketing e-mail, WhatsApp or SMS from the product.** Not built, and they
  need prior consent (Ley 8642 art. 44) which the product records but cannot
  yet use. When built, every message starts with "Publicidad" and carries a
  free one-step opt-out ([notifications](../06-operations/notifications.md)).
- **Contests and draws.** See decision 5.
- **Influencer payments.** Not researched; a paid post is advertising and must
  say so (Ley 10946 from about June 2027; _for the lawyer to confirm_ today's
  rule).

---

## 6. The numbers that say it works

A small set. Each says how to read it in the product today. Targets are the
roadmap's proposals.

| #   | Number                                           | Target (source)                                                      | How to read it today                                                                                                                                 | Measurable now?                 |
| --- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | Orders delivered a day                           | 100 in the pilot in total; one full route a day at launch (roadmap)  | Console **Resumen**: orders today; **Pedidos**: filter by status delivered                                                                           | Yes                             |
| 2   | On-time delivery against the promised date       | ≥ 95% (roadmap phase 1)                                              | **Resumen** shows late parcels now; **Pedidos** marks each late order. No rate over time: count by hand each week                                    | Partly (by hand)                |
| 3   | First-attempt delivery success                   | ≥ 90% (roadmap)                                                      | **Resumen**: failed deliveries; **Despacho**: each route's stops delivered and failed                                                                | Partly (by hand)                |
| 4   | Delivered stops per driver-day                   | ≥ 25 (see below)                                                     | **Despacho** per route; one route is one driver-day                                                                                                  | Partly (by hand)                |
| 5   | Contribution per order                           | Positive on average for 4 weeks (roadmap phase 2)                    | Fees per order from the ledger in **Liquidaciones** and seller statements; costs (driver, rent, packaging) are outside the product, in a spreadsheet | No: half the inputs are outside |
| 6   | Share of shoppers who order again within 60 days | ≥ 1/3 of pilot shoppers; ≥ 25% at launch (roadmap)                   | **No report.** The order list shows a recipient name, not the account. Needs a report function (see "Needed elsewhere")                              | **No**                          |
| 7   | Active sellers with stock in the warehouse       | 5 in the pilot; growth each week after                               | **Vendedores** (status, listings); **Bodegas** for inbound received                                                                                  | Yes                             |
| 8   | Refunds paid within 8 calendar days              | 100% (law; [customer service](../06-operations/customer-service.md)) | **Atención**, returns oldest first; **Cobros** for refunds the gateway did not take                                                                  | Partly (by hand)                |
| 9   | Cash variance                                    | 0 every day of the last 2 pilot weeks (roadmap)                      | **Liquidaciones**: expected and handed in per route                                                                                                  | Yes                             |
| 10  | Cost to win a shopper, by channel                | No target until measured                                             | **Not in the product.** Ad platforms report clicks, not orders                                                                                       | **No**                          |

**Why 25 stops, not 20.** The business model compares an own driver with
Correos at ₡2,300 per parcel. That is Correos' self-service locker price.
Correos' Pymexpress volume tariff is lower: ₡2,005.53 (5–24 parcels a
month), ₡1,962.17 (25–200), ₡1,853.76 (201–450) and ₡1,756.19 (451 or more),
for the first kilo inside the GAM, before 13% IVA. Every tier needs prior
authorisation from Correos' Dirección de Pymes, and a home pickup costs
₡1,500 (1–3 parcels) to ₡2,000 (11 or more) on top (correos.go.cr/tarifas,
opened 24 November 2026).

One driver at 23–25 stops over 26 days is about 600–650 parcels a month,
which is the 451-or-more tier. Against it, at the assumed ₡45,000 driver-day:

| Case                                                               | An own driver costs less than Correos above |
| ------------------------------------------------------------------ | ------------------------------------------: |
| With authorisation, 451+ tier, one ₡2,000 pickup a day, before IVA |        **24.5 stops** (₡43,000 ÷ ₡1,756.19) |
| Same, without the pickup (parcels dropped off by Yuntera)          |                                  25.6 stops |
| Same, if Yuntera cannot credit the IVA                             |                       about 21.5–22.7 stops |
| Before authorisation, at the ₡2,300 locker price                   |    19.6 stops, plus the drive to a drop-off |

This plan uses **about 25 stops** as the test. It equals the business
model's own assumed density, so at that density an own driver only breaks
even with Correos. The business model's "about 20" needs this correction (see
"Needed elsewhere"). Whether IVA can be credited is _for the accountant to
confirm_.

**Until the product counts them,** numbers 2, 3, 4, 6 and 10 go in one
spreadsheet the owner fills every Saturday: orders, late, failed, stops per
route, the number of new and of returning shoppers, and the answers to
"¿Cómo nos conoció?" asked once by WhatsApp after the first delivery, only to
people who wrote to Yuntera. The sheet holds **counts and order numbers
only**: a returning shopper is recorded as the pair of order numbers (first
order, later order), never by name, e-mail or phone. If the owner wants any
personal data in the sheet, it must first be listed as a processing activity
in [privacy](../05-security-compliance/privacy.md), with a deletion step
(_for the lawyer to confirm_).

---

## 7. Launch sequence

Weeks are counted from the start of the [roll-out plan](rollout-plan.md)
(week 1). The roll-out plan holds the entry and exit tests; this table holds
the market actions.

### 7.1 Before launch (roll-out phases 0 to 3, weeks 1–22 at best, an estimate)

Until the trademark search is clear and the company exists, the owner may
talk to sellers and describe the service, but prints nothing, signs nothing
and visits no one under the name ([brand book](../brand/brand-book.md) §15).

| When (weeks)     | Action                                                                                                    | Who                  | Done when                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| 1–2              | Trademark search at the Registro Nacional; register `yuntera.cr`; reserve social handles                  | Owner, lawyer        | Search result in writing; handles held                                                        |
| 1–6              | 10–15 seller interviews with the worked statement, without printed material or a contract                 | Owner                | 5 sellers say yes; written commitments once the search is clear and the company exists        |
| 2–6              | Choose the warehouse and the pilot cluster (§2.3)                                                         | Owner                | Lease signed; cluster written into **Operación**                                              |
| 4–8              | Seller flyer and pitch, shopper card, in Spanish and English (written in the marketing part of this pack) | Owner; copy editor   | Printed only after the trademark search is clear; every promotion line has dates and quantity |
| 6–10             | Sellers list products and send stock                                                                      | Sellers; owner helps | Stock counted in the warehouse                                                                |
| 10–22 (or later) | Closed pilot: invited shoppers only; no public posts                                                      | Owner                | Roadmap phase 1 exit criteria met                                                             |

### 7.2 Launch week (first week of roll-out phase 4)

| Day          | Action                                                                                                              | Who            | Done when                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------- |
| Before day 1 | Public site without the Vercel login; legal footer with the real company data; help page and complaint form checked | Builder; owner | A stranger's phone opens the shop and the complaint form |
| Day 1        | Each pilot seller posts their shop link to their followers; the owner posts on Facebook, Instagram and TikTok       | Sellers; owner | Posts live                                               |
| Days 1–6     | Owner answers every WhatsApp message the same day; logs each contact against its order                              | Owner          | No message older than the targets in customer service    |
| Days 1–6     | Daily check of numbers 1–3 and 9 (§6)                                                                               | Owner          | Spreadsheet line per day                                 |
| Day 6        | Review: any late parcels, any failed payments, any complaint                                                        | Owner          | Written list of fixes, each with an owner and a date     |

### 7.3 The first 90 days after launch

| Days  | Action                                                                                                | Who                | Done when                                                |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| 1–30  | Sales agent starts; target 50 active sellers                                                          | Sales agent; owner | 50 in **Vendedores**, status `active`                    |
| 1–30  | ₡25,000 paid social test to shoppers in the served cantons only                                       | Owner              | Cost per click and per thousand views written down       |
| 31–60 | Add a canton only by the rule in the roll-out plan; ask MEIC and Correos for a joint session (§8)     | Owner              | Rule met and written; session held or refused in writing |
| 31–60 | Set the monthly ad cap from the test, within the budget level (decision 4)                            | Owner              | Cap written in this file                                 |
| 61–90 | Read the launch exit test: contribution positive 4 weeks, 25% repeat in 60 days, one full route a day | Owner              | Each number read and written; go, change or stop (§10)   |

---

## 8. Partnerships worth asking for

None is agreed. Each line says what to ask and who asks.

| Partner                                               | What to ask                                                                                                                                                                                             | Why                                                                                                                | Who asks    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| Correos de Costa Rica, Dirección de Pymes             | Authorisation for the Pymexpress volume tariff (all four tiers need it, per the tariff page); the pickup price; whether cash collection on delivery is live; a joint session for its Pymexpress clients | The only published courier price; fallback for overflow and outside the core; 20,400 small-business clients (2024) | Owner       |
| ONVO                                                  | The contract, the written questions in [payments](../06-operations/payments.md), the rate for SINPE Móvil in the marketplace flow                                                                       | Blocks every real order                                                                                            | Owner       |
| MEIC (mipyme and entrepreneur registers, EXPOPYME)    | A stand or a talk at a regional EXPOPYME; a training session for registered entrepreneurs                                                                                                               | 36,098 registered firms (May 2026)                                                                                 | Owner       |
| esencial COSTA RICA (country brand)                   | A session for licensed companies selling packaged goods                                                                                                                                                 | More than 700 licensed companies; fits _hecho en Costa Rica_                                                       | Owner       |
| Authorised distributors of electronics and appliances | Listings with the manufacturer's warranty                                                                                                                                                               | The warranty wedge                                                                                                 | Sales agent |
| Moovin, Uber Direct                                   | Written price quotes                                                                                                                                                                                    | No published merchant price (open question 45)                                                                     | Owner       |
| INS                                                   | Work-risk insurance quote per driver and warehouse worker                                                                                                                                               | Mandatory before any route (compliance §7)                                                                         | Owner       |

Boxful is a fulfilment competitor in Escazú; ask for a quote only as a
benchmark. Walmart Marketplace, Pyme Store BAC and the Correos–BCR–INS–
Mastercard pilot are competitors for sellers; none publishes seller fees
(market research §3.1). Ask each for its seller terms in writing, as a seller
would.

---

## 9. Budget: lean, base, bold

Monthly cash out, in colones. **Founder pay is not included** (decision 3 in
the [team structure](team-structure.md)). Amounts marked _assumption_ have no
published price; each says how to check.

| Line                                        | Unit cost and source                                                                                                                                                                                                                                                     | Lean (pilot, founder runs it, 5–10 orders a day)                                        | Base (launch, 20–40 orders a day)      | Bold (launch with a team, 50–65 orders a day) |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Platform (database, hosting, e-mail)        | US$45–75 a month ([operations](../07-deployment/operations.md), "What it costs"; error tracking and uptime checks on free tiers, US$0); bold adds point-in-time recovery, about US$100 plus about US$5 of larger compute (same source)                                   | ₡20,300–₡33,800                                                                         | ₡20,300–₡33,800                        | ₡67,500–₡81,000                               |
| Warehouse space                             | _Assumption_ US$8–14 per m² a month for small units (large GAM units list at US$7.25–9.00 plus about US$0.85 upkeep); check 3 listings near the sellers                                                                                                                  | 20 m²: ₡72,000–₡126,000                                                                 | 50 m²: ₡180,000–₡315,000               | 100 m²: ₡360,000–₡630,000                     |
| Drivers                                     | ₡1,170,000 a driver a month: the business model's assumed ₡45,000 driver-day × 26 days; of it, labour at the legal minimum is ₡564,600 (sourced). Count by the ratio in [team structure](team-structure.md) §5 (orders ÷ 25 stops, plus 10% failed attempts, rounded up) | Founder drives: fuel only, _assumption_ 2–6 litres a day × ₡807 × 26 = ₡42,000–₡126,000 | 1–2 drivers: ₡1,170,000–₡2,340,000     | 3 drivers: ₡3,510,000                         |
| Backup person (warehouse and backup driver) | ₡18,800 a day loaded (TOSC ₡13,523.69 a day × 1.3916); part-time pay rules _for the accountant to confirm_                                                                                                                                                               | 8 days: ₡150,600                                                                        | — (the associate is the backup driver) | —                                             |
| Warehouse associate                         | ₡519,200 loaded (Bodeguero peón ₡373,092.30 × 1.3916); 1 per 40 orders a day                                                                                                                                                                                             | —                                                                                       | 1: ₡519,200                            | 2: ₡1,038,400                                 |
| Support agent                               | ₡564,600 loaded (Oficinista or Telefonista ₡405,710.70 × 1.3916); hired at about 60 orders a day                                                                                                                                                                         | —                                                                                       | — (founder)                            | 1: ₡564,600                                   |
| Sales agent                                 | ₡584,100 loaded (Agente de ventas ₡419,755.80 × 1.3916); starts at open launch (§7.3)                                                                                                                                                                                    | —                                                                                       | 1: ₡584,100                            | 1: ₡584,100                                   |
| Packaging                                   | ₡200 an order (business model assumption), 26 days a month                                                                                                                                                                                                               | ₡26,000–₡52,000 (130–260 orders)                                                        | ₡104,000–₡208,000                      | ₡260,000–₡338,000                             |
| Courier overflow (Correos, by hand)         | ₡2,300 locker price × 1.13 IVA = about ₡2,600 a parcel until the volume tariff is authorised (Correos tariff)                                                                                                                                                            | ₡0–₡130,000 (up to 50 parcels, an assumption)                                           | Only if a driver is off                | Only if a driver is off                       |
| Printing (flyers, parcel cards)             | _Assumption_; get 2 quotes                                                                                                                                                                                                                                               | ₡30,000–₡60,000                                                                         | ₡60,000–₡120,000                       | ₡120,000–₡240,000                             |
| Paid social                                 | A cap the owner sets; not derived from a cost per view (none found)                                                                                                                                                                                                      | ₡0 (ads wait for the pilot exit, decision 6)                                            | ₡150,000, including the ₡25,000 test   | ₡500,000                                      |
| Radio                                       | Price not found; quotes needed                                                                                                                                                                                                                                           | —                                                                                       | —                                      | Not budgeted until quoted                     |
| Accountant                                  | _Assumption_ ₡100,000–₡300,000 a month; get 3 quotes                                                                                                                                                                                                                     | ₡100,000–₡300,000                                                                       | ₡100,000–₡300,000                      | ₡100,000–₡300,000                             |
| **Total a month**                           |                                                                                                                                                                                                                                                                          | **₡440,900–₡978,400**                                                                   | **₡2,887,600–₡4,570,100**              | **₡7,104,600–₡7,786,100**                     |
| In US dollars at ₡450                       |                                                                                                                                                                                                                                                                          | US$980–2,170                                                                            | US$6,420–10,160                        | US$15,790–17,300                              |

Loaded costs are salary × 1.3916 (26.83% employer charges, 8.33% aguinaldo,
about 4% vacation). The 26.83% includes the INS
work-risk rate at a reference 1%; the real rate depends on the activity and
may be higher for drivers (Alegra, updated 7 October 2026). _For the
accountant to confirm_ with an INS quote. Above 65 orders a day the team grows
to the [team structure](team-structure.md)'s Level 1 (100 orders a day:
payroll ₡10.9M–₡11.9M a month).

**One-off costs before the pilot**, outside the monthly table:

| Item                                                             | Cost                                                 | Source                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| Trademark filing                                                 | US$50 a class; 3 classes proposed = US$150 (₡67,500) | Fact sheet §9; classes in open question 2 |
| Google Play account                                              | US$25 once (₡11,300)                                 | `STATUS.md`, item 11.6                    |
| Lawyer: terms, seller agreement, privacy notice, driver contract | _Assumption_ ₡1,000,000–₡3,000,000; get 3 quotes     | No source found                           |
| Shelving, scale, label printer, bin labels                       | _Assumption_ ₡300,000–₡700,000; price 3 suppliers    | No source found                           |

**Yearly costs**, from the first year:

| Item                              | Cost                                                                 | Source                                                                     |
| --------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `yuntera.cr`                      | US$70 plus IVA (about ₡35,600)                                       | Fact sheet §9, via [operations](../07-deployment/operations.md)            |
| Apple developer membership        | US$99 (₡44,600)                                                      | `STATUS.md`, item 11.6                                                     |
| PRODHAB registration, if required | US$200 (₡90,000)                                                     | [Operations](../07-deployment/operations.md), "Per year"; open question 35 |
| Trademark renewal                 | Not a yearly cost in the first years; check the term with the lawyer | —                                                                          |

**How the budget relates to the business model.** The model's ₡2,334
contribution on a ₡20,000 order already pays ₡1,800 for delivery, ₡500 for
picking, ₡200 for packaging and ₡150 for support. Before those four costs, a
₡20,000 order brings **₡4,984**, and an ₡8,000 order ₡3,044 (the business
model's ₡2,334 and ₡394, "The same order at other basket sizes", plus
₡2,650). With staff on salary, the month
breaks even when orders × ₡4,784 (packaging still per order) cover the rest
of the level's costs:

- **Base:** about 582 orders a month (**22 a day**, about all one driver can
  carry) at the low costs with one driver; about 912 (35 a day) at the high costs with two. The pricing
  proposal finds about 24 a day for its launch month (pricing strategy §3.3).
- **Bold:** about 1,430–1,560 orders a month (55–60 a day), near the top of
  its 50–65 range.

The overheads alone (platform, rent, printing, ads, accountant at base:
₡510,300–₡918,800) would need only 219–394 orders a month at ₡2,334, but
that figure assumes full routes and is **not** the break-even. A salaried
driver doing 10 stops a day costs ₡4,500 a stop instead of the model's
₡1,800, so each of those orders contributes ₡2,334 − ₡2,700 = **−₡366**.
Density, not ad money, decides the result.

**Cash needed until the launch exit test.** An estimate from week 1 to 13
weeks after the open launch, at the best-case weeks of the
[roll-out plan](rollout-plan.md). Contribution is counted as orders × ₡4,984
(₡20,000 baskets) or × ₡3,044 (₡8,000 baskets). It ignores the timing of
gateway settlement and seller payouts. **Founder pay is not included**, so
the pilot looks cheaper than it is.

| Period                                                                      | Weeks (months) | Central case: low costs, ₡20,000 baskets         | Worst case: high costs, ₡8,000 baskets |
| --------------------------------------------------------------------------- | -------------- | ------------------------------------------------ | -------------------------------------- |
| Set-up: one-off and first-year costs, accountant, platform, 1 month of rent | 1–10 (2.3)     | ₡1,761,000 out                                   | ₡4,843,000 out                         |
| Pilot at the lean level, 130 orders a month                                 | 10–22 (2.8)    | ₡207,000 a month in; ₡574,000 in over the period | ₡583,000 a month out; ₡1,615,000 out   |
| Launch at the base level, 20 orders a day, 1 driver                         | 23–35 (3.0)    | ₡296,000 a month out; ₡888,000 out               | ₡1,713,000 a month out; ₡5,144,000 out |
| **Total to week 35**                                                        |                | **about ₡2.1M**                                  | **about ₡11.6M**                       |

Every input is an estimate from the tables above. The pilot comes out near
zero in cash only because the founder drives, packs and answers for free and
his vehicle costs only fuel. At 260 pilot orders or 40 launch orders a day
the totals fall; with longer set-up lead times (up to week 16) they rise by
the set-up months.

**For a seller,** the price against shipping alone (Correos or a courier) is
compared in the pricing proposal (pricing strategy §2.6). Boxful publishes
no price; ask for a quote as a benchmark (§8).

---

## 10. Risks, and what would make the owner stop or change course

Risks come before the action they apply to; the table is ordered by how early
each one can bite.

| Risk                                                                                                 | Sign to watch                                                                                           | Response                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The name cannot be used (trademark search)                                                           | Search result                                                                                           | Change the name before printing anything ([decision 14](../02-architecture/decisions.md))         |
| The gateway or Hacienda set-up takes months                                                          | No contract or no invoicing certification by week 8                                                     | Keep recruiting sellers; do not set a public launch date                                          |
| Sellers will not accept 8%–15% plus fulfilment                                                       | Fewer than 5 yes in 15 interviews                                                                       | Change the fee proposal before the pilot, not after                                               |
| Orders too scattered to fill a route                                                                 | Fewer than 12 delivered stops per driver-day after 4 weeks of launch (orders lose money below about 11) | Narrow the cantons, or move deliveries to Correos and keep the driver for the densest canton only |
| Baskets too small                                                                                    | Average order under ₡10,000 (an ₡8,000 order contributes ₡394)                                          | Change categories or the free-delivery threshold (pricing proposal)                               |
| Amazon Bazaar's ₡10,000 free shipping sets the shopper's reference                                   | Shoppers ask why delivery costs ₡1,500                                                                  | Sell speed, SINPE Móvil and a local answer, not price                                             |
| Walmart Marketplace, Boxful or the Correos–BCR pilot win the same sellers                            | Sellers cite them in interviews                                                                         | Ask them for those platforms' terms; compare the total cost per order                             |
| Founder ill or away                                                                                  | Any day with no one to drive or pack                                                                    | The backup person is trained before the pilot (roadmap phase 1)                                   |
| An advert breaks the promotion rules (MEIC found breaches in 31% of 26 digital adverts in June 2026) | Any offer without dates, quantity or former price                                                       | Every offer goes through the checklist in §3 before it is posted                                  |
| Support overload with no inbox or notes                                                              | More than the founder can answer within the targets                                                     | Build the console's support desk (owner chose it; task in progress) before paid ads               |

**Stop or change course if any of these holds** (the roadmap's own tests,
with numbers):

1. After the pilot's 100 orders, contribution per order is negative and no
   lever in the business model makes it positive. **Change** the categories
   or the delivery model before launch.
2. Fewer than 1 in 3 pilot shoppers order a second time without being asked.
   **Stop** paid acquisition; find out why first.
3. After 90 days of launch, fewer than 25% of first-time shoppers return
   within 60 days. **Stop** spending on shopper ads.
4. After 90 days of launch, no canton fills one route a day (about 25 stops, §6).
   **Change** to carrier delivery for everything outside the best canton.
5. A refund misses the legal 8 days, or a complaint goes unanswered past
   5 working days. **Pause** marketing until the cause is fixed.

---

## Decisions for the owner

1. **Which cantons does the pilot serve?**
   A. Cluster A, East: San José Central, Montes de Oca, Curridabat, Goicoechea, Moravia.
   B. Cluster B, West: Escazú, Santa Ana, Belén.
   C. Cluster C, North: Heredia Central, Santo Domingo, San Pablo, Flores.
   D. The 3 to 5 adjacent core cantons around the 5 signed sellers and the warehouse. **(recommended)** No source tells the clusters apart, and routes fill fastest where the stock and the first customers already are.
2. **A first-order offer in the pilot?**
   A. None. **(recommended)** Invited shoppers do not need one, and the pilot must measure real willingness to pay delivery.
   B. First delivery free, with start date, end date and number of orders stated (art. 55 i and j).
3. **May marketing quote how many Costa Ricans buy online?**
   A. No; describe the problem instead. **(recommended)** The three sources disagree and the regulation needs checkable sources.
   B. "48.5% (UCR, 2022)", with the year shown.
   C. "About 80%", naming the industry source.
4. **Which budget level?**
   A. Lean until the pilot's exit test, then base. **(recommended)** It spends on people only after density is proven.
   B. Base from the pilot.
   C. Bold from the launch.
5. **Draws and contests in the first 90 days?**
   A. None. **(recommended)** Each draw needs a written reglamento, a notary or sworn declaration and the winner published nationally (art. 59), and paid entry may need the JPS.
   B. Free-entry draws only, with all of art. 59 met.
6. **When does paid advertising start?**
   A. After the pilot's exit test, with a ₡25,000 test first. **(recommended)** Ads before density buy scattered orders.
   B. In launch week.

---

## Assumptions to verify

| Assumption                        | Range used                                                                          | How to verify                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fully loaded driver-day           | ₡45,000                                                                             | Payroll quote from the accountant plus a vehicle and fuel log for 2 weeks |
| Delivered stops per driver-day    | 25 (model); about 25 to beat Correos (§6)                                           | Pilot routes in **Despacho**                                              |
| Correos volume tariff available   | From authorisation; ₡2,300 locker price before                                      | Ask the Dirección de Pymes (§8)                                           |
| Pilot order rate                  | 5–10 a day, 130–260 a month                                                         | Pilot actuals ([roll-out plan](rollout-plan.md))                          |
| INS work-risk rate                | 1% reference inside the 26.83%                                                      | INS quote per driver and warehouse worker                                 |
| Rent for 20–100 m² in the GAM     | US$8–14 per m²                                                                      | 3 listings near the first sellers                                         |
| Accountant's monthly fee          | ₡100,000–₡300,000                                                                   | 3 written quotes                                                          |
| Lawyer's package                  | ₡1,000,000–₡3,000,000                                                               | 3 written quotes                                                          |
| Printing                          | ₡30,000–₡240,000 a month                                                            | 2 quotes                                                                  |
| Owner hours per channel           | 5–10 hours a week                                                                   | A diary in the first 2 weeks                                              |
| New sellers per sales agent       | 5–10 a week                                                                         | The agent's first 4 weeks                                                 |
| Loaded cost factor                | Salary × 1.3916, shown as 1.39 (26.83% charges, 8.33% aguinaldo, about 4% vacation) | Accountant's payroll quote per role                                       |
| Exchange rate                     | ₡450 per US$                                                                        | Central bank rate on the day of payment                                   |
| Fuel use of the founder's vehicle | 2–6 litres a day                                                                    | Fuel receipts for 2 weeks                                                 |

## Sources

Opened by the writer on 24 November 2026:

- MTSS, Lista de salarios mínimos por ocupación 2026 (Decreto 45303-MTSS, in force 1 January 2026), copy of https://www.mtss.go.cr/temas-laborales/salarios/lista_salarios_minimos_2026.pdf — Agente de ventas ₡419,755.80; Oficinista, Telefonista, Bodeguero (encargado) ₡405,710.70; Bodeguero (peón), Mensajero ₡373,092.30; Conductor de vehículo liviano ₡13,523.69 a day.
- Correos de Costa Rica, Tarifas, https://correos.go.cr/tarifas/ — Pymexpress volume tiers, before IVA, each needing prior authorisation from the Dirección de Pymes; pickup ₡1,500–₡2,000; locker price ₡2,300.
- UCR, "Un estudio desmonta mitos sobre el uso de las plataformas digitales en Costa Rica" (27 May 2026), https://www.ucr.ac.cr/noticias/2026/5/27/un-estudio-desmonta-mitos-sobre-el-uso-de-las-plataformas-digitales-en-costa-rica.html — WhatsApp 96%, Facebook 80%, YouTube 77%; 792 adults, August 2025.

Read in the pack's market research (`/root/yuntera-audit/strategy-pack/research/market.md`, all read 24 November 2026 by the researcher):

- UCR Mediápolis, https://mediapolis.ucr.ac.cr/confianza-y-consumo/habitos-y-practicas-de-consumo/ — TikTok 58%, Instagram 47% (CICOM 2025; the population is not stated).
- Decreto 37899-MEIC arts. 55 and 59 (consolidated print of 7 January 2026); Ley 8642 art. 44 (SUTEL PDF).
- MTSS communiqué CP-022-2026 (28 October 2026): 1.70% increase from 1 January 2027.
- Alegra, employer charges 26.83% (updated 7 October 2026), https://blog.alegra.com/costa-rica/salario-minimo-costa-rica/
- Tico Times, 17 June 2026 (SINPE Móvil 2025; no data source named in the article); La República / Rumbo Económico, 12 September 2022 (UCR survey, 48.5%, provinces, devices); Forbes Centroamérica, 18 September 2025 (18%, search result).
- El Financiero: Amazon Bazaar (November 2025); "La rebelión del delivery" (15 July 2026).
- Delfino: Walmart Marketplace (21 January 2026, sponsored); Boxful (March 2026); Kantar IBOPE radio (14 February 2026); CBRE industrial market (May 2026); EXPOPYME (April 2026); Expo Pyme CR (May 2026).
- El Observador: MEIC registers (28 June 2026); exchange rate low (November 2026, search result). Diario Extra: bank rates (search result).
- La República: Pymexpress volumes (6 May 2024); esencial COSTA RICA (search result).
- Infobae, MEIC inspection of digital adverts (17 June 2026).
- Repretel and Diario Extra, fuel prices November 2026 (search results).
- Encuentra24 warehouse listings (search results).

Repository: `STATUS.md`; `packages/core/src/promise.ts`; `apps/web/src/components/checkout-form.tsx`; `apps/web/src/app/carrito/page.tsx`; `docs/05-security-compliance/privacy.md`; `docs/00-strategy/business-model.md`, `market-and-wedge.md`; `docs/01-product/pricing-and-fees.md`, `roadmap.md`, `personas-and-journeys.md`, `scope-by-app.md`; `docs/06-operations/customer-service.md`, `logistics-playbook.md`, `notifications.md`; `docs/05-security-compliance/compliance-costa-rica.md`; `docs/07-deployment/operations.md`, `go-live-checklist.md`; `docs/08-open-questions.md`; `docs/brand/brand-book.md` §4; `supabase/migrations/20261121080300_geography_data.sql`; `supabase/migrations/20261121081600_api_operations.sql` (`ops_overview`, `ops_orders`); `apps/ops/src/lib/staff.ts`; the pack's support research (`support-and-it.md`) and English research (`english.md`).
