// The product words the native journeys look for: the word of each status
// (SISTEMA.md §4.3, §20.5 rule 1). One file, so a word changed on screen is
// one edit here.
//
// Today these are the words the screens show now. When packages/core has
// status-words.ts (step 1b), switch the one line marked SWITCH below to read
// it. `word()` then asks core first and falls back to the table below
// whenever core has no word: core throws for a kind or value it does not
// hold, or returns nothing. Four kinds here are not database statuses and
// core is not expected to hold them: order_stopping, queued_action,
// variant_status and listing_edit. They keep working from this table after
// the switch (lib/words.test.cjs proves it with a stand-in core).
//
// Expected export of core (CommonJS-loadable from plain node):
//
//   statusWord(kind, value, { viewer, locale, attemptCount? }) → { sign, word }
//
// with `kind` the enum or table name of §4.3 without the viewer
// ("order_status", "shipment_status", "stop_status", "offer_status",
// "product_status", …), `viewer` one of "shopper", "seller", "staff",
// "driver", "warehouse", and `locale` "es". The journeys ask for the viewer
// "warehouse" (the warehouse app's board); if core names that viewer
// "staff", map it in `askCore` below.
//
// Plain node cannot require a .ts file that imports "./dates" without an
// extension, so the switch needs core loadable as CommonJS (a built file, or
// a runner with a TypeScript loader). Switching in a core whose words differ
// from today's screens makes the journeys fail until those screens move.

// SWITCH: replace `null` with require("<path to core's status words, loadable from node>")
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
  // The warehouse board's words for a parcel (apps/warehouse-native labels).
  shipment_status: {
    warehouse: {
      pending: "Por alistar",
      packed: "Empacado",
    },
  },
  stop_status: {
    driver: {
      arrived: "En la puerta",
      skipped: "Omitida",
    },
  },
  // Not a database value: an action the drivers' app keeps until it has signal.
  queued_action: {
    driver: {
      pending: "Por enviar",
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
      active: "Publicado y a la venta",
    },
  },
  // A variant (size, colour) of a product the seller stopped offering.
  variant_status: {
    seller: {
      retired: "Retirada",
    },
  },
  // A change to a published product, waiting for staff (seller_listing_edits).
  listing_edit: {
    seller: {
      pending: "Cambios en revisión",
    },
  },
};

/** Today's word, or an error that names what is missing. */
function todayWord(kind, value, viewer) {
  const found = TODAY[kind]?.[viewer]?.[value];
  if (!found) throw new Error(`words.cjs has no word for ${kind} ${value} (${viewer})`);
  return found;
}

/** Core's word, or undefined when core has none for this kind, value or viewer. */
function askCore(source, kind, value, viewer) {
  try {
    return source.statusWord(kind, value, { viewer, locale: "es" })?.word || undefined;
  } catch {
    return undefined;
  }
}

/** A `word()` that asks `source` (core, or null) first and falls back to today's table. */
function makeWord(source) {
  return function word(kind, value, viewer) {
    if (source) {
      const fromCore = askCore(source, kind, value, viewer);
      if (fromCore) return fromCore;
    }
    return todayWord(kind, value, viewer);
  };
}

/** The word of a status value for a viewer, as the screen shows it. */
const word = makeWord(core);

/**
 * Sentences that carry a status but are not one word: what the order says
 * about a return line (apps/shop-native/src/lib/returns.ts). Core has no
 * sentences, so these stay here until the app reads them from core.
 */
const RETURN_LINES = {
  withdrawn: "Retirada: usted retiró esta solicitud.",
};
const returnLine = (state) => RETURN_LINES[state];

module.exports = { TODAY, makeWord, returnLine, word };
