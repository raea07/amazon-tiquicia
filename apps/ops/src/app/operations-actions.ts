"use server";

/**
 * Operations staff's tools: delivery zones, districts, holidays, zone
 * closures, warehouse locations and stuck routes, and the administrators'
 * platform settings. Each action re-reads the session, validates its input,
 * calls the database (which checks the caller's role on every call and is
 * where every rule lives), redraws the page behind the form and, where the
 * shop shows what changed, asks the shop to drop its cached copies.
 */

import { ApiError, CLOSURE_REASONS, LOCATION_CODE, type ZoneServiceInput } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

type Api = Awaited<ReturnType<typeof sessionApi>>;

/** What the shop shows that this change touches. */
type ShopRefresh = "none" | "catalog" | "districts";

/**
 * Runs an operations change; on success, redraws the page and refreshes the
 * shop. `explain` may give a refusal a message that uses its detail (how many
 * units, routes or stops) instead of the general one for its code.
 */
async function operationsAction(
  returnTo: string,
  shop: ShopRefresh,
  run: (api: Api) => Promise<string>,
  values?: Record<string, string>,
  explain?: (error: ApiError) => string | null,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  let explained: string | null = null;
  const state = await attempt(async () => {
    let message: string;
    try {
      message = await run(await sessionApi());
    } catch (error) {
      if (error instanceof ApiError) explained = explain?.(error) ?? null;
      throw error;
    }
    // Product pages (date and delivery fee), the cart's quote is never cached;
    // the district list says where the shop delivers.
    if (shop !== "none") await refreshShopCatalog({ districts: shop === "districts" });
    return message;
  }, values);
  if (explained) return { error: explained, values };
  if (state.ok) refresh();
  return state;
}

const uuid = z.uuid();
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = (detail: string | null) => Number.parseInt(detail ?? "", 10);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whole colones as typed ("1 500", "₡1.500") into céntimos; null when empty, NaN when not a number. */
function colonesToMinor(value: string): number | null {
  const digits = value.replace(/[\s₡.,]/g, "");
  if (digits === "") return null;
  return /^\d{1,9}$/.test(digits) ? Number(digits) * 100 : Number.NaN;
}

const wholeNumber = (value: string) => (/^-?\d{1,9}$/.test(value) ? Number(value) : Number.NaN);

// ── Zones ───────────────────────────────────────────────────────────────────

const ZONE_FIELDS = [
  "zoneId",
  "name",
  "cutoffHour",
  "transitMinDays",
  "transitMaxDays",
  "shippingFee",
  "freeShippingThreshold",
];

/** The zone's service as typed, or what is wrong with it in words. */
function zoneService(formData: FormData): ZoneServiceInput | string {
  const weekdays = (name: string) =>
    formData
      .getAll(name)
      .map((value) => Number(value))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const fee = colonesToMinor(text(formData, "shippingFee"));
  const threshold = colonesToMinor(text(formData, "freeShippingThreshold"));
  const cutoffHour = wholeNumber(text(formData, "cutoffHour"));
  const transitMinDays = wholeNumber(text(formData, "transitMinDays"));
  const transitMaxDays = wholeNumber(text(formData, "transitMaxDays"));
  if (text(formData, "name").length < 2) return "Escriba el nombre de la zona.";
  if (fee === null || Number.isNaN(fee)) {
    return "Escriba el costo de envío en colones, sin decimales (0 si es gratis).";
  }
  if (threshold !== null && Number.isNaN(threshold)) {
    return "Escriba el monto para envío gratis en colones, sin decimales, o déjelo vacío.";
  }
  if ([cutoffHour, transitMinDays, transitMaxDays].some(Number.isNaN)) {
    return "Escriba la hora de corte y los días de camino como números enteros.";
  }
  return {
    name: text(formData, "name"),
    cutoffHour,
    processingWeekdays: weekdays("processingWeekdays"),
    deliveryWeekdays: weekdays("deliveryWeekdays"),
    transitMinDays,
    transitMaxDays,
    shippingFeeMinor: fee,
    freeShippingThresholdMinor: threshold,
    codAvailable: formData.get("codAvailable") === "on",
  };
}

export async function createZone(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, ...ZONE_FIELDS);
  const service = zoneService(formData);
  if (typeof service === "string") return { error: service, values };
  if (text(formData, "zoneId") === "") {
    return { error: "Escriba el identificador de la zona, por ejemplo zona-sur.", values };
  }
  return operationsAction(
    "/operacion",
    "none",
    async (api) => {
      const zone = await api.opsCreateZone(text(formData, "zoneId"), service);
      return `Zona «${zone.name}» creada, apagada y sin distritos. Asígnele distritos en Distritos y enciéndala cuando esté lista.`;
    },
    values,
  );
}

export async function updateZone(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, ...ZONE_FIELDS);
  const revision = wholeNumber(text(formData, "revision"));
  const service = zoneService(formData);
  if (Number.isNaN(revision)) return { error: GENERIC_ERROR, values };
  if (typeof service === "string") return { error: service, values };
  return operationsAction(
    "/operacion",
    "districts",
    async (api) => {
      const zone = await api.opsUpdateZone(text(formData, "zoneId"), revision, service);
      return `Zona «${zone.name}» guardada. Rige para los pedidos nuevos; los pedidos ya hechos conservan su fecha y su envío.`;
    },
    values,
  );
}

export async function setZoneActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const on = formData.get("active") === "yes";
  const revision = wholeNumber(text(formData, "revision"));
  if (Number.isNaN(revision)) return { error: GENERIC_ERROR };
  return operationsAction("/operacion", "districts", async (api) => {
    const zone = await api.opsSetZoneActive(text(formData, "zoneId"), on, revision);
    return on
      ? `Zona «${zone.name}» encendida: sus direcciones ya pueden hacer pedidos.`
      : `Zona «${zone.name}» apagada: sus direcciones ya no pueden hacer pedidos. Los ${zone.open_order_count} pedidos abiertos siguen su curso.`;
  });
}

export async function deleteZone(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return operationsAction("/operacion", "none", async (api) => {
    await api.opsDeleteZone(text(formData, "zoneId"));
    return "Zona borrada.";
  });
}

// ── Districts ───────────────────────────────────────────────────────────────

export async function moveDistricts(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const codes = formData
    .getAll("postalCode")
    .map(String)
    .filter((code) => /^[1-7]\d{4}$/.test(code));
  const target = text(formData, "zoneId");
  if (codes.length === 0) return { error: "Elija al menos un distrito." };
  if (target === "") return { error: "Elija a qué zona pasan, o «No se entrega»." };
  const zoneId = target === "none" ? null : target;
  const canton = text(formData, "canton");
  return operationsAction(`/operacion/distritos?canton=${canton}`, "districts", async (api) => {
    const impact = await api.opsMoveDistricts(codes, zoneId);
    const moved = plural(impact.changing_count, "distrito", "distritos");
    return zoneId
      ? `Listo: ${moved} pasan a «${impact.target?.name ?? zoneId}». Los pedidos nuevos usan su envío y su fecha.`
      : `Listo: ${moved} quedan sin entrega. Sus direcciones guardadas siguen guardadas y no se pueden elegir al pagar.`;
  });
}

// ── Holidays ────────────────────────────────────────────────────────────────

export async function addHoliday(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "day", "name");
  const day = isoDay.safeParse(text(formData, "day"));
  if (!day.success) return { error: "Elija el día del feriado.", values };
  if (text(formData, "name").length < 3) return { error: "Escriba el nombre del feriado.", values };
  const confirm = formData.get("confirm") === "on";
  return operationsAction(
    "/operacion/feriados",
    "catalog",
    async (api) => {
      const added = await api.opsAddHoliday({
        day: day.data,
        name: text(formData, "name"),
        confirm,
      });
      return added.promised_orders > 0
        ? `Feriado agregado. ${plural(added.promised_orders, "pedido prometido", "pedidos prometidos")} ese día mantienen su fecha; avíseles si no se podrá cumplir.`
        : "Feriado agregado. La fecha de entrega que ve la tienda ya lo salta.";
    },
    values,
    (error) => {
      if (error.code === "holiday_has_promised_orders") {
        const n = count(error.detail);
        return `Ese día hay ${plural(n, "pedido abierto", "pedidos abiertos")} con entrega prometida. Si de todos modos es feriado, marque «Agregar aunque haya pedidos prometidos» y vuelva a enviar: esos pedidos mantienen su fecha.`;
      }
      if (error.code === "holiday_has_routes") {
        const n = count(error.detail);
        return `Ese día ya tiene ${plural(n, "ruta planeada", "rutas planeadas")}. Muévala o ciérrela en Despacho o en Rutas detenidas antes de marcarlo como feriado.`;
      }
      return null;
    },
  );
}

export async function removeHoliday(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const day = isoDay.safeParse(text(formData, "day"));
  if (!day.success) return { error: GENERIC_ERROR };
  return operationsAction("/operacion/feriados", "catalog", async (api) => {
    const removed = await api.opsRemoveHoliday(day.data);
    return `«${removed.name}» ya no es feriado: ese día hay entregas otra vez.`;
  });
}

// ── Closures ────────────────────────────────────────────────────────────────

export async function openClosure(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "zoneId", "startsOn", "endsOn", "reason", "note");
  const startsOn = isoDay.safeParse(text(formData, "startsOn"));
  const endsOn = isoDay.safeParse(text(formData, "endsOn"));
  const reason = z.enum(CLOSURE_REASONS).safeParse(text(formData, "reason"));
  if (text(formData, "zoneId") === "") return { error: "Elija la zona que se cierra.", values };
  if (!startsOn.success || !endsOn.success) {
    return { error: "Elija el primer y el último día del cierre.", values };
  }
  if (!reason.success) return { error: "Elija el motivo del cierre.", values };
  return operationsAction(
    "/operacion/cierres",
    "catalog",
    async (api) => {
      const closure = await api.opsOpenZoneClosure({
        zoneId: text(formData, "zoneId"),
        startsOn: startsOn.data,
        endsOn: endsOn.data,
        reason: reason.data,
        note: text(formData, "note") || null,
      });
      return closure.affected_order_count > 0
        ? `Cierre guardado. ${plural(closure.affected_order_count, "pedido abierto tiene", "pedidos abiertos tienen")} la entrega prometida en esas fechas: están en la lista del cierre.`
        : "Cierre guardado. La tienda ya no promete entregas en esa zona esos días.";
    },
    values,
  );
}

export async function changeClosureEnd(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "endsOn");
  const id = uuid.safeParse(formData.get("closureId"));
  const endsOn = isoDay.safeParse(text(formData, "endsOn"));
  const revision = wholeNumber(text(formData, "revision"));
  if (!id.success || Number.isNaN(revision)) return { error: GENERIC_ERROR, values };
  if (!endsOn.success) return { error: "Elija el nuevo último día.", values };
  return operationsAction(
    "/operacion/cierres",
    "catalog",
    async (api) => {
      await api.opsChangeZoneClosureEnd(id.data, endsOn.data, revision);
      return "Último día del cierre cambiado.";
    },
    values,
  );
}

export async function endClosure(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("closureId"));
  const revision = wholeNumber(text(formData, "revision"));
  if (!id.success || Number.isNaN(revision)) return { error: GENERIC_ERROR };
  return operationsAction("/operacion/cierres", "catalog", async (api) => {
    const closure = await api.opsEndZoneClosure(id.data, revision);
    return closure.state === "cancelled"
      ? "Cierre cancelado antes de empezar: la zona recibe entregas esos días."
      : "Cierre terminado: la zona recibe entregas desde hoy. Para volver a cerrarla, cambie el último día.";
  });
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function updateSetting(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "value");
  const key = text(formData, "key");
  const unit = text(formData, "unit");
  let expected: unknown;
  try {
    expected = JSON.parse(text(formData, "expected"));
  } catch {
    return { error: GENERIC_ERROR, values };
  }
  const typedValue = text(formData, "value");
  const value = unit === "minor" ? colonesToMinor(typedValue) : wholeNumber(typedValue);
  if (value === null || Number.isNaN(value)) {
    return {
      error:
        unit === "minor"
          ? "Escriba el monto en colones, sin decimales."
          : "Escriba un número entero.",
      values,
    };
  }
  if (formData.get("confirm") !== "on") {
    return {
      error: "Marque la casilla para confirmar que el cambio rige de inmediato.",
      values,
    };
  }
  return operationsAction(
    "/operacion/ajustes",
    "none",
    async (api) => {
      await api.opsUpdateSetting(key, value, expected);
      return "Ajuste guardado. Rige desde ahora; queda en la auditoría con el valor anterior.";
    },
    values,
    (error) => {
      if (error.code !== "setting_out_of_range" || !error.detail) return null;
      const [min, max] = error.detail.split("-").map(Number);
      if (min === undefined || max === undefined) return null;
      const show = (n: number) =>
        unit === "minor" ? `₡${(n / 100).toLocaleString("es-CR")}` : n.toLocaleString("es-CR");
      return `Escriba un número entero entre ${show(min)} y ${show(max)}.`;
    },
  );
}

// ── Warehouse locations ─────────────────────────────────────────────────────

export async function createLocation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "code", "kind");
  const warehouse = uuid.safeParse(formData.get("warehouseId"));
  const kind = z.enum(["storage", "pick"]).safeParse(text(formData, "kind"));
  const code = text(formData, "code").toUpperCase();
  if (!warehouse.success) return { error: GENERIC_ERROR, values };
  if (!LOCATION_CODE.test(code)) {
    return {
      error: "Escriba el código como en la etiqueta: letra, pasillo, nivel y posición (A-01-02-B).",
      values,
    };
  }
  if (!kind.success) return { error: "Elija si es de almacenaje o de alisto.", values };
  return operationsAction(
    "/operacion/ubicaciones",
    "none",
    async (api) => {
      const location = await api.opsCreateLocation(warehouse.data, code, kind.data);
      return `Ubicación ${location.code} creada. La bodega ya la puede elegir al recibir y guardar mercadería.`;
    },
    values,
  );
}

export async function renameLocation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "code");
  const id = uuid.safeParse(formData.get("locationId"));
  const code = text(formData, "code").toUpperCase();
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (!LOCATION_CODE.test(code)) {
    return {
      error: "Escriba el código como en la etiqueta: letra, pasillo, nivel y posición (A-01-02-B).",
      values,
    };
  }
  return operationsAction(
    "/operacion/ubicaciones",
    "none",
    async (api) => {
      const location = await api.opsRenameLocation(id.data, code);
      return `Ubicación ${location.previous_code ?? ""} ahora se llama ${location.code}. Cambie también la etiqueta del estante.`;
    },
    values,
    (error) =>
      error.code === "location_has_open_tasks"
        ? `Hay ${plural(count(error.detail), "tarea de alisto abierta", "tareas de alisto abiertas")} en esta ubicación. Termínelas antes de cambiarle el código.`
        : null,
  );
}

export async function setLocationActive(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("locationId"));
  const on = formData.get("active") === "yes";
  if (!id.success) return { error: GENERIC_ERROR };
  return operationsAction(
    "/operacion/ubicaciones",
    "none",
    async (api) => {
      const location = await api.opsSetLocationActive(id.data, on);
      return on
        ? `Ubicación ${location.code} activa: la bodega ya la puede elegir.`
        : `Ubicación ${location.code} desactivada: la bodega ya no la ve.`;
    },
    undefined,
    (error) => {
      if (error.code === "location_has_stock") {
        return `Esta ubicación tiene ${plural(count(error.detail), "unidad", "unidades")}. Muévalas a otra ubicación antes de desactivarla.`;
      }
      if (error.code === "location_has_open_tasks") {
        return `Hay ${plural(count(error.detail), "tarea de alisto abierta", "tareas de alisto abiertas")} en esta ubicación. Termínelas antes de desactivarla.`;
      }
      return null;
    },
  );
}

// ── Stuck routes ────────────────────────────────────────────────────────────

export async function removeRouteStop(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "reason");
  const id = uuid.safeParse(formData.get("stopId"));
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (text(formData, "reason").length < 5) {
    return { error: "Escriba por qué la quita (al menos 5 caracteres).", values };
  }
  return operationsAction(
    "/operacion/rutas",
    "none",
    async (api) => {
      const removed = await api.opsRemoveRouteStop(id.data, text(formData, "reason"));
      const back =
        removed.shipment_status === "delivery_failed"
          ? "El repartidor debe devolver el paquete a la bodega; ya está en Despacho para otra ruta."
          : removed.shipment_status === "packed"
            ? "El paquete vuelve a Despacho para otra ruta."
            : "El paquete estaba cancelado y queda así.";
      return `Parada ${removed.tracking_code} quitada de la ruta ${removed.route_code}. ${back}${
        removed.open_stops === 0 ? " La ruta ya no tiene paradas pendientes: puede cerrarla." : ""
      }`;
    },
    values,
  );
}

export async function closeRoute(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "reason");
  const id = uuid.safeParse(formData.get("routeId"));
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (text(formData, "reason").length < 5) {
    return { error: "Escriba por qué la cierra (al menos 5 caracteres).", values };
  }
  return operationsAction(
    "/operacion/rutas",
    "none",
    async (api) => {
      const route = await api.opsCloseRoute(id.data, text(formData, "reason"));
      return route.status === "completed"
        ? `Ruta ${route.code} cerrada. Su liquidación quedó abierta en Liquidaciones con lo que el repartidor cobró.`
        : `Ruta ${route.code} cancelada: nunca salió.`;
    },
    values,
    (error) =>
      error.code === "route_has_open_stops"
        ? `La ruta todavía tiene ${plural(count(error.detail), "parada pendiente", "paradas pendientes")}. Quítelas o espere a que el repartidor las cierre.`
        : null,
  );
}
