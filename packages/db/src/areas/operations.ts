/**
 * Staff operations tools: delivery zones, districts, holidays, zone closures,
 * platform settings, warehouse locations and stuck routes.
 *
 * SQL: supabase/migrations/20261121084000_console_operations.sql. What each
 * action does and refuses is decided there (its header says why); the
 * ranges below mirror its checks so a form can say them before sending.
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const count = z.number().int().min(0);

// ── Delivery zones ──────────────────────────────────────────────────────────

/** What the database accepts for a zone (private.check_zone_service). */
export const ZONE_LIMITS = {
  nameLength: [2, 60],
  cutoffHour: [6, 22],
  transitMinDays: [0, 10],
  transitMaxDays: [0, 15],
  /** Céntimos: ₡0 to ₡100 000. */
  shippingFeeMinor: [0, 10_000_000],
  /** Céntimos: ₡1 to ₡10 000 000, or none (never free). */
  freeShippingThresholdMinor: [100, 1_000_000_000],
} as const;

export const opsZone = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  sort: z.number().int(),
  /** Sent back with an edit: an edit made from an older revision is refused. */
  revision: z.number().int(),
  cutoff_hour: z.number().int(),
  /** 0 = Sunday … 6 = Saturday. */
  processing_weekdays: z.array(z.number().int().min(0).max(6)),
  delivery_weekdays: z.array(z.number().int().min(0).max(6)),
  transit_min_days: z.number().int(),
  transit_max_days: z.number().int(),
  shipping_fee_minor: z.number().int(),
  free_shipping_threshold_minor: z.number().int().nullable(),
  cod_available: z.boolean(),
  /** Districts served by this zone. */
  district_count: count,
  /** Districts of this zone marked as not served. */
  not_served_count: count,
  saved_address_count: count,
  /** Orders placed to this zone that are not yet delivered, cancelled or refunded. */
  open_order_count: count,
  upcoming_closures: count,
  /** Something refers to it (a canton, a district, an order, a closure): it cannot be deleted. */
  in_use: z.boolean(),
  /** What an order placed now is promised, for stock in a Yuntera warehouse. */
  promise: z.object({ earliest: day, latest: day }).nullable(),
});
export type OpsZone = z.infer<typeof opsZone>;

export interface ZoneServiceInput {
  name: string;
  cutoffHour: number;
  processingWeekdays: number[];
  deliveryWeekdays: number[];
  transitMinDays: number;
  transitMaxDays: number;
  shippingFeeMinor: number;
  freeShippingThresholdMinor: number | null;
  codAvailable: boolean;
}

const zoneArgs = (input: ZoneServiceInput) => ({
  p_name: input.name,
  p_cutoff_hour: input.cutoffHour,
  p_processing_weekdays: input.processingWeekdays,
  p_delivery_weekdays: input.deliveryWeekdays,
  p_transit_min_days: input.transitMinDays,
  p_transit_max_days: input.transitMaxDays,
  p_shipping_fee_minor: input.shippingFeeMinor,
  p_free_shipping_threshold_minor: input.freeShippingThresholdMinor,
  p_cod_available: input.codAvailable,
});

// ── Districts ───────────────────────────────────────────────────────────────

export const opsCanton = z.object({
  code: z.string(),
  name: z.string(),
  province_code: z.number().int(),
  province: z.string(),
  district_count: count,
  served_count: count,
  /** The zones its served districts belong to. */
  zones: z.array(z.string()),
});
export type OpsCanton = z.infer<typeof opsCanton>;

export const opsDistrict = z.object({
  postal_code: z.string(),
  name: z.string(),
  zone_id: z.string(),
  zone_name: z.string(),
  zone_active: z.boolean(),
  served: z.boolean(),
  saved_address_count: count,
  open_order_count: count,
});
export type OpsDistrict = z.infer<typeof opsDistrict>;

export const opsCantonDistricts = z.object({
  code: z.string(),
  name: z.string(),
  province: z.string(),
  canton_zone_id: z.string(),
  districts: z.array(opsDistrict),
});
export type OpsCantonDistricts = z.infer<typeof opsCantonDistricts>;

/** What a move would touch, and (after it) what it touched. */
export const districtMoveImpact = z.object({
  district_count: count,
  /** Districts whose zone or service actually changes. */
  changing_count: count,
  changing: z.array(z.string()),
  saved_address_count: count,
  open_order_count: count,
  /** Null: the districts are marked as not served. */
  target: z.object({ id: z.string(), name: z.string(), active: z.boolean() }).nullable(),
  /** Zones that serve a district now and would serve none afterwards. */
  zones_left_empty: z.array(z.object({ id: z.string(), name: z.string() })),
  /** No active zone would serve a district afterwards; the move is refused. */
  nothing_served_after: z.boolean(),
});
export type DistrictMoveImpact = z.infer<typeof districtMoveImpact>;

// ── Holidays ────────────────────────────────────────────────────────────────

export const opsHoliday = z.object({
  day,
  name: z.string(),
  /** After today: it can still be removed. */
  changeable: z.boolean(),
  routes_planned: count,
  promised_orders: count,
});
export type OpsHoliday = z.infer<typeof opsHoliday>;

export const opsHolidays = z.object({
  /** Today in Costa Rica. */
  today: day,
  /** The last day a holiday can be added for. */
  latest_allowed: day,
  holidays: z.array(opsHoliday),
});
export type OpsHolidays = z.infer<typeof opsHolidays>;

export const addedHoliday = z.object({ day, name: z.string(), promised_orders: count });
export const removedHoliday = z.object({ day, name: z.string() });

// ── Zone closures ───────────────────────────────────────────────────────────

export const CLOSURE_REASONS = ["weather", "road_closed", "capacity", "other"] as const;
export const closureReason = z.enum(CLOSURE_REASONS);
export type ClosureReason = z.infer<typeof closureReason>;

export const opsClosure = z.object({
  id,
  zone_id: z.string(),
  zone_name: z.string(),
  starts_on: day,
  ends_on: day,
  reason: closureReason,
  note: z.string().nullable(),
  revision: z.number().int(),
  state: z.enum(["upcoming", "current", "over", "cancelled"]),
  ended_early: z.boolean(),
  created_at: timestamp,
  affected_order_count: count,
  /** The first 50 open orders promised inside it. */
  affected_orders: z.array(
    z.object({
      order_number: z.string(),
      status: z.string(),
      promise_earliest: day,
      promise_latest: day,
    }),
  ),
});
export type OpsClosure = z.infer<typeof opsClosure>;

export const opsClosures = z.object({
  today: day,
  closures: z.array(opsClosure),
  /** Days closed one by one before closures had periods. */
  single_days: z.array(
    z.object({ zone_id: z.string(), zone_name: z.string(), day, reason: z.string() }),
  ),
});
export type OpsClosures = z.infer<typeof opsClosures>;

// ── Settings ────────────────────────────────────────────────────────────────

export const opsSetting = z.object({
  key: z.string(),
  value: z.unknown(),
  /** The database's own note, in English, for whoever reads the table. */
  description: z.string(),
  /** Operational: an administrator may change it here. Otherwise protected. */
  editable: z.boolean(),
  min_value: z.number().int().nullable(),
  max_value: z.number().int().nullable(),
  unit: z.enum(["count", "minor", "per_hour"]).nullable(),
  updated_at: timestamp,
});
export type OpsSetting = z.infer<typeof opsSetting>;

export const updatedSetting = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: timestamp,
});

/**
 * What each setting does, in plain Spanish, for the settings screen. A key
 * that is not here is shown with SETTING_UNKNOWN and is protected (the
 * database protects every key that is not on its operational list).
 */
export const SETTING_TEXT: Readonly<Record<string, { label: string; help: string }>> = {
  cod_max_order_minor: {
    label: "Monto máximo para pagar contra entrega",
    help: "Los pedidos con un total mayor no se pueden pagar en efectivo al recibirlos.",
  },
  max_held_units_per_account: {
    label: "Unidades apartadas por cuenta",
    help: "Unidades que una cuenta puede tener apartadas en pedidos sin pagar (y, si nunca ha recibido un pedido, en pedidos contra entrega) antes de hacer otro pedido así.",
  },
  max_unpaid_orders_per_account: {
    label: "Pedidos sin pagar por cuenta",
    help: "Pedidos que una cuenta puede tener esperando el pago al mismo tiempo.",
  },
  max_open_cod_orders_new_account: {
    label: "Pedidos contra entrega de una cuenta nueva",
    help: "Pedidos contra entrega sin entregar que puede tener una cuenta que todavía no ha recibido ningún pedido.",
  },
  max_pending_shops_per_account: {
    label: "Tiendas en verificación por cuenta",
    help: "Tiendas que una persona puede tener esperando la verificación a la vez.",
  },
  max_listings_in_review_per_seller: {
    label: "Publicaciones en revisión por tienda",
    help: "Publicaciones nuevas y cambios que una tienda puede tener esperando la revisión del catálogo a la vez.",
  },
  max_new_offers_per_day_per_seller: {
    label: "Ofertas nuevas por día y tienda",
    help: "Ofertas que una tienda puede agregar en 24 horas a productos publicados por otras tiendas. No pasan por revisión.",
  },
  max_draft_listings_per_seller: {
    label: "Borradores por tienda",
    help: "Publicaciones en borrador que una tienda puede guardar.",
  },
  max_open_inbounds_per_seller: {
    label: "Envíos a bodega abiertos por tienda",
    help: "Envíos a una bodega de Yuntera que una tienda puede tener anunciados y sin recibir.",
  },
  max_lines_per_inbound: {
    label: "Productos distintos por envío a bodega",
    help: "Cuántos productos diferentes puede traer un envío de una tienda a la bodega.",
  },
  max_units_per_inbound_line: {
    label: "Unidades de un producto por envío a bodega",
    help: "Cuántas unidades de un mismo producto puede traer un envío a la bodega.",
  },
  max_members_per_shop: {
    label: "Personas por tienda",
    help: "Miembros e invitaciones pendientes que puede tener una tienda en total.",
  },
  max_pending_invitations_per_shop: {
    label: "Invitaciones pendientes por tienda",
    help: "Invitaciones a unirse a una tienda que pueden estar esperando respuesta a la vez.",
  },
  max_open_complaints_per_account: {
    label: "Reclamos abiertos por cuenta",
    help: "Reclamos que una cuenta puede tener abiertos a la vez.",
  },
  max_open_reports_per_account: {
    label: "Reportes abiertos por cuenta",
    help: "Reportes de contenido que una cuenta puede tener esperando una decisión a la vez.",
  },
  visitor_reports_per_hour: {
    label: "Reportes de visitantes por hora",
    help: "Reportes de personas sin cuenta, en toda la plataforma, en la última hora. Por encima de esto se les pide escribir a soporte.",
  },
  payments_mode: {
    label: "Modo de pagos",
    help: "Si los pagos son simulados, de prueba en el procesador o con dinero real.",
  },
  payment_gateway: {
    label: "Procesador de pagos",
    help: "La empresa por la que pasan los pagos con tarjeta y SINPE Móvil.",
  },
  gateway_expected_fees: {
    label: "Comisiones esperadas del procesador",
    help: "Lo que se espera que cobre el procesador por cada pago, para compararlo con lo que reporta. No es la comisión que pagan los vendedores.",
  },
  gateway_refund_unknown_hold_minutes: {
    label: "Espera de un reembolso sin respuesta",
    help: "Minutos que se revisa en el procesador un reembolso sin respuesta antes de pasarlo a finanzas.",
  },
  max_payment_attempts_per_order: {
    label: "Intentos de pago por pedido",
    help: "Cuántas veces puede un comprador empezar un pago en el procesador para un mismo pedido.",
  },
  invoicing_issuer: {
    label: "Emisor de los comprobantes electrónicos",
    help: "Los datos fiscales de la plataforma en sus comprobantes ante Hacienda.",
  },
  invoicing_policy: {
    label: "Reglas de facturación",
    help: "Las decisiones que confirma el contador: quién emite cada comprobante, sus códigos, las notas de crédito y si el dinero simulado lleva comprobante.",
  },
  require_staff_mfa: {
    label: "Segundo paso obligatorio para el personal",
    help: "Si todo el personal debe entrar con un segundo paso además de la contraseña.",
  },
  policy_versions: {
    label: "Versiones de las políticas",
    help: "La versión de cada política (términos, privacidad y otras) que las personas aceptan hoy.",
  },
  order_number_prefix: {
    label: "Prefijo de los números de pedido",
    help: "Las letras con que empiezan los números de pedido y los códigos de seguimiento.",
  },
  payout_hold_days: {
    label: "Días antes de pagar a los vendedores",
    help: "Días después de la entrega antes de que lo ganado se pueda pagar. Cubren el plazo en que el comprador puede devolver.",
  },
  payout_minimum_minor: {
    label: "Pago mínimo a un vendedor",
    help: "El monto más pequeño que vale una transferencia; los saldos menores esperan a una corrida posterior.",
  },
  reservation_minutes: {
    label: "Minutos que se guardan los productos sin pagar",
    help: "Cuánto tiempo se apartan los productos de un pedido que espera el pago. Las páginas y los mensajes dicen ese mismo número.",
  },
  max_units_per_line: {
    label: "Unidades de una oferta por pedido",
    help: "La mayor cantidad de una misma oferta en un pedido. El carrito de la tienda tiene el mismo número.",
  },
  max_lines_per_order: {
    label: "Productos distintos por pedido",
    help: "Cuántas ofertas diferentes puede tener un pedido. El carrito de la tienda tiene el mismo número.",
  },
};

export const SETTING_UNKNOWN = {
  label: "Ajuste sin descripción en la consola",
  help: "La consola todavía no explica este ajuste, así que se trata como protegido.",
} as const;

// ── Warehouse locations ─────────────────────────────────────────────────────

/** Zone letter, aisle, level and position, as the warehouse's labels: A-01-02-B. */
export const LOCATION_CODE = /^[A-Z]-[0-9]{2}-[0-9]{2}-[A-Z]$/;

export const opsLocation = z.object({
  id,
  code: z.string(),
  kind: z.enum(["receiving", "storage", "pick", "packing", "staging", "returns", "damaged"]),
  active: z.boolean(),
  /** Storage and picking locations are changed here; the other areas are not. */
  editable: z.boolean(),
  units: count,
  open_tasks: count,
  /** Picked from here into parcels still being picked: back here if cancelled. */
  picked_units: count,
  previous_code: z.string().optional(),
});
export type OpsLocation = z.infer<typeof opsLocation>;

export const opsWarehouseLocations = z.object({
  id,
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  locations: z.array(opsLocation),
});
export type OpsWarehouseLocations = z.infer<typeof opsWarehouseLocations>;

// ── Stuck routes ────────────────────────────────────────────────────────────

export const opsRouteStop = z.object({
  stop_id: id,
  sequence: z.number().int(),
  status: z.enum(["pending", "arrived", "delivered", "failed", "skipped"]),
  tracking_code: z.string(),
  shipment_status: z.string(),
  order_number: z.string(),
  district: z.string().nullable(),
  cash_planned: z.boolean(),
  removed_at: timestamp.nullable(),
  removal_reason: z.string().nullable(),
  /** Why it cannot be taken off the route, or null when it can. */
  not_removable: z.enum(["attempt_in_progress", "closed"]).nullable(),
});
export type OpsRouteStop = z.infer<typeof opsRouteStop>;

export const opsOpenRoute = z.object({
  route_id: id,
  code: z.string(),
  status: z.enum(["draft", "assigned", "in_progress"]),
  service_date: day,
  started_at: timestamp.nullable(),
  driver_name: z.string().nullable(),
  open_stops: count,
  stuck: z.boolean(),
  stuck_reasons: z.array(z.enum(["past_date", "cancelled_parcel", "no_open_stops"])),
  stops: z.array(opsRouteStop),
});
export type OpsOpenRoute = z.infer<typeof opsOpenRoute>;

export const removedStop = z.object({
  route_id: id,
  route_code: z.string(),
  tracking_code: z.string(),
  shipment_status: z.string(),
  open_stops: count,
});
export const closedRoute = z.object({
  route_id: id,
  code: z.string(),
  status: z.enum(["completed", "cancelled"]),
});

// ── Messages ────────────────────────────────────────────────────────────────

export const operationsErrors = {
  zone_name_invalid: {
    "es-CR": "Escriba el nombre de la zona, de 2 a 60 caracteres.",
    en: "Write the zone's name, 2 to 60 characters long.",
  },
  zone_id_invalid: {
    "es-CR":
      "El identificador de la zona va en minúsculas sin tildes, con números y guiones, de 2 a 30 caracteres (por ejemplo: zona-sur).",
    en: "The zone's identifier is lowercase without accents, with digits and hyphens, 2 to 30 characters (for example: zona-sur).",
  },
  zone_id_taken: {
    "es-CR": "Ya hay una zona con ese identificador. Elija otro.",
    en: "There is already a zone with that identifier. Choose another one.",
  },
  zone_cutoff_invalid: {
    "es-CR": "La hora de corte debe estar entre las 6 y las 22.",
    en: "The cut-off hour must be between 6 and 22.",
  },
  zone_weekdays_invalid: {
    "es-CR": "Marque al menos un día de preparación y un día de entrega.",
    en: "Tick at least one processing day and one delivery day.",
  },
  zone_transit_invalid: {
    "es-CR":
      "Los días de camino van de 0 a 10 (el más rápido) y hasta 15 (el más lento), y el más rápido no puede ser mayor que el más lento.",
    en: "Transit days go from 0 to 10 (fastest) and up to 15 (slowest), and the fastest cannot exceed the slowest.",
  },
  zone_fee_invalid: {
    "es-CR": "El costo de envío debe estar entre ₡0 y ₡100 000.",
    en: "The delivery fee must be between ₡0 and ₡100,000.",
  },
  zone_threshold_invalid: {
    "es-CR":
      "El monto para envío gratis debe estar entre ₡1 y ₡10 000 000, o déjelo vacío si nunca es gratis.",
    en: "The free-delivery amount must be between ₡1 and ₡10,000,000, or leave it empty if delivery is never free.",
  },
  zone_changed_meanwhile: {
    "es-CR":
      "Otra persona cambió esta zona mientras usted la editaba. La página ya muestra los valores actuales: revíselos y vuelva a guardar.",
    en: "Someone else changed this zone while you were editing it. The page now shows the current values: check them and save again.",
  },
  zone_unchanged: {
    "es-CR": "No hay nada que guardar: la zona ya está así.",
    en: "There is nothing to save: the zone is already like that.",
  },
  zone_last_active: {
    "es-CR":
      "Es la única zona encendida que tiene distritos con entrega: si se apaga, nadie podría hacer pedidos. Encienda otra zona con distritos antes de apagar esta.",
    en: "This is the only switched-on zone with districts served: switching it off would stop every order. Switch on another zone with districts first.",
  },
  zone_has_no_districts: {
    "es-CR":
      "Esta zona no tiene distritos con entrega, así que encendida no recibiría pedidos. Asígnele distritos en Distritos y enciéndala después.",
    en: "This zone has no districts served, so switched on it would take no orders. Assign districts to it under Districts and switch it on afterwards.",
  },
  districts_none_served: {
    "es-CR":
      "Con este cambio ninguna zona encendida tendría distritos con entrega y nadie podría hacer pedidos. Deje al menos un distrito con entrega en una zona encendida.",
    en: "With this change no switched-on zone would have a district served and nobody could order. Keep at least one district served in a switched-on zone.",
  },
  zone_in_use: {
    "es-CR":
      "Esta zona tiene distritos, pedidos o cierres, así que no se puede borrar. Puede apagarla.",
    en: "This zone has districts, orders or closures, so it cannot be deleted. You can switch it off.",
  },
  canton_not_found: {
    "es-CR": "No encontramos ese cantón. Elíjalo de la lista.",
    en: "We could not find that canton. Choose it from the list.",
  },
  district_selection_invalid: {
    "es-CR": "Elija de 1 a 60 distritos.",
    en: "Choose between 1 and 60 districts.",
  },
  district_not_found: {
    "es-CR": "Uno de los distritos elegidos no existe. Vuelva a elegirlos de la lista.",
    en: "One of the chosen districts does not exist. Choose them again from the list.",
  },
  district_unchanged: {
    "es-CR": "Los distritos elegidos ya están así. No se cambió nada.",
    en: "The chosen districts are already like that. Nothing was changed.",
  },
  holiday_name_invalid: {
    "es-CR": "Escriba el nombre del feriado, de 3 a 60 caracteres.",
    en: "Write the holiday's name, 3 to 60 characters long.",
  },
  holiday_in_past: {
    "es-CR":
      "Solo se pueden agregar o quitar días a partir de mañana: hoy ya hay entregas en camino.",
    en: "Only days from tomorrow on can be added or removed: today's deliveries are already under way.",
  },
  holiday_too_far: {
    "es-CR": "Esa fecha está a más de dos años. Revise el año.",
    en: "That date is more than two years away. Check the year.",
  },
  holiday_exists: {
    "es-CR": "Ese día ya está en el calendario como feriado.",
    en: "That day is already in the calendar as a holiday.",
  },
  holiday_has_routes: {
    "es-CR":
      "Ese día ya tiene rutas planeadas. Muévalas o ciérrelas en Despacho antes de marcarlo como feriado.",
    en: "That day already has routes planned. Move or close them under Dispatch before marking it as a holiday.",
  },
  holiday_has_promised_orders: {
    "es-CR":
      "Hay pedidos con entrega prometida ese día. Confirme si desea agregar el feriado de todos modos; esos pedidos mantienen su fecha.",
    en: "There are orders promised for that day. Confirm if you want to add the holiday anyway; those orders keep their date.",
  },
  holiday_not_found: {
    "es-CR": "Ese día no está en el calendario como feriado.",
    en: "That day is not in the calendar as a holiday.",
  },
  zone_closure_dates_invalid: {
    "es-CR":
      "Escriba el primer y el último día del cierre; el último no puede ser antes del primero.",
    en: "Write the first and last day of the closure; the last cannot be before the first.",
  },
  zone_closure_in_past: {
    "es-CR": "Un cierre empieza hoy o después, y su último día no puede haber pasado.",
    en: "A closure starts today or later, and its last day cannot be in the past.",
  },
  zone_closure_too_far: {
    "es-CR": "Ese cierre empieza dentro de más de un año. Revise el año.",
    en: "That closure starts more than a year from now. Check the year.",
  },
  zone_closure_too_long: {
    "es-CR":
      "Un cierre dura como máximo 31 días. Para más tiempo, apague la zona en Zonas de entrega.",
    en: "A closure lasts 31 days at most. For longer, switch the zone off under Delivery zones.",
  },
  zone_closure_reason_invalid: {
    "es-CR": "Elija el motivo del cierre de la lista.",
    en: "Choose the reason for the closure from the list.",
  },
  zone_closure_note_invalid: {
    "es-CR": "Con el motivo «Otro», escriba en pocas palabras qué pasa (de 3 a 200 caracteres).",
    en: "With the reason «Other», write briefly what is happening (3 to 200 characters).",
  },
  zone_closure_overlaps: {
    "es-CR":
      "Esa zona ya tiene un cierre en esas fechas. Cambie el último día de ese cierre en lugar de abrir otro.",
    en: "That zone already has a closure on those dates. Change that closure's last day instead of opening another one.",
  },
  zone_closure_not_found: {
    "es-CR": "No encontramos ese cierre. Recargue la página.",
    en: "We could not find that closure. Reload the page.",
  },
  zone_closure_changed_meanwhile: {
    "es-CR":
      "Otra persona cambió este cierre mientras usted lo veía. La página ya muestra las fechas actuales: revíselas y vuelva a intentarlo.",
    en: "Someone else changed this closure while you were looking at it. The page now shows the current dates: check them and try again.",
  },
  zone_closure_over: {
    "es-CR": "Este cierre ya terminó o se canceló; no hay nada que terminar.",
    en: "This closure is already over or was cancelled; there is nothing to end.",
  },
  zone_closure_unchanged: {
    "es-CR": "El cierre ya termina ese día. No se cambió nada.",
    en: "The closure already ends on that day. Nothing was changed.",
  },
  setting_protected: {
    "es-CR":
      "Este ajuste está protegido: solo se cambia con el procedimiento de despliegue, no desde la consola.",
    en: "This setting is protected: it is changed only through the deployment runbook, not from the console.",
  },
  setting_not_found: {
    "es-CR": "No encontramos ese ajuste. Recargue la página.",
    en: "We could not find that setting. Reload the page.",
  },
  setting_out_of_range: {
    "es-CR": "Escriba un número entero dentro del rango que se indica para este ajuste.",
    en: "Write a whole number within the range shown for this setting.",
  },
  setting_changed_meanwhile: {
    "es-CR":
      "Otra persona cambió este ajuste mientras usted lo veía. La página ya muestra el valor actual: revíselo y vuelva a intentarlo.",
    en: "Someone else changed this setting while you were looking at it. The page now shows the current value: check it and try again.",
  },
  setting_unchanged: {
    "es-CR": "El ajuste ya tiene ese valor. No se cambió nada.",
    en: "The setting already has that value. Nothing was changed.",
  },
  location_code_invalid: {
    "es-CR":
      "El código va como en las etiquetas: letra de la zona, pasillo, nivel y posición, por ejemplo A-01-02-B.",
    en: "The code goes as on the labels: zone letter, aisle, level and position, for example A-01-02-B.",
  },
  location_code_taken: {
    "es-CR": "Esa bodega ya tiene una ubicación con ese código. Elija otro.",
    en: "That warehouse already has a location with that code. Choose another one.",
  },
  location_kind_invalid: {
    "es-CR": "Elija si la ubicación es de almacenaje o de alisto.",
    en: "Choose whether the location is for storage or for picking.",
  },
  location_not_editable: {
    "es-CR":
      "Las zonas de recepción, empaque, despacho, devoluciones y dañados no se cambian desde aquí.",
    en: "The receiving, packing, dispatch, returns and damaged areas are not changed from here.",
  },
  location_unchanged: {
    "es-CR": "La ubicación ya está así. No se cambió nada.",
    en: "The location is already like that. Nothing was changed.",
  },
  location_has_stock: {
    "es-CR":
      "Esta ubicación tiene mercadería. Se puede desactivar cuando quede vacía, cuando esas unidades salgan en pedidos.",
    en: "This location holds goods. It can be switched off once it is empty, when those units leave in orders.",
  },
  location_has_picked_units: {
    "es-CR":
      "Hay unidades sacadas de esta ubicación en paquetes que todavía se están alistando: si se cancela el pedido, vuelven aquí. Desactívela cuando esos paquetes estén empacados.",
    en: "Units taken from this location are in parcels still being picked: if the order is cancelled, they come back here. Switch it off once those parcels are packed.",
  },
  location_has_open_tasks: {
    "es-CR": "Hay tareas de alisto abiertas en esta ubicación. Termínelas antes de cambiarla.",
    en: "There are open picking tasks at this location. Finish them before changing it.",
  },
  location_last_active: {
    "es-CR":
      "Es la última ubicación de almacenaje o alisto activa de la bodega. Active otra antes de desactivar esta.",
    en: "This is the warehouse's last active storage or picking location. Switch another one on first.",
  },
  stop_attempt_in_progress: {
    "es-CR":
      "El repartidor está en la puerta de esta parada. Espere a que la entregue o la marque como no entregada.",
    en: "The driver is at this stop's door. Wait until they deliver it or mark it as not delivered.",
  },
  stop_already_closed: {
    "es-CR": "Esta parada ya se entregó, falló o se quitó de la ruta; no se puede quitar.",
    en: "This stop was already delivered, failed or taken off the route; it cannot be removed.",
  },
  route_closed: {
    "es-CR": "Esta ruta ya está cerrada.",
    en: "This route is already closed.",
  },
  route_has_open_stops: {
    "es-CR":
      "La ruta todavía tiene paradas pendientes. Quítelas o espere a que el repartidor las cierre.",
    en: "The route still has stops to do. Remove them or wait for the driver to close them.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const operationsApi = ({ call, run }: Caller) => ({
  // Zones
  opsDeliveryZones: () => call("ops_delivery_zones", {}, z.array(opsZone)),
  opsCreateZone: (zoneId: string, input: ZoneServiceInput) =>
    call("ops_create_zone", { p_zone_id: zoneId, ...zoneArgs(input) }, opsZone),
  opsUpdateZone: (zoneId: string, revision: number, input: ZoneServiceInput) =>
    call(
      "ops_update_zone",
      { p_zone_id: zoneId, p_revision: revision, ...zoneArgs(input) },
      opsZone,
    ),
  opsSetZoneActive: (zoneId: string, active: boolean, revision: number) =>
    call(
      "ops_set_zone_active",
      { p_zone_id: zoneId, p_active: active, p_revision: revision },
      opsZone,
    ),
  opsDeleteZone: (zoneId: string) => run("ops_delete_zone", { p_zone_id: zoneId }),

  // Districts
  opsDistrictCantons: () => call("ops_district_cantons", {}, z.array(opsCanton)),
  opsCantonDistricts: (cantonCode: string) =>
    call("ops_canton_districts", { p_canton_code: cantonCode }, opsCantonDistricts),
  opsDistrictMovePreview: (postalCodes: string[], zoneId: string | null) =>
    call(
      "ops_district_move_preview",
      { p_postal_codes: postalCodes, p_zone_id: zoneId },
      districtMoveImpact,
    ),
  opsMoveDistricts: (postalCodes: string[], zoneId: string | null) =>
    call(
      "ops_move_districts",
      { p_postal_codes: postalCodes, p_zone_id: zoneId },
      districtMoveImpact,
    ),

  // Holidays
  opsHolidays: () => call("ops_holidays", {}, opsHolidays),
  opsAddHoliday: (input: { day: string; name: string; confirm?: boolean }) =>
    call(
      "ops_add_holiday",
      { p_day: input.day, p_name: input.name, p_confirm: input.confirm ?? false },
      addedHoliday,
    ),
  opsRemoveHoliday: (holiday: string) =>
    call("ops_remove_holiday", { p_day: holiday }, removedHoliday),

  // Closures
  opsZoneClosures: () => call("ops_zone_closures", {}, opsClosures),
  opsOpenZoneClosure: (input: {
    zoneId: string;
    startsOn: string;
    endsOn: string;
    reason: ClosureReason;
    note?: string | null;
  }) =>
    call(
      "ops_open_zone_closure",
      {
        p_zone_id: input.zoneId,
        p_starts_on: input.startsOn,
        p_ends_on: input.endsOn,
        p_reason: input.reason,
        p_note: input.note ?? null,
      },
      opsClosure,
    ),
  opsChangeZoneClosureEnd: (closureId: string, endsOn: string, revision: number) =>
    call(
      "ops_change_zone_closure_end",
      { p_closure_id: closureId, p_ends_on: endsOn, p_revision: revision },
      opsClosure,
    ),
  opsEndZoneClosure: (closureId: string, revision: number) =>
    call("ops_end_zone_closure", { p_closure_id: closureId, p_revision: revision }, opsClosure),

  // Settings
  opsSettings: () => call("ops_settings", {}, z.array(opsSetting)),
  opsUpdateSetting: (key: string, value: number, expected: unknown) =>
    call(
      "ops_update_setting",
      { p_key: key, p_value: value, p_expected: expected },
      updatedSetting,
    ),

  // Warehouse locations
  opsWarehouseLocations: () => call("ops_warehouse_locations", {}, z.array(opsWarehouseLocations)),
  opsCreateLocation: (warehouseId: string, code: string, kind: "storage" | "pick") =>
    call(
      "ops_create_location",
      { p_warehouse_id: warehouseId, p_code: code, p_kind: kind },
      opsLocation,
    ),
  opsRenameLocation: (locationId: string, code: string) =>
    call("ops_rename_location", { p_location_id: locationId, p_code: code }, opsLocation),
  opsSetLocationActive: (locationId: string, active: boolean) =>
    call("ops_set_location_active", { p_location_id: locationId, p_active: active }, opsLocation),

  // Routes
  opsOpenRoutes: () => call("ops_open_routes", {}, z.array(opsOpenRoute)),
  opsRemoveRouteStop: (stopId: string, reason: string) =>
    call("ops_remove_route_stop", { p_stop_id: stopId, p_reason: reason }, removedStop),
  opsCloseRoute: (routeId: string, reason: string) =>
    call("ops_close_route", { p_route_id: routeId, p_reason: reason }, closedRoute),
});
