// The product words the native journeys look for: the word of each status
// (SISTEMA.md §4.3, §20.5 rule 1). The status words come from
// packages/core/src/status-words.ts, the module every app reads, so a word
// changed there changes on screen and here at once.
//
// `word(kind, value, viewer)` asks core first and falls back to the table
// below only when core has no word: core throws for a kind or value it does
// not hold. The table holds the four kinds that are not database statuses,
// which core does not hold: order_stopping, queued_action, variant_status and
// listing_edit (lib/words.test.cjs checks that every other kind comes from
// core).
//
// status-words.ts has no run-time import, so plain node loads it as it is
// (Node 22 strips the types).

const core = require("../../../packages/core/src/status-words.ts");

/** Words of the screens that are not database statuses, by kind, viewer and value. */
const TODAY = {
  // Derived, not a database value: an order Central stopped or sent back,
  // while it is being cancelled (apps/shop-native, the shopper's order).
  order_stopping: {
    shopper: {
      cancels: "Se está cancelando",
      held: "Detenido en la bodega",
    },
  },
  // Not a database value: an action the drivers' app keeps until it has signal.
  queued_action: {
    driver: {
      pending: "Por enviar", // not a status word
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

/** A `word()` that asks `source` (core, or null) first and falls back to the table. */
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

module.exports = { TODAY, core, makeWord, returnLine, word };

// ── Wave 9: derived words (a stopped parcel) ───────────────────────────────

/**
 * Core's word of a status that depends on more than its value (the
 * DERIVED_STATUS_WORDS of status-words.ts): `options` are statusWord's, such
 * as `{ stoppedBeforeLeaving: true }` for a parcel that never left.
 */
const derivedWord = (kind, value, viewer, options) =>
  core.statusWord(kind, value, { viewer, locale: "es", ...options }).word;

Object.assign(module.exports, { derivedWord });
