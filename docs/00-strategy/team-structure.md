# Team structure

**What this is.** The people Yuntera needs at the pilot, at launch and at 100, 300 and 1,000 orders a day: what each does, in which app, with which permissions, on what terms and at what monthly cost.
**Conclusion 1.** The pilot needs the founder plus one trained backup person (payroll ₡150,600 a month); launch needs 3 or 4 people (₡2,273,300–₡3,443,300). Every hire after that is triggered by a number the console shows, not by a date.
**Conclusion 2.** Drivers are most of the cost at every level (about 60%–65% of payroll at 100 orders a day). The business model's per-order labour figures are not reached even at 1,000 orders a day: payroll stays about ₡750–₡820 an order above them. So the model must budget the overhead roles, or density must exceed 25 stops.
**Conclusion 3.** The product automates the money, the promise, the stock and the delivery check, but not people work: seller approval, listing review, payouts, support conversations and late-delivery calls stay manual.
**The owner must decide** four questions, asked once in the [owner decisions](owner-decisions.md) list: founder pay (D18), driver engagement and vehicle (D19), the first hire (D39) and combined jobs (D40).

All costs are monthly, in colones, at the **2026 legal minimum** for the
closest occupation in the labour ministry's list, **fully loaded**: salary ×
1.3916, shown as "× 1.39" (26.83% employer charges, 8.33% aguinaldo, about 4%
vacation; market research §6.2). The 26.83% includes the INS work-risk rate
at a reference 1%; INS sets the real rate by activity, and it may be higher
for drivers and warehouse work (Alegra, updated 7 October 2026): _for the
accountant to confirm_ with an INS quote. The market usually pays more; a range is given where a market
figure exists. From **1 January 2027** every minimum rises **1.70%** (MTSS
communiqué CP-022-2026, 28 October 2026). Which occupation fits each role,
and the loaded factor, are **for the accountant to confirm**; the employment
basis is **for the lawyer to confirm** ([compliance](../05-security-compliance/compliance-costa-rica.md) §7).
US dollars at ₡450 (bank selling rate, 18 November 2026).

Related: [go-to-market](go-to-market.md), [roll-out plan](rollout-plan.md),
[business model](business-model.md), [logistics playbook](../06-operations/logistics-playbook.md),
[customer service](../06-operations/customer-service.md).

---

## 1. Unit costs used throughout

| Role in Yuntera                               | Closest MTSS occupation (category)                       | 2026 minimum            | Loaded cost a month 2026 | Loaded 2027 (+1.70%) | Market reference (low confidence)                                                       |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------- | -----------------------: | -------------------: | --------------------------------------------------------------------------------------- |
| Warehouse associate                           | Bodeguero (peón), TONCG                                  | ₡373,092.30 a month     |                 ₡519,200 |             ₡528,000 | —                                                                                       |
| Warehouse lead                                | Bodeguero (encargado), TOSCG                             | ₡405,710.70 a month     |                 ₡564,600 |             ₡574,200 | —                                                                                       |
| Driver (car or van)                           | Conductor de vehículo liviano, TOSC                      | ₡13,523.69 a day        |       ₡564,600 (30 days) |             ₡574,200 | —                                                                                       |
| Motorbike courier                             | Mensajero, TONCG (no motorbike occupation in the list)   | ₡373,092.30 a month     |                 ₡519,200 |             ₡528,000 | Which category applies is **for the lawyer or accountant**                              |
| Support agent                                 | Oficinista or Telefonista, TOSCG                         | ₡405,710.70 a month     |                 ₡564,600 |             ₡574,200 | Paylab average ₡657,336 gross (refused the request; search result)                      |
| Finance clerk, catalogue reviewer, dispatcher | Oficinista (general), TOSCG                              | ₡405,710.70 a month     |                 ₡564,600 |             ₡574,200 | —                                                                                       |
| Sales agent (seller recruitment)              | Agente de ventas, TOCG                                   | ₡419,755.80 a month     |                 ₡584,100 |             ₡594,100 | Seller-success pay: **not found**                                                       |
| Social-media person                           | Gestor de redes sociales: replies TOSCG, reads data TOCG | ₡405,710.70–₡419,755.80 |        ₡564,600–₡584,100 |    ₡574,200–₡594,100 | Not found                                                                               |
| Operations lead                               | Bodeguero (encargado) as a floor                         | ₡405,710.70 a month     |      ₡564,600–₡1,065,500 |                      | Paylab logistics controller about ₡765,690 gross at 5 years (fewer than 20 respondents) |
| Graduate role (finance lead, later)           | Bachiller universitario                                  | ₡664,078.07 a month     |                 ₡924,100 |             ₡939,800 | Average formal salaried worker ₡822,699.50 (BCCR, May 2026, press-level)                |

**A driver costs more than the wage.** The business model assumes a fully
loaded **₡45,000 per driver-day**, or **₡1,170,000 a month** over 26 days. Of
that, labour at the minimum is ₡564,600 (₡21,700 a day); the other ₡605,400
(₡23,300 a day) is the vehicle, fuel (regular about ₡807 a litre, November
2026), insurance, phone and supervision. That split is an **estimate**; the
vehicle part is not sourced. This document uses ₡1,170,000 for each driver.

Minimums checked in the ministry's list
(lista_salarios_minimos_2026.pdf, Decreto 45303-MTSS, in force 1 January
2026). Employers with fewer than 5 permanent non-agricultural workers do not
pay the 1.50% INA charge (Alegra, third party): _for the accountant to
confirm_; this document does not deduct it.

---

## 2. What the product gives each person

The product has three kinds of work access, each a separate record
(`supabase/migrations/20261121080100_identity.sql`,
`20261121080500_inventory.sql`):

| Access          | Values                                                                                                  | Set in the console        | What it opens                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff role      | `admin`, `ops`, `support`, `finance`, `catalog` — **one per person**                                    | **Personal** (admin only) | Console areas (table below); every database function checks the role again                                                                                                      |
| Driver          | Status `pending`, `active`, `suspended`, `offboarded`; vehicle, licence, inspection and insurance dates | **Repartidores** (`ops`)  | The field app's route area (`/ruta`) and the Yuntera Ruta phone app (not yet run on a phone)                                                                                    |
| Warehouse staff | `associate` or `lead`, per warehouse                                                                    | **Bodegas** (`ops`)       | The field app's warehouse area (`/bodega`) and the Yuntera Bodega phone app (not yet run on a phone). `lead` grants nothing more than `associate` today; it only sorts the list |

Console areas by staff role (`apps/ops/src/lib/staff.ts`; `admin` sees all):

| Area                                       |    ops     | support | finance | catalog |
| ------------------------------------------ | :--------: | :-----: | :-----: | :-----: |
| Resumen (today's counts)                   |     ✓      |    ✓    |    ✓    |    ✓    |
| Pedidos                                    |     ✓      |    ✓    |    ✓    |         |
| Despacho, Operación, Repartidores, Bodegas |     ✓      |         |         |         |
| Liquidaciones (cash per route)             |     ✓      |         |    ✓    |         |
| Atención (returns, complaints, reports)    |     ✓      |    ✓    |    ✓    |    ✓    |
| Mensajes (stuck messages)                  |            |    ✓    |         |         |
| Catálogo                                   |            |         |         |    ✓    |
| Vendedores                                 |     ✓      |    ✓    |    ✓    |         |
| Cobros, Pagos a vendedores, Comprobantes   |            |         |    ✓    |         |
| Cambios de tienda                          |     ✓      |         |    ✓    |         |
| Ofertas en pausa                           |            |         |    ✓    |    ✓    |
| Personal, Auditoría, Seguridad             | admin only |         |         |         |

Rules in the product that shape the team:

- **One staff role per person.** Someone who does support and catalogue
  needs `admin`, or the product must allow two roles (owner decision D40).
- **Two people for some steps.** Nobody approves their own payout-account
  request or one for a shop they belong to; the security page warns when
  fewer than two administrators have a second factor; refunds above ₡50,000
  need a second approver "once there is a second person" (customer service,
  a policy, not enforced in code).
- **Console sessions** last 12 hours and end after 30 idle minutes.
- **The delivery code** is never shown to any staff role or driver.
- A person appears to be able to hold a staff role, a driver record and a
  warehouse record at once (no function refuses it); **verify on the preview**
  before the founder relies on it.

---

## 3. Which roles the product replaces today, and which it does not

| Work                                                                         | Automated today?                                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Fees, IVA on fees, each seller's statement and payout amount                 | **Yes** (fee engine and ledger)                                                                                        |
| The delivery date shown, with cutoffs and holidays                           | **Yes** (`promise.ts`)                                                                                                 |
| Stock reserved, released, counted; picks checked against the barcode         | **Yes**                                                                                                                |
| Delivery proof by the shopper's code; cash expected per route                | **Yes**                                                                                                                |
| Order and payment messages                                                   | **Yes, once** the messaging provider is set up (nothing is sent today)                                                 |
| SINPE Móvil matched to the order; card payments; refunds through the gateway | **Yes, once** ONVO is live. Until then finance confirms transfers by hand                                              |
| Electronic invoices for Yuntera's fees and the delivery charge               | **Yes, once** the Hacienda issuer is set up. Sellers' own invoices for the goods: **no**, each seller issues them      |
| A first route plan from packed parcels                                       | **Partly**: the planner proposes; a person adjusts and assigns (roadmap: done by hand on purpose)                      |
| Seller verification, listing, photo and logo review                          | **No**: a person in **Vendedores** and **Catálogo**                                                                    |
| Paying sellers                                                               | **No**: finance makes each bank transfer by hand and records it; there is no bank connection                           |
| Refunds of cash orders                                                       | **No**: finance pays back by transfer                                                                                  |
| Support conversations (WhatsApp, e-mail)                                     | **No**: no inbox, no notes yet; the support desk is being built                                                        |
| Calling a shopper before a late delivery                                     | **No**: the late list shows it; a person calls                                                                         |
| Complaint intake from the shop                                               | **No**: the form is not wired (phase 1 of the roll-out plan)                                                           |
| Seller recruitment, seller help, marketing                                   | **No**                                                                                                                 |
| Watching the system                                                          | **No**: no monitoring installed                                                                                        |
| Risk and seller scores acting on orders                                      | **No**: both are written in `packages/core` and "not wired in yet" ([open questions](../08-open-questions.md), row 61) |

---

## 4. Roles, one by one

Each role: what it does daily and where, the product access, the employment
basis and the lawyer's question it raises.

### Founder (until each role is hired)

- **Daily:** everything in the rows below that has no person yet. In the
  pilot: morning picks and packing in the field app (`/bodega`), the route in
  the afternoon (`/ruta`), support on WhatsApp, cash settlement in
  **Liquidaciones**, seller verification and listing review, payouts in
  **Pagos a vendedores**.
- **Access:** staff `admin` with a second factor; a driver record; warehouse
  staff `lead`.
- **Basis:** owner. Whether the founder is on the payroll is owner decision
  D18, and a question for the accountant.

### Backup person (warehouse and backup driver)

- **Daily in the pilot:** 2 days a week (an assumption): receive and count
  inbound stock, pick and pack; drive the route when the founder cannot. The
  roadmap requires a trained warehouse backup and a backup driver
  **before** the pilot ([roadmap](../01-product/roadmap.md) phase 1; open
  question 16). This plan **chooses** one person for both. If the founder is
  away on a day with both packing and a route, a second backup person is
  needed for that day.
- **Access:** warehouse staff `associate`; a driver record (`active`). No
  staff role.
- **Basis:** employee, part-time. _For the lawyer and accountant:_ how
  part-time pay and charges are computed at the minimum; whether a person who
  both drives and packs falls under the driver or the warehouse category.
- **Cost:** ₡18,800 a loaded day (TOSC ₡13,523.69 × 1.3916); 8 days =
  ₡150,600 a month.

### Driver

- **Daily:** collects the day's parcels from the dispatch shelf, runs the
  route in `/ruta` (navigation link, the shopper's code at the door, cash,
  failed attempts with a reason), hands in cash at the end. Returns collected
  on the same route.
- **Access:** driver record `active`, with licence, inspection and insurance
  dates kept current (**Repartidores**).
- **Basis:** the cost model budgets drivers as **employees** (compliance §7).
  _For the lawyer:_ employee, contractor or courier company (D19);
  whether a motorbike courier is "Mensajero" or "Conductor de vehículo
  liviano"; what the contract and the app must avoid. Work-risk insurance
  (INS) is required either way.
- **Cost:** ₡1,170,000 a month all-in (§1); labour alone ₡564,600 (or
  ₡519,200 if "Mensajero" applies).

### Warehouse associate

- **Daily:** receives inbound shipments by appointment, puts away by scan,
  picks and packs before the cutoff, places parcels by route, checks in
  returns, moves stock and corrects counts in **Bodega → Ubicaciones**.
- **Access:** warehouse staff `associate`.
- **Basis:** employee. _For the lawyer:_ none beyond the usual contract.
- **Cost:** ₡519,200. A lead (same access, `lead`): ₡564,600.

### Support agent

- **Daily:** WhatsApp and e-mail, each contact logged against its order;
  **Pedidos** to see an order, **Atención** for returns, complaints and
  reports, **Mensajes** to resend a stuck message; calls shoppers whose parcel
  will be late. Targets in [customer service](../06-operations/customer-service.md).
- **Access:** staff `support`. Cannot stop a packed parcel (asks `ops`).
- **Basis:** employee. _For the lawyer:_ working hours across 6 delivery days
  for one person.
- **Cost:** ₡564,600.

### Sales agent (seller recruitment and seller help)

- **Daily:** visits and calls shops; helps the first listing in the seller
  centre (with the seller signed in on their own account, never with their
  password); answers seller questions.
- **Access:** no staff role. The `support` role would also open **Pedidos**
  and **Atención**, with buyers' names and orders, which this job does not
  need (D40 A). The founder or `ops` tells the agent a seller's status.
  Seller approval stays with `ops`. A sellers-only role would be a product
  change.
- **Basis:** employee, or a contractor paid per active seller. _For the
  lawyer:_ whether commission-only pay is allowed below the minimum wage, and
  what makes a sales contractor an employee.
- **Cost:** ₡584,100 at the minimum.

### Operations lead and dispatcher

- **Daily:** plans and assigns routes in **Despacho**, watches **Resumen**
  (late parcels, failed deliveries, parcels to dispatch), stops a packed
  parcel when asked, approves sellers in **Vendedores**, manages drivers in
  **Repartidores** and zones, closures and settings in **Operación**, settles
  cash in **Liquidaciones**.
- **Access:** staff `ops`.
- **Basis:** employee.
- **Cost:** lead ₡564,600–₡1,065,500; dispatcher ₡564,600.

### Catalogue reviewer

- **Daily:** listings, edits, photos and logos in review; categories, brands
  and search synonyms; review moderation; content reports in **Atención**.
- **Access:** staff `catalog`.
- **Basis:** employee or part-time contractor. _For the lawyer:_ contractor
  test.
- **Cost:** ₡564,600.

### Finance clerk

- **Daily:** **Cobros** (payment reviews, reconciliation, refunds the
  gateway did not take), **Pagos a vendedores** (payout runs and the
  transfers by hand), **Comprobantes** (rejected or waiting invoices),
  **Liquidaciones** with operations, payout-account approvals.
- **Access:** staff `finance`.
- **Basis:** employee; an external accountant keeps the books.
- **Cost:** clerk ₡564,600; a graduate finance lead later ₡924,100.

### Social-media person

- **Daily:** posts and replies on Facebook, Instagram and TikTok; no access
  to customer data.
- **Access:** none in the product.
- **Basis:** contractor first. _For the lawyer:_ contractor test.
- **Cost:** ₡564,600–₡584,100 if employed; contractor rate not found.

### Advisers and builders (outside the payroll)

- **Lawyer and accountant:** contractors; monthly accountant _assumption_
  ₡100,000–₡300,000, lawyer's first package ₡1,000,000–₡3,000,000 (no source;
  get 3 quotes each).
- **Builders:** the people changing the code. They need no staff
  role on production; an `engineering` role without buyer data is proposed in
  the [support research](../research/support-and-system-health-tools.md) for later.

---

## 5. Headcount and cost by level

Ratios used (all **assumptions**, each with its basis):

- **Drivers:** orders a day ÷ 25 delivered stops (business model), plus 10%
  for failed attempts, rounded up, plus 1 spare per 10 drivers for leave and
  illness.
- **Warehouse associates:** 1 per 40 orders a day. Basis: the model's ₡500
  pick-and-pack cost per order at ₡519,200 a month over 26 days.
- **Support agents:** 1 per 145 orders a day. Basis: the model's ₡150 support
  cost per order at ₡564,600. **No benchmark for contacts per 100 orders was
  found**; measure it in the pilot.

| Level   | Orders a day | Drivers | Warehouse                 | Support | Operations                         | Catalogue |              Finance |   Sales | Social media | People (excluding founder) | Payroll a month         |
| ------- | -----------: | ------: | ------------------------- | ------: | ---------------------------------- | --------: | -------------------: | ------: | -----------: | -------------------------: | ----------------------- |
| Pilot   |         5–10 | Founder | Founder + backup (8 days) | Founder | Founder                            |   Founder |              Founder | Founder |            — |                          1 | ₡150,600 (backup only)  |
| Launch  |        20–40 |     1–2 | 1 (also backup driver)    | Founder | Founder                            |   Founder |              Founder |       1 |            — |                        3–4 | ₡2,273,300–₡3,443,300   |
| Level 1 |          100 |       6 | 3 + 1 lead                |       1 | 1 lead                             |   Founder | Founder + accountant |       1 |            — |                         13 | ₡10,855,500–₡11,857,300 |
| Level 2 |          300 |      16 | 8 + 1 lead                |       3 | 1 lead + 1 dispatcher              |         1 |                    1 |       2 |            1 |                         35 | ₡29,123,200–₡30,144,500 |
| Level 3 |        1,000 |      49 | 25 + 2 leads              |       7 | 1 manager + 1 lead + 2 dispatchers |         2 |                    2 |       4 |            1 |                         96 | ₡83,310,000–₡84,892,000 |

Founder pay is not included. Launch payroll: 1–2 drivers ₡1,170,000 each +
associate ₡519,200 + sales agent ₡584,100. By the driver ratio, one driver
carries up to about 22 orders a day (22 ÷ 25 × 1.1 = 0.97); a second is needed
from about 23 orders a day. The launch level matches the base budget in
[go-to-market](go-to-market.md) §9. Leads are counted at ₡564,600–₡1,065,500;
the Level 3 manager at ₡1,065,500–₡1,144,900. Level 3 also needs carriers for
anything outside the GAM.

**What the payroll means per order** (26 operating days):

| Level   | Orders a month | Payroll per order | Of which drivers | Business model's per-order labour (delivery ₡1,800 + picking ₡500 + support ₡150) | Contribution per ₡20,000 order with this payroll, before rent and overheads |
| ------- | -------------: | ----------------: | ---------------: | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------: |
| Level 1 |          2,600 |     ₡4,175–₡4,560 |           ₡2,700 | ₡2,450                                                                            |                                                                   ₡224–₡609 |
| Level 2 |          7,800 |     ₡3,734–₡3,865 |           ₡2,400 | ₡2,450                                                                            |                                                                 ₡919–₡1,050 |
| Level 3 |         26,000 |     ₡3,204–₡3,265 |           ₡2,205 | ₡2,450                                                                            |                                                               ₡1,519–₡1,580 |

Contribution here is the model's ₡2,334 less the payroll above the model's
₡2,450. The model's labour figures are **never reached**: even at Level 3 the
payroll per order stays ₡754–₡815 above ₡2,450, mostly the leads, spare
drivers, sales, catalogue and finance roles the model does not count. Drivers
alone cost more than the model's ₡1,800 at every level, because of the 10%
for failed attempts, the rounding up and the spare: at Level 1, 6 drivers for
100 orders is 16.7 delivered stops each. So the business model must budget
the overhead roles, or density must exceed 25 stops. **Verify** with the
pilot's real stops per route before hiring past Level 1.

---

## 6. Order of hiring, and the trigger for each

| #   | Hire                                      | Trigger (read in the console or the weekly sheet)                                                                                                                                                                                                                                       | What the founder stops doing |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Backup person (warehouse + backup driver) | Before the pilot starts (roadmap phase 1)                                                                                                                                                                                                                                               | Nothing yet; covers absence  |
| 2   | First employed driver                     | Open launch, or the founder's route at about 25 delivered stops a day for 2 weeks (**Despacho**): the point at which an own driver costs the same as Correos' volume tariff (24.5 at the 451-or-more tier with one ₡2,000 pickup a day, before IVA; [go-to-market](go-to-market.md) §6) | Driving                      |
| 3   | Sales agent                               | Open launch (to go from 50 to 200 sellers; in the base budget)                                                                                                                                                                                                                          | Most seller visits           |
| 4   | Warehouse associate (full time)           | Picks above 40 orders a day for 2 weeks                                                                                                                                                                                                                                                 | Picking and packing          |
| 5   | Support agent                             | Above about 60 orders a day, or any week with replies late against the customer-service targets                                                                                                                                                                                         | WhatsApp and e-mail          |
| 6   | Operations lead                           | About 100 orders a day, or more than 3 routes a day                                                                                                                                                                                                                                     | Dispatch and cash settlement |
| 7   | Finance clerk                             | More than 50 active sellers paid by hand each payout run, or about 200 orders a day                                                                                                                                                                                                     | Payouts and reconciliation   |
| 8   | Catalogue reviewer                        | **Resumen** shows "Productos por revisar" above 20 (an assumption) for 2 weeks, or the oldest item in **Catálogo** has waited more than 2 working days, checked by hand (the console shows a count, not the age)                                                                        | Listing review               |
| 9   | Social-media person (contractor)          | After the launch exit test, when paid ads start                                                                                                                                                                                                                                         | Posting                      |

Each trigger is an **assumption** to adjust after the pilot.

---

## 7. Organisation charts

**Pilot**

```
                 Founder (admin, driver, warehouse lead)
                                 |
                 Backup person (warehouse associate, backup driver; 2 days a week)

  Outside: lawyer · accountant · builders · Correos for overflow
```

**Launch**

```
                              Founder (admin)
            ┌──────────────────────┼──────────────────────┐
   Drivers (1–2)           Warehouse associate       Sales agent
                            (also backup driver)

  Founder still does: support, dispatch, finance, catalogue.
  Outside: lawyer · accountant · builders
```

**Level 2 (about 300 orders a day)**

```
                                      Founder (admin)
      ┌───────────────┬────────────────┼────────────────┬───────────────┐
 Operations lead   Support (3)    Finance clerk     Catalogue (1)   Sales (2)
  (ops)            (support)      (finance)         (catalog)         │
   ├─ Dispatcher (ops)                                            Social media
   ├─ Drivers (16)                                                 (contractor)
   └─ Warehouse lead ── Associates (8)

  Outside: accountant · lawyer · builders
```

---

## Decisions for the owner

The questions this structure raises are asked once, in the
[owner decisions](owner-decisions.md) list: founder pay (D18), how drivers and
the backup person are engaged and whose vehicle they drive (D19), the first
hire after the backup person (D39) and access for combined jobs (D40). If
drivers bring their own motorbike, the ₡45,000 driver-day in §1 is worked out
again here, in [go-to-market](go-to-market.md) §9 and in the
[pricing strategy](pricing-strategy.md) §3.1.

---

## Assumptions to verify

| Assumption                                                | Value used                                    | How to verify                                            |
| --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| Loaded factor                                             | Salary × 1.3916, shown as 1.39                | Accountant's payroll quote per role                      |
| INS work-risk rate                                        | 1% reference, inside the 26.83%               | INS quote for drivers and warehouse work                 |
| Pilot order rate                                          | 5–10 a day                                    | [Roll-out plan](rollout-plan.md) phase 3 actuals         |
| MTSS occupation per role                                  | Table in §1                                   | Accountant or lawyer                                     |
| Driver all-in cost                                        | ₡45,000 a day; ₡605,400 a month beyond labour | A vehicle, fuel and insurance log for 2 weeks; INS quote |
| Delivered stops per driver-day                            | 25                                            | Pilot routes in **Despacho**                             |
| Orders per warehouse associate                            | 40 a day                                      | Time the pilot: minutes per pick, pack and receipt       |
| Orders per support agent                                  | 145 a day                                     | Contacts per 100 orders in the pilot                     |
| Backup person's days                                      | 8 a month                                     | Pilot rota                                               |
| Operations lead's pay                                     | ₡564,600–₡1,065,500 loaded                    | 3 job adverts or a salary survey                         |
| Lawyer and accountant fees                                | See §4                                        | 3 quotes each                                            |
| A person can be staff, driver and warehouse staff at once | Yes                                           | Try it on the preview                                    |

## Sources

Opened on 24 November 2026:

- MTSS, Lista de salarios mínimos por ocupación 2026, Decreto 45303-MTSS, in force 1 January 2026 (https://www.mtss.go.cr/temas-laborales/salarios/lista_salarios_minimos_2026.pdf) — every 2026 minimum in §1.

From the [market research](../research/market-and-costs-2026-11.md) (read 24 November 2026):

- MTSS communiqué CP-022-2026 (28 October 2026), https://www.mtss.go.cr/prensa/comunicados/2026/octubre/cp_022_2026.html — 1.70% from 1 January 2027.
- Alegra, employer charges 26.83% and the INA exception (updated 7 October 2026), https://blog.alegra.com/costa-rica/salario-minimo-costa-rica/ (third party; matches the repository's fact sheet).
- Paylab Costa Rica, customer service and logistics controller (search results; pages refused the request) — low confidence.
- BCCR average formal salary ₡822,699.50, May 2026 (search result).
- Fuel prices November 2026 (Repretel, Diario Extra; search results). Exchange rate (El Observador, Diario Extra; search results).

Repository: `docs/00-strategy/business-model.md`; `docs/01-product/roadmap.md`, `scope-by-app.md`, `personas-and-journeys.md`; `docs/06-operations/customer-service.md`, `logistics-playbook.md`; `docs/05-security-compliance/compliance-costa-rica.md` §7; `docs/08-open-questions.md`; `STATUS.md`; `apps/ops/src/lib/staff.ts`; `supabase/migrations/20261121080000_foundation.sql` (staff roles), `20261121080100_identity.sql` (staff members, drivers), `20261121080500_inventory.sql` (warehouse staff), `20261121082300_people_payouts.sql` (people functions); the [support research](../research/support-and-system-health-tools.md).
