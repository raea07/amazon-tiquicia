"use server";

/**
 * Everything staff can change, as Server Actions.
 *
 * Each action re-reads the session, validates its input and calls the API. The
 * database checks the caller's staff role on every call; nothing here grants
 * anything. Errors come back as text safe to show.
 */

import {
  DEFAULT_SERVICE_MINUTES,
  parseColones,
  planRoutes,
  type RouteStop,
  VEHICLE_PRESETS,
  type Vehicle,
} from "@yuntera/core";
import {
  type ActionState,
  attempt,
  endSession,
  GENERIC_ERROR,
  messageOf,
  passwordSignIn,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { refusedForCode } from "@/lib/refused-for-code";
import { currentStaff } from "@/lib/staff";

export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignIn(formData);
}

export async function signOut(): Promise<void> {
  await endSession("/ingresar");
}

/** Runs a staff action and redraws the screen behind the form when it worked. */
async function staffAction(
  returnTo: string,
  run: (api: Awaited<ReturnType<typeof sessionApi>>) => Promise<string>,
  values?: Record<string, string>,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  const state = await attempt(async () => run(await sessionApi()), values);
  if (state.ok) refresh();
  return state;
}

const uuid = (formData: FormData, name: string) => z.uuid().safeParse(formData.get(name));
const note = (formData: FormData) => String(formData.get("note") ?? "").trim();

// ── Sellers ─────────────────────────────────────────────────────────────────

export async function setSellerStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sellerId = uuid(formData, "sellerId");
  const status = z.enum(["active", "suspended", "closed"]).safeParse(formData.get("status"));
  if (!sellerId.success || !status.success) return { error: GENERIC_ERROR };
  return staffAction(
    "/vendedores",
    async (api) => {
      await api.opsSetSellerStatus(sellerId.data, status.data, note(formData) || null);
      // A suspended or closed shop's offers leave the shop at once (WEB-6).
      if (status.data !== "active") await refreshShopCatalog();
      return status.data === "active" ? "Vendedor verificado y activo." : "Estado actualizado.";
    },
    typed(formData, "note"),
  );
}

// ── Catalogue ───────────────────────────────────────────────────────────────

// Reviewing a new listing (with its photos) is in photo-actions.ts.

// ── Care ────────────────────────────────────────────────────────────────────

export async function decideReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const returnId = uuid(formData, "returnId");
  if (!returnId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  return staffAction(
    "/atencion",
    async (api) => {
      refusedForCode(await api.opsDecideReturn(returnId.data, approve, note(formData) || null));
      return approve
        ? "Reclamo aprobado. Coordine la recolección; el reembolso se registra cuando el producto llegue."
        : "Devolución rechazada; el cliente ve el motivo.";
    },
    typed(formData, "note"),
  );
}

export async function completeReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const returnId = uuid(formData, "returnId");
  if (!returnId.success) return { error: GENERIC_ERROR };
  return staffAction(
    "/atencion",
    async (api) => {
      refusedForCode(await api.opsCompleteReturn(returnId.data, note(formData) || null));
      return "Reembolso registrado.";
    },
    typed(formData, "note"),
  );
}

export async function resolveComplaint(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const complaintId = uuid(formData, "complaintId");
  if (!complaintId.success) return { error: GENERIC_ERROR };
  const close = formData.get("decision") === "yes";
  return staffAction(
    "/atencion",
    async (api) => {
      refusedForCode(await api.opsResolveComplaint(complaintId.data, note(formData), close));
      return close
        ? "Reclamo cerrado con su respuesta."
        : "Respuesta enviada; el reclamo sigue abierto.";
    },
    typed(formData, "note"),
  );
}

export async function resolveReport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reportId = uuid(formData, "reportId");
  if (!reportId.success) return { error: GENERIC_ERROR };
  const act = formData.get("decision") === "yes";
  return staffAction(
    "/atencion",
    async (api) => {
      await api.opsResolveReport(reportId.data, act, note(formData));
      // Content taken down must stop showing now, not when the cache expires (WEB-6).
      if (act) await refreshShopCatalog();
      return act ? "Reporte atendido y contenido retirado." : "Reporte descartado.";
    },
    typed(formData, "note"),
  );
}

// ── Payments ────────────────────────────────────────────────────────────────

export async function confirmPayment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderId = uuid(formData, "orderId");
  const reference = String(formData.get("bankReference") ?? "").trim();
  const values = typed(formData, "bankReference");
  if (!orderId.success) return { error: GENERIC_ERROR };
  if (reference.length < 4) {
    return { error: "Escriba el número de comprobante del banco.", values };
  }
  return staffAction(
    "/pedidos",
    async (api) => {
      await api.opsConfirmPayment(orderId.data, reference);
      return "Pago confirmado. El pedido pasó a preparación.";
    },
    values,
  );
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Plans the day's routes for the chosen parcels and drivers and creates them.
 * The plan comes from the routing code in @yuntera/core; the database then
 * checks every parcel again before it accepts a route.
 */
export async function planDay(_previous: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/despacho"));
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      depotId: z.uuid(),
      shipmentIds: z.array(z.uuid()).min(1, "Marque al menos un paquete."),
      driverIds: z.array(z.uuid()).min(1, "Marque al menos un repartidor."),
    })
    .safeParse({
      date: formData.get("date"),
      depotId: formData.get("depotId"),
      shipmentIds: formData.getAll("shipmentId"),
      driverIds: formData.getAll("driverId"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  try {
    const api = await sessionApi();
    const board = await api.opsDispatchBoard(parsed.data.date);
    const depot = board.depots.find((candidate) => candidate.id === parsed.data.depotId);
    if (!depot) return { error: "Elija la bodega de salida." };

    const chosen = new Set(parsed.data.shipmentIds);
    const stops: RouteStop[] = board.ready
      .filter((shipment) => chosen.has(shipment.shipment_id))
      .map((shipment) => ({
        stopId: shipment.shipment_id,
        location: { lat: shipment.lat, lng: shipment.lng },
        weightKg: shipment.weight_grams / 1000,
        // Collecting cash takes longer at the door.
        serviceMinutes: DEFAULT_SERVICE_MINUTES + (shipment.cash_on_delivery ? 3 : 0),
      }));
    const drivers = new Set(parsed.data.driverIds);
    const vehicles: Vehicle[] = board.drivers
      .filter((driver) => drivers.has(driver.id))
      .map((driver) => ({
        vehicleId: driver.id,
        capacityKg: driver.capacity_kg,
        ...VEHICLE_PRESETS[driver.vehicle_type],
      }));
    if (stops.length === 0 || vehicles.length === 0) {
      return {
        error: "Esos paquetes o repartidores ya no están disponibles. Actualice la página.",
      };
    }

    const plan = planRoutes({ lat: depot.lat, lng: depot.lng }, stops, vehicles);
    let created = 0;
    for (const route of plan.routes) {
      if (route.stops.length === 0) continue;
      await api.opsCreateRoute({
        serviceDate: parsed.data.date,
        depotWarehouseId: depot.id,
        driverId: route.vehicleId,
        plannedKm: Math.round(route.totalKm * 10) / 10,
        plannedMinutes: Math.round(route.totalMinutes),
        stops: route.stops.map((stop) => ({
          shipmentId: stop.stopId,
          sequence: stop.sequence,
          etaMinute: Math.round(stop.arrivalMinute),
        })),
      });
      created += 1;
    }
    refresh();
    const left = plan.unassigned.length;
    return {
      ok:
        `${created === 1 ? "Se creó 1 ruta" : `Se crearon ${created} rutas`} ` +
        `(${Math.round(plan.totalKm)} km en total).` +
        (left > 0
          ? ` ${left === 1 ? "Quedó 1 paquete" : `Quedaron ${left} paquetes`} sin asignar: no caben en los vehículos elegidos.`
          : ""),
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function assignRoute(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const routeId = uuid(formData, "routeId");
  const driverId = uuid(formData, "driverId");
  if (!routeId.success || !driverId.success) return { error: "Elija un repartidor." };
  return staffAction("/despacho", async (api) => {
    await api.opsAssignRoute(routeId.data, driverId.data);
    return "Ruta asignada.";
  });
}

export async function returnShipment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shipmentId = uuid(formData, "shipmentId");
  if (!shipmentId.success) return { error: GENERIC_ERROR };
  return staffAction("/despacho", async (api) => {
    await api.opsReturnShipment(shipmentId.data);
    return "El paquete vuelve a la bodega.";
  });
}

export async function settleRoute(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const routeId = uuid(formData, "routeId");
  const values = typed(formData, "handed", "note");
  if (!routeId.success) return { error: GENERIC_ERROR, values };
  const handedMinor = parseColones(values.handed ?? "");
  if (handedMinor === null) {
    return { error: "Escriba cuánto efectivo entregó el repartidor, por ejemplo 21 900.", values };
  }
  return staffAction(
    "/liquidaciones",
    async (api) => {
      await api.opsSettleRoute(routeId.data, handedMinor, note(formData) || null);
      return "Liquidación registrada.";
    },
    values,
  );
}

// ── Drivers ─────────────────────────────────────────────────────────────────

export async function setDriverStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const driverId = uuid(formData, "driverId");
  const status = z.enum(["active", "suspended", "offboarded"]).safeParse(formData.get("status"));
  if (!driverId.success || !status.success) return { error: GENERIC_ERROR };
  return staffAction("/repartidores", async (api) => {
    await api.opsSetDriverStatus(driverId.data, status.data);
    return "Estado actualizado.";
  });
}
