"use server";

/**
 * What drivers and warehouse staff can do, as Server Actions. Each re-reads the
 * session, validates its input and calls the API; the database enforces that a
 * driver acts only on their own route and a worker only in their own warehouse.
 */

import { LOCKED_CODE_MESSAGE, parseColones } from "@yuntera/core";
import { ApiError } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  endSession,
  GENERIC_ERROR,
  getViewer,
  messageOf,
  passwordSignIn,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { formatPrice } from "@yuntera/ui";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignIn(formData);
}

export async function signOut(): Promise<void> {
  await endSession("/ingresar");
}

async function api(returnTo: string) {
  if (!(await getViewer())) redirectTo(signInPath(returnTo));
  return sessionApi();
}

const uuid = (formData: FormData, name: string) => z.uuid().safeParse(formData.get(name));

/** The device's position, when the form carries one. Never required: GPS fails indoors. */
function position(formData: FormData): { lat: number | null; lng: number | null } {
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  const valid = formData.get("lat") && Number.isFinite(lat) && Number.isFinite(lng);
  return valid ? { lat, lng } : { lat: null, lng: null };
}

// ── Driver ──────────────────────────────────────────────────────────────────

export async function startRoute(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const routeId = uuid(formData, "routeId");
  if (!routeId.success) return { error: GENERIC_ERROR };
  const client = await api("/ruta");
  const state = await attempt(async () => {
    await client.driverStartRoute(routeId.data);
    return "Ruta iniciada. Buen camino.";
  });
  if (state.ok) refresh();
  return state;
}

export async function arrive(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const stopId = uuid(formData, "stopId");
  if (!stopId.success) return { error: GENERIC_ERROR };
  const client = await api("/ruta");
  const state = await attempt(async () => {
    await client.driverArrive(stopId.data);
    return "Llegada registrada.";
  });
  if (state.ok) refresh();
  return state;
}

export async function completeStop(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const stopId = uuid(formData, "stopId");
  const values = typed(formData, "recipientName", "collected");
  if (!stopId.success) return { error: GENERIC_ERROR, values };

  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "");
  if (pin.length !== 4) return { error: "Pídale al cliente su código de 4 dígitos.", values };
  const recipientName = (values.recipientName ?? "").trim();
  if (recipientName.length < 3) return { error: "Escriba el nombre de quien recibe.", values };

  const expectsCash = formData.get("expectsCash") === "1";
  const collected = expectsCash ? parseColones(values.collected ?? "") : 0;
  if (collected === null) return { error: "Escriba cuánto efectivo recibió.", values };

  const client = await api("/ruta");
  let done: { route_completed: boolean };
  try {
    const result = await client.driverCompleteStop({
      stopId: stopId.data,
      pin,
      recipientName,
      codCollectedMinor: collected,
      ...position(formData),
    });
    if (!result.ok) {
      // Door-side problems come back as data: the attempt is recorded either way.
      const message = {
        // The last attempt used up: say the same as the lock, not "Quedan 0 intentos".
        wrong_pin:
          result.attempts_left === 0
            ? LOCKED_CODE_MESSAGE
            : `Ese código no es. ${
                result.attempts_left === 1
                  ? "Queda 1 intento"
                  : `Quedan ${result.attempts_left ?? 0} intentos`
              }. Pídale al cliente que lo lea de su pedido.`,
        pin_locked: LOCKED_CODE_MESSAGE,
        cod_amount_mismatch: `Debe cobrar exactamente ${formatPrice(result.expected_minor ?? 0)}. Sin el monto completo no se entrega.`,
        recipient_required: "Escriba el nombre de quien recibe.",
      }[result.error];
      refresh();
      return { error: message, values };
    }
    done = result;
  } catch (error) {
    return { error: messageOf(error), values };
  }
  redirect(done.route_completed ? "/ruta?fin=1" : "/ruta?entregado=1");
}

export async function failStop(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const stopId = uuid(formData, "stopId");
  const reason = z
    .enum(["nobody_home", "wrong_address", "refused", "cannot_pay", "unsafe", "damaged", "other"])
    .safeParse(formData.get("reason"));
  if (!stopId.success) return { error: GENERIC_ERROR };
  if (!reason.success) return { error: "Elija por qué no se pudo entregar." };

  const client = await api("/ruta");
  let finished = false;
  try {
    const result = await client.driverFailStop({
      stopId: stopId.data,
      reason: reason.data,
      ...position(formData),
    });
    finished = result.route_completed;
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect(finished ? "/ruta?fin=1" : "/ruta?fallida=1");
}

/** Called by the open route screen every so often. Failures are ignored: the next one will do. */
export async function reportPosition(lat: number, lng: number, accuracy: number): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(await getViewer())) return;
  try {
    await (await sessionApi()).driverReportPosition(
      lat,
      lng,
      Number.isFinite(accuracy) ? accuracy : undefined,
    );
  } catch {
    // Not on a route, or offline for a moment.
  }
}

// ── Warehouse ───────────────────────────────────────────────────────────────

export async function startPicking(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shipmentId = uuid(formData, "shipmentId");
  if (!shipmentId.success) return { error: GENERIC_ERROR };
  const client = await api("/bodega");
  const state = await attempt(async () => {
    await client.wmsStartPicking(shipmentId.data);
    return "Alisto iniciado.";
  });
  if (state.ok) refresh();
  return state;
}

export async function confirmPick(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "code", "quantity");
  const parsed = z
    .object({
      shipmentId: z.uuid(),
      taskId: z.uuid(),
      quantity: z.coerce.number().int().min(0).max(100_000),
    })
    .safeParse({
      shipmentId: formData.get("shipmentId"),
      taskId: formData.get("taskId"),
      quantity: values.quantity === "" ? Number.NaN : values.quantity,
    });
  if (!parsed.success) return { error: "Escriba cuántas unidades tomó.", values };

  const client = await api("/bodega");
  try {
    // The scan is checked against the task on the server: the screen is never
    // trusted to say that the right product was picked.
    const shipment = await client.wmsShipment(parsed.data.shipmentId);
    const task = shipment.tasks.find((candidate) => candidate.task_id === parsed.data.taskId);
    if (!task)
      return { error: "Esa línea ya no está en este paquete. Actualice la pantalla.", values };
    // What was scanned or typed goes as it came: the database compares it with
    // the product's own codes (any usual spelling of the barcode) and refuses
    // another product's, so the screen is never what decides.
    await client.wmsConfirmPick(
      parsed.data.taskId,
      parsed.data.quantity,
      task.location_id,
      (values.code ?? "").slice(0, 200) || null,
    );
  } catch (error) {
    // A wrong product empties the field for the next scan.
    const wrong = error instanceof ApiError && error.code === "scanned_wrong_item";
    return { error: messageOf(error), values: wrong ? { ...values, code: "" } : values };
  }
  refresh();
  return { ok: "Línea confirmada." };
}

export async function packShipment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "weightGrams", "packageCount");
  const parsed = z
    .object({
      shipmentId: z.uuid(),
      weightGrams: z.coerce.number().int().min(1).max(30_000),
      packageCount: z.coerce.number().int().min(1).max(20),
    })
    .safeParse({
      shipmentId: formData.get("shipmentId"),
      weightGrams: values.weightGrams === "" ? Number.NaN : values.weightGrams,
      packageCount: values.packageCount || 1,
    });
  if (!parsed.success) return { error: "Escriba el peso en gramos y cuántos bultos son.", values };

  const client = await api("/bodega");
  const state = await attempt(async () => {
    await client.wmsPackShipment(
      parsed.data.shipmentId,
      parsed.data.weightGrams,
      parsed.data.packageCount,
    );
    return "Empacado. Llévelo a la zona de despacho.";
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function receiveLine(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "good", "damaged");
  const parsed = z
    .object({
      inboundLineId: z.uuid(),
      locationId: z.uuid("Elija dónde lo guarda."),
      goodQuantity: z.coerce.number().int().min(0).max(100_000),
      damagedQuantity: z.coerce.number().int().min(0).max(100_000),
    })
    .safeParse({
      inboundLineId: formData.get("inboundLineId"),
      locationId: formData.get("locationId"),
      goodQuantity: values.good || 0,
      damagedQuantity: values.damaged || 0,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR, values };
  if (parsed.data.goodQuantity + parsed.data.damagedQuantity === 0) {
    return { error: "Indique cuántas unidades recibió.", values };
  }

  const client = await api("/bodega");
  const state = await attempt(async () => {
    await client.wmsReceive(parsed.data);
    return "Recepción registrada.";
  }, values);
  if (state.ok) refresh();
  return state;
}
