# Offers and the product page

One catalogue product can be sold by several shops. A **product** is one page
in the store, with its text, photos and reviews; a **variant** (SKU) is one
buyable version of it (a size, a colour); an **offer** is one shop's price,
stock and way of shipping for one variant. This document says which offer a
shopper sees first, how a shop sells a product another shop created, who may
change what, and what happens to the other shops when the creating shop stops.

- The order: `packages/core/src/offers.ts` (`selectFeaturedOffer`,
  `compareOffers`, `OFFER_ORDER_SQL`) and, in SQL,
  `private.refresh_product_summary` and `private.get_product_page`
  (`supabase/migrations/20261121083600_seller_listings.sql`, between the
  `offer_order` markers)
- Where it runs: the product page of the website
  (`apps/web/src/app/p/[slug]/page.tsx`) and of the shopper app
  (`apps/shop-native/src/lib/offers.ts`); the listing summary that search,
  category pages and the seller's "Destacada" badge read
- Tests: `packages/core/src/offers.test.ts` (the cases),
  `packages/core/src/offers.parity.test.ts` (the SQL order equals the
  TypeScript one), `supabase/tests/155_seller_listings.sql` block A (the same
  cases in the database) and blocks B to I for the rest of this document

## Which offer is shown first

Every surface uses one deterministic order for a variant's offers:

1. **In stock first.** An offer with units to sell comes before one without.
2. **Then the lowest total for the shopper**: the price plus the shipping the
   shopper would pay for that offer. Shipping is charged once per order by
   zone, the same for every offer, so today the price decides. If shipping
   ever differs by offer, `shippingMinor` carries it and the order follows.
3. **Then the older offer** (listed first).
4. **Then the offer id**, so two offers listed in the same instant still come
   out the same way on every request and on both sides.

The offer shown first (in the buy box, and as the price in search and on
category pages) is the first **new** offer in that order. Refurbished and
used offers are listed with the others and can be bought, never shown first.
Only offers on sale from shops that may trade are shown at all. The others
follow under "Otras ofertas de este producto", each with its price, its
delivery date, the shop that sells it (its logo and a link to its page) and
its own buy button, so the shopper sees every offer and can choose any.

| Surface                        | What it shows                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product page                   | Per variant: the first new offer in the buy box, "Vendido por" with the shop's logo and page; every other offer below, in order                                                                  |
| Search results, category pages | One row per product (a product is never listed twice, however many shops sell it): the price of the first new offer across the product's variants that are switched on, from the listing summary |
| Cart and checkout              | Exactly the offer the shopper added, with its shop ("Vendido por …"); checkout prices that offer again from the database. When that offer can no longer be bought, see below                     |
| Seller centre                  | "Destacada" when the shop's offer is the one the listing summary shows first, and how many other shops sell the product                                                                          |

### When the offer in a cart can no longer be bought

The cart keeps the offer the shopper chose; it never swaps it silently. When
that offer sells out, is paused, or its shop stops trading, the cart asks
`cart_alternatives` (a visitor function) for the offer of the same variant
that the product page now shows first among those that can be bought (the
same order, between the same `offer_order` markers), and says so:

> Botella térmica Sendero 750 ml. La oferta de Ferretería El Higuerón se
> agotó. Tienda Sendero lo vende a ₡9 900. [Cambiar a la oferta de Tienda
> Sendero] [Ver todas las ofertas]

"Cambiar" replaces the offer id in the cart and keeps the quantity; prices
are read again as always. Only when no other shop sells the variant does the
cart say the product is not available and ask to remove it. When an order is
refused because a product ran out (`insufficient_stock`, `offer_unavailable`),
checkout names the product and its shop, and says whether to change it on the
cart page or lower the quantity, instead of "one of the products".

### Why this rule, and not the weighted score

Until November 2026 the product page featured the offer with the best score
of price (55 %), delivery speed (25 %), seller score (15 %) and warehouse
fulfilment (5 %), while search and category pages showed the cheapest offer in
stock. The two disagreed: a shopper could see ₡19 500 in search and land on a
page whose buy box said ₡19 900. The score also could not run in the database,
where the listing summary and checkout live, and its seller component was a
constant (no job computes seller scores; every shop had 90). So there is now
one rule, simple enough to state in a sentence on the help page
(`/ayuda#como-ordenamos`), run the same way in SQL and TypeScript, and
checked by a parity test. The cost is that a faster offer no longer wins over
a slightly cheaper one; the delivery date of every offer is on the page next
to its price. Bringing speed or seller performance back is a change to both
sides and to the help page, made when seller scores are computed.

What the order deliberately does not use: the shop's identity or size, any
payment to Yuntera, Yuntera's commission, or whose offer it is. If Yuntera
ever sells on its own account, its offers are ordered the same way.

### Worked example

"Audífonos inalámbricos Nimbo Aire" in the demo data: TecnoCasa at ₡19 900
from the warehouse (90 units), Tienda Sendero at ₡19 500 shipped by itself (6
units). Both have stock, so the lower price decides: Tienda Sendero's offer is
shown first, and TecnoCasa's is listed under it with its earlier delivery
date. When Sendero sells its last unit, TecnoCasa's offer moves first (in
stock before out of stock) and Sendero's stays listed as "Agotado".

## Selling a product another shop created

A shop does not publish a product that already exists: it adds its own offer
to it (seller centre, Productos → "Vender uno que ya existe";
`seller_catalog_search`, `seller_add_offer`).

- **Finding it.** By name, by brand, or by a variant's barcode (8 to 14 digits,
  typed with or without spaces or dashes). Only published products a shopper
  can open are found, at most 20, one result per product with each variant,
  how many shops sell it and the lowest price in stock.
- **The offer.** Price (with the same price floor as any offer: a sale must
  not cost the shop more in fees than it pays), an optional regular price,
  and who keeps and ships it (the shop, with its handling days, or the
  warehouse when the package fits). An offer the shop archived on that
  variant is put back instead of a second one being made. Stock then arrives
  through the usual paths: the shop's own count at its pickup place
  (`seller_set_stock`) or an inbound shipment to a Yuntera warehouse.
- **No review.** The content (text, photos, category, package) was already
  approved when the product was published, and the offering shop cannot
  change any of it, so there is nothing new for staff to read. What limits
  abuse instead: only a member of an **active** shop whose identity staff
  **verified** can add offers (a pending, suspended or closed shop cannot);
  at most `max_new_offers_per_day_per_seller` (30, a setting, in the pattern
  of the limits migration 083000) offers a day per shop; the price floor; and
  everything a shop does with its offers stays reportable and suspendable as
  before. There is nothing category-specific to check: categories carry no
  restriction today beyond being switched on, and a switched-off category's
  products cannot be found.

## Who may change what

| What                                          | Who                                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The product's text, category, package, photos | The shop that created it, through the reviews it always had (`seller_update_listing`, photo changes); catalogue staff decide them. Nobody else: the offering shops get "not found" |
| A variant switched off and on                 | The creating shop (`seller_set_variant_active`). If another shop sells that variant, the variant stays on sale for it and only the creating shop's own offer is paused             |
| Back to draft, archived                       | The creating shop, and only while no other active shop has a live offer on it (`listing_shared`)                                                                                   |
| An offer's price, stock, handling time, pause | The shop that owns the offer, and nobody else                                                                                                                                      |
| A reply to a review                           | The shop that sold the unit the review is about (the review belongs to an order line, so its seller is known); the creating shop replies only to reviews of its own sales          |
| Taking content down                           | Catalogue staff, for every shop's offers at once, as before                                                                                                                        |

Reviews are about the product: they are shown on its page whichever shop sold
the unit, and they count towards the product's rating.

An approved edit of the package or category changes the fees of every offer
on that variant or product. The creating shop's own offers are checked as
before (its edit is refused while its own price would be below the floor).
Another shop's offer the edit would leave below the floor is not a reason to
refuse the creating shop's edit for a price it does not set, but the package
data the creating shop declares sets the other shops' fees, and staff cannot
weigh the parcel. So:

- The console's review of the edit lists, before staff decide, each other
  shop's offer the approval would pause, with its price and the lowest price
  that would cover the fees afterwards (`ops_listing_edits_for_review`,
  `pauses_offers`).
- Approving such an edit is refused (`edit_pauses_offers`) unless staff tick
  that they checked the package and confirm the pauses
  (`ops_review_listing_edit(…, p_pause_offers => true)`). An edit that does
  not look real is rejected instead.
- Once confirmed, those offers are paused, each shop sees them in its list of
  paused offers with the reason ("se aprobó un cambio del paquete o de la
  categoría") and the lowest price that covers the new fees, puts them back
  on sale in one step, and is told by e-mail and push
  (`seller_offers_paused_edit`).

## When the creating shop stops

"A live offer" means an offer **on sale** (status `active`, with or without
stock right now) from a shop that may trade (active): what a shopper can find
on the page. A paused offer sells nothing, so it holds nothing back; if it
did, a shop that paused its offer and forgot it would stop the creating shop
from ever reworking or retiring its own listing. A suspended or closed shop's
offers are on sale nowhere and hold nothing back either. A shop that no
longer wants to sell a product another shop created withdraws its offer for
good from its list of products ("Dejar de vender este producto"); adding it
again later puts the same offer back.

| The creating shop…                                      | What happens to the product and to the other shops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wants to archive it, or take it to draft                | Refused while another active shop has a live offer: its page is not the creating shop's alone. It can pause or archive its own offer. Other shops' paused offers do not stop it; they stay paused, and the page says how many there are                                                                                                                                                                                                                                                                                                               |
| Retires a variant                                       | Only its own offer on that variant is paused when another shop has a live offer on it; otherwise the variant leaves the page (other shops' paused offers on it stay paused)                                                                                                                                                                                                                                                                                                                                                                           |
| Is suspended                                            | The product stays on sale through the other shops (its own offers leave the page); it stays the suspended shop's, because a suspension may be lifted, but that shop can send no edit while suspended. A product nobody else sells leaves the shop until it is reinstated                                                                                                                                                                                                                                                                              |
| Closes (staff, or its last owner deleted their account) | Each of its published listings that another active shop offers **passes to the shop with the oldest offer on sale on it**, or, when every other offer is paused, to the shop with the oldest paused one (it can resume; without an heir the page would be gone for it too). The new owner edits it through the same reviews. What the closed shop left waiting on it (a listing edit, photos not yet approved) is withdrawn; its published photos stay with the listing. A listing nobody else offers stays with the closed shop and is shown nowhere |

The closed shop's logo and description leave the shop too (they may describe
the person behind it), every change to its details still waiting for review
is withdrawn (and a description is never approved onto a closed shop), and
its public page stops existing.

## Variants on and off, and back to draft

- **A variant switched off** cannot be ordered: it leaves the product page,
  carts cannot buy it, checkout refuses it. Orders already placed, units held
  for them and stock are untouched, and the offer itself keeps its price and
  state, so switching the variant on again puts it back as it was. The last
  variant on sale cannot be switched off: the listing goes back to draft or is
  archived instead. The listing summary is refreshed whenever a variant is
  switched (a trigger on `skus`).
- **Back to draft** takes a published listing out of the shop at once (its
  address answers "not found", search and suggestions drop it, carts treat it
  as an archived listing); open orders go on and are delivered. A listing
  edit waiting for review is withdrawn, because the draft is now edited in
  place. Photos follow the photo rules for an unpublished listing: they are
  reviewed with the listing. It goes back on sale only through the review of
  a new listing; its first publication date is kept.

## How it is explained

To shoppers, under "Otras ofertas de este producto", with a link to the help
page:

> Mostramos primero la oferta nueva con existencias y el precio más bajo; si
> cuestan lo mismo, la que se publicó antes. Puede comprar cualquiera de estas.

To sellers, in the list of products and in the seller app, the same rule in
one sentence, the "Destacada" badge, and how many other shops sell the
product; an offer on another shop's listing is marked "De otra tienda".

## Known limits

- **Seller scores are not computed**, so seller performance has no say in the
  order. See "Why this rule".
- **Per variant.** Each variant has its own offers and its own first offer;
  search shows the product's lowest price across its variants.
- **The cache.** A shop's own price, stock or pause does not refresh the
  shop's cached pages at once (they catch up within about a minute). Adding
  an offer, a variant switched, a listing back to draft, an approved
  description or logo, and an offer resumed from the paused list do refresh it.
- **A shop that takes over a listing** can add and remove its own photos but
  not remove the photos the closed shop uploaded (their files are in that
  shop's folder); catalogue staff can take them down.
- **The paused-by-edit message** is planned by the approval itself, not by
  the notification planner: only the approval knows which offers it paused.
  It is recorded as an event `listing_edit.offers_paused` that no consumer
  reads, so its deliveries have an event to belong to.
- **Native shopper app.** Its cart still says only that a product is not
  available; the swap to another shop's offer is on the website.

## What to measure before changing the order

| Measure                                                             | Why                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Share of orders that buy the offer shown first versus another       | If shoppers often pick another, the rule does not match what they want           |
| On-time and defect rates of the offer shown first versus the others | Whether "cheapest first" picks reliable offers; the case for bringing speed back |
| Price movement on products sold by several shops                    | Whether the rule encourages healthy competition or a race that shops abandon     |
| Offers added on other shops' products per day, and reports on them  | Whether the daily cap and "no review" hold up                                    |
