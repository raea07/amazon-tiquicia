/**
 * Errors the API can return, and what to tell a person when they happen.
 *
 * The database raises short machine codes ("insufficient_stock"). Every code is
 * listed here with a message in Spanish and English. A test reads the SQL
 * migrations and fails if a code is ever raised that has no message, so a user
 * is never shown a raw code.
 *
 * Spanish copy addresses the reader as "usted", the everyday register in Costa
 * Rica, and says what to do next wherever there is something to do.
 */

export type Locale = "es-CR" | "en";

import { areaErrors, lockConflictCode } from "./areas";
import type { Messages } from "./areas/types";

const CORE_MESSAGES = {
  // ── Session ──
  not_authenticated: {
    "es-CR": "Inicie sesión para continuar.",
    en: "Sign in to continue.",
  },
  forbidden: {
    "es-CR": "Su cuenta no tiene permiso para hacer esto.",
    en: "Your account is not allowed to do this.",
  },

  // ── Cart and checkout ──
  cart_empty: {
    "es-CR": "Su carrito está vacío.",
    en: "Your cart is empty.",
  },
  invalid_quantity: {
    "es-CR": "Revise las cantidades: hay un máximo por producto en cada pedido.",
    en: "Check the quantities: there is a limit per product in each order.",
  },
  too_many_lines: {
    "es-CR": "El pedido tiene demasiados productos distintos. Divídalo en dos pedidos.",
    en: "The order has too many different products. Split it into two orders.",
  },
  offer_unavailable: {
    "es-CR": "Uno de los productos ya no está disponible. Quítelo del carrito para continuar.",
    en: "One of the products is no longer available. Remove it from the cart to continue.",
  },
  insufficient_stock: {
    "es-CR": "No quedan suficientes unidades de uno de los productos. Ajuste la cantidad.",
    en: "There are not enough units left of one of the products. Adjust the quantity.",
  },
  price_changed: {
    "es-CR": "Un precio cambió mientras usted compraba. Revise el nuevo total antes de confirmar.",
    en: "A price changed while you were shopping. Review the new total before confirming.",
  },
  zone_not_served: {
    "es-CR":
      "Por ahora no entregamos en esa zona. Elija una dirección en una zona donde sí entregamos.",
    en: "We do not deliver to that area for now. Choose an address in an area we deliver to.",
  },
  zone_not_found: {
    "es-CR": "No reconocemos esa zona de entrega.",
    en: "We do not recognise that delivery area.",
  },
  cod_not_available: {
    "es-CR":
      "El pago contra entrega no está disponible para este pedido. Elija otro medio de pago.",
    en: "Cash on delivery is not available for this order. Choose another payment method.",
  },
  sandbox_disabled: {
    "es-CR": "Los pagos de prueba están desactivados.",
    en: "Test payments are switched off.",
  },

  // ── Addresses and profile ──
  address_not_found: {
    "es-CR": "No encontramos esa dirección en su cuenta.",
    en: "We could not find that address in your account.",
  },
  address_invalid: {
    "es-CR":
      "Revise la dirección: nombre completo, teléfono de 8 dígitos, señas detalladas y la ubicación en el mapa dentro de Costa Rica.",
    en: "Check the address: full name, 8-digit phone, detailed directions and a map pin inside Costa Rica.",
  },
  postal_code_invalid: {
    "es-CR": "Elija la provincia, el cantón y el distrito.",
    en: "Choose the province, cantón and district.",
  },
  invalid_profile: {
    "es-CR": "Revise sus datos: el teléfono debe ser un número costarricense de 8 dígitos.",
    en: "Check your details: the phone must be an 8-digit Costa Rican number.",
  },
  invalid_consent: {
    "es-CR": "No pudimos registrar su consentimiento. Inténtelo de nuevo.",
    en: "We could not record your consent. Please try again.",
  },

  // ── Orders ──
  order_not_found: {
    "es-CR": "No encontramos ese pedido.",
    en: "We could not find that order.",
  },
  order_item_not_found: {
    "es-CR": "No encontramos ese producto en sus pedidos.",
    en: "We could not find that product in your orders.",
  },
  order_not_payable: {
    "es-CR": "Este pedido ya no está esperando un pago.",
    en: "This order is no longer waiting for payment.",
  },
  order_not_ready: {
    "es-CR": "El pedido todavía no está pagado, así que no se puede preparar.",
    en: "The order has not been paid yet, so it cannot be prepared.",
  },
  too_late_to_cancel: {
    "es-CR":
      "El pedido ya se está preparando y no se puede cancelar desde aquí. Escríbanos y le ayudamos; después de recibirlo también puede devolverlo.",
    en: "The order is already being prepared and cannot be cancelled here. Contact us and we will help; you can also return it after it arrives.",
  },
  invalid_order_transition: {
    "es-CR": "El pedido no puede pasar a ese estado desde donde está.",
    en: "The order cannot move to that status from where it is.",
  },
  invalid_shipment_transition: {
    "es-CR": "El paquete no puede pasar a ese estado desde donde está.",
    en: "The parcel cannot move to that status from where it is.",
  },

  // ── Reviews, returns, complaints, reports ──
  not_delivered_yet: {
    "es-CR": "Podrá hacerlo cuando reciba el pedido.",
    en: "You can do this once the order has been delivered.",
  },
  invalid_return_kind: {
    "es-CR": "Elija el motivo de la devolución.",
    en: "Choose the reason for the return.",
  },
  withdrawal_window_closed: {
    "es-CR": "El plazo para devolver este producto sin indicar motivo ya venció.",
    en: "The period to return this product without giving a reason has ended.",
  },
  warranty_expired: {
    "es-CR": "La garantía de este producto ya venció.",
    en: "The warranty on this product has expired.",
  },
  reason_required: {
    "es-CR": "Explique el motivo con un poco más de detalle.",
    en: "Please explain the reason in a little more detail.",
  },
  invalid_complaint: {
    "es-CR": "Cuéntenos qué pasó con un poco más de detalle.",
    en: "Tell us what happened in a little more detail.",
  },
  invalid_report: {
    "es-CR": "Elija el motivo del reporte.",
    en: "Choose the reason for the report.",
  },
  contact_required: {
    "es-CR": "Déjenos un correo para poder responderle.",
    en: "Leave us an e-mail address so we can reply.",
  },
  review_not_found: {
    "es-CR": "No encontramos esa reseña.",
    en: "We could not find that review.",
  },
  invalid_reply: {
    "es-CR": "La respuesta debe tener entre 2 y 2 000 caracteres.",
    en: "The reply must be between 2 and 2,000 characters.",
  },

  // ── Sellers ──
  slug_taken: {
    "es-CR": "Esa dirección de tienda ya está en uso. Pruebe con otra.",
    en: "That shop address is already in use. Try another.",
  },
  seller_already_registered: {
    "es-CR": "Ya existe una cuenta de vendedor con esa identificación.",
    en: "A seller account with that identification already exists.",
  },
  seller_not_found: {
    "es-CR": "No encontramos ese vendedor.",
    en: "We could not find that seller.",
  },
  category_not_found: {
    "es-CR": "Elija una categoría de la lista.",
    en: "Choose a category from the list.",
  },
  invalid_listing: {
    "es-CR":
      "Revise la publicación: título de al menos 5 caracteres, precio mayor que cero, y peso y medidas del paquete.",
    en: "Check the listing: a title of at least 5 characters, a price above zero, and the parcel's weight and size.",
  },
  listing_needs_review: {
    "es-CR": "Las publicaciones nuevas se revisan antes de salir a la venta. Envíela a revisión.",
    en: "New listings are reviewed before going on sale. Send it for review.",
  },
  offer_not_found: {
    "es-CR": "No encontramos esa oferta entre las suyas.",
    en: "We could not find that offer among yours.",
  },
  invalid_offer: {
    "es-CR":
      "Revise el precio: debe ser mayor que cero, y el precio regular debe ser mayor que el precio.",
    en: "Check the price: it must be above zero, and the regular price must be higher than the price.",
  },
  below_reserved: {
    "es-CR":
      "No puede bajar el inventario por debajo de las unidades ya vendidas y pendientes de entrega.",
    en: "Stock cannot go below the units already sold and awaiting delivery.",
  },
  product_not_reviewable: {
    "es-CR": "Esta publicación no está en revisión.",
    en: "This listing is not under review.",
  },

  // ── Warehouse ──
  warehouse_not_found: {
    "es-CR": "No encontramos esa bodega.",
    en: "We could not find that warehouse.",
  },
  location_not_found: {
    "es-CR": "Esa ubicación no existe en esta bodega.",
    en: "That location does not exist in this warehouse.",
  },
  invalid_lines: {
    "es-CR": "Agregue al menos un producto al envío.",
    en: "Add at least one product to the shipment.",
  },
  inbound_line_not_found: {
    "es-CR": "No encontramos esa línea de ingreso.",
    en: "We could not find that inbound line.",
  },
  inbound_not_receivable: {
    "es-CR": "Este ingreso ya se cerró.",
    en: "This inbound shipment is already closed.",
  },
  invalid_adjustment: {
    "es-CR": "Indique la cantidad y explique el motivo del ajuste.",
    en: "Enter the quantity and explain the reason for the adjustment.",
  },
  shipment_not_found: {
    "es-CR": "No encontramos ese paquete.",
    en: "We could not find that parcel.",
  },
  invalid_shipment_state: {
    "es-CR": "Ese paso no corresponde al estado actual del paquete.",
    en: "That step does not match the parcel's current status.",
  },
  shipment_not_picking: {
    "es-CR": "Primero inicie la recolección de este paquete.",
    en: "Start picking this parcel first.",
  },
  task_not_found: {
    "es-CR": "No encontramos esa tarea.",
    en: "We could not find that task.",
  },
  invalid_task_state: {
    "es-CR": "Esa tarea ya está cerrada.",
    en: "That task is already closed.",
  },
  bin_stock_insufficient: {
    "es-CR":
      "En esa ubicación hay menos unidades de las que indica el sistema. Cuente la ubicación antes de seguir.",
    en: "That location holds fewer units than the system shows. Count the location before continuing.",
  },
  picking_incomplete: {
    "es-CR": "Faltan productos por recolectar. Complete la lista antes de empacar.",
    en: "Some products have not been picked. Complete the list before packing.",
  },
  invalid_package: {
    "es-CR": "Indique el peso del paquete y la cantidad de bultos.",
    en: "Enter the parcel's weight and the number of packages.",
  },

  // ── Dispatch and delivery ──
  route_empty: {
    "es-CR": "Agregue al menos una parada a la ruta.",
    en: "Add at least one stop to the route.",
  },
  driver_not_available: {
    "es-CR": "Ese repartidor no está activo.",
    en: "That driver is not active.",
  },
  shipment_not_dispatchable: {
    "es-CR": "Ese paquete todavía no está empacado.",
    en: "That parcel has not been packed yet.",
  },
  shipment_already_routed: {
    "es-CR": "Ese paquete ya está en otra ruta.",
    en: "That parcel is already on another route.",
  },
  shipment_not_returnable: {
    "es-CR": "Solo se puede devolver un paquete con una entrega fallida.",
    en: "Only a parcel with a failed delivery can be sent back.",
  },
  route_not_found: {
    "es-CR": "No encontramos esa ruta entre las suyas.",
    en: "We could not find that route among yours.",
  },
  route_not_assignable: {
    "es-CR": "Esa ruta ya salió o está cerrada.",
    en: "That route has already left or is closed.",
  },
  route_not_startable: {
    "es-CR": "Esa ruta no está lista para iniciar.",
    en: "That route is not ready to start.",
  },
  route_not_in_progress: {
    "es-CR": "Inicie la ruta antes de registrar entregas.",
    en: "Start the route before recording deliveries.",
  },
  stop_not_found: {
    "es-CR": "No encontramos esa parada en su ruta.",
    en: "We could not find that stop on your route.",
  },
  invalid_stop_state: {
    "es-CR": "Esa parada ya está cerrada.",
    en: "That stop is already closed.",
  },
  invalid_failure_reason: {
    "es-CR": "Elija el motivo por el que no se pudo entregar.",
    en: "Choose the reason the delivery could not be made.",
  },
  not_a_driver: {
    "es-CR": "Su cuenta no está registrada como repartidor.",
    en: "Your account is not registered as a driver.",
  },
  wrong_pin: {
    "es-CR": "El código no coincide. Pídale a quien recibe que lo revise en su pedido.",
    en: "The code does not match. Ask the recipient to check it in their order.",
  },
  pin_locked: {
    "es-CR": "Demasiados intentos. Llame a soporte para completar esta entrega.",
    en: "Too many attempts. Call support to complete this delivery.",
  },
  cod_amount_mismatch: {
    "es-CR": "El monto recibido no coincide con el total del pedido.",
    en: "The amount received does not match the order total.",
  },
  recipient_required: {
    "es-CR": "Escriba el nombre de quien recibe.",
    en: "Enter the name of the person receiving it.",
  },

  // ── Seller locations ──
  invalid_location: {
    "es-CR":
      "Revise la ubicación: hace falta un nombre, señas completas y un punto dentro de Costa Rica.",
    en: "Check the location: it needs a name, full directions and a point inside Costa Rica.",
  },
  too_many_locations: {
    "es-CR": "Ya tiene el máximo de ubicaciones. Escríbanos si necesita más.",
    en: "You already have the maximum number of locations. Write to us if you need more.",
  },

  // ── Returns, complaints and reports (staff) ──
  return_not_found: {
    "es-CR": "No encontramos esa devolución.",
    en: "We could not find that return.",
  },
  invalid_return_state: {
    "es-CR": "Esa devolución ya fue resuelta o todavía no está aprobada.",
    en: "That return was already settled or is not approved yet.",
  },
  complaint_not_found: {
    "es-CR": "No encontramos ese reclamo, o ya está cerrado.",
    en: "We could not find that complaint, or it is already closed.",
  },
  report_not_found: {
    "es-CR": "No encontramos ese reporte, o ya fue resuelto.",
    en: "We could not find that report, or it was already resolved.",
  },

  // ── Cash settlement ──
  settlement_not_found: {
    "es-CR": "No encontramos la liquidación de esa ruta.",
    en: "We could not find the cash count for that route.",
  },
  settlement_already_closed: {
    "es-CR": "Esa liquidación ya se cerró.",
    en: "That cash count is already closed.",
  },
  invalid_amount: {
    "es-CR": "Indique un monto válido.",
    en: "Enter a valid amount.",
  },
  note_required_for_difference: {
    "es-CR": "El monto entregado no coincide con lo cobrado. Explique la diferencia en una nota.",
    en: "The amount handed in does not match what was collected. Explain the difference in a note.",
  },

  // ── Configuration problems (should never reach a customer) ──
  calendar_misconfigured: {
    "es-CR": "No pudimos calcular la fecha de entrega. Ya fuimos avisados.",
    en: "We could not work out the delivery date. We have been notified.",
  },
  invalid_handling_days: {
    "es-CR": "No pudimos calcular la fecha de entrega. Ya fuimos avisados.",
    en: "We could not work out the delivery date. We have been notified.",
  },
  no_active_fee_schedule: {
    "es-CR": "No pudimos calcular las tarifas. Ya fuimos avisados.",
    en: "We could not work out the fees. We have been notified.",
  },
  invalid_sort: {
    "es-CR": "Ese orden de resultados no existe.",
    en: "That sort order does not exist.",
  },
} as const satisfies Messages;

/** Every error code the API can return: the core ones above plus each area's. */
export const ERROR_MESSAGES = { ...CORE_MESSAGES, ...areaErrors } as const satisfies Messages;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

const FALLBACK = {
  "es-CR": "Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento.",
  en: "Something went wrong on our side. Please try again in a moment.",
} as const;

const NETWORK = {
  "es-CR": "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.",
  en: "We could not connect. Check your connection and try again.",
} as const;

export const isErrorCode = (code: string): code is ErrorCode => code in ERROR_MESSAGES;

/**
 * An error from the API, carrying a code the UI can branch on and a message
 * that is safe to show. `detail` holds the extra value some errors return
 * (the new total for `price_changed`, the offer id for `insufficient_stock`).
 */
export class ApiError extends Error {
  readonly code: ErrorCode | "unknown" | "network" | "invalid_response";
  readonly detail: string | null;
  readonly status: number | null;

  constructor(
    code: ApiError["code"],
    options: { detail?: string | null; status?: number | null; cause?: unknown } = {},
  ) {
    super(code, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.detail = options.detail ?? null;
    this.status = options.status ?? null;
  }

  /** The message to show a person, in their language. */
  userMessage(locale: Locale = "es-CR"): string {
    return messageFor(this.code, locale);
  }
}

export function messageFor(code: string, locale: Locale = "es-CR"): string {
  if (code === "network") return NETWORK[locale];
  return isErrorCode(code) ? ERROR_MESSAGES[code][locale] : FALLBACK[locale];
}

/** The shape of an error as PostgREST (and supabase-js) report it. */
export interface TransportError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Converts a transport error into an ApiError. Application errors arrive as
 * SQLSTATE P0001 with our code in `message`; a denied privilege (42501) means
 * the caller is not signed in or not allowed; a deadlock (40P01) or a
 * serialisation failure (40001) means nothing was changed and the call can
 * be made again (areas/lock-conflicts.ts). Anything else is reported as
 * unknown, and its raw text is kept out of the user-facing message.
 */
export function toApiError(error: TransportError, status: number | null = null): ApiError {
  const message = error.message ?? "";
  if (error.code === "P0001" && isErrorCode(message)) {
    return new ApiError(message, { detail: error.details || null, status, cause: error });
  }
  // A deadlock or serialisation failure: the database rolled the call back.
  const conflict = lockConflictCode(error.code);
  if (conflict) {
    return new ApiError(conflict, { detail: error.code ?? null, status, cause: error });
  }
  if (error.code === "42501" || status === 401 || status === 403) {
    return new ApiError(status === 401 ? "not_authenticated" : "forbidden", {
      status,
      cause: error,
    });
  }
  if (error.code === "PGRST301") {
    return new ApiError("not_authenticated", { status, cause: error });
  }
  if (!error.code && /fetch|network|timeout|ECONN/i.test(message)) {
    return new ApiError("network", { status, cause: error });
  }
  return new ApiError("unknown", { status, cause: error });
}
