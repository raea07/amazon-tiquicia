/**
 * Shopper follow-ups (migration 20261121084600_shopper_followups.sql).
 *
 * The cart's alternative for a line that can no longer be bought now says
 * when it would arrive: `cartAlternatives` replaces the seller-listings
 * method of the same name (this area is spread after it), takes the district
 * the cart is priced for, and its answer carries `promise`, the same date the
 * offer's product page gives for that district at the same moment, or null
 * (no district, a zone switched off, a district not served). The field is
 * optional, so an answer without it still parses, and the type stays a
 * `CartAlternative` with one more field.
 *
 * The refund messages of the same migration change nothing here: they are
 * planned in the database and rendered by packages/notifications. The
 * migration raises no new error code.
 */

import { z } from "zod";
import { cartAlternative } from "./seller-listings";
import type { Caller, Messages } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** When an offer would arrive, as the product page says it. */
export const deliveryPromise = z.object({ earliest: date, latest: date });
export type DeliveryPromise = z.infer<typeof deliveryPromise>;

/** Another shop's offer for a cart line, with when it would arrive in the cart's district. */
export const datedCartAlternative = cartAlternative.extend({
  /** Null where the product page gives no date; missing from an older database. */
  promise: deliveryPromise.nullable().optional(),
});
export type DatedCartAlternative = z.infer<typeof datedCartAlternative>;

export const shopperFollowupsErrors = {} as const satisfies Messages;

export const shopperFollowupsApi = ({ call }: Caller) => ({
  /**
   * For each cart line that cannot be bought, another shop's offer of the
   * same variant, with its delivery date in `postalCode` (the district the
   * cart is priced for). Needs no account. Replaces the seller-listings
   * method.
   */
  cartAlternatives: (offerIds: string[], postalCode?: string | null) =>
    call(
      "cart_alternatives",
      postalCode ? { p_offer_ids: offerIds, p_postal_code: postalCode } : { p_offer_ids: offerIds },
      z.array(datedCartAlternative),
    ),
});
