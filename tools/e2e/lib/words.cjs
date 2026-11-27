// The status words of the product, in ONE place for every browser journey
// (rule 20.5.1 of docs/brand/system/SISTEMA.md): an order, a parcel, a
// return, a payout… is named on screen by these words, so a journey that
// checks a state asks this file for the word instead of writing it.
//
// Today the table below holds the words the screens show now (read from
// packages/ui/src/commerce.tsx, packages/core/src/lifecycle.ts and the labels
// files of the apps). When packages/core/src/status-words.ts exists (step 1b,
// §4.3), the switch is one change in `statusWord` at the bottom:
//
//   const core = require("../../../packages/core/src/status-words.ts");
//   function statusWord(kind, value, options = {}) {
//     return core.statusWord(kind, value, { locale: "es", viewer: "shopper", ...options });
//   }
//
// Node 22.18 and later loads a .ts file with require() (types are stripped),
// as long as that file imports nothing by a path without its extension.
// The shape expected from core is §4.3's:
//   statusWord(kind, value, { viewer, locale, attemptCount? }) → { sign, word }
// with `kind` one of the keys of TODAY below (the enum or table the value
// belongs to), `viewer` one of "shopper" | "seller" | "staff" | "driver" |
// "warehouse". Two kinds here are not enums: `rescheduled` is what
// shipment_status delivery_failed with attemptCount 0 reads (core takes
// that as an option, as statusWord here does), and `derived` holds states
// the screens compute (lifecycle.ts); the integrator maps those two to
// whatever names core gives them.
//
// Only the words that change in §4.3 make a journey's expectation move; a
// journey never writes a status word itself.

/**
 * kind → value → word, or { viewer: word } when viewers read different words.
 * `derived` holds states the screens compute (packages/core lifecycle.ts).
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
  // `_` is the word every viewer reads unless one is named (the warehouse
  // board of apps/field words its steps its own way today).
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
  payment_status: {
    pending: "Pago pendiente",
    authorized: "Autorizado",
    captured: "Pagado",
    failed: "Pago fallido",
    cancelled: "Pago anulado",
    refunded: "Reembolsado",
    partially_refunded: "Reembolso parcial",
  },
  return_status: {
    requested: "Por decidir",
    approved: "Aprobada",
    received: "Producto recibido",
  },
  // A message's delivery (apps/ops/src/lib/notification-labels.ts).
  notification_status: {
    pending: "En cola",
    sending: "Enviando",
    sent: "Enviado",
    delivered: "Entregado",
    failed: "No entregado",
    skipped: "No se envió",
    expired: "Vencido",
    dead: "Detenido",
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
  product_status: {
    draft: "Borrador",
    pending_review: "En revisión",
    active: "Publicado",
  },
  // shipment_status delivery_failed with attempt_count 0 (taken off a route).
  rescheduled: {
    shopper: "Entrega reprogramada",
    staff: "Quitado de una ruta",
  },
  derived: {
    // An order whose only parcels were taken off a route (attempt_count 0).
    rescheduled: "Entrega reprogramada",
    // An order whose parcels were stopped or sent back: it is being cancelled.
    cancelling: "Se está cancelando",
    // The staff heading of an order that waits for another route.
    awaitingRoute: "espera otra ruta",
    // A parcel stopped by staff, on the staff order page and the shopper's.
    stoppedStaff: "Detenido: vuelve a la zona de devoluciones",
    stoppedShopper: "Detenido en la bodega",
  },
};

/**
 * The sign and the word of a state, as `viewer` reads it. Signs do not exist
 * on today's screens (§4.3 brings them), so `sign` is null until the switch.
 */
function statusWord(kind, value, { viewer = "shopper", attemptCount } = {}) {
  // A parcel taken off a route counts no attempt: it is not a failed delivery.
  const rescheduled =
    kind === "shipment_status" && value === "delivery_failed" && attemptCount === 0;
  const entry = rescheduled ? TODAY.rescheduled : TODAY[kind]?.[value];
  const word = typeof entry === "object" && entry !== null ? (entry[viewer] ?? entry._) : entry;
  if (typeof word !== "string") {
    throw new Error(`no status word for ${kind}.${value} (${viewer}) in tools/e2e/lib/words.cjs`);
  }
  return { sign: null, word };
}

/** Just the word: what a journey compares with the screen. */
const word = (kind, value, options) => statusWord(kind, value, options).word;

module.exports = { statusWord, word };
