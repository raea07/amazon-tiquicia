# Roadmap

Six phases, each ended by evidence rather than by a date. A phase is finished
when its exit criteria are met; until then the next phase does not start, and
if the criteria cannot be met the plan changes instead of the criteria. The
thresholds below are proposals (assumptions to validate with the owner), chosen
to be the smallest numbers that would actually change a decision.

The plan assumes a solo founder with AI tooling and little capital. That shapes
two rules used throughout: **operate by hand before automating**, because the
manual version reveals what the software should do; and **spend on fixed costs
only after a phase has proven the demand for them**.

## Summary

| Phase                              | Goal                                                   | Ends when                                                     |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 0 Foundation                       | A platform that can take and fulfil an order correctly | The full order journey works end to end in a test environment |
| 1 Closed pilot                     | Prove the operation and measure the three numbers      | About 100 real orders delivered to standard                   |
| 2 GAM public launch                | Prove strangers buy and come back                      | Contribution is positive and repeat buying is visible         |
| 3 Scale within the GAM             | Density: more orders per route and per square metre    | Own drivers are cheaper than carriers in the core zones       |
| 4 National                         | Reach the rest of the country through carriers         | National orders are profitable per order                      |
| 5 Cross-border and Central America | New supply, then new demand                            | Decided when Phase 3 is stable; not planned in detail         |

The three numbers are contribution per order, delivered stops per driver-day
and the 60-day repeat rate; see the
[business model](../00-strategy/business-model.md).

## Phase 0 — Foundation

**Goal.** Everything needed for one real order to be placed, paid, picked,
delivered and paid out, with the legal basics in place.

**Built.** This repository: the domain logic (`packages/core`), the brand
(`packages/brand`), the data model and access rules, and the apps to Pilot
scope ([scope by app](scope-by-app.md)): a storefront, a seller centre, an
operations console, and one mobile web app shared by drivers and the
warehouse. Native driver and warehouse apps are deferred (see "Do not build
yet"). A live preview environment with demonstration data is prepared as a
[runbook](../07-deployment/runbook-first-deploy.md) but not created: that
needs the owner's decision on cost.

**State today.** The domain logic, the database and the storefront are built
and tested locally; the other apps are in progress; nothing is deployed. The
current truth is in the
[architecture overview](../02-architecture/overview.md).

**Done by hand on purpose.** Nothing operates yet.

**In parallel, by the owner.** Register the domains; start the trademark
filing; incorporate the company and register with Hacienda; open the business
bank account; request gateway quotes; talk to 10–15 target sellers with the
worked fee statement from [pricing and fees](pricing-and-fees.md). These have
lead times of weeks and gate Phase 1 more than the software does. See
[open questions](../08-open-questions.md).

**Exit criteria.**

- The order journey in
  [personas and journeys](personas-and-journeys.md) completes end to end in the
  preview environment, across all the apps, for SINPE Móvil and cash on
  delivery.
- Access rules are tested: a shopper, seller, driver and associate each see
  only what [privacy](../05-security-compliance/privacy.md) says they should.
- A lawyer and an accountant have answered the questions at the end of
  [compliance](../05-security-compliance/compliance-costa-rica.md).
- A payment gateway account exists in sandbox.
- At least five sellers have said yes to the Pilot.

**Main risks.** Building past Pilot scope before any real order. Legal entity
and gateway onboarding taking longer than the software.

## Phase 1 — Closed pilot

**Goal.** Run the real operation at the smallest scale that produces evidence:
a handful of sellers, one small storage space, one or two drivers, and shoppers
who are friends, family and the sellers' own customers.

**Built.** Only what the pilot proves is missing. Expect: fixes to address
capture, the cash close-out, notifications, and whatever the first failed
delivery reveals.

**Done by hand on purpose.**

| Manual in the Pilot                                                           | Why not automate yet                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Seller onboarding and listing review, by the founder                          | Learn what sellers get wrong before designing the form                  |
| Confirming SINPE Móvil transfers against the bank, if the gateway is not live | The matching rules are only known after seeing real transfers           |
| Electronic invoices issued by each seller from their own system               | Integration is expensive; first confirm who must issue what             |
| Route building reviewed and adjusted by a person                              | The planner is a starting point; local knowledge beats it at this scale |
| Customer support over WhatsApp, by the founder                                | Every conversation is product research                                  |
| Payouts by bank transfer from a spreadsheet generated by the fee engine       | Volume does not justify payout automation                               |
| Returns collected by the same driver                                          | Too few to need a process                                               |

**Exit criteria (proposed).**

- At least 100 orders delivered, from at least 5 sellers, to at least 40
  distinct shoppers.
- On-time delivery against the promised date: at least 95%.
- First-attempt delivery success: at least 90%.
- Picking accuracy: at least 99% of orders with the right items.
- Cash on delivery reconciled to zero variance every day of the last two weeks.
- Every refund paid within the legal 8 calendar days.
- The three numbers measured, with the assumptions in the business model
  replaced by actuals.
- At least a third of pilot shoppers have ordered a second time without being
  asked.

**Main risks.** Too few orders to learn anything (fix: narrower categories,
sellers who bring their own customers). The founder doing every job and
stopping when ill (fix: a second person trained on the warehouse and one
backup driver before the pilot starts). Cash handling errors.

**Stop or change if** contribution per order is negative with no visible path
to positive, or shoppers do not reorder. Both are findings, not failures.

## Phase 2 — GAM public launch

**Goal.** Open to the public in the GAM core and find out whether strangers buy
and return.

**Built.** Launch scope in [scope by app](scope-by-app.md): card payments,
reviews, self-service returns and withdrawal, the complaint mechanism,
self-service seller onboarding, the exceptions queue, staff multi-factor
authentication, English interface, and automated electronic invoicing if the
accountant's answer and seller demand justify it.

**Done by hand on purpose.** Seller approval stays manual. Listing moderation
stays manual with a report button. Marketing is the sellers' own audiences plus
word of mouth before any paid acquisition.

**Exit criteria (proposed).**

- Positive contribution per order on average for four consecutive weeks.
- At least 25% of first-time shoppers order again within 60 days.
- Order volume fills at least one own-driver route a day in the core zone
  (about 20 delivered stops; see the business model).
- Service levels from Phase 1 held at the higher volume.
- No unresolved complaint older than the response target in
  [customer service](../06-operations/customer-service.md).
- Compliance items marked "needs lawyer" or "needs accountant" are all closed.

**Main risks.** Demand without density: orders scattered across the GAM so that
no route fills. A price comparison against cross-border platforms on the wrong
categories. One bad seller damaging trust in all of them.

## Phase 3 — Scale within the GAM

**Goal.** Density. More orders per route, more units per square metre, more
sellers per category, the extended GAM zone served well.

**Built.** Batch picking and packing stations, capacity limits per zone and
day, automated payouts, sponsored placements if traffic justifies them, a
native shopper app, recommendations from purchase data, seller tools for bulk
listing. Search moves to a dedicated engine only if measured search quality or
latency requires it.

**Done by hand on purpose.** Category management and seller recruitment.

**Exit criteria (proposed).** Own delivery cost per stop is below the carrier
price in every core zone. Fixed costs are covered by contribution for three
consecutive months. The operation runs for two weeks without the founder.

**Main risks.** Hiring ahead of volume. The courier employment question being
settled by law or the courts in a way the cost model did not assume (the model
intends to budget drivers as employees, on an assumed cost per driver-day that
is still to be validated; see
[compliance](../05-security-compliance/compliance-costa-rica.md)).

## Phase 4 — National via carrier partners

**Goal.** Sell to the whole country without building a national fleet.

**Built.** Carrier integrations for labels and tracking with one or two of the
carriers operating locally (Correos de Costa Rica, Moovin, Boxful; see the
[fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour)),
carrier-cost shipping at checkout, longer and wider delivery windows, returns
by carrier drop-off. Which carriers offer a usable integration has to be
confirmed with each of them.

**Done by hand on purpose.** Claims with carriers.

**Exit criteria (proposed).** National orders are contribution-positive after
carrier cost and the higher failure rate, and on-time delivery against the
(longer) promise is at least 95%.

**Main risks.** Carrier reliability becoming Yuntera's reputation. Returns
logistics outside the GAM.

## Phase 5 — Cross-border and Central America

Two separate bets, not planned in detail because the evidence to plan them does
not exist yet.

- **Cross-border supply:** imported goods sold through the same storefront,
  with customs, duties and import IVA handled by Yuntera or a partner. This
  roughly doubles the compliance surface
  ([market and wedge](../00-strategy/market-and-wedge.md)) and depends on
  customs rules that are changing.
- **Central America:** the same model in a second country. Requires a local
  entity, local payment rails and local law; nothing in the first four phases
  should be built for it in advance beyond keeping the country, currency and
  language as configuration, which the code already does.

## Do not build yet

Each of these is a reasonable idea that would cost months and prove nothing the
pilot needs to know.

| Not yet                                                  | Build it when                                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native shopper app                                       | Repeat usage on the mobile web is established (Phase 3)                                                                                                                |
| Native driver and warehouse apps                         | Drivers regularly lose signal on real routes, dispatch needs live positions, or scanning speed is what limits the warehouse. Until then one mobile web app serves both |
| Sponsored listings and an ads system                     | There is traffic sellers would pay to reach                                                                                                                            |
| Machine-learned ranking, recommendations or fraud models | There is enough labelled data; the rule-based versions in `packages/core` are in place until then                                                                      |
| A dedicated search engine                                | Measured relevance or latency in the database search is the bottleneck                                                                                                 |
| Microservices, queues, a data warehouse                  | A specific, measured load requires one                                                                                                                                 |
| Multiple warehouses and inventory transfers              | One warehouse is full                                                                                                                                                  |
| Own-courier fulfilment by sellers, with address sharing  | A seller segment needs it and the privacy consequences are designed                                                                                                    |
| Shopper–seller chat                                      | Support volume shows questions that only sellers can answer                                                                                                            |
| Membership or loyalty programme                          | Order frequency per shopper is known                                                                                                                                   |
| Public API and third-party integrations                  | A seller with real volume asks                                                                                                                                         |
| Credit, instalments, a wallet                            | A regulated partner offers it; never on Yuntera's own balance sheet without licensing advice                                                                           |
| Cross-border imports, a second country                   | Phase 3 is stable                                                                                                                                                      |
