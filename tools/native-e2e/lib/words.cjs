// The product words the native journeys look for: the word of each status
// (SISTEMA.md §4.3, §20.5 rule 1). One file, so a word changed on screen is
// one edit here.
//
// Today these are the words the screens show now. When packages/core has
// status-words.ts (step 1b), switch the one line marked SWITCH below to read
// it; `word()` then asks core and the table below is only the fallback for
// the few sentences core does not hold. Expected export of core:
//
//   statusWord(kind, value, { viewer, locale, attemptCount? }) → { sign, word }
//
// with `kind` the enum or table name of §4.3 without the viewer
// ("order_status", "shipment_status", "stop_status", "offer_status",
// "product_status", "return_requests.status", "seller_invitations.status",
// "inbound_status", …), `viewer` one of "shopper", "seller", "staff",
// "driver", and `locale` "es".

// SWITCH: replace `null` with require("../../../packages/core/src/status-words.ts")
const core = null;

/** Today's words, by kind, viewer and value: what the screens say on 27 November 2026. */
const TODAY = {
  order_status: {
    shopper: {
      shipped: "En camino",
    },
  },
  // Derived, not a database value: an order Central stopped or sent back,
  // while it is being cancelled (packages/core lifecycle.ts, shopper words).
  order_stopping: {
    shopper: {
      cancels: "Se está cancelando",
      held: "Detenido en la bodega",
    },
  },
  stop_status: {
    driver: {
      arrived: "En la puerta",
    },
  },
  offer_status: {
    seller: {
      paused: "En pausa",
    },
  },
  product_status: {
    seller: {
      draft: "Borrador",
    },
  },
  // A change to a published product, waiting for staff (seller_listing_edits).
  listing_edit: {
    seller: {
      pending: "Cambios en revisión",
    },
  },
};

/** The word of a status value for a viewer, as the screen shows it. */
function word(kind, value, viewer) {
  if (core) return core.statusWord(kind, value, { viewer, locale: "es" }).word;
  const found = TODAY[kind]?.[viewer]?.[value];
  if (!found) throw new Error(`words.cjs has no word for ${kind} ${value} (${viewer})`);
  return found;
}

/**
 * Sentences that carry a status but are not one word: what the order says
 * about a return line (apps/shop-native/src/lib/returns.ts). Core has no
 * sentences, so these stay here until the app reads them from core.
 */
const RETURN_LINES = {
  withdrawn: "Retirada: usted retiró esta solicitud.",
};
const returnLine = (state) => RETURN_LINES[state];

module.exports = { returnLine, word };
