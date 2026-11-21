# Personas and journeys

Yuntera serves five people who never meet but depend on each other: the
shopper, the seller, the driver, the warehouse associate and the operator. This
document describes what each one is trying to get done, follows one order
across all five apps, and fixes how the most common failures are handled. The
failure handling is policy: the apps and the support team must both follow it.

## Personas

### The shopper — "necesito esto para el sábado"

Lives or works in the GAM. Buys from a phone. Has SINPE Móvil; may or may not
have a card that works online. Has been burned at least once by a parcel that
arrived late, or never.

| Job to be done                                                     | What "done" looks like                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Find something specific without knowing the catalogue's vocabulary | Searching "refri" or "abanico" returns refrigeradoras and ventiladores (`packages/core/src/search.ts`) |
| Know the real cost and the real date before committing             | Total with IVA and shipping, and a delivery date, visible before the pay button                        |
| Pay the way they already pay                                       | SINPE Móvil, card, or cash at the door                                                                 |
| Be found                                                           | A map pin and their own _señas_; no form demanding a street number that does not exist                 |
| Get help or their money back without a fight                       | One message; refund inside the legal period                                                            |

### The seller — a PYME owner

Runs a small shop, workshop or distribution business. Sells today through
Instagram and WhatsApp, takes SINPE Móvil transfers by hand, and delivers by
motorcycle courier or Correos. Has no time and no developer.

| Job to be done                                | What "done" looks like                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Reach buyers beyond their own followers       | Listings appear in search and can win the featured offer on merit                |
| Stop doing logistics                          | Sends stock to the warehouse once; Yuntera picks, packs and delivers             |
| Know exactly what they will be paid           | Every fee itemised per order; payout date known in advance                       |
| Stay compliant                                | Clear guidance on who issues the factura electrónica and with which data         |
| Understand why a listing is or is not selling | A score and the single most useful thing to fix (`packages/core/src/sellers.ts`) |

### The driver — repartidor

Rides a motorcycle. Knows the streets better than any map. Is paid per day or
per delivery and loses money every time nobody answers the door.

| Job to be done                         | What "done" looks like                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Finish the route without doubling back | Stops in a sensible order, grouped by area (`packages/core/src/routing.ts`)   |
| Find the door                          | Pin, _señas_ and a one-tap call or WhatsApp to the recipient                  |
| Prove the delivery happened            | The recipient's PIN, entered once; no argument later                          |
| Hand in cash without being short       | A running total of cash collected and a clean close-out at the end of the day |
| Keep working with no signal            | The app works offline and syncs later                                         |

### The warehouse associate — bodeguero

Receives stock, puts it away, picks, packs and hands parcels to drivers. At
pilot scale this may be the founder or one part-time person.

| Job to be done                      | What "done" looks like                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| Never search for stock              | Every unit has one known location; the app says where to walk      |
| Not ship the wrong thing            | A scan confirms the item before it goes in the box                 |
| Handle exceptions without a meeting | Damaged, short or unlabelled items have a defined place and action |

### Operations and support — one person, at first

Sees everything. Approves sellers, watches the day's orders, builds routes,
answers shoppers, issues refunds, reconciles cash.

| Job to be done                     | What "done" looks like                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| Know what is going wrong right now | A short list of exceptions, not a dashboard of everything   |
| Fix it with one action             | Reassign, reschedule, refund or cancel from the same screen |
| Leave a trail                      | Every manual action is recorded with who and why            |

## One order, end to end

1. **Seller** creates a listing in _Yuntera Vende_ and sends stock to the
   warehouse with an inbound notice.
2. **Warehouse associate** receives the stock in _Yuntera Bodega_, counts it
   against the notice and puts it away. The listing becomes available.
3. **Shopper** searches in _Yuntera_, opens the product, sees the price with
   IVA, the delivery date and who sells it.
4. **Shopper** checks out: confirms the address (pin and _señas_), chooses
   SINPE Móvil, card or cash on delivery, reviews the order summary and
   confirms. Stock is reserved.
5. **Payment** is confirmed by the gateway, or, for cash on delivery, the order
   is accepted after the risk check (`packages/core/src/risk.ts`). The shopper
   receives a receipt and a delivery PIN.
6. **Seller** issues the factura or tiquete electrónico to the shopper (see
   [compliance](../05-security-compliance/compliance-costa-rica.md)).
7. **Warehouse associate** picks and packs the order in _Yuntera Bodega_; the
   parcel is labelled and staged for dispatch.
8. **Operations** builds the day's routes in _Yuntera Central_ and assigns them
   to drivers.
9. **Driver** loads the parcels, starts the route in _Yuntera Ruta_; the shopper
   is told the order is on its way.
10. **Driver** arrives, hands over the parcel, enters the shopper's PIN and, for
    cash orders, records the cash collected.
11. **Shopper** sees the order as delivered and can review the product once
    they have had it.
12. **Driver** closes the route and hands in cash; **operations** reconciles it
    the same day.
13. **Seller** is paid on the next payout date, with a statement itemising
    every fee (`packages/core/src/fees.ts`).

Order and shipment states and the transitions allowed between them are defined
in `packages/core/src/lifecycle.ts`.

## Failure cases and how they are handled

The principle in every case: **the shopper is told first, in plain words, with
their options; nobody is left guessing.**

| Case                                                                             | What happens                                                                                                                                                                                                                                                                                                                                                     | Who bears the cost                                                                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Payment not received** — the shopper chose SINPE Móvil but no transfer arrives | The order waits as _Esperando el pago_ and holds the stock for a short, stated window (assumption to validate: 30 minutes). One reminder is sent. When the window closes the order is cancelled and the stock released. A transfer that arrives after cancellation is refunded in full                                                                           | Nobody                                                                                                                                     |
| **Out of stock after the order** — the unit cannot be found or is damaged        | The shopper is offered, in this order: wait for a stated new date, a substitute they approve, or cancellation of that item with a full refund. Never a silent substitution. The seller's cancellation rate is affected if the stock was theirs to count                                                                                                          | Seller if the count was wrong; Yuntera if the warehouse lost or damaged it                                                                 |
| **Nobody home**                                                                  | The driver calls and messages before leaving, records the failed attempt with a reason, and the parcel returns to the warehouse. The shopper chooses a new delivery day. After a second failed attempt the order is cancelled and refunded less the shipping charge (assumption to validate, and to confirm with the lawyer)                                     | Yuntera for the first re-attempt                                                                                                           |
| **Wrong or damaged item**                                                        | The shopper reports it with a photo. Yuntera collects the item at no charge and sends the right one, or refunds in full, at the shopper's choice. This falls under the legal warranty, where the burden of proof is on the merchant                                                                                                                              | Whoever caused it: seller for a wrong or defective item, Yuntera for transit or picking errors                                             |
| **Return within the withdrawal period**                                          | The shopper may withdraw without giving a reason. The law gives 8 business days from the sale; Yuntera's policy counts **8 business days from delivery**, which is always at least as generous and is simpler to explain. Refund within 8 calendar days by the same payment method. Legal exceptions apply: used consumables, perishables, made-to-measure goods | Return shipping is an [open question](../08-open-questions.md); the default assumed is that Yuntera collects at no charge during the pilot |
| **Late against the promised date**                                               | The shopper is told before the date passes, not after, and offered: keep the order with a new date, or cancel with a full refund. Missing the promised date gives the shopper that right by law                                                                                                                                                                  | Yuntera                                                                                                                                    |

Legal references for the last three rows are in the
[fact sheet, section 3](../research/costa-rica-fact-sheet.md#3-consumer-protection).
