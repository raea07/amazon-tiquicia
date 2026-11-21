# Market and wedge

Yuntera does not try to out-catalogue or out-price the cross-border giants. It
competes where they are structurally weak in Costa Rica: speed, local payment
methods, a legal invoice, a warranty someone answers for, and deliveries that
find the house. This document sets out the landscape, the wedge, where Yuntera
loses, and what that means for the categories to launch with.

All market figures come from the
[fact sheet, section 8](../research/costa-rica-fact-sheet.md#8-market-context)
unless marked otherwise.

## The landscape

**Demand is real and already online.** Costa Rican e-commerce was about US$6.4
billion in 2024 with double-digit growth forecast; roughly 80% of adults buy
online and mobile is 74% of volume. Other trackers publish much lower totals on
narrower definitions, so treat the size as "large enough", not as a target.
Domestic merchants take 55% of volume: shoppers do buy locally.

**Cross-border players set the price floor and are getting closer.**

| Player                              | What they offer in Costa Rica                                      | Structural weakness here                                                        |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Amazon (main store)                 | Free shipping on eligible orders of US$35+                         | Days to weeks; returns cross a border; no Costa Rican electronic invoice        |
| Amazon Bazaar (launched 7 Nov 2025) | Most items under ₡5,000, delivery in two weeks or less, cards only | Two weeks; no SINPE Móvil or cash; low-value goods only                         |
| Temu                                | Direct shipping in about 15 days                                   | No local representation for claims; parcels held in customs                     |
| Shein                               | Direct route since Sept 2025, about a month                        | Slowest of the group; taxes collected on delivery                               |
| Casilleros                          | A US address and freight forwarding for anything sold in the US    | The shopper does the importing: pays per weight, waits, handles the claim alone |

The "what they offer" column is from the fact sheet. The "weakness" column is
this plan's reading of it, not a sourced finding.

Volume through these channels is growing fast: courier import declarations in
January–July 2025 were about four times all of 2024.

**Local retail is strong but mostly sells its own stock.** Large chains run
their own online stores with their own inventory. Marketplaces that let a small
or medium seller reach the whole GAM with someone else's logistics are few and
young. (Names of specific local competitors came up during the naming search
and are not yet in the fact sheet; a structured competitor review is listed in
[open questions](../08-open-questions.md).)

**Logistics can be bought.** Correos de Costa Rica (Pymexpress), Moovin, Boxful
and Uber Direct all operate locally
([fact sheet, section 7](../research/costa-rica-fact-sheet.md#7-last-mile-and-labour)).
That matters twice: they are a fallback for Yuntera's own delivery, and they
mean delivery alone is not a moat.

## What shoppers complain about

From the fact sheet: late or missing deliveries and slow refunds (95 complaints
to MEIC against a single online store), nobody local to claim against for Temu
and Shein purchases, parcels stuck in customs, weak logistics outside the GAM
and for returns, and general distrust.

Every one of these is an operations and accountability problem. None is a
catalogue problem.

## The wedge

Yuntera's promise is one sentence: **local stock, at the door tomorrow, paid
the way Costa Ricans pay, with a seller and a company that answer for it.**

| Element                 | What Yuntera does                                                                                                                                                                                                                                | Why importers cannot match it                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speed                   | Stock is already in the country; orders before the cutoff arrive the next delivery day in the GAM core (service levels in `packages/core/src/promise.ts`)                                                                                        | Their stock is an ocean or a border away                                                                                                                                                              |
| Payment                 | SINPE Móvil and cash on delivery alongside cards                                                                                                                                                                                                 | Card-only checkouts exclude shoppers without an international card, and SINPE Móvil is the country's everyday payment rail ([fact sheet, section 5](../research/costa-rica-fact-sheet.md#5-payments)) |
| Invoice                 | The seller issues a factura or tiquete electrónico; businesses can deduct the purchase                                                                                                                                                           | Foreign sellers do not issue Costa Rican electronic invoices                                                                                                                                          |
| Warranty and withdrawal | The legal 30-business-day warranty and the 8-business-day right of withdrawal are honoured without argument, with refunds inside the legal 8 calendar days ([fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection)) | A claim against a foreign seller has no local counterpart                                                                                                                                             |
| Addresses that work     | Every address is a map pin plus the shopper's own _señas_ plus a Plus Code (`packages/core/src/cr/geo.ts`)                                                                                                                                       | Carriers built for street-and-number addresses fail on "200 metros al sur del antiguo higuerón"                                                                                                       |
| A promise that is kept  | The delivery date shown is a commitment the operation is measured against; missing it gives the shopper the right to a full refund by law, so the promise is deliberately conservative                                                           | Estimated windows of "two weeks or less"                                                                                                                                                              |

For sellers, the wedge is the mirror image: a PYME gets warehousing, delivery,
payment collection and a storefront without building any of them, for
published, itemised fees (see
[pricing and fees](../01-product/pricing-and-fees.md)).

## Where Yuntera loses

Stating this plainly keeps the roadmap honest.

- **Catalogue breadth.** A cross-border catalogue has millions of items. Yuntera
  will have hundreds, then thousands. A shopper looking for a specific obscure
  item will not find it.
- **Price on imported commodity goods.** A local seller has already paid
  freight, duties and 13% IVA and carries stock risk. On a phone case or a
  generic gadget, direct-from-factory platforms will be cheaper, often by a lot.
- **Brand trust on day one.** Nobody has heard of Yuntera. Trust is earned one
  delivery at a time.
- **Coverage.** Next-day delivery is a GAM promise. Outside it, Yuntera relies
  on carriers and is no faster than anyone else.

## What that implies for launch categories

Launch where waiting two weeks is unacceptable or importing is impractical, and
avoid a head-on price fight on small imported goods.

| Launch with                                                                                   | Why                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Urgent replacements: chargers, cables, small appliances, printer supplies, tools and hardware | The need is today or tomorrow; a 15-day wait is not an option |
| Bulky or heavy goods: home, small furniture, pet food, cleaning supplies                      | Freight by weight makes importing them expensive              |
| Goods where warranty matters: electronics and appliances from authorised local distributors   | A local warranty and invoice are worth a price premium        |
| _Hecho en Costa Rica_: coffee, food products, crafts, local brands                            | No cross-border competitor carries them                       |
| Gifts with a date attached                                                                    | The promised date is the product                              |

| Avoid at launch                         | Why                                                          |
| --------------------------------------- | ------------------------------------------------------------ |
| Ultra-low-price fashion and accessories | The price floor is set by platforms Yuntera cannot match     |
| Long-tail imported gadgets              | Breadth game; requires a catalogue Yuntera will not have     |
| Perishables and chilled goods           | Needs cold chain and same-day routing; a different operation |
| Medicines and regulated products        | Licensing and liability outside the scope of a pilot         |

These are hypotheses. The pilot's job is to test them with real sellers; the
launch category list is an [open question](../08-open-questions.md) for the
owner.

## Why not just be a casillero

A casillero would give Yuntera an instant, unlimited catalogue, and the roadmap
keeps cross-border imports as a later phase. It is not the starting point for
four reasons:

1. **It is the crowded side.** Established forwarders, plus Amazon, Temu and
   Shein now shipping direct, all compete there.
2. **It abandons the wedge.** An imported parcel is slow, has no local warranty
   and no Costa Rican invoice. Yuntera would be selling exactly what shoppers
   complain about.
3. **It roughly doubles the compliance surface**: customs declarations, duties,
   import IVA and freight consolidation, with a per-parcel customs fee under
   debate and a new customs system planned for 2027
   ([fact sheet, "recently changed"](../research/costa-rica-fact-sheet.md#recently-changed--re-check-before-launch)).
4. **It does nothing for local sellers**, who are the supply side this model
   depends on.

The sequence is therefore: prove local delivery and trust first, then add
imports as one more source of supply flowing through an operation that already
works.
