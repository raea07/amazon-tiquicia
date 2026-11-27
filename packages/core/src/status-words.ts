/**
 * The sign and the word of every status the database knows, by who is
 * looking (design system §4.3). One source for the web apps, the phone apps,
 * the messages and the journeys, so changing a word is one edit.
 *
 * A status stamp is shape + word: five signs, the same in every app.
 *
 *   ○ not_yet      `.tag`                         not yet
 *   ◐ in_progress  `.tag.half`                    in progress
 *   ✓ done         `.tag.done` / `.tag.ok`        done (green only for done)
 *   ! attention    `.tag.warn` / `.tag.err`       needs attention
 *   – ended        `.tag.ended`                   ended
 *
 * `tone` says which of the two classes a sign takes where it has two.
 *
 * The words of §4.3 are copied exactly. Where §4.3 has no word for a status
 * the database has (marked «chosen» below), the word is written in the same
 * plain register; the report of the change that added this file lists them.
 *
 * Phase A of the migration (§2.5): no screen reads this module yet. Today's
 * labels (ORDER_STATUS_LABEL in lifecycle.ts, the apps' labels.ts files)
 * keep their words until one change moves every screen and journey here.
 * status-words.test.ts reads the enums and the `check (status in (…))` lists
 * of supabase/migrations and fails when a status has no word.
 */

// Type-only import: this file has no run-time import, so plain Node can load
// it (the browser and native journeys require it directly).
import type { CoreLocaleInput } from "./dates";

export type StatusViewer = "shopper" | "seller" | "staff" | "driver" | "warehouse";
export const STATUS_VIEWERS: readonly StatusViewer[] = [
  "shopper",
  "seller",
  "staff",
  "driver",
  "warehouse",
];

export type StatusSign = "not_yet" | "in_progress" | "done" | "attention" | "ended";
export type StatusTone = "plain" | "half" | "done" | "ok" | "warn" | "err" | "ended";

export const STATUS_SIGN_GLYPH: Readonly<Record<StatusSign, string>> = {
  not_yet: "○",
  in_progress: "◐",
  done: "✓",
  attention: "!",
  ended: "–",
};

const SIGN_OF_TONE: Readonly<Record<StatusTone, StatusSign>> = {
  plain: "not_yet",
  half: "in_progress",
  done: "done",
  ok: "done",
  warn: "attention",
  err: "attention",
  ended: "ended",
};

export interface StatusWord {
  /** One of the five signs of §4.3. */
  sign: StatusSign;
  /** The class variant of the sign (`warn` or `err`, `done` or `ok`). */
  tone: StatusTone;
  /** The sign's glyph: ○ ◐ ✓ ! – */
  glyph: string;
  /** The word on the stamp, in the asked language. */
  word: string;
}

interface Entry {
  readonly tone: StatusTone;
  readonly es: string;
  readonly en: string;
}

const e = (tone: StatusTone, es: string, en: string): Entry => ({ tone, es, en });

/** Where a kind's values live in the database. */
export type StatusSource =
  | { readonly enum: string }
  | { readonly table: string; readonly column: string }
  | { readonly derived: string };

interface KindSpec {
  readonly source: StatusSource;
  readonly words: Readonly<Record<string, Entry>>;
  /** Words that differ for one viewer. */
  readonly byViewer?: Partial<Record<StatusViewer, Readonly<Record<string, Entry>>>>;
}

/** Every status, by kind. The keys of `words` are the database values. */
export const STATUS_WORDS = {
  order_status: {
    source: { enum: "order_status" },
    // Seller, staff, driver and warehouse.
    words: {
      pending_payment: e("warn", "Esperando el pago", "Awaiting payment"),
      payment_review: e("half", "Verificando el pago", "Checking payment"),
      confirmed: e("plain", "Por preparar", "To prepare"),
      processing: e("half", "Preparando", "Preparing"),
      partially_shipped: e("half", "Parte en camino", "Partly on its way"),
      shipped: e("half", "En camino", "On its way"),
      delivered: e("ok", "Entregado", "Delivered"),
      completed: e("ok", "Completado", "Completed"),
      cancelled: e("ended", "Cancelado", "Cancelled"),
      refunded: e("ended", "Reembolsado", "Refunded"),
    },
    byViewer: {
      shopper: {
        pending_payment: e("warn", "Esperando el pago", "Awaiting payment"),
        payment_review: e("half", "Verificando el pago", "Checking your payment"),
        confirmed: e("done", "Pedido confirmado", "Order confirmed"),
        processing: e("half", "Preparando su pedido", "Preparing your order"),
        partially_shipped: e(
          "half",
          "Parte del pedido va en camino",
          "Part of your order is on its way",
        ),
        shipped: e("half", "En camino", "On its way"),
        delivered: e("ok", "Entregado", "Delivered"),
        completed: e("ok", "Entregado", "Delivered"),
        cancelled: e("ended", "Cancelado", "Cancelled"),
        refunded: e("ended", "Reembolsado", "Refunded"),
      },
    },
  },
  shipment_status: {
    source: { enum: "shipment_status" },
    words: {
      pending: e("plain", "Por preparar", "To prepare"),
      picking: e("half", "Preparando", "Preparing"),
      packed: e("half", "Empacado", "Packed"),
      ready_for_dispatch: e("half", "Listo para salir", "Ready to leave"),
      out_for_delivery: e("half", "En camino", "On its way"),
      delivered: e("ok", "Entregado", "Delivered"),
      // With attemptCount 0 (taken off a route): «Reprogramado», see statusWord.
      delivery_failed: e("warn", "No se pudo entregar", "Not delivered"),
      returning: e("warn", "Vuelve a la bodega", "Returning to the warehouse"),
      returned: e("ended", "Devuelto a la bodega", "Back at the warehouse"),
      cancelled: e("ended", "Cancelado", "Cancelled"),
    },
    byViewer: {
      shopper: {
        packed: e("half", "Preparando", "Preparing"),
        ready_for_dispatch: e("half", "Preparando", "Preparing"),
      },
    },
  },
  /** Derived flags of an order (lifecycle.ts); staff only. */
  order_flags: {
    source: { derived: "lifecycle.ts: isOrderBeingStopped, orderAwaitingNewAttempt" },
    words: {
      stopped: e("warn", "Detenido", "Stopped"),
      awaiting_route: e("warn", "Espera otra ruta", "Waiting for another route"),
      needs_attention: e("warn", "Por atender", "Needs attention"),
    },
  },
  payment_status: {
    source: { enum: "payment_status" },
    words: {
      // Cash on delivery: «Se paga al recibir», see statusWord.
      pending: e("warn", "Esperando el pago", "Awaiting payment"),
      authorized: e("half", "Autorizado", "Authorised"),
      captured: e("ok", "Pagado", "Paid"),
      failed: e("err", "Pago rechazado", "Payment declined"),
      cancelled: e("ended", "Anulado", "Voided"),
      refunded: e("ended", "Devuelto", "Refunded"),
      partially_refunded: e("ended", "Devuelto en parte", "Partly refunded"),
    },
  },
  return_requests: {
    source: { table: "public.return_requests", column: "status" },
    words: {
      requested: e("plain", "Por decidir", "To decide"),
      approved: e("half", "Aprobada: por recibir", "Approved: to receive"),
      received: e("half", "Recibida: por devolver el dinero", "Received: refund pending"),
      refunded: e("ok", "Dinero devuelto", "Refunded"),
      rejected: e("ended", "Rechazada", "Declined"),
    },
  },
  complaints: {
    source: { table: "public.complaints", column: "status" },
    words: {
      open: e("plain", "Por responder", "To answer"),
      in_progress: e("half", "En revisión", "In review"),
      resolved: e("ok", "Respondido", "Answered"),
    },
  },
  payouts: {
    source: { table: "public.payouts", column: "status" },
    words: {
      scheduled: e("plain", "Programado", "Scheduled"),
      paid: e("ok", "Transferido", "Transferred"),
      failed: e("err", "No se pudo transferir", "Transfer failed"),
    },
  },
  product_status: {
    source: { enum: "product_status" },
    words: {
      draft: e("plain", "Borrador", "Draft"),
      pending_review: e("half", "En revisión", "In review"),
      active: e("ok", "Publicado", "Published"),
      rejected: e("err", "Rechazado", "Rejected"),
      archived: e("ended", "Archivado", "Archived"),
    },
  },
  offer_status: {
    source: { enum: "offer_status" },
    words: {
      // With stock 0: «Sin existencias», see statusWord.
      active: e("ok", "A la venta", "On sale"),
      paused: e("ended", "En pausa", "Paused"),
      archived: e("ended", "Archivada", "Archived"),
    },
  },
  product_photos: {
    source: { table: "public.product_photos", column: "state" },
    words: {
      uploading: e("half", "Subiendo", "Uploading"),
      pending: e("half", "En revisión", "In review"),
      approved: e("ok", "Publicada", "Published"),
      // The reason follows in a sentence.
      rejected: e("err", "Rechazada", "Rejected"),
      removed: e("ended", "Quitada", "Removed"),
    },
  },
  /** Chosen: §4.3 has no row for logos; the same words as photos. */
  shop_logos: {
    source: { table: "public.shop_logos", column: "state" },
    words: {
      uploading: e("half", "Subiendo", "Uploading"),
      pending: e("half", "En revisión", "In review"),
      approved: e("ok", "Publicado", "Published"),
      rejected: e("err", "Rechazado", "Rejected"),
      removed: e("ended", "Quitado", "Removed"),
    },
  },
  invoice_status: {
    source: { enum: "invoice_status" },
    words: {
      pending: e("plain", "Por enviar", "To send"),
      sent: e("half", "Enviada", "Sent"),
      accepted: e("ok", "Aceptada", "Accepted"),
      rejected: e("err", "Rechazada", "Rejected"),
      voided: e("ended", "Anulada", "Voided"),
    },
  },
  /** Chosen: Hacienda's own answer to an electronic invoice (staff only). */
  hacienda_state: {
    source: { table: "public.electronic_invoices", column: "hacienda_state" },
    words: {
      recibido: e("half", "Recibida por Hacienda", "Received by Hacienda"),
      procesando: e("half", "Hacienda la revisa", "Hacienda is checking it"),
      aceptado: e("ok", "Aceptada por Hacienda", "Accepted by Hacienda"),
      rechazado: e("err", "Rechazada por Hacienda", "Rejected by Hacienda"),
      error: e("warn", "Hacienda no pudo procesarla", "Hacienda could not process it"),
    },
  },
  inbound_status: {
    source: { enum: "inbound_status" },
    words: {
      draft: e("plain", "Por enviar", "To send"),
      in_transit: e("half", "En camino", "On its way"),
      receiving: e("half", "Recibiendo", "Receiving"),
      // With a difference: «Con diferencias», see statusWord.
      received: e("ok", "Recibido", "Received"),
      closed: e("ended", "Cerrado", "Closed"),
      cancelled: e("ended", "Cancelado", "Cancelled"),
    },
  },
  review_status: {
    source: { enum: "review_status" },
    words: {
      pending: e("plain", "Por revisar", "To review"),
      published: e("ok", "Publicada", "Published"),
      rejected: e("ended", "No publicada", "Not published"),
    },
  },
  stop_status: {
    source: { enum: "stop_status" },
    words: {
      pending: e("plain", "Por entregar", "To deliver"),
      arrived: e("half", "En la puerta", "At the door"),
      delivered: e("ok", "Entregado", "Delivered"),
      failed: e("warn", "No se pudo entregar", "Not delivered"),
      skipped: e("ended", "Quitada por Central", "Removed by Central"),
    },
  },
  route_status: {
    source: { enum: "route_status" },
    words: {
      draft: e("plain", "Borrador", "Draft"),
      assigned: e("plain", "Asignada", "Assigned"),
      in_progress: e("half", "En ruta", "On the road"),
      completed: e("ok", "Terminada", "Finished"),
      cancelled: e("ended", "Cancelada", "Cancelled"),
    },
  },
  seller_invitations: {
    source: { table: "public.seller_invitations", column: "status" },
    words: {
      // Past expires_at: «Vencida», see statusWord.
      pending: e("plain", "Pendiente", "Pending"),
      accepted: e("ok", "Aceptada", "Accepted"),
      declined: e("ended", "Rechazada", "Declined"),
      revoked: e("ended", "Retirada", "Withdrawn"),
    },
  },
  seller_change_requests: {
    source: { table: "public.seller_change_requests", column: "status" },
    words: {
      pending: e("half", "En revisión", "In review"),
      approved: e("ok", "Aprobado", "Approved"),
      rejected: e("err", "Rechazado", "Rejected"),
      withdrawn: e("ended", "Retirado", "Withdrawn"),
      replaced: e("ended", "Reemplazado", "Replaced"),
    },
  },
  /** Chosen: §4.3 names shop change requests only; listing changes read the same. */
  product_change_requests: {
    source: { table: "public.product_change_requests", column: "status" },
    words: {
      pending: e("half", "En revisión", "In review"),
      approved: e("ok", "Aprobado", "Approved"),
      rejected: e("err", "Rechazado", "Rejected"),
      withdrawn: e("ended", "Retirado", "Withdrawn"),
    },
  },
  /** Chosen: a seller's new payout details wait for finance; the change-request words. */
  payout_detail_requests: {
    source: { table: "public.payout_detail_requests", column: "status" },
    words: {
      pending: e("half", "En revisión", "In review"),
      approved: e("ok", "Aprobado", "Approved"),
      rejected: e("err", "Rechazado", "Rejected"),
      replaced: e("ended", "Reemplazado", "Replaced"),
    },
  },
  /** Messages of the notification outbox; staff only. */
  notification_deliveries: {
    source: { table: "private.notification_deliveries", column: "status" },
    words: {
      pending: e("half", "Enviando", "Sending"),
      sending: e("half", "Enviando", "Sending"),
      sent: e("half", "Enviado", "Sent"),
      delivered: e("ok", "Entregado", "Delivered"),
      failed: e("warn", "Falló: se reintenta", "Failed: retrying"),
      dead: e("err", "Detenido", "Stopped"),
      skipped: e("ended", "No se envió", "Not sent"),
      expired: e("ended", "No se envió", "Not sent"),
    },
  },
  /** Chosen: the outbox's internal jobs; staff only. */
  outbox_jobs: {
    source: { table: "private.outbox_jobs", column: "status" },
    words: {
      pending: e("half", "En cola", "Queued"),
      done: e("ok", "Procesado", "Processed"),
      dead: e("err", "Detenido", "Stopped"),
    },
  },
  content_reports: {
    source: { enum: "report_status" },
    words: {
      open: e("plain", "Por revisar", "To review"),
      in_review: e("half", "En revisión", "In review"),
      actioned: e("ok", "Atendido", "Acted on"),
      dismissed: e("ended", "Descartado", "Dismissed"),
    },
  },
  /** Chosen: a seller's account. */
  seller_status: {
    source: { enum: "seller_status" },
    words: {
      pending: e("plain", "Por verificar", "To verify"),
      active: e("ok", "Activo", "Active"),
      suspended: e("err", "Suspendido", "Suspended"),
      closed: e("ended", "Cerrado", "Closed"),
    },
    // The seller reads the state of their shop («la tienda»).
    byViewer: {
      seller: {
        pending: e("half", "En revisión", "In review"),
        active: e("ok", "Activa", "Active"),
        suspended: e("err", "Suspendida", "Suspended"),
        closed: e("ended", "Cerrada", "Closed"),
      },
    },
  },
  /** Chosen: the check of a seller's identity. */
  kyc_status: {
    source: { enum: "kyc_status" },
    words: {
      pending: e("plain", "Por verificar", "To verify"),
      verified: e("ok", "Verificado", "Verified"),
      rejected: e("err", "Rechazado", "Rejected"),
    },
    // The seller reads the check of their identity («la identidad»).
    byViewer: {
      seller: {
        pending: e("half", "En verificación", "Being checked"),
        verified: e("ok", "Verificada", "Verified"),
        rejected: e("err", "No verificada", "Not verified"),
      },
    },
  },
  /** Chosen: a driver's account. */
  driver_status: {
    source: { enum: "driver_status" },
    words: {
      pending: e("plain", "Por aprobar", "To approve"),
      active: e("ok", "Activo", "Active"),
      suspended: e("err", "Suspendido", "Suspended"),
      offboarded: e("ended", "Dado de baja", "Deactivated"),
    },
  },
  /** Chosen: stock set aside for an order. */
  reservation_status: {
    source: { enum: "reservation_status" },
    words: {
      active: e("half", "Apartado", "Set aside"),
      consumed: e("ok", "Usado en el pedido", "Used for the order"),
      released: e("ended", "Liberado", "Released"),
    },
  },
  /** Chosen: a warehouse picking task. */
  pick_status: {
    source: { enum: "pick_status" },
    words: {
      open: e("plain", "Por recoger", "To pick"),
      in_progress: e("half", "Recogiendo", "Picking"),
      done: e("ok", "Recogido", "Picked"),
      short: e("warn", "Faltan unidades", "Units missing"),
      cancelled: e("ended", "Cancelado", "Cancelled"),
    },
  },
  /** Chosen: the cash a driver hands in at the end of a route. */
  driver_settlements: {
    source: { table: "public.driver_settlements", column: "status" },
    words: {
      open: e("plain", "Por liquidar", "To settle"),
      settled: e("ok", "Liquidado", "Settled"),
      short: e("err", "Faltó efectivo", "Cash missing"),
    },
  },
  /** Chosen: one try at paying an order at the gateway; staff only. */
  payment_attempts: {
    source: { table: "private.payment_attempts", column: "status" },
    words: {
      creating: e("half", "Preparando el cobro", "Setting up the charge"),
      open: e("plain", "Esperando el pago", "Awaiting payment"),
      processing: e("half", "Confirmando el pago", "Confirming payment"),
      failed: e("err", "Pago rechazado", "Payment declined"),
      succeeded: e("ok", "Pagado", "Paid"),
      review: e("warn", "Por revisar", "To review"),
      cancel_requested: e("half", "Anulando", "Voiding"),
      cancelled: e("ended", "Anulado", "Voided"),
      expired: e("ended", "Vencido", "Expired"),
      error: e("err", "No se pudo crear", "Could not be created"),
    },
  },
  /** Chosen: money the gateway took that a person must settle; staff only. */
  payment_reviews: {
    source: { table: "private.payment_reviews", column: "status" },
    words: {
      open: e("plain", "Por revisar", "To review"),
      accepted: e("ok", "Aceptado", "Accepted"),
      attached: e("ok", "Asignado a un pedido", "Matched to an order"),
      refunding: e("half", "Devolviendo", "Refunding"),
      refunded: e("ended", "Devuelto", "Refunded"),
      dismissed: e("ended", "Descartado", "Dismissed"),
    },
  },
  /** Chosen: a refund on its way back to the shopper; staff only. */
  gateway_refunds: {
    source: { table: "private.gateway_refunds", column: "status" },
    words: {
      requested: e("plain", "Por enviar", "To send"),
      sending: e("half", "Enviando", "Sending"),
      sent: e("half", "Enviado", "Sent"),
      unknown: e("warn", "Sin respuesta", "No answer"),
      succeeded: e("ok", "Devuelto", "Refunded"),
      failed: e("err", "No se pudo devolver", "Refund failed"),
    },
  },
} as const satisfies Record<string, KindSpec>;

export type StatusKind = keyof typeof STATUS_WORDS;
export type StatusValue<K extends StatusKind> = keyof (typeof STATUS_WORDS)[K]["words"] & string;

export const STATUS_KINDS = Object.keys(STATUS_WORDS) as StatusKind[];

/** The database values of a kind, in the order of the table. */
export function statusValues<K extends StatusKind>(kind: K): StatusValue<K>[] {
  return Object.keys(STATUS_WORDS[kind].words) as StatusValue<K>[];
}

export interface StatusWordOptions {
  viewer: StatusViewer;
  locale?: CoreLocaleInput;
  /** shipment_status: the parcel's attempt_count; `delivery_failed` with 0 reads «Reprogramado». */
  attemptCount?: number;
  /** offer_status: the offer's stock; `active` with 0 reads «Sin existencias». */
  stock?: number;
  /** payment_status: the payment's method; `pending` with cash_on_delivery reads «Se paga al recibir». */
  paymentMethod?: string;
  /** stop_status: the stop's pin_attempts_left; 0 on a stop not yet ended reads «Código bloqueado». */
  pinAttemptsLeft?: number;
  /** seller_invitations: `pending` past expires_at reads «Vencida». */
  expired?: boolean;
  /** inbound_status: `received` with a difference reads «Con diferencias». */
  hasDifference?: boolean;
}

/** The words that depend on more than the value (the «+ derived» rows of §4.3). */
const DERIVED = {
  rescheduled: e("half", "Reprogramado", "Rescheduled"),
  outOfStock: e("warn", "Sin existencias", "Out of stock"),
  payOnDelivery: e("plain", "Se paga al recibir", "Pay on delivery"),
  codeLocked: e("err", "Código bloqueado", "Code locked"),
  expiredInvitation: e("ended", "Vencida", "Expired"),
  withDifferences: e("warn", "Con diferencias", "With differences"),
} as const;

/** Every word a stamp can show for a derived case, for tests and journeys. */
export const DERIVED_STATUS_WORDS: Readonly<Record<keyof typeof DERIVED, Entry>> = DERIVED;

function entryFor(kind: StatusKind, value: string, opts: StatusWordOptions): Entry {
  const spec: KindSpec = STATUS_WORDS[kind];
  if (kind === "shipment_status" && value === "delivery_failed" && opts.attemptCount === 0) {
    return DERIVED.rescheduled;
  }
  if (kind === "offer_status" && value === "active" && opts.stock === 0) return DERIVED.outOfStock;
  if (
    kind === "payment_status" &&
    value === "pending" &&
    opts.paymentMethod === "cash_on_delivery"
  ) {
    return DERIVED.payOnDelivery;
  }
  if (
    kind === "stop_status" &&
    (value === "pending" || value === "arrived") &&
    opts.pinAttemptsLeft === 0
  ) {
    return DERIVED.codeLocked;
  }
  if (kind === "seller_invitations" && value === "pending" && opts.expired === true) {
    return DERIVED.expiredInvitation;
  }
  if (kind === "inbound_status" && value === "received" && opts.hasDifference === true) {
    return DERIVED.withDifferences;
  }
  const entry = spec.byViewer?.[opts.viewer]?.[value] ?? spec.words[value];
  if (!entry) throw new RangeError(`No word for ${kind} ${JSON.stringify(value)}`);
  return entry;
}

/**
 * The sign and the word of a status for a viewer:
 * `statusWord("shipment_status", "packed", { viewer: "shopper" })` →
 * `{ sign: "in_progress", tone: "half", glyph: "◐", word: "Preparando" }`.
 */
export function statusWord<K extends StatusKind>(
  kind: K,
  value: StatusValue<K>,
  opts: StatusWordOptions,
): StatusWord {
  const entry = entryFor(kind, value, opts);
  const sign = SIGN_OF_TONE[entry.tone];
  return {
    sign,
    tone: entry.tone,
    glyph: STATUS_SIGN_GLYPH[sign],
    word: opts.locale === "en" ? entry.en : entry.es,
  };
}

/**
 * Like statusWord for a value read at run time (a string from the API):
 * null when the kind has no such value, so a screen can fall back instead of
 * failing.
 */
export function statusWordOf(
  kind: StatusKind,
  value: string,
  opts: StatusWordOptions,
): StatusWord | null {
  if (!Object.hasOwn(STATUS_WORDS[kind].words, value)) return null;
  return statusWord(kind, value as StatusValue<typeof kind>, opts);
}

/**
 * Every word of a kind for one viewer, keyed by database value: for a
 * select, a filter or a history line.
 * `statusWordMap("stop_status", "driver").skipped` → «Quitada por Central».
 */
export function statusWordMap<K extends StatusKind>(
  kind: K,
  viewer: StatusViewer,
  locale?: CoreLocaleInput,
): Readonly<Record<StatusValue<K>, string>> {
  const out = {} as Record<StatusValue<K>, string>;
  for (const value of statusValues(kind)) {
    out[value] = statusWord(kind, value, { viewer, ...(locale ? { locale } : {}) }).word;
  }
  return out;
}

/**
 * The `{ label, tone }` table a screen renders as a badge: the words from
 * here, the colour from the screen's own tone table (until the status stamp
 * of §5.3 replaces the badge). Only the values the tone table names are kept.
 */
export function statusLabels<K extends StatusKind, const T extends string>(
  kind: K,
  viewer: StatusViewer,
  // Keyed by the kind's values; a key the kind lacks throws when the module loads.
  tones: Readonly<Record<string, T>>,
  locale?: CoreLocaleInput,
): Readonly<Record<StatusValue<K>, { label: string; tone: T }>> {
  const out = {} as Record<StatusValue<K>, { label: string; tone: T }>;
  for (const [value, tone] of Object.entries(tones) as [StatusValue<K>, T][]) {
    out[value] = {
      label: statusWord(kind, value, { viewer, ...(locale ? { locale } : {}) }).word,
      tone,
    };
  }
  return out;
}
