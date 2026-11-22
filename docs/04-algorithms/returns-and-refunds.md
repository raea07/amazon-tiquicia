# Returns and refunds

When money goes back to a shopper, how much, and what makes it impossible
for the same money to go back twice. Written after the security review of
21 November 2026, which found three ways to refund an order twice or for more
than was paid; this document is the rule that closes all of them at once.

- Implementation: `supabase/migrations/20261121082900_integrity.sql`
  (`private.refund_units`, `private.post_order_refund`, the register
  `private.refunds`, the return triggers, `request_return`,
  `ops_decide_return`, `ops_receive_return`, `ops_complete_return`,
  `cancel_order`, `wms_receive_returned_shipment`, and for cash on delivery
  `private.cod_due_minor`, `private.replan_cod`,
  `private.settle_returned_parcels_at_door`)
- Tests: `supabase/tests/115_integrity.sql` (one block per finding, with the
  invariants after each); `packages/db/src/contract.integrity.test.ts` (the
  same rules with two database sessions at once)
- Neighbour: [fees and settlement](fees-and-settlement.md) says how a capture
  and a refund are booked in the ledger

## The rule in one paragraph

Money comes back for **units**, never for "an order" in general. Each refund
names the thing it refunds (a cancelled order, one return request, or one
parcel that came back) and is written to a register with the units it gives
back. The register refuses the same thing twice, more units of a line than the
shopper bought, and more money than was collected for the order. The ledger
refuses, when the transaction commits, a refund that is not in the register.
So whichever screen, function or future integration tries to move money back,
it either goes through the register or nothing is saved.

## What a shopper may ask for, by state

**Waiting for payment** (`pending_payment`, `payment_review`). The shopper or
staff may cancel. Nothing was collected, so no money moves.

**Paid, nothing started** (`confirmed`). The shopper or staff may cancel. The
capture is reversed in full.

**Being picked** (`processing`, parcels `picking`). The shopper asks support;
staff may cancel, and the picked units go back to their shelf. The capture is
reversed in full.

**A parcel is packed, on a route or out for delivery.** Nobody can cancel any
more. The shopper may refuse the parcel at the door, or withdraw after
delivery. No money moves until a parcel is delivered or comes back. The
console says so where the cancel form used to be.

**A parcel came back undelivered** (`returning`). The warehouse checks it in
(`wms_receive_returned_shipment`, from the warehouse board or the order page).
Its units are refunded if they were paid for; on a cash order not yet paid,
the cash still to collect drops instead (see below).

**Units delivered.** The shopper may withdraw (no reason, within the legal
window) or claim (damaged, wrong item, warranty). Staff decide a claim, record
the goods back and refund those units once the goods are back.

**Cancelled or refunded.** Nothing more; it is settled.

A **withdrawal** (the legal right to change one's mind, arts. 72–75 of the
consumer-law regulation) is approved the moment it is asked, but only for
units the shopper has received. Before delivery the same wish is a
cancellation, and the screen says so. Our policy restarts the 8-business-day
window at delivery, so a shopper who could not cancel any more loses nothing
by waiting for the parcel.

A **claim** waits for staff to approve or refuse it, with a written reason.
While it waits, the shopper may **withdraw** it (`withdraw_return_request`,
from the order page in the shop and the app): it closes like a refusal, its
units are free again, and the order says "Retirada" instead of a reason.
Once staff decided, or for a withdrawal of the purchase (approved at once),
withdrawing is refused (`return_not_withdrawable`); support stops those.

Asking again for units already in a return is refused with its own message
(`units_already_in_return`), and asking for more than were received with
another (`return_more_than_received`); both used to answer the cart's
`invalid_quantity`.

## The steps of a return

```
requested ──approve──▶ approved ──goods back──▶ received ──refund──▶ refunded
    │                     │
    └──refuse──▶ rejected ◀┘ close: the goods never came (also when the order is cancelled)
```

`rejected` and `refunded` are final. A trigger refuses every other step,
whoever writes it, and refuses any direct write of a return's status by a
signed-in user or a visitor: only the functions move a return. A second
trigger refuses, on any write, more units in open or refunded returns than the
line has.

The refund waits for the goods. Once a return is approved, Yuntera contacts
the shopper and collects the product on a delivery route at no charge to them
([customer service](../06-operations/customer-service.md)); the shopper's
order page says so for each return, and says what it is waiting for at every
step after that. Staff record that the goods arrived and in what state: in
good condition they go back into the warehouse stock they left from (with a
stock movement), damaged ones are recorded and stay out. A line the seller
ships from their own shop goes back to the seller, who counts it.

If the product never comes back, staff **close** the approved return
(`ops_decide_return` with a refusal) with a reason the shopper reads on their
order. Closing frees its units, so a later claim on the same unit is possible.

## How much goes back

| Path                    | The shopper gets back                | The seller gives back                                                                   |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Cancelling a paid order | Everything paid, shipping included   | Everything: the capture is reversed entry by entry                                      |
| A return                | The unit price × units returned      | What they were paid for those units; their commission comes back, the other fees do not |
| A parcel that came back | The unit price × units in the parcel | Same as a return                                                                        |

The payment and warehouse fees are not returned to the seller on a return:
those services were provided.

Shipping is not refunded when a parcel comes back undelivered: the delivery
was attempted. **This is a policy choice for the owner to confirm**, like the
one in [fees and settlement](fees-and-settlement.md) about which fees a
refund returns to the seller.

When every parcel of an order came back and none was delivered, the order is
cancelled (the only way an order on its way can become cancelled).

## Cash on delivery

A cash order is paid once, at the **first parcel handed over**, whichever it
is. The amount is what is owed at that moment: the order total less the goods
of every parcel that has already come back, or is on its way back, without
being delivered. Shipping stays, because something is being delivered.

- The amount on the driver's stops is a plan. It is worked out again when a
  stop fails, when a parcel starts back, when it is checked in, and at the door
  itself: if the driver hands over a parcel whose stop did not carry the cash,
  the cash moves to that stop and the driver is told how much to collect. A
  parcel is never handed over without the cash, and the cash never includes
  goods that are back on the shelf.
- The capture books the whole order. The parcels that came back before the
  cash was collected are then registered as refunded **at the door**: through
  the register (so they can never be refunded again), out of the driver's cash
  account rather than owed to the shopper, and with a
  `refund.settled_at_door` event instead of `refund.requested`, because no
  money is to be sent. The driver's cash account then holds exactly what the
  driver took.
- A parcel that comes back **after** the cash was collected is refunded like
  any other (`refund.requested`): the shopper paid for it at the first door.

Whatever the order of events, the shopper ends up paying for the goods
delivered plus shipping. The tests check that equality after each sequence.

## What is recorded so it cannot happen twice

| Record                                 | Says                                                    | Refuses                                                       |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `private.refunds`                      | Order, reason, the thing refunded, amount, ledger entry | The same reason and thing twice (unique); more than collected |
| `private.refund_units`                 | The units of each line each refund gave back            | More units of a line than were bought                         |
| `ledger_transactions` (deferred check) | —                                                       | A refund transaction that is not in the register              |
| `ledger_transactions` (unique indexes) | —                                                       | A second capture, or a second full reversal, of an order      |
| `return_requests` triggers             | —                                                       | Steps outside the diagram; direct writes; units over the line |

A payment's status follows: `partially_refunded` after a part, `refunded`
once everything collected has gone back. Every refund emits a
`refund.requested` event with its amount, for the integration that moves the
money (gateway refund or transfer), except a refund settled at the door, which
emits `refund.settled_at_door`.

## Two calls at once

Every function that moves an order's money takes the order's row lock first,
then what hangs from it: requesting, deciding, receiving and refunding a
return, cancelling, confirming a payment, planning a route that collects cash,
completing or failing a stop, sending a parcel back and checking it in. So a
second call waits for the first and then sees what it left. Money owed to one
seller is changed by one transaction at a time (a lock per seller), so a
refund and the payment of that seller's payout cannot pass each other: a
payout is refused when refunds since it was scheduled leave less than it.

## Known limits

- An order with one parcel delivered and the others returned is **delivered**
  once its last parcel ends (migration 083200, decision 32); the shopper can
  return the delivered units, and each seller's hold still starts when that
  seller's own parcels ended (`seller_order_settled_at`), so no payout changed.
- Nothing moves the money itself: refunds are booked and announced. The
  gateway integration that sends them is not built. "Refund completed" is
  announced only on a recorded confirmation (`private.confirm_refund`; at
  commit in sandbox mode), which the gateway work must call in live mode
  (decision 34). The shopper is told when a return is approved (with how the
  product is collected) and when its goods are back.
- Staff cannot cancel once a parcel is packed. Stopping such an order means
  letting the parcel come back through the check-in.
- A cash order whose first delivered parcel collects the whole amount, and
  whose other parcel then comes back, owes the shopper a refund by transfer
  for that parcel (the customer-service guide says how a cash refund is paid).
