# Returns and refunds

When money goes back to a shopper, how much, and what makes it impossible
for the same money to go back twice. Written after the security review of
21 November 2026, which found three ways to refund an order twice or for more
than was paid; this document is the rule that closes all of them at once.

- Implementation: `supabase/migrations/20261121082900_integrity.sql`
  (`private.refund_units`, `private.post_order_refund`, the register
  `private.refunds`, the return triggers, `request_return`,
  `ops_receive_return`, `ops_complete_return`, `cancel_order`,
  `wms_receive_returned_shipment`)
- Tests: `supabase/tests/115_integrity.sql` (one block per finding, with the
  invariants after each); `packages/db/src/contract.integrity.test.ts` (the
  same rules with two database sessions at once)
- Neighbour: [fees and settlement](fees-and-settlement.md) says how a capture
  and a refund are booked in the ledger

## The rule in one paragraph

Money comes back for **units**, never for "an order" in general. Each refund
names the thing it refunds — a cancelled order, one return request, or one
parcel that came back — and is written to a register with the units it gives
back. The register refuses the same thing twice, more units of a line than the
shopper bought, and more money than was collected for the order. The ledger
refuses, when the transaction commits, a refund that is not in the register.
So whichever screen, function or future integration tries to move money back,
it either goes through the register or nothing is saved.

## What a shopper may ask for, by state

| The order is…                                            | Shopper may                                                           | Staff may                                                      | Money                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Waiting for payment (`pending_payment`, `payment_review`) | Cancel                                                                | Cancel                                                         | Nothing was collected; nothing moves            |
| Paid, nothing started (`confirmed`)                      | Cancel                                                                | Cancel                                                         | Full reversal of the capture                    |
| Being picked (`processing`, parcels `picking`)           | Ask support                                                           | Cancel: picked units go back to their shelf                    | Full reversal of the capture                    |
| A parcel is packed, on a route or out for delivery       | Nothing yet (refuse it at the door, or withdraw after delivery)       | Nothing: too late to cancel                                    | None until a parcel is delivered or comes back  |
| A parcel came back undelivered (`returning`)             | —                                                                     | Check it in (`wms_receive_returned_shipment`)                  | Its units are refunded                          |
| Units delivered                                          | Withdraw (no reason, within the legal window) or claim (damaged, wrong item, warranty) | Decide a claim; record the goods back; refund      | Those units, once the goods are back            |
| Cancelled or refunded                                    | Nothing                                                               | Nothing                                                        | Already settled                                 |

A **withdrawal** (the legal right to change one's mind, arts. 72–75 of the
consumer-law regulation) is approved the moment it is asked, but only for
units the shopper has received. Before delivery the same wish is a
cancellation, and the screen says so. Our policy restarts the 8-business-day
window at delivery, so a shopper who could not cancel any more loses nothing
by waiting for the parcel.

A **claim** waits for staff to approve or refuse it, with a written reason.

## The steps of a return

```
requested ──approve──▶ approved ──goods back──▶ received ──refund──▶ refunded
    │                     │
    └──refuse──▶ rejected ◀┘ (also when the order is cancelled)
```

`rejected` and `refunded` are final. A trigger refuses every other step,
whoever writes it, and refuses any direct write of a return's status by a
signed-in user or a visitor: only the functions move a return. A second
trigger refuses, on any write, more units in open or refunded returns than the
line has.

The refund waits for the goods. Staff record that they arrived and in what
state: in good condition they go back into the warehouse stock they left from
(with a stock movement), damaged ones are recorded and stay out. A line the
seller ships from their own shop goes back to the seller, who counts it.

## How much goes back

| Path                       | The shopper gets back                             | The seller gives back                                                     |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Cancelling a paid order    | Everything paid, shipping included                | Everything: the capture is reversed entry by entry                         |
| A return                   | The unit price × units returned                   | What they were paid for those units; the commission on them comes back to them, the payment and warehouse fees do not (those services were provided) |
| A parcel that came back    | The unit price × units in the parcel              | Same as a return                                                          |

Shipping is not refunded when a parcel comes back undelivered: the delivery
was attempted. **This is a policy choice for the owner to confirm**, like the
one in [fees and settlement](fees-and-settlement.md) about which fees a
refund returns to the seller.

When every parcel of an order came back and none was delivered, the order is
cancelled (the only way an order on its way can become cancelled).

## What is recorded so it cannot happen twice

| Record                                | Says                                                    | Refuses                                                     |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `private.refunds`                     | Order, reason, the thing refunded, amount, ledger entry | The same reason and thing twice (unique); more than collected |
| `private.refund_units`                | The units of each line each refund gave back            | More units of a line than were bought                       |
| `ledger_transactions` (deferred check) | —                                                       | A refund transaction that is not in the register           |
| `ledger_transactions` (unique indexes) | —                                                       | A second capture, or a second full reversal, of an order    |
| `return_requests` triggers            | —                                                       | Steps outside the diagram; direct writes; units over the line |

A payment's status follows: `partially_refunded` after a part, `refunded`
once everything collected has gone back. Every refund emits a
`refund.requested` event with its amount, for the integration that moves the
money (gateway refund or transfer).

## Two calls at once

Every function that moves an order's money takes the order's row lock first,
then what hangs from it: requesting, deciding, receiving and refunding a
return, cancelling, confirming a payment, planning a route that collects cash.
So a second call waits for the first and then sees what it left. Money owed to
one seller is changed by one transaction at a time (a lock per seller), so a
refund and the payment of that seller's payout cannot pass each other: a
payout is refused when refunds since it was scheduled leave less than it.

## Known limits

- An order with one parcel delivered and another returned stays "shipped" as a
  whole, as before; the shopper can still return the delivered units, and the
  seller's hold starts from the last parcel (see `seller_order_settled_at`).
  Its withdrawal window is the one set at purchase, not extended at delivery.
- Nothing moves the money itself: refunds are booked and announced. The
  gateway integration that sends them is not built.
- Staff cannot cancel once a parcel is packed. Stopping such an order means
  letting the parcel come back through the check-in.
