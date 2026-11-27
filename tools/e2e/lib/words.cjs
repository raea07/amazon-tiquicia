// The status words of the product, in ONE place for every browser journey
// (rule 20.5.1 of docs/brand/system/SISTEMA.md): an order, a parcel, a
// return, a payout… is named on screen by these words, so a journey that
// checks a state asks this file for the word instead of writing it
// (`node tools/e2e/selectors.mjs --check` fails on a status word written as
// a literal in a journey or a helper).
//
// Every status word comes from packages/core/src/status-words.ts, the module
// the apps read (§4.3): `statusWord(kind, value, { viewer, locale,
// attemptCount? })` → `{ sign, word }`. That file has no run-time import, so
// plain node loads it as it is (Node 22 strips the types).
//
// SCREEN_ONLY keeps the few words of today's screens that §4.3 has no state
// for (a whole order's heading, the shopper's refund panel). They stay here
// until core or a rebuilt screen gives them a state.
// `node tools/e2e/check-words.cjs` checks both.
//
// Every call names its viewer ("shopper" | "seller" | "staff" | "driver" |
// "warehouse"): §4.3 gives some states a different word for each, so a call
// without one throws.

/** The file of core's status words. */
const CORE_PATH = `${__dirname}/../../../packages/core/src/status-words.ts`;

const VIEWERS = ["shopper", "seller", "staff", "driver", "warehouse"];

/**
 * Words of today's screens that §4.3 has no state for: kind → value → word,
 * or { viewer: word } when only some viewers read it.
 */
const SCREEN_ONLY = {
  // What the shopper's order heading and list row say of a whole order.
  order_summary: {
    // Its only parcels were taken off a route (attempt_count 0).
    rescheduled: { shopper: "Entrega reprogramada" },
    // Its parcels were stopped or sent back: it is being cancelled.
    cancelling: "Se está cancelando",
  },
  // A refund as the shopper's order page states it (apps/web payment-panel.tsx).
  shopper_refund: {
    pending: { shopper: "En camino" },
    succeeded: { shopper: "Completado" },
  },
};

const pick = (entry, viewer) =>
  typeof entry === "object" && entry !== null ? (entry[viewer] ?? entry._) : entry;

let core;
/** Core's module, loaded once. */
function loadCore(path = CORE_PATH) {
  if (core?.path === path) return core.module;
  core = { path, module: require(path) };
  return core.module;
}

/** The sign and the word of a state, as `viewer` reads it. */
function statusWord(kind, value, options = {}) {
  const { viewer } = options;
  if (!VIEWERS.includes(viewer)) {
    throw new Error(
      `word(${kind}, ${value}): name the viewer (${VIEWERS.join(", ")}), got ${viewer}`,
    );
  }
  const fromCore = loadCore();
  if (Object.hasOwn(fromCore.STATUS_WORDS, kind)) {
    const { sign, word } = fromCore.statusWord(kind, value, { locale: "es", ...options });
    return { sign, word };
  }
  const word = pick(SCREEN_ONLY[kind]?.[value], viewer);
  if (typeof word !== "string") {
    throw new Error(`no status word for ${kind}.${value} (${viewer}) in tools/e2e/lib/words.cjs`);
  }
  return { sign: null, word };
}

/** Just the word: what a journey compares with the screen. */
const word = (kind, value, options) => statusWord(kind, value, options).word;

/**
 * Every status word a journey could write as a literal, for the check in
 * selectors.mjs: the Spanish words of core for every kind and viewer, the
 * derived words, and SCREEN_ONLY.
 */
function allWords() {
  const out = new Set();
  const add = (entry) => {
    if (typeof entry === "string") out.add(entry);
    else for (const w of Object.values(entry)) out.add(w);
  };
  for (const values of Object.values(SCREEN_ONLY)) for (const e of Object.values(values)) add(e);
  const fromCore = loadCore();
  for (const kind of fromCore.STATUS_KINDS) {
    for (const viewer of VIEWERS) {
      for (const w of Object.values(fromCore.statusWordMap(kind, viewer))) out.add(w);
    }
  }
  for (const entry of Object.values(fromCore.DERIVED_STATUS_WORDS)) out.add(entry.es);
  return [...out];
}

module.exports = { statusWord, word, allWords, loadCore, SCREEN_ONLY, VIEWERS };
