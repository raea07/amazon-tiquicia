// The status words of the product, in ONE place for every browser journey
// (rule 20.5.1 of docs/brand/system/SISTEMA.md): an order, a parcel, a
// return, a payout… is named on screen by these words, so a journey that
// checks a state asks this file for the word instead of writing it
// (`node tools/e2e/selectors.mjs --check` fails on a status word written as
// a literal in a journey or a helper).
//
// TODAY holds the words the screens show now (read from packages/ui
// commerce.tsx, packages/core lifecycle.ts and the labels files of the apps).
// Its kinds and values carry the names of packages/core/src/status-words.ts
// (step 1b, §4.3): `STATUS_WORDS[kind].words[value]`, and
// `statusWord(kind, value, { viewer, locale, attemptCount? })` → `{ sign, word }`.
//
// THE SWITCH TO CORE is one line: set CORE_PATH below to
//   `${__dirname}/../../../packages/core/src/status-words.ts`
// Every kind core knows is then read from core (with the viewer the journey
// names); SCREEN_ONLY keeps the few words of today's screens that §4.3 has
// no state for. `node tools/e2e/check-words.cjs [path to status-words.ts]`
// checks that every kind and value of TODAY exists in core.
//
// Every call names its viewer ("shopper" | "seller" | "staff" | "driver" |
// "warehouse"): §4.3 gives some states a different word for each, so a call
// without one throws.

/** The file of core's status words; null until the switch (see above). */
const CORE_PATH = null;

const VIEWERS = ["shopper", "seller", "staff", "driver", "warehouse"];

/**
 * kind → value → word, or { viewer: word } when viewers read different words
 * today (`_` is what every other viewer reads). Kind and value names are
 * core's.
 */
const TODAY = {
  order_status: {
    pending_payment: "Esperando el pago",
    payment_review: "Verificando el pago",
    confirmed: "Pedido confirmado",
    processing: "Preparando su pedido",
    partially_shipped: "Parte del pedido va en camino",
    shipped: "En camino",
    delivered: "Entregado",
    completed: "Completado",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
  },
  // The warehouse board of apps/field words its steps its own way today.
  shipment_status: {
    pending: { _: "Por preparar", warehouse: "Por alistar" },
    picking: { _: "En preparación", warehouse: "Alistando" },
    packed: "Empacado",
    ready_for_dispatch: { _: "Listo para salir", warehouse: "En zona de despacho" },
    out_for_delivery: "En camino",
    delivered: "Entregado",
    delivery_failed: "Entrega fallida",
    returning: "De regreso",
    returned: "Devuelto",
    cancelled: "Cancelado",
  },
  // Flags packages/core lifecycle.ts derives for an order (core: order_flags).
  order_flags: {
    // A parcel stopped by staff, as the staff order page and the shopper's say it.
    stopped: {
      staff: "Detenido: vuelve a la zona de devoluciones",
      shopper: "Detenido en la bodega",
    },
    // The staff heading of an order that waits for another route.
    awaiting_route: { staff: "espera otra ruta" },
  },
  payment_status: {
    pending: "Pago pendiente",
    authorized: "Autorizado",
    captured: "Pagado",
    failed: "Pago fallido",
    cancelled: "Pago anulado",
    refunded: "Reembolsado",
    partially_refunded: "Reembolso parcial",
  },
  return_requests: {
    requested: "Por decidir",
    approved: "Aprobada",
    received: "Producto recibido",
  },
  // A payout to a shop (apps/ops people-labels.ts, apps/seller pagos).
  payouts: {
    scheduled: "Por transferir",
    paid: "Pagado",
    failed: "No se pagó",
  },
  product_status: {
    draft: "Borrador",
    pending_review: "En revisión",
    active: "Publicado",
  },
  // A listing's photo in the seller centre (apps/seller photo-manager.tsx).
  product_photos: {
    pending: "En revisión",
    approved: "Aprobada",
    rejected: "Rechazada",
  },
  // A message's delivery, on the staff console (apps/ops notification-labels.ts).
  notification_deliveries: {
    pending: "En cola",
    sending: "Enviando",
    sent: "Enviado",
    delivered: "Entregado",
    failed: "No entregado",
    skipped: "No se envió",
    expired: "Vencido",
    dead: "Detenido",
  },
  // A refund to the gateway, on the staff console (apps/ops payment-labels.ts).
  gateway_refunds: {
    sent: "Enviado, sin confirmar",
  },
  stop_status: {
    pending: "Pendiente",
    arrived: "En la puerta",
    delivered: "Entregado",
    failed: "No entregado",
  },
  driver_status: {
    pending: "Por aprobar",
    active: "Activo",
    suspended: "Suspendido",
    offboarded: "Dado de baja",
  },
};

/** shipment_status delivery_failed with attemptCount 0: a parcel taken off a route. */
const RESCHEDULED = { shopper: "Entrega reprogramada", _: "Quitado de una ruta" };

/**
 * Words of today's screens that §4.3 has no state for; they stay here after
 * the switch until core (or the rebuilt screen) gives them a state.
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

/** Today's word, or undefined. */
function todayWord(kind, value, { viewer, attemptCount }) {
  if (kind === "shipment_status" && value === "delivery_failed" && attemptCount === 0) {
    return pick(RESCHEDULED, viewer);
  }
  return pick((TODAY[kind] ?? SCREEN_ONLY[kind])?.[value], viewer);
}

let core;
/** Core's module, loaded once, when CORE_PATH is set. */
function loadCore(path = CORE_PATH) {
  if (!path) return null;
  if (core?.path === path) return core.module;
  // Core imports its siblings without the .ts ending (a bundler's habit);
  // Node needs it, so it is added for files of packages/core/src.
  const { registerHooks } = require("node:module");
  const { existsSync } = require("node:fs");
  const { fileURLToPath } = require("node:url");
  registerHooks({
    resolve(specifier, context, next) {
      if (
        specifier.startsWith(".") &&
        !/\.\w+$/.test(specifier) &&
        context.parentURL?.includes("/packages/core/src/")
      ) {
        const url = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
      return next(specifier, context);
    },
  });
  core = { path, module: require(path) };
  return core.module;
}

/**
 * The sign and the word of a state, as `viewer` reads it. Signs do not exist
 * on today's screens (§4.3 brings them), so `sign` is null until the switch.
 */
function statusWord(kind, value, options = {}) {
  const { viewer } = options;
  if (!VIEWERS.includes(viewer)) {
    throw new Error(
      `word(${kind}, ${value}): name the viewer (${VIEWERS.join(", ")}), got ${viewer}`,
    );
  }
  const fromCore = loadCore();
  if (fromCore && Object.hasOwn(fromCore.STATUS_WORDS, kind)) {
    const { sign, word } = fromCore.statusWord(kind, value, { locale: "es", ...options });
    return { sign, word };
  }
  const word = todayWord(kind, value, options);
  if (typeof word !== "string") {
    throw new Error(`no status word for ${kind}.${value} (${viewer}) in tools/e2e/lib/words.cjs`);
  }
  return { sign: null, word };
}

/** Just the word: what a journey compares with the screen. */
const word = (kind, value, options) => statusWord(kind, value, options).word;

/** Every word of today's table, for the literal check in selectors.mjs. */
function allWords() {
  const out = new Set();
  const add = (entry) => {
    if (typeof entry === "string") out.add(entry);
    else for (const w of Object.values(entry)) out.add(w);
  };
  for (const table of [TODAY, SCREEN_ONLY]) {
    for (const values of Object.values(table)) for (const e of Object.values(values)) add(e);
  }
  add(RESCHEDULED);
  return [...out];
}

module.exports = { statusWord, word, allWords, loadCore, TODAY, SCREEN_ONLY, VIEWERS };
