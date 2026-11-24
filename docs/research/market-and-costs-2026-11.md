# Market and costs research, researched on 24 November 2026

Research date: **24 November 2026**. Every source below was read on that date
unless the source list says otherwise. This is a research report, not a plan:
it gives the facts the plan needs, says how sure each one is, and lists what
could not be found.

**How to read it.**

- **Verified** means read in the source itself (an official page, a law, a
  published price list, or the named article).
- **Press** means a reputable news outlet reporting a figure; the original
  study was not read.
- **Third party** means a blog, a calculator or a vendor guide. Use only as a
  range, never as a quote.
- **Estimate** means arithmetic or an assumption made here, with a range and a
  way to verify it.
- **Repository** means the figure comes from a file in the repository.
- Every statement about law, tax or employment that the repository's
  compliance document does not already settle is marked **for the lawyer or
  accountant to confirm**.

---

## 0. What the research found, in short

1. **Demand is large but the "80% buy online" figure is soft.** Three sources
   disagree: 80% (an industry tracker), 48.5% (a 2022 university survey) and
   18% (a World Bank figure, reported by press). No representative survey after
   2022 was found. Nobody publishes an average basket for Costa Rica.
2. **Phones and SINPE Móvil are universal.** 96% of adults with a mobile phone
   use WhatsApp; SINPE Móvil processed 747.5 million transfers in 2025 for
   more than 3.6 million people and about 55,000 companies.
3. **Two new local competitors appeared since the repository's last research.**
   Walmart opened a marketplace for third-party sellers in January 2026
   (sellers deliver, cards only). Boxful opened fulfilment for small
   businesses in Escazú in December 2025. Correos, BCR, INS and Mastercard
   launched a "digital ecosystem" pilot for 350 small businesses in November
   2025. Pyme Store BAC launched in 2025. None of them publishes seller fees.
4. **Amazon Bazaar ships free from ₡10,000.** The repository's proposed
   free-shipping threshold is ₡25,000 in the GAM core.
5. **The dollar fell to about ₡445–₡449.** The fee schedule converts the
   gateway's US$0.35 fixed fee at an assumed ₡515, giving ₡180. At ₡449 the
   same fee is about ₡157.
6. **Minimum wages are published by occupation.** A light-vehicle driver,
   a warehouse lead and an office clerk are ₡405,710.70 a month; a warehouse
   labourer and a messenger are ₡373,092.30 (2026). They rise 1.70% on
   1 January 2027. Employer social charges are 26.83%.
7. **Correos publishes its small-business rates by weight and zone.** From
   ₡1,756 to ₡2,006 before IVA for the first kilo inside the GAM, depending on
   monthly volume.
8. **Benchmarks for commissions cluster at 8%–15%** for general goods (Amazon
   US and Mexico, official); delivery apps in Costa Rica charge 25%–29%
   (press). The repository's 8%–15% sits inside the general-goods range.
9. **Promotions and sweepstakes have written rules.** The consumer regulation
   requires a stated duration and stock for any promotion, and for a sweepstake
   a notary or sworn declaration and public announcement of the winner. The
   telecom law requires prior consent for direct-marketing messages.
10. **No published figures were found for** the number of small businesses
    selling online, a Costa Rican advertising price list, a cash-on-delivery
    share, or salaries by role from a reputable salary survey.

---

## 1. What the repository already establishes

Read before searching so time went to what is missing or older than a year.

| Topic                                             | What the repository says                                                                                                                                                                                                                                                                   | Source in the repository and its own source                                                        | Age or status                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Market size                                       | US$6.4 billion in 2024, forecast 13% a year to US$9.3 billion in 2027                                                                                                                                                                                                                      | `docs/research/costa-rica-fact-sheet.md` §8, citing Payments & Commerce Market Intelligence (PCMI) | 2024 data; the PCMI page returned empty on 24 Nov 2026 and could not be re-read       |
| Share buying online, mobile share, domestic share | About 80% of adults; mobile 74% of volume; domestic merchants 55%                                                                                                                                                                                                                          | Fact sheet §8, PCMI                                                                                | 2024 data; see §1 below for conflicting figures                                       |
| Online payment mix                                | International credit card 68%, debit 16%, bank transfer 10%, wallets 3% (by volume, 2024)                                                                                                                                                                                                  | Fact sheet §5, PCMI                                                                                | 2024 data                                                                             |
| SINPE Móvil                                       | Limits, 2025 scale ₡12.6 trillion in 745.5 million transactions                                                                                                                                                                                                                            | Fact sheet §5, BCCR and La Nación                                                                  | Still current; 2025 figures re-confirmed below                                        |
| Gateway prices                                    | ONVO cards 3.9% + US$0.35, SINPE Móvil 1.5%, US$3 per payout; Tilopay cards 4.25% + US$0.35, SINPE Móvil 2% + US$0.35                                                                                                                                                                      | Fact sheet §5, third-party comparison dated 20 Oct 2026                                            | Tilopay re-verified on its own page below; ONVO's page refused the request (403)      |
| Card fee caps                                     | Acquiring 1.95% local, 2.50% cross-border; interchange 1.00%                                                                                                                                                                                                                               | Fact sheet §5, BCCR                                                                                | 2024–2025; 2026 review pending                                                        |
| Cross-border players                              | Amazon free shipping over US$35; Amazon Bazaar since 7 Nov 2025 (most items under ₡5,000, two weeks, cards only); Temu about 15 days; Shein direct route since Sept 2025, about a month                                                                                                    | Fact sheet §8, Delfino and El Financiero                                                           | 2025; Bazaar's ₡10,000 free-shipping minimum added below                              |
| Courier imports                                   | 12.9 million declaration lines Jan–Jul 2025, about four times all of 2024                                                                                                                                                                                                                  | Fact sheet §8, Teletica                                                                            | 2025; no 2026 figure found                                                            |
| Shopper complaints                                | Late or missing deliveries, slow refunds (95 complaints against one store), no local claim route for Temu and Shein, customs holds, weak rural logistics                                                                                                                                   | Fact sheet §8; `docs/00-strategy/market-and-wedge.md`                                              | 2025–2026; re-confirmed below                                                         |
| Correos Pymexpress                                | Small ₡2,300 / medium ₡3,250 / large ₡4,550 / extra large ₡7,250 inside the GAM before IVA; ₡3,450–₡9,050 outside                                                                                                                                                                          | Fact sheet §7, correos.go.cr                                                                       | Re-read below: these are the self-service locker prices; the volume tariff is cheaper |
| Moovin, Boxful, Uber Direct                       | Operate locally; no published prices                                                                                                                                                                                                                                                       | Fact sheet §7                                                                                      | Still true; one Moovin pickup fee found below                                         |
| Employer charges                                  | 26.83% employer, 10.83% worker (2026)                                                                                                                                                                                                                                                      | Fact sheet §7, La Nación and Delfino                                                               | Re-confirmed below with the breakdown                                                 |
| Couriers' employment status                       | Two first-instance rulings found employment with a platform; bill 24.500 pending                                                                                                                                                                                                           | Fact sheet §7; `docs/05-security-compliance/compliance-costa-rica.md` §7                           | Unchanged; for the lawyer                                                             |
| Base salary for fines                             | ₡462,200 in 2026                                                                                                                                                                                                                                                                           | Fact sheet §4                                                                                      | Current                                                                               |
| Consumer law                                      | Withdrawal 8 business days; refund within 8 calendar days; warranty 30 business days; total price with taxes and shipping; promised date binding; no pre-ticked options                                                                                                                    | Fact sheet §3; compliance document §1                                                              | Current (consolidated text of 7 Jan 2026)                                             |
| Marketing consent                                 | Separate, unticked consent for commercial messages; withdrawal is immediate and self-service; commercial messages start with "Publicidad" and carry a free opt-out                                                                                                                         | `docs/05-security-compliance/privacy.md`; `docs/06-operations/notifications.md`                    | Product rule                                                                          |
| What is built                                     | Commercial messages are **not built** (no template, no one-step unsubscribe page). Real payments, invoices and messages are not live. Native seller, driver and warehouse apps have not run on a phone                                                                                     | `STATUS.md`, "Not built"                                                                           | 23 Nov 2026                                                                           |
| Fees in the product today                         | Commission 8%–15% by category (default 12%, floor ₡150); fulfilment ₡900 / ₡1,400 / ₡2,400 / ₡4,900; payment fee SINPE Móvil 1.5%, card 3.9% + ₡180, cash on delivery 2.0% + ₡300, bank transfer 0.5%; shipping ₡1,500 GAM core free above ₡25,000, ₡2,000 GAM extended free above ₡35,000 | `packages/core/src/fees.ts`; `docs/01-product/pricing-and-fees.md`                                 | All marked "assumption to validate" in the repository                                 |
| Unit economics                                    | Contribution about ₡2,334 on a ₡20,000 order; ₡394 on an ₡8,000 order; own driver beats Correos above about 20 stops a day, at an assumed ₡45,000 driver-day                                                                                                                               | `docs/00-strategy/business-model.md`                                                               | All cost lines are assumptions                                                        |

**What was missing or old, and therefore searched:** a second source on how
many people buy online; frequency and basket; the shape of local competition
in 2026; what sellers pay today beyond the gateways; marketplace benchmarks;
wages by occupation; warehouse rent; fuel; the exchange rate; marketing
reach; and the rules on promotions, sweepstakes and marketing messages.

---

## 2. Demand

### 2.1 Connectivity and phones

| Fact                                    | Figure                                           | Source                                                                                               | Confidence                                         |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Population                              | 5.16 million (Oct 2025)                          | DataReportal, Digital 2026: Costa Rica (8 Nov 2025)                                                  | Third party (compiles UN, GSMA, platform ad tools) |
| Internet users                          | 4.78 million, 92.6% of the population (end 2025) | DataReportal, same report                                                                            | Third party                                        |
| Mobile connections                      | 7.47 million, 145% of the population             | DataReportal, citing GSMA Intelligence                                                               | Third party                                        |
| Households with internet                | 87.32% (2025)                                    | MICITT annual report on the national plan, citing INEC ENAHO 2025 (search result, report not opened) | Press-level; verify in INEC ENAHO 2025             |
| Households with internet, previous year | 85.4% (2024)                                     | UCR study citing ENAHO (search result)                                                               | Press-level                                        |

### 2.2 How many people buy online: three figures that disagree

| Figure                                                            | What it measures                                                                                                      | Source                                                          | Confidence  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------- |
| About **80%** of adults buy online                                | Industry estimate, method not public                                                                                  | PCMI (in the fact sheet); ICEX "Informe e-País" 2025 repeats it | Third party |
| **48.5%** of consumers buy through an electronic medium           | First national e-commerce survey, Centro de Investigación Observatorio del Desarrollo, UCR; article dated 12 Sep 2022 | La República (Rumbo Económico) report of the survey             | Press, 2022 |
| **18%** of the population has made a purchase **and paid** online | World Bank figure, reported by Forbes Centroamérica on 18 Sep 2025                                                    | Search result; article not opened                               | Press, low  |

**Reading.** The figures probably measure different things (any online order,
including those paid on delivery, against an online payment), but no source
confirms that. **Do not print "80% buy online" on a flyer or in a pitch.** The
consumer regulation requires statistics used in advertising to come from
"fuentes responsables, identificadas y disponibles para su comprobación"
(Decreto 37899-MEIC art. 55 g, read in the consolidated text of 7 Jan 2026).
How to verify: ask MEIC or UCR's CIOdD whether a 2024–2026 wave of the
e-commerce survey exists.

### 2.3 What they buy, how often, how much

From the 2022 UCR survey (La República report, 12 Sep 2022, press):

- Bought in the last six months: prepared food 78.2% (the most common), toys
  and hobbies 18.6%, furniture 6.9%. Other categories were listed without
  figures.
- Device: mobile phone 65.3%, computer 32.8%, tablet 1.8%.
- 68.7% pay in advance.
- Buyers by province: San José 36.8%, Alajuela 16.4%, Heredia 12.8%,
  Puntarenas 9.5%, Cartago 9.3%, Guanacaste 7.5%, Limón 5.6%.
- 81.2% of buyers are 18–54; 51.3% women.
- 71% know general consumer law; 28.3% know the e-commerce rules.

**Frequency and average basket: not found** in any source. The 2022 survey
article gives neither. How to verify: measure in the pilot (the repository's
business model already names basket value as one of three deciding numbers).

### 2.4 How people pay

| Fact                                   | Figure                                                                                                                                      | Source                                                                                                       | Confidence                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Cashless payments per person           | 498.4 in 2025, up from 439.2 in 2024                                                                                                        | Tico Times, 17 Jun 2026, citing BCCR payment-system data                                                     | Press                                                                 |
| SINPE Móvil                            | 747.5 million transfers in 2025 (+15%); 4.5 million active numbers; more than 3.6 million individuals and nearly 55,000 legal entities      | Same                                                                                                         | Press (consistent with the fact sheet's 745.5 million from La Nación) |
| Cards                                  | 11.2 million in circulation (7.8 million debit, 3.4 million credit); nearly 150,000 businesses affiliated; more than 211,000 points of sale | Same                                                                                                         | Press                                                                 |
| Cash in circulation                    | 3.1% of GDP, lowest on record                                                                                                               | Same                                                                                                         | Press                                                                 |
| Methods used by online shoppers (2022) | Card 78%, SINPE Móvil 73%, bank transfer 37.7%, cash 27.1%; 41.1% pay in full only on delivery                                              | Omno (payments vendor) citing the 2022 national survey; card and SINPE figures match the La República report | Third party for cash, transfer and pay-on-delivery                    |
| Cash-on-delivery share in 2026         | **Not found.** A Shopify guide gives 45% card, 25% SINPE Móvil, 12% cash on delivery with no source                                         | easyappsecom.com                                                                                             | Unverified; do not use                                                |

**Reading.** SINPE Móvil is a habit for almost every adult and for tens of
thousands of companies. Card-only checkouts (Amazon, Amazon Bazaar, Walmart's
marketplace) exclude part of the market; the repository's wedge depends on
this and it holds.

### 2.5 Where they shop online today

No ranked list of the shops Costa Ricans buy from was found. Named channels,
with evidence:

- Cross-border: Amazon, Amazon Bazaar, Temu, Shein, casilleros (repository fact
  sheet; §3 below).
- Local retail chains' own online shops: Walmart, Masxmenos and Maxi Palí
  (online since 2020, per Delfino).
- Delivery apps: Uber Eats (more than 5,000 merchants), PedidosYa (more than
  4,000 merchants, sponsored press), DiDi Food (El Financiero, 15 Jul 2026).
- Social media and WhatsApp: the most-used channels (§7), with no figure on how
  much is bought through them.

---

## 3. Competitors and substitutes

Each entry says what it is, what it charges sellers and shoppers, and how fast
it delivers, **only where the company's own page or reputable press says so.**
"Not published" means searched and not found.

### 3.1 Local and regional marketplaces and classifieds

| Player                                        | What it is                                                                                                                                                                                       | Charges sellers                                                                                                                                 | Charges shoppers                           | Speed                                                                         | Source (read 24 Nov 2026)                    | Confidence                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
| **Walmart Marketplace (Costa Rica)**          | "Lanzamiento oficial" of third-party sellers inside Walmart's site and app; items labelled "Exclusivo en línea"; TV, appliances, computing, mattresses; 24 more categories planned for 2026–2027 | Not published                                                                                                                                   | Not published; pay by credit or debit card | Not published; **sellers deliver**, Walmart handles follow-up and after-sales | Delfino, 21 Jan 2026 (sponsored content)     | Press, medium (sponsored)         |
| **Pyme Store BAC**                            | A bank's online catalogue and store builder for small businesses that already use its Compra Click payment button                                                                                | Not published                                                                                                                                   | Not published                              | Not published                                                                 | Ticoslandia, Dec 2025; search result         | Press, low                        |
| **Pymexpress "Ecosistema Digital para Pyme"** | BCR, Correos, INS and Mastercard: inventory sync, e-invoice v4.4 connection, payments, WhatsApp/Facebook/Instagram integration, national delivery by Correos. Pilot with 350 small businesses    | Not published                                                                                                                                   | Not applicable                             | Not stated                                                                    | La Nación, 18 Nov 2025                       | Press                             |
| **TicoMarket**                                | Online craft fair: jewellery, personal care, décor, clothing, toys, baked goods                                                                                                                  | 0% commission, membership from ₡2,500 a month or ₡25,000 a year (search result showing the site's own text; the page read did not show the fee) | Not stated                                 | "Envíos a todo el país"; pay by SINPE Móvil                                   | ticomarket.com                               | Low on the fee                    |
| **Encuentra24**                               | Classifieds (vehicles, property, goods, services)                                                                                                                                                | Posting free in vehicles, classifieds, technology, jobs (sponsored article); featured-ad prices not found                                       | None (buyer contacts seller)               | Not applicable                                                                | La Nación sponsored article; encuentra24.com | Press, low                        |
| **Mercado Libre Costa Rica**                  | Classifieds-style site; the home page says publishing is free. Whether checkout, Mercado Pago or Mercado Envíos work in Costa Rica: **not verified** (help pages refused the request)            | Not verified                                                                                                                                    | Not verified                               | Not verified                                                                  | mercadolibre.co.cr (403 on help pages)       | Unverified                        |
| **CostaRicaYA.com**                           | A Guatemalan marketplace that announced entry about three years ago                                                                                                                              | Not published                                                                                                                                   | Not published                              | Not published                                                                 | Revista Summa (old)                          | Low; may be inactive              |
| **HolaCompras**                               | Online store with 95 MEIC complaints for late, missing or duplicated orders, waits of up to six months                                                                                           | n/a                                                                                                                                             | n/a                                        | n/a                                                                           | CRHoy                                        | Press (already in the fact sheet) |

### 3.2 Cross-border buying and couriers

| Player                                            | Charges shoppers                                                                                                                                                                                                             | Speed                         | Source                                              | Confidence  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- | ----------- |
| **Amazon Bazaar**                                 | Free shipping on orders of **₡10,000 or more**; a standard fee below (amount not stated); free returns within 15 days; international Visa, Mastercard, American Express only; "muchos de los productos cuestan menos de $10" | Two weeks or less             | El Financiero (launch article, Nov 2025)            | Press, high |
| **Amazon (main store)**                           | Free shipping on eligible orders of US$35+                                                                                                                                                                                   | Days to weeks                 | Repository fact sheet §8                            | Medium      |
| **Temu, Shein**                                   | Not re-checked; MEIC says neither has representation in Costa Rica, so claims fall on the consumer                                                                                                                           | About 15 days / about a month | Repository fact sheet; Teletica interview with MEIC | Medium      |
| **Aeropost (casillero)**                          | Freight US$5.99 per kg on the FLEX plan, US$3.99 per kg on Smart Weight, plus international and customs handling per parcel (search result showing the official page; the page itself returned an error)                     | Not stated                    | aeropost.com/SJO/es/casillero                       | Low–medium  |
| **Other casilleros** (JetBox, Aerocasillas, Tivi) | Same model: per-kilo freight plus a commission on value; Tivi lists US$10.50 for 1 kg                                                                                                                                        | Not stated                    | jplcostarica.com comparison; tivicr.com             | Third party |

**Import tax: a conflict to resolve.** The fact sheet says the US$500
exemption for online purchases ended on 1 May 2021. A La Nación explainer says
parcels under US$50 pay no tax and personal-use parcels under US$500 pay no
extra charges. **For the accountant to confirm**; do not use either in
customer copy.

### 3.3 Supermarket and delivery apps that sell general goods

| Player                                             | Charges merchants                                                                             | Speed                                                                 | Source                                    | Confidence   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ------------ |
| **Uber Eats**                                      | 25%–29% per order depending on plan (Uber Eats for Merchants data); more than 5,000 merchants | Minutes to hours; "Uber Speed" convenience orders in about 15 minutes | El Financiero, 15 Jul 2026; Uber newsroom | Press        |
| **PedidosYa** (incl. PedidosYa Market dark stores) | 25% base commission, negotiable by volume                                                     | Fast delivery; dark stores are its own stock                          | El Financiero, 15 Jul 2026                | Press        |
| **DiDi Food**                                      | Did not disclose rates                                                                        | Not stated                                                            | El Financiero, 15 Jul 2026                | Press        |
| **Walmart / Masxmenos / Maxi Palí online**         | n/a (own stock)                                                                               | Maxi Palí orders in about three hours (pick-up or delivery)           | Delfino, Jun 2024                         | Press, dated |

Merchant complaints about these apps (El Financiero, 15 Jul 2026): the
commission; no control over the courier; damaged orders with no one to claim
against; automated support; the 13% IVA and tax withholdings hurting cash
flow; customer prices rising (a ₡6,000 meal reaching ₡7,500).

### 3.4 Post and private couriers a shop would otherwise use

**Correos de Costa Rica, Pymexpress volume tariff** (correos.go.cr/tarifas,
read 24 Nov 2026; prices **before 13% IVA**; requires prior authorisation by
the Dirección de Pymes):

| Monthly volume            | GAM → GAM, first kg | GAM → rest of country, first kg | Rest → rest, first kg | Each extra kg (GAM routes) |
| ------------------------- | ------------------: | ------------------------------: | --------------------: | -------------------------: |
| Emprendedor, 5–24 parcels |           ₡2,005.53 |                       ₡2,741.70 |             ₡3,478.93 |                  ₡1,061.95 |
| Mi Pyme, 25–200           |           ₡1,962.17 |                       ₡2,682.42 |             ₡3,403.71 |                  ₡1,038.99 |
| Premium, 201–450          |           ₡1,853.76 |                       ₡2,534.22 |             ₡3,215.66 |                    ₡981.59 |
| Gold, 451+                |           ₡1,756.19 |                       ₡2,400.84 |             ₡3,046.38 |                    ₡929.92 |

Other Correos lines on the same page: light cargo 3–10 kg ₡3,982.30 flat on all
routes; heavy express 10–20 kg ₡9,800 plus ₡1,000 per extra kg; home pickup
₡1,500 for 1–3 parcels (₡2,000 for 11+), plus a per-parcel rate for pickup
clients of ₡1,890 small / ₡3,080 medium / ₡4,180 large inside the GAM. Transport
insurance ₡229 per parcel, cover up to ₡100,000 (search result citing Correos).
Delivery time: 24 hours in the GAM and 48 hours outside (El Financiero, older
article; not on the tariff page). Cash collection on delivery: La República
says Correos "trabaja en la implementación"; **not confirmed as live**.

Scale: 2.1 million Pymexpress deliveries in 2023, about 8,500 a day, 20,400
small businesses affiliated (La República, 6 May 2024); 2,236,000 parcels in
2024 (search result citing Correos). Correos raised regulated rates between
3.12% and 206.26% on 22 Aug 2025 (CRHoy).

**Correction to the repository.** The fact sheet's "small ₡2,300 inside the GAM"
is the self-service locker price. A seller sending 25–200 parcels a month pays
₡1,962.17 plus IVA (₡2,217.25) for the first kilo. The business model's
comparison "own driver beats Correos above about 20 stops" should be re-run
against ₡1,756–₡2,006 before IVA.

**Private couriers:**

| Courier                   | Published price                                                                                                                                                                                                                               | Source                                      | Confidence                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Moovin                    | Pickup ₡1,200 plus IVA for 3 parcels or fewer, free for 4 or more; delivery price shown only after entering the shipment                                                                                                                      | moovin.me terms page (about 642 days old)   | Verified, dated                                       |
| Boxful                    | Free sign-up; compares Correos, Uber and Moovin rates; fulfilment warehouse at Parque Empresarial Blum, Guachipelín de Escazú, since December 2025; more than 5,000 small businesses across the region, 74% led by women. No prices published | Delfino, Mar 2026; El Financiero            | Press                                                 |
| Uber Direct / Uber Envíos | Available in Costa Rica; merchant price not published (intake form). Uber's driver-side tariff for Envíos: base ₡400, ₡240 per km, ₡40 per minute, minimum ₡855                                                                               | uber.com/es-CR blog; merchants.ubereats.com | Verified for driver tariff only; not a merchant price |

### 3.5 Social-media selling

- Most small businesses already have Facebook, Instagram and WhatsApp Business
  profiles; the challenge is selling through them (El Financiero, 6 Jan 2026).
  No figure for how many sell through social media was found.
- Fraud: buyers posing as customers send fake SINPE Móvil receipts; Teletica
  cites 108 victims per the judicial police (date unclear); the OIJ broke up a
  group that took more than ₡5 million in goods with altered receipts (CRHoy).
- Informal selling in social-media groups hurts formal shops (La República,
  headline only).

**Reading for the plan.** The real alternative for a small seller is
"Instagram plus WhatsApp plus SINPE Móvil plus Correos or a motorbike
messenger." Its pains are verified: fake receipts, courier cost and control,
and no one to answer for the delivery. Those match the repository's wedge.

---

## 4. Seller side

### 4.1 How many small businesses

| Figure        | What it counts                                                                                                                                  | Source                                  | Confidence            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------- |
| 36,098        | Micro, small and medium firms **registered with MEIC** (May 2026), up 97% from 18,301 in May 2022; MEIC says mipymes are about 98% of all firms | El Observador, 28 Jun 2026, citing MEIC | Press                 |
| 12,050        | People in MEIC's entrepreneur register (May 2026)                                                                                               | Same                                    | Press                 |
| 31,641        | "Active PYMES" at end of December 2025, +23% in a year (Expo PymeCR analysis; source data not named)                                            | La República, 2 Jan 2026                | Press, method unknown |
| About 140,000 | Small and medium firms, "INEC and MEIC data"                                                                                                    | Microsoft press release, May 2025       | Low                   |
| About 150,000 | Businesses affiliated to the card system                                                                                                        | Tico Times, 17 Jun 2026, BCCR           | Press                 |
| Nearly 55,000 | Legal entities using SINPE Móvil                                                                                                                | Same                                    | Press                 |
| 20,400        | Small businesses affiliated to Correos Pymexpress (2024)                                                                                        | La República, 6 May 2024                | Press, dated          |

**How many sell online: not found.** The closest proxies are the 20,400
Pymexpress clients (2024) and the 55,000 companies on SINPE Móvil.

### 4.2 What selling online costs them today

| Cost line                      | Published figure                                                                     | Source                                                                                           | Confidence     |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------- |
| Card payments via Tilopay      | 4.25% + US$0.35; no monthly fee                                                      | tilopay.com/tarifas                                                                              | Verified       |
| SINPE Móvil via Tilopay        | 2% + US$0.35                                                                         | Same                                                                                             | Verified       |
| Card instalments via Tilopay   | BAC Tasa Cero 7.5% (3 months) to 14% (12 months); Credix 6% to 14%; each + US$0.35   | Same                                                                                             | Verified       |
| ONVO                           | Cards 3.9% + US$0.35, SINPE Móvil 1.5%, US$3 per payout                              | Repository fact sheet (third-party comparison, 20 Oct 2026); ONVO's own page refused the request | Low–medium     |
| SINPE Móvil person to person   | Free up to ₡100,000 a day out and ₡2,000,000 a month in                              | Repository fact sheet, BCCR                                                                      | Verified there |
| Courier inside the GAM         | ₡1,756–₡2,006 per first kilo before IVA (Correos volume tariff)                      | §3.4                                                                                             | Verified       |
| Courier GAM to rest of country | ₡2,401–₡2,742 per first kilo before IVA                                              | §3.4                                                                                             | Verified       |
| Delivery-app commission        | 25%–29%                                                                              | §3.3                                                                                             | Press          |
| Marketplace commission (local) | Not published by Walmart, BAC, Falabella-type players; TicoMarket 0% plus membership | §3.1                                                                                             | Low            |

### 4.3 What sellers complain about

Verified in press: delivery-app commissions and IVA and withholdings on cash
flow; no control over the courier; automated support (El Financiero,
15 Jul 2026); fake SINPE receipts (CRHoy, Teletica); "muchos emprenden, pocos
sobreviven", citing financial disorder, lack of management and mentoring and
fear of formalising (La República, 2 Jan 2026). MEIC's 2025 Monitor Mipyme
(CELIEM) names limited financing, formalisation costs and lack of innovation
(Delfino, Aug 2025, headline only).

**Not found:** a survey of what small online sellers in Costa Rica complain
about. The repository's plan to interview 10–15 target sellers
(`docs/01-product/pricing-and-fees.md`) is the way to get it.

---

## 5. Benchmarks for marketplace pricing

### 5.1 Commission tables

| Marketplace                         | Commission                                                                                                                                                                                                                                    | Minimum or fixed fee                                                                  | Source                                                     | Confidence                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Amazon US                           | Most categories 15%; computers, consumer electronics, full-size appliances 8%; beauty and baby 8% up to US$10 then 15%; clothing 5%–17% by price; furniture 15% then 10% above US$200; grocery 8% up to US$15 then 15%; jewellery 20% then 5% | US$0.30 minimum; Professional plan US$39.99 a month or US$0.99 per item sold          | sell.amazon.com/pricing                                    | Verified                              |
| Amazon Mexico                       | Most categories 15%; electronics and computers 10%; toys 8% up to MXN 300 then 15%; beauty and health 12% up to MXN 200 then 15%; food 12% up to MXN 500 then 15%; video consoles 8%                                                          | MXN 8 minimum; plan free for 12 months, then MXN 75 or MXN 600 a month by sales       | vender.amazon.com.mx/precios                               | Verified                              |
| Mercado Libre Mexico                | "Clásica" about 8%–17%, "Premium" about 11%–21.5% by category (sources disagree)                                                                                                                                                              | Fixed fee per unit under MXN 299: about MXN 25–37                                     | Tiendanube, Profitos and other seller blogs                | Third party                           |
| Shopee Brazil                       | From March 2026: 20% + R$4.50 up to R$79.99; 14% + R$16–R$20 above; individual sellers pay more                                                                                                                                               | Included                                                                              | Priceva, Ecommerce na Prática and others; sources disagree | Third party                           |
| Falabella (Chile)                   | A commission per category, in a table shown only after registering                                                                                                                                                                            | Logistics fee per unit, by size and by whether the price is below or above CLP 19,990 | falabella.com "cuánto cuesta vender"                       | Verified that the table is not public |
| Uber Eats / PedidosYa in Costa Rica | 25%–29% / 25% base                                                                                                                                                                                                                            | —                                                                                     | El Financiero, 15 Jul 2026                                 | Press                                 |
| **Repository today**                | 8% (electronics, groceries) to 15% (fashion), default 12%                                                                                                                                                                                     | ₡150 floor per unit; no monthly fee in the pilot                                      | `packages/core/src/fees.ts`                                | Repository                            |

**Reading.** For general goods, 8%–15% is the published norm at the two
largest marketplaces where the tables could be read. Delivery apps charge
roughly double because they include the delivery. The repository's rates are
in range; the question for pricing is whether a seller who also pays the
fulfilment fee sees the total as cheaper than the 25%–29% apps or the
"Instagram plus Correos" route.

### 5.2 Fulfilment and storage fees

| Marketplace          | Fulfilment per unit                                                                                                                                                                                                                   | Storage                                                                                       | Source                               | Confidence                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- |
| Amazon Mexico (FBA)  | Most categories, price under MXN 150: envelope 0–0.10 kg MXN 27.00; standard 0–0.10 kg MXN 28.00; standard 0.50–0.60 kg MXN 28.25; standard 0–0.10 kg at price MXN 499+: MXN 61.80. Health, food, drinks under MXN 150: MXN 4.50–5.00 | MXN 0.36 per dm³ a month (Jan–Sep), 0.53 (Oct–Dec); large 0.19 / 0.43                         | vender.amazon.com.mx/precios         | Verified                  |
| Amazon US (FBA)      | Small standard about US$3.06–3.31; large standard 1–1.5 lb about US$4.90–5.52 (2026)                                                                                                                                                  | About US$0.78–0.87 per cubic foot a month (Jan–Sep), US$2.40 (Oct–Dec); aged-stock surcharges | Webgility, RepricerExpress, Red Stag | Third party               |
| Falabella (Chile)    | Per unit, by size and price band; part subsidised; returns paid in full by the seller                                                                                                                                                 | Not stated                                                                                    | falabella.com                        | Verified (structure only) |
| Boxful (Costa Rica)  | Not published                                                                                                                                                                                                                         | Not published                                                                                 | Delfino, Mar 2026                    | Press                     |
| **Repository today** | ₡900 / ₡1,400 / ₡2,400 / ₡4,900 by size tier                                                                                                                                                                                          | No storage fee in the pilot; proposed for launch                                              | `fees.ts`; pricing document          | Repository                |

No conversion of pesos to colones is made here: no exchange-rate source for the
peso was read.

### 5.3 Free-delivery thresholds and delivery fees

| Marketplace                    | Threshold                                                            | Source                                | Confidence  |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------- | ----------- |
| **Amazon Bazaar, Costa Rica**  | **₡10,000**                                                          | El Financiero                         | Press, high |
| Amazon, Costa Rica             | US$35 on eligible orders                                             | Repository fact sheet                 | Medium      |
| Mercado Libre Mexico           | MXN 299 (mandatory free shipping on new items above it)              | Telediario; UpSeller                  | Third party |
| Mercado Libre Chile / Colombia | CLP 19,990 / COP 60,000 (Nov 2025)                                   | UpSeller                              | Third party |
| Mercado Libre Argentina        | Lowered from ARS 33,000 to ARS 15,000 (2026)                         | El Cronista; Forbes Argentina         | Press       |
| **Repository today**           | ₡25,000 GAM core (₡1,500 below); ₡35,000 GAM extended (₡2,000 below) | `docs/01-product/pricing-and-fees.md` | Repository  |

**Reading.** The free-delivery threshold is the most visible number a
shopper compares. Amazon Bazaar's ₡10,000 is two and a half times lower than
the repository's ₡25,000, but Bazaar takes two weeks and accepts only
international cards. The repository's business model shows an ₡8,000 order
contributes only ₡394, so matching ₡10,000 would lose money on small baskets
at the current cost assumptions.

---

## 6. Costs of running it in Costa Rica

### 6.1 Minimum wages by occupation (2026)

Source: MTSS, "Lista de salarios mínimos por ocupación, sector privado, año
2026", Decreto 45303-MTSS, La Gaceta 229, Alcance 156, 5 Dec 2025, in force
1 Jan 2026 (mtss.go.cr PDF, read 24 Nov 2026). **Verified.** Daily rates are
for an ordinary day; monthly figures are the "genérico" monthly amounts.
The MTSS calls the list "una guía ilustrativa": the right category depends on
the actual tasks.

| Role in this business            | Closest MTSS occupation                                                                                                                                  | Category     |                                2026 minimum |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------: |
| Delivery driver (car or van)     | Conductor de vehículo liviano                                                                                                                            | TOSC         | ₡13,523.69 a day (= ₡405,710.70 at 30 days) |
| Delivery driver (truck)          | Conductor de vehículo pesado                                                                                                                             | TOC          |                            ₡13,991.86 a day |
| Motorbike courier                | Mensajero (no motorbike-specific occupation in the list)                                                                                                 | TONCG        |                         ₡373,092.30 a month |
| Warehouse worker                 | Bodeguero (peón)                                                                                                                                         | TONCG        |                         ₡373,092.30 a month |
| Warehouse lead                   | Bodeguero (encargado)                                                                                                                                    | TOSCG        |                         ₡405,710.70 a month |
| Packer                           | Empacador, etiquetador (manual)                                                                                                                          | TONC         |                            ₡12,436.41 a day |
| Inventory scanner                | Escaneador de inventarios (hand held)                                                                                                                    | TOSCG        |                         ₡405,710.70 a month |
| Forklift driver                  | Montacarguista                                                                                                                                           | TOSC         |                            ₡13,523.69 a day |
| Customer-service agent           | Telefonista or Oficinista (general); no call-centre occupation in the list                                                                               | TOSCG        |                         ₡405,710.70 a month |
| Cash handler / collector         | Cajero / Cobrador                                                                                                                                        | TOCG / TOSCG |           ₡419,755.80 / ₡405,710.70 a month |
| Sales agent (seller recruitment) | Agente de ventas                                                                                                                                         | TOCG         |                         ₡419,755.80 a month |
| Social-media manager             | Gestor de redes sociales: monitors and replies TOSCG ₡405,710.70; reads and interprets data TOCG ₡419,755.80; designs final artwork TOE ₡16,244.50 a day | —            |                                   as stated |
| University graduate              | Bachiller ₡664,078.07; Licenciado ₡796,921.00 a month                                                                                                    | —            |                                   as stated |

**Increase for 2027:** 1.70% for all private-sector categories from
1 Jan 2027 (Técnico Medio 2.58768%; domestic work pending). MTSS communiqué
CP-022-2026, 28 Oct 2026. **Verified.** Arithmetic: TONC becomes about
₡379,435 and TOSC about ₡412,608 a month (estimate; the decree's exact figures
were not yet read).

**Whether a motorbike courier is a "Mensajero" (TONCG) or a "Conductor de
vehículo liviano" (TOSC) is for the lawyer or accountant to confirm.** So is
the choice between employee and contractor (repository compliance document
§7 already says this; nothing here softens it).

### 6.2 Employer social charges and mandatory extras

| Item                              | Figure                                                                                                                                                | Source                                    | Confidence                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| CCSS and related employer charges | 26.83% in total: SEM 9.25, IVM 5.58, FODESAF 5.00, INA 1.50, IMAS 0.50, Banco Popular 0.25 + 0.25, FCL 1.50, OPC 2.00, INS work-risk 1.00 (reference) | Alegra, updated 7 Oct 2026                | Third party, matches the repository's 26.83%                |
| Small-employer exception          | Non-agricultural employers with fewer than 5 permanent workers do not pay INA (1.50%)                                                                 | Same                                      | Third party; **for the accountant to confirm**              |
| INS work-risk premium             | Varies by activity; the 1% is a reference, can reach about 6% in construction and security                                                            | Same                                      | Third party; get an INS quote (repository open question 19) |
| Worker's share                    | 10.83% (repository) / 10.5% (FiniquitoJusto)                                                                                                          | Repository fact sheet; finiquitojusto.com | Conflict; **for the accountant to confirm**                 |
| Aguinaldo (13th month)            | One twelfth of the year's pay (1 Dec–30 Nov)                                                                                                          | Aglegal; El Financiero calculator         | Third party; **for the accountant to confirm**              |
| Vacation                          | Two weeks per 50 weeks worked                                                                                                                         | FiniquitoJusto                            | Third party; **for the lawyer to confirm**                  |
| Severance and notice              | Severance only on dismissal without cause, capped at 8 years; scale in Código de Trabajo art. 29                                                      | Alegra; FiniquitoJusto                    | Third party; **for the lawyer to confirm**                  |

**Estimate, fully loaded monthly cost of one employee** (salary × (1 + 26.83%
charges + 8.33% aguinaldo + about 4% vacation), before severance provision,
uniforms and insurance above the reference rate):

| Role                                                  | 2026 minimum | Estimated monthly cost | Range             |
| ----------------------------------------------------- | -----------: | ---------------------: | ----------------- |
| Warehouse worker or motorbike courier (TONCG)         |     ₡373,092 |         about ₡519,000 | ₡500,000–₡560,000 |
| Driver, customer service, warehouse lead (TOSC/TOSCG) |     ₡405,711 |         about ₡565,000 | ₡545,000–₡610,000 |
| Sales agent or cashier (TOCG)                         |     ₡419,756 |         about ₡584,000 | ₡565,000–₡630,000 |

These are **estimates** at the legal minimum; the market usually pays more. To
verify: ask the accountant for a payroll quote for each role.

**Per driver-day:** about ₡565,000 ÷ 26 working days ≈ ₡21,700 for labour
alone (estimate). The repository's ₡45,000 fully loaded driver-day leaves about
₡23,000 for the vehicle, fuel, insurance, phone and supervision. That is
plausible but unverified.

### 6.3 Market pay above the minimum (low confidence)

| Role                                              | Figure                                                       | Source                                           | Confidence       |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ---------------- |
| Average formal salaried worker                    | ₡822,699.50 a month (May 2026)                               | BCCR figure in a search result                   | Press-level      |
| Customer service                                  | 80% earn ₡354,551–₡1,020,750 gross a month; average ₡657,336 | Paylab (search result; page refused the request) | Third party, low |
| Logistics customer service (one job advert)       | ₡405,710 a month, Santa Ana, 1 year's experience             | Magneto job listing, 21 Sep 2026                 | One advert       |
| Logistics controller (closest to operations lead) | ₡431,294–₡1,020,249 gross a month; about ₡765,690 at 5 years | Paylab (fewer than 20 respondents)               | Third party, low |
| Logistics director                                | ₡573,449–₡2,780,767 gross a month                            | Paylab                                           | Third party, low |
| Seller-success person, marketing person           | **Not found**                                                | —                                                | —                |

PwC's SEIS study found 86% of companies adjusted salaries between
November 2025 and April 2026 and early staff turnover of 26% (Revista Summa,
headline only).

### 6.4 Fuel, vehicles, rent, exchange rate

| Item                           | Figure                                                                                                                                                                                | Source                                   | Confidence                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Fuel, November 2026            | Regular about ₡807–808 a litre, super ₡805–806, diesel ₡807–808 (sources differ by ₡1–2)                                                                                              | Repretel; Diario Extra (ARESEP approval) | Press                                                                       |
| Fuel, December 2026            | Government proposed a cut of up to ₡103 a litre; not yet in force                                                                                                                     | Infobae, 20 Nov 2026                     | Press                                                                       |
| Small motorbike                | One used 2025 Honda Navi advertised at ₡790,000 (May 2026); **no dealer list price found**                                                                                            | Encuentra24 listing                      | One advert                                                                  |
| Small car or van               | **Not found**                                                                                                                                                                         | —                                        | —                                                                           |
| Industrial warehouse rent, GAM | Listings: Coyol US$8.00–8.50 per m² a month plus about US$0.85–0.89 maintenance; Heredia US$7.25–9.00; Alajuela about US$8 including security and maintenance (units of 400–5,200 m²) | Encuentra24 listings, 2026               | Listings, not transactions                                                  |
| Industrial market              | Vacancy below 1%; net absorption about 288,000 m² in a year; availability rising in Coyol                                                                                             | Delfino, May 2026, citing CBRE           | Press                                                                       |
| Older benchmark                | Alajuela asking rent US$7.30 per m² (Q1 2024), vacancy under 6%                                                                                                                       | Statista summary of Cushman & Wakefield  | Third party                                                                 |
| Small spaces (50–200 m²)       | **Not found**; small units usually cost more per m²                                                                                                                                   | —                                        | Estimate: US$8–14 per m²; verify with three listings near the first sellers |
| Exchange rate                  | Monex low ₡444.45 on 19 Nov 2026; bank selling rates ₡450–₡452 on 18 Nov 2026; down 10.6% in 2026                                                                                     | El Observador; Diario Extra; Nación      | Press                                                                       |

**Consequence for the fee schedule (repository).** `fees.ts` charges ₡180 as
the card fixed fee, "₡180 ≈ US$0.35" at an assumed ₡515 per dollar. At ₡449,
US$0.35 is about ₡157. The seller is charged about ₡23 more per card order
than the gateway's list price. The schedule calls the payment fee a
pass-through, so this needs a decision (see §9, question 4).

### 6.5 Payment processing

See §4.2. Summary: cards 3.9%–4.25% + US$0.35; SINPE Móvil 1.5% to 2% +
US$0.35 through a gateway; the BCCR caps the acquiring fee at 1.95% for local
cards (repository fact sheet). Card acquirers withhold up to 6% IVA and 2%
income tax on card sales (repository fact sheet; **for the accountant** under
open question 24).

---

## 7. Marketing channels

### 7.1 Reach by channel

| Channel                                   | Reach                                                                                                                | Source                                                                                                  | Confidence                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| WhatsApp                                  | 96% of adults with a mobile phone                                                                                    | CICOM-UCR, "Nuestras apps de cada día 2025", phone survey of 792 adults, August 2025 (UCR, 27 May 2026) | Verified (university survey)    |
| Facebook                                  | 80%                                                                                                                  | Same                                                                                                    | Verified                        |
| YouTube                                   | 77%                                                                                                                  | Same                                                                                                    | Verified                        |
| TikTok                                    | 58%, fastest growing; 35–54 year-olds use it about as much as 18–34                                                  | CICOM-UCR (Mediápolis page)                                                                             | Verified                        |
| Instagram                                 | 47%                                                                                                                  | Same                                                                                                    | Verified                        |
| X / LinkedIn                              | 15% / 11%                                                                                                            | Same                                                                                                    | Verified                        |
| At least one social network               | 90%                                                                                                                  | Same                                                                                                    | Verified                        |
| Facebook / Instagram / Messenger ad reach | 3.50 million (67.8%) / 2.65 million (51.4%) / 1.95 million (37.8%)                                                   | DataReportal, 8 Nov 2025                                                                                | Third party (platform ad tools) |
| Radio                                     | 61% listened in the last 30 days on traditional sets; 79.8% including online; 31% of listeners spend 1–3 hours a day | Kantar IBOPE Media TGI Costa Rica 2025 R3 (Delfino, 14 Feb 2026)                                        | Press                           |
| Advertisers on radio                      | More than 1,700 used radio with other media; 1,056 used only radio (2025)                                            | Same                                                                                                    | Press                           |

### 7.2 Advertising costs

- **No published price list for Costa Rican radio, outdoor or social ads was
  found.**
- Ad spend by medium (2024): TV 42%, digital 19%, radio 17% (search result
  citing a study; not opened; low).
- Facebook CPM: one local agency claims ₡3,500–₡7,500 per thousand impressions
  with no method (andreybusiness.com). **Do not budget from it.** To verify:
  run a ₡25,000 test campaign and read the cost per thousand and per click in
  Ads Manager.
- Election-campaign spending, early 2026 (Universidad Latina with Kantar): TV
  74.26% (US$3.65 million), radio US$446,664, outdoor US$261,840, digital
  US$354,103. Campaign spending only, not the commercial market.

### 7.3 Fairs, chambers and networks

| Network                                                    | What it is                                       | Figures                                                                                                                                                                                                   | Source                                        | Confidence |
| ---------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------- |
| EXPOPYME Oficial (MEIC)                                    | Government fair for small businesses             | 235 businesses at Antigua Aduana, 2026; more than 15,000 visitors; regional editions of 40 businesses each (e.g. Quepos, 24–25 Oct); applicants need packaged, labelled products and health registrations | Delfino Apr 2026; La República; newsinamerica | Press      |
| Expo Pyme CR                                               | Private fair, 4th edition                        | 3–4 Oct 2026, Parque La Libertad, Desamparados, free entry                                                                                                                                                | Delfino, May 2026                             | Press      |
| Feria Nacional de Economía Social y Solidaria              | National fair                                    | 4–6 Dec 2026, Parque Nacional, San José                                                                                                                                                                   | Search result                                 | Press, low |
| Impulso (women-led businesses)                             | Free fair                                        | 11–12 Jul 2026, Parque Viva                                                                                                                                                                               | CRHoy (sponsored)                             | Low        |
| esencial COSTA RICA (country brand)                        | Licence for companies and products               | More than 700–750 licensed companies (2024–2025); licensing digitised Sept 2025                                                                                                                           | La República; Delfino                         | Press      |
| MEIC registers                                             | Mipyme and entrepreneur registers; training      | 36,098 firms and 12,050 entrepreneurs; 5,890 people trained in a year                                                                                                                                     | El Observador, 28 Jun 2026                    | Press      |
| Sistema de Banca para el Desarrollo                        | Development credit                               | ₡1.94 trillion in 492,177 loans since May 2022; average ₡3.94 million                                                                                                                                     | Same                                          | Press      |
| Chambers of commerce, craft associations, farmers' markets | **Membership costs and member counts not found** | —                                                                                                                                                                                                         | —                                             | —          |

### 7.4 The rules on promotions, sweepstakes and marketing messages

Read in the primary texts. Where the repository's compliance document does not
already cover a point, it is **for the lawyer to confirm**.

**Promotions and offers** (Decreto 37899-MEIC art. 55, consolidated print of
7 Jan 2026, read):

- (i) the merchant must state how long the promotion lasts and guarantee stock
  of what is promoted for that whole period;
- (j) for limited quantities, the offer must state the quantity available;
- (b) what the advertising promises is enforceable even if the contract says
  otherwise; the term most favourable to the consumer wins;
- (c) no hidden, false or misleading advertising, including by omission or
  exaggeration;
- (g) statistics and survey figures used in advertising need responsible,
  identified, checkable sources;
- (h) "garantía" or "garantizado" may be used only for conditions better than
  the legal warranty, and the advert must say what they are.

**Enforcement in practice.** In June 2026 MEIC's e-commerce observatory checked
26 digital adverts from 25 merchants (Facebook 54%, websites 42%, Instagram 4%)
and found breaches in 31%. Of those: no stated duration 40%, no stock quantity
20%, no former price or benefit 20%; also undisclosed restrictions, prices in
dollars without the exchange rate, and conditions tied to a payment method
(Infobae, 17 Jun 2026). Eight warning letters were sent.

**Sweepstakes** (art. 59, as reformed by Decreto 44400 of 26 Feb 2024, read).
Before running one, the merchant must publish: (a) start and end dates;
(b) what it is and the steps to enter; (c) restrictions, stated clearly and not
by reference to documents the consumer cannot see; (d) how and where to claim
the prize; (e) the winner chosen before a notary public or recorded in a sworn
declaration (date, winner, method, prize, delivery), published through the
same media used to announce it, of national reach. The rules may be in a
written reglamento; a digital copy may be sent to MEIC's consumer office.

**Raffles with paid tickets.** Press and a law-firm page say the Junta de
Protección Social has exclusive competence over raffles and lotteries, so a
paid-entry draw needs JPS authorisation, while a free promotional draw does
not (Teletica; El Financiero legal column, 2005; Ley de Rifas y Loterías
1387 and Ley 8718 cited). **For the lawyer to confirm.** Safe default: no draw
that requires a purchase or payment to enter until the lawyer answers.

**Marketing messages** (Ley 8642, Ley General de Telecomunicaciones, art. 44,
read in SUTEL's PDF):

- automated calls, fax, e-mail "o cualquier otro dispositivo" for direct sales
  are prohibited except to subscribers who gave **prior consent**;
- exception: a business that obtained a customer's e-mail with consent during
  a sale may use it to sell **similar** products; the customer may stop the
  messages at any time, free of charge;
- always prohibited: hiding the sender's identity, or omitting a valid address
  to ask for the messages to stop.

The repository's privacy rules (separate unticked consent, "Publicidad" at the
start, free one-step opt-out) meet or exceed this. **Commercial messages are
not built** (`STATUS.md`). Whether WhatsApp counts as "cualquier otro
dispositivo" is **for the lawyer to confirm**; the safe reading is yes.

**Ley 10946** (from about 24 Jun 2027) adds advertising transparency and a
ban on dark patterns (repository fact sheet §3; already covered).

---

## 8. What this changes in the repository's documents

These are facts to carry into the plan. Nothing in the repository was changed.

1. `docs/research/costa-rica-fact-sheet.md` §7 cites the locker price (₡2,300)
   as "Pymexpress". The volume tariff for 25–200 parcels is ₡1,962.17 before
   IVA for the first kilo. Re-run the break-even comparison in
   `docs/00-strategy/business-model.md` against it.
2. The "about 80% of adults buy online" figure in the fact sheet and in
   `market-and-wedge.md` has two lower competing figures (48.5% in 2022; 18%
   paying online). Mark it as an industry estimate.
3. `market-and-wedge.md` says local marketplaces that let a seller reach the
   whole GAM with someone else's logistics "are few and young". Walmart
   Marketplace (sellers deliver), Boxful (fulfilment, Escazú), Pyme Store BAC
   and the Correos–BCR–INS–Mastercard pilot now exist. The structured
   competitor review in `docs/08-open-questions.md` can use §3 above.
4. Amazon Bazaar's free-shipping minimum is ₡10,000.
5. `fees.ts` assumes ₡515 per dollar; the rate is about ₡445–₡452.
6. Wages: the business model's ₡45,000 driver-day can now be split into
   about ₡21,700 of legal-minimum labour and about ₡23,000 for everything else.

---

## 9. Decisions this research raises

The five questions this research raised are asked once, with the strategy
documents' questions, in the [owner decisions](../00-strategy/owner-decisions.md)
list: the share of people who buy online (D30), the free-delivery threshold
(D21), the courier for parcels outside the route (D35), the card fixed fee
(D38) and draws (D41).

---

## 10. What could not be found

- A representative survey after 2022 of how many Costa Ricans buy online, how
  often, and the average basket.
- The share of cash on delivery in online orders.
- A ranked list of where Costa Ricans shop online.
- Fees charged to sellers by Walmart Marketplace, Pyme Store BAC, the
  Correos–BCR–INS–Mastercard pilot, Boxful, Moovin (delivery), Uber Direct
  and Encuentra24 (featured ads).
- Whether Mercado Libre's checkout, payments and shipping work in Costa Rica
  (its help pages refused the request).
- ONVO's own price page (refused the request); its prices come only from the
  repository's third-party source.
- PCMI's 2025–2026 Costa Rica figures (page returned empty).
- How many small businesses sell online.
- A survey of online sellers' complaints in Costa Rica.
- Salaries for a seller-success person or a marketing person from a reputable
  survey; Paylab pages refused the request.
- Dealer list prices for a motorbike, car or small van.
- Rent for small warehouse spaces (50–200 m²).
- Published prices for radio, outdoor or social-media advertising in Costa
  Rica; a reliable cost per thousand impressions.
- Membership fees and member counts of chambers of commerce and craft
  associations.
- 2026 courier-import volumes and the current tax-free import thresholds
  (conflicting secondary sources).
- Whether Correos' cash-on-delivery collection is live.

---

## Sources

The strategy documents that use these facts are [go-to-market](../00-strategy/go-to-market.md),
[roll-out plan](../00-strategy/rollout-plan.md), [team structure](../00-strategy/team-structure.md)
and [pricing strategy](../00-strategy/pricing-strategy.md).

All read on **24 November 2026** unless stated. "Search result" means the
figure came from the search engine's extract of that page, not from reading the
page itself.

**Official and primary texts**

1. MTSS, Lista de salarios mínimos por ocupación 2026 (Decreto 45303-MTSS) —
   https://www.mtss.go.cr/temas-laborales/salarios/lista_salarios_minimos_2026.pdf
2. MTSS, comunicado CP-022-2026 (28 Oct 2026), increase for 2027 —
   https://www.mtss.go.cr/prensa/comunicados/2026/octubre/cp_022_2026.html
3. Decreto 37899-MEIC, consolidated print of 7 Jan 2026, arts. 55 and 59 —
   https://www.micitt.go.cr/sites/default/files/marco_juridico_legal/03.%20Decreto%20Ejecutivo%20n.%C2%B0%2037899-MEIC%20Reglamento%20a%20la%20Ley%20de%20Promoci%C3%B3n%20de%20la%20Competencia%20y%20Defensa%20Efectiva%20del%20Consumidor%20n.%C2%B0%207472..pdf
4. Ley 8642, Ley General de Telecomunicaciones, art. 44 —
   https://www.sutel.go.cr/sites/default/files/normativas/ley_general_de_telecomunicaciones.pdf
5. Correos de Costa Rica, Tarifas (Pymexpress) — https://correos.go.cr/tarifas/
6. Tilopay, Tarifas — https://tilopay.com/tarifas
7. Amazon, Selling on Amazon pricing (US) — https://sell.amazon.com/pricing
8. Amazon México, Precios — https://vender.amazon.com.mx/precios
9. Falabella Chile, ¿Cuánto cuesta vender en falabella.com? —
   https://www.falabella.com/falabella-cl/page/cuanto-cuesta-vender-en-falabella
10. Moovin, términos y condiciones — https://www.moovin.me/terminos-y-condiciones/
    (search result; page about 642 days old)
11. Uber, Uber Direct — https://merchants.ubereats.com/mx/en/services/uber-direct ;
    Uber Envíos tariff — https://www.uber.com/es-CR/blog/uberflash-manda-paquetes-a-traves-de-la-app-de-uber
    (search result)
12. TicoMarket — https://www.ticomarket.com/
13. UCR, "Un estudio desmonta mitos sobre el uso de las plataformas digitales"
    (27 May 2026) —
    https://www.ucr.ac.cr/noticias/2026/5/27/un-estudio-desmonta-mitos-sobre-el-uso-de-las-plataformas-digitales-en-costa-rica.html
14. UCR Mediápolis, Hábitos y prácticas de consumo (CICOM 2025) —
    https://mediapolis.ucr.ac.cr/confianza-y-consumo/habitos-y-practicas-de-consumo/
15. MICITT, Informe anual PEN 2025 (household internet 87.32%, ENAHO 2025) —
    https://micitt.go.cr/sites/default/files/transparencia/planes_institucionales/MICITT-SPIS-INF-000008-2026%20Informe%20Anual%20PEN%202025.pdf
    (search result)

**Press**

16. Tico Times, "Costa Rica Hits Record Digital Payment Use as Cash Declines"
    (17 Jun 2026) — https://ticotimes.net/2026/06/17/costa-rica-hits-record-digital-payment-use-as-cash-declines
17. La República / Rumbo Económico, UCR e-commerce survey (12 Sep 2022) —
    https://rumboeconomico.net/tendencias/485-de-consumidores-del-pais-realizan-compras-por-algun-medio-electronico/
18. Forbes Centroamérica (18 Sep 2025), World Bank 18% figure —
    https://forbescentroamerica.com/2025/09/18/conoce-como-la-confianza-da-un-segundo-aire-al-comercio-online/
    (search result)
19. El Financiero, Amazon Bazaar launch —
    https://www.elfinancierocr.com/tecnologia/amazon-contraataca-a-temu-estrena-su-seccion/TIZ3DKNZ4ZH4DMOEZV6XNJQLPI/story/
20. Delfino, Walmart Marketplace (21 Jan 2026, sponsored) —
    https://delfino.cr/2026/01/walmart-lanza-productos-exclusivos-en-linea
21. La Nación, Pymexpress digital ecosystem (18 Nov 2025) —
    https://www.nacion.com/economia/esta-es-la-nueva-plataforma-que-promete-cambiar/3FCANLX66ZCHNGS32OXUP5W3MQ/story/
22. Ticoslandia, Pyme Store BAC (Dec 2025) —
    https://ticoslandia.com/bac-lanza-un-mercado-digital-para-impulsar-el-comercio-electronico-de-las-pyme-en-costa-rica/
    (search result)
23. Delfino, Boxful in Costa Rica (Mar 2026) —
    https://delfino.cr/2026/03/boxful-llega-a-costa-rica-la-startup-centroamericana-que-quiere-hacer-el-e-commerce-facil-y-accesible-para-todas-las-pymes
24. El Financiero, "La rebelión del delivery" (15 Jul 2026) —
    https://www.elfinancierocr.com/negocios/la-rebelion-del-delivery-los-restaurantes-de-costa/OSEH7STGYRH5VJQTNRWBHKDDDE/story/
25. La República, Pymexpress volumes (6 May 2024) —
    https://www.larepublica.net/noticia/correos-de-costa-rica-facilita-el-crecimiento-de-las-pymes-con-envios-diarios-de-8500-paquetes
26. CRHoy, Correos rate increase (Aug 2025) —
    https://www.crhoy.com/nacionales/correos-de-costa-rica-aplico-aumentos-en-sus-servicios-de-hasta-un-206/
    (search result)
27. El Observador, MEIC registers (28 Jun 2026) —
    https://observador.cr/las-mipymes-registradas-casi-se-duplicaron-en-cuatro-anos-en-costa-rica-emprendedores-inscritos-llegan-a-12-050/
28. La República, Expo PymeCR analysis (2 Jan 2026) —
    https://www.larepublica.net/noticia/emprendimientos-crecen-con-fuerza-en-costa-rica-pero-pocos-logran-consolidarse-segun-expopyme
29. Infobae, MEIC digital-advertising inspection (17 Jun 2026) —
    https://www.infobae.com/costa-rica/2026/06/18/ministerio-de-economia-industria-y-comercio-de-costa-rica-detecto-incumplimientos-en-el-31-de-la-publicidad-digital-por-el-dia-del-padre/
30. CRHoy, 95 complaints against an online store —
    https://crhoy.com/nacionales/meic-ya-recibio-95-denuncias-contra-tienda-virtual-por-incumplimientos-en-entregas-y-devoluciones/
31. Teletica, MEIC on Temu and Shein —
    https://www.teletica.com/entrevistas/comprar-en-estas-plataformas-requiere-doble-cuidado-meic-ante-auge-de-temu-y-shein-en-costa-rica_390456
    (search result)
32. Teletica, raffles and the JPS —
    https://www.teletica.com/nacional/rifas-de-carros-y-motos-inundan-redes-sociales-pueden-las-autoridades-decomisar-premios_411845
    (search result)
33. CRHoy, fake SINPE receipts —
    https://crhoy.com/nacionales/grupo-estafo-a-empresa-por-mas-de-%C2%A25-millones-con-comprobantes-falsos-de-sinpe/
    (search result); Teletica —
    https://www.teletica.com/calle-7/aprenda-a-identificar-las-sinpe-estafas_337689 (search result)
34. El Financiero, social media for small businesses (6 Jan 2026) —
    https://www.elfinancierocr.com/tecnologia/como-deben-usar-las-pymes-las-redes-sociales-en/DEFQTE6Z4RDQDJ6SBRSVLZUJWI/story/
35. Delfino, Kantar IBOPE radio (14 Feb 2026) —
    https://delfino.cr/2026/02/kantar-ibope-media-la-radio-consolida-su-conexion-con-los-costarricenses
36. Delfino, CBRE industrial market (May 2026) —
    https://delfino.cr/2026/05/mercado-industrial-y-logistico-en-costa-rica-mantiene-alta-demanda-y-consolida-su-crecimiento-en-la-region-segun-informe-de-cbre
37. Repretel, November fuel prices —
    https://www.repretel.com/noticia/aprueban-fuerte-aumento-en-el-precio-de-los-combustibles/
    (search result); Diario Extra —
    https://www.diarioextra.com/noticia/autoridades-descartan-que-litro-de-combustible-llegue-a-%C2%A21-000/
    (search result); Infobae (20 Nov 2026) —
    https://www.infobae.com/costa-rica/2026/11/20/gobierno-de-costa-rica-confirma-propuesta-de-rebaja-de-hasta-103-usd-022-por-litro-en-los-combustibles-para-diciembre/
    (search result)
38. El Observador, exchange rate low (Nov 2026) —
    https://observador.cr/dolar-marca-nuevo-minimo-historico-en-monex-cae-a-44445/
    (search result); Diario Extra, bank rates —
    https://www.diarioextra.com/noticia/dolar-cierra-la-semana-en-¢449/ (search result)
39. Delfino, EXPOPYME 2026 —
    https://www.delfino.cr/2026/04/expopyme-oficial-2026-reunira-a-235-emprendimientos-en-la-antigua-aduana ;
    Expo Pyme CR —
    https://delfino.cr/2026/05/expo-pyme-cr-anuncia-cuarta-edicion-con-feria-gratuita-en-parque-la-libertad
    (search results)
40. La República, esencial COSTA RICA licensees —
    https://www.larepublica.net/noticia/mas-de-750-productos-son-esencial-costa-rica (search result)
41. La Nación, import exemptions explainer —
    https://www.nacion.com/el-explicador/por-que-es-tan-barato-comprar-en-temu-desde-costa/AOKPO4QYOVBDRLK5XRTDIQLOFE/story/
    (search result)
42. El Cronista, Mercado Libre Argentina free-shipping threshold —
    https://www.cronista.com/podcast/mercado-libre-baja-el-piso-para-envios-gratis-la-apuesta-para-sumar-usuarios-y-aumentar-las-ventas/
    (search result)

**Third party (ranges only)**

43. DataReportal, Digital 2026: Costa Rica (8 Nov 2025) —
    https://datareportal.com/reports/digital-2026-costa-rica
44. Alegra, Salario mínimo Costa Rica 2026 y costo patronal (updated
    7 Oct 2026) — https://blog.alegra.com/costa-rica/salario-minimo-costa-rica/
45. Aglegal, salarios mínimos 2026 — https://aglegal.com/salario-minimo-costa-rica/ (search result)
46. FiniquitoJusto, prestaciones — https://finiquitojusto.com/?p=300 (search result)
47. Paylab Costa Rica, customer service —
    https://www.paylab.com/cr/salarios/atendimento-ao-cliente?lang=pt ; logistics controller —
    https://www.paylab.com/cr/salarios/transporte-logistica/controlador-de-logistica?lang=pt ;
    logistics director — https://paylab.com/cr/salaryinfo/top-management/logistics-director?lang=en
    (search results; pages refused the request)
48. Magneto, logistics customer-service advert (21 Sep 2026) —
    https://www.magneto365.com/cr/empleos/servicio-al-cliente-logistico-costa-rica-921682 (search result)
49. Encuentra24 warehouse listings —
    https://www.encuentra24.com/costa-rica-en/real-estate-for-rent-comercial?q=keyword.bodegas ;
    motorbike listing —
    https://www.encuentra24.com/costa-rica-en/cars-auto-trucks-motorcycles/2025-honda-navi-excellent-condition-unique-owner/33091662
    (search results)
50. Statista summary of Cushman & Wakefield industrial rent —
    https://statista.com/statistics/1394447/industrial-real-estate-rent-costa-rica-by-market (search result)
51. Omno, Costa Rica payments —
    https://omno.com/coverage/costa-rica/ (search result)
52. easyappsecom, Shopify in Costa Rica (unsourced shares; not used) —
    https://easyappsecom.com/guides/selling-on-shopify-costa-rica (search result)
53. Aeropost casillero page — https://aeropost.com/SJO/es/casillero (search result; page returned an error);
    JPL comparison — https://jplcostarica.com/en/international-shipping-companies-in-costa-rica-2026-comparison/ (search result);
    Tivi — https://www.tivicr.com/content/7-tarifas-casillero-aereo (search result)
54. Mercado Libre Mexico commission guides: Tiendanube —
    https://www.tiendanube.com/blog/comision-mercado-libre-mexico/ ; Profitos —
    https://www.profitosapp.com/blog/cuanto-cobra-mercado-libre-por-vender-mexico-2026 (search results)
55. Mercado Libre thresholds: UpSeller — https://upseller.com/es/blog-article-443 ;
    Telediario — https://www.telediario.mx/comunidad/envios-gratis-mercado-libre-cuanto-es-minimo-compra (search results)
56. Shopee Brazil: Priceva — https://priceva.com/pt/calculadora-shopee ;
    ruacep — https://www.ruacep.com.br/guias/ecommerce/comissao-marketplace-ml-amazon-shopee-magalu-2026/ (search results)
57. Amazon FBA US: Webgility — https://www.webgility.com/blog/amazon-pick-and-pack-fee?hs_amp=true ;
    RepricerExpress — https://www.repricerexpress.com/?p=48423 (search results)
58. Andrey Business, Meta ads in Costa Rica (unsourced CPM; not used for budgets) —
    https://www.andreybusiness.com/costa-rica/meta-ads (search result)

**Repository files read**

`STATUS.md`; `docs/00-strategy/business-model.md`;
`docs/00-strategy/market-and-wedge.md`; `docs/01-product/pricing-and-fees.md`;
`docs/research/costa-rica-fact-sheet.md`; `docs/08-open-questions.md`;
`docs/05-security-compliance/compliance-costa-rica.md` (headings and §7);
`docs/05-security-compliance/privacy.md` and `docs/06-operations/notifications.md`
(marketing-consent passages); `packages/core/src/fees.ts`.
