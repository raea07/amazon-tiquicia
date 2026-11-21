"use server";

/**
 * Server Actions for people management and seller payouts: staff, drivers,
 * warehouse workers, sellers' bank-detail requests and payout runs.
 *
 * Same rules as the other actions: each one re-reads the session, validates
 * its input so the message can be specific, and calls the API. The database
 * checks the caller's role and the same formats again; nothing here grants
 * anything.
 */

import { parseIdentification, parsePhone } from "@yuntera/core";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { STAFF_ROLE } from "@/lib/labels";
import { WAREHOUSE_ROLE } from "@/lib/people-labels";
import { currentStaff } from "@/lib/staff";

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

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const uuid = (formData: FormData, name: string) => z.uuid().safeParse(formData.get(name));
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// ── Staff ───────────────────────────────────────────────────────────────────

/** Gives a role, changes it, or withdraws access. `access` is "active" or "inactive". */
export async function setStaff(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "email", "role", "access");
  const email = (values.email ?? "").trim().toLowerCase();
  const role = z.enum(["admin", "ops", "support", "finance", "catalog"]).safeParse(values.role);
  const active = values.access !== "inactive";
  if (!EMAIL.test(email)) {
    return { error: "Escriba el correo con el que la persona ingresa a Yuntera.", values };
  }
  if (!role.success) return { error: "Elija el rol.", values };
  return staffAction(
    "/personal",
    async (api) => {
      await api.opsSetStaff(email, role.data, active);
      return active
        ? `Listo: ${email} tiene acceso como ${STAFF_ROLE[role.data]}. Aplica desde su próximo clic.`
        : `Listo: ${email} ya no tiene acceso a la consola. Aplica de inmediato.`;
    },
    values,
  );
}

// ── Drivers ─────────────────────────────────────────────────────────────────

const DRIVER_FIELDS = [
  "email",
  "fullName",
  "phone",
  "idType",
  "idNumber",
  "vehicleType",
  "plate",
  "capacityKg",
  "licenseClass",
  "licenseExpiresOn",
  "inspectionExpiresOn",
  "insuranceExpiresOn",
] as const;

/** A date field: null when empty, the date when well formed, false when not. */
function dateField(value: string | undefined): string | null | false {
  const day = (value ?? "").trim();
  if (day === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return false;
  }
  return day;
}

/** Creates the driver record of an existing account, or corrects an existing record. */
export async function saveDriver(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, ...DRIVER_FIELDS);
  const editing = String(formData.get("driverId") ?? "") !== "";
  const driverId = uuid(formData, "driverId");
  if (editing && !driverId.success) return { error: GENERIC_ERROR, values };

  const email = (values.email ?? "").trim().toLowerCase();
  if (!editing && !EMAIL.test(email)) {
    return { error: "Escriba el correo con el que el repartidor ingresa a Yuntera.", values };
  }
  const fullName = (values.fullName ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < 5 || fullName.length > 120) {
    return { error: "Escriba el nombre completo, con apellidos.", values };
  }
  const phone = parsePhone(values.phone ?? "");
  if (phone?.kind !== "mobile") {
    return { error: "El teléfono debe ser un celular de Costa Rica: 8 dígitos.", values };
  }
  const idType = z.enum(["fisica", "dimex"]).safeParse(values.idType);
  if (!idType.success) return { error: "Elija el tipo de identificación.", values };
  const identification = parseIdentification(values.idNumber ?? "", idType.data);
  if (!identification) {
    return {
      error:
        idType.data === "fisica"
          ? "La cédula física tiene 9 dígitos y no empieza con cero."
          : "El DIMEX tiene 11 o 12 dígitos.",
      values,
    };
  }
  const vehicleType = z.enum(["motorcycle", "car", "van", "bicycle"]).safeParse(values.vehicleType);
  if (!vehicleType.success) return { error: "Elija el tipo de vehículo.", values };
  const motor = vehicleType.data !== "bicycle";

  const plate = (values.plate ?? "").replace(/\s/g, "").toUpperCase();
  if (motor && !/^([A-Z]{1,3}-?)?\d{3,6}$/.test(plate)) {
    return { error: "Escriba la placa, por ejemplo BRT-204 o MOT-482913.", values };
  }
  const capacityKg = Number((values.capacityKg ?? "").trim().replace(",", "."));
  if (!(capacityKg > 0 && capacityKg <= 5000)) {
    return { error: "Escriba cuántos kilos puede cargar, entre 1 y 5 000.", values };
  }
  const licenseClass = (values.licenseClass ?? "").trim().toUpperCase();
  if ((motor || licenseClass !== "") && !/^[A-E][1-4]$/.test(licenseClass)) {
    return { error: "Escriba la clase de licencia, por ejemplo A2 o B1.", values };
  }
  const licenseExpiresOn = dateField(values.licenseExpiresOn);
  const inspectionExpiresOn = dateField(values.inspectionExpiresOn);
  const insuranceExpiresOn = dateField(values.insuranceExpiresOn);
  if (licenseExpiresOn === false || inspectionExpiresOn === false || insuranceExpiresOn === false) {
    return { error: "Una de las fechas de vencimiento no es válida.", values };
  }
  if (motor && !(licenseExpiresOn && inspectionExpiresOn && insuranceExpiresOn)) {
    return {
      error:
        "Para un vehículo de motor hacen falta las tres fechas de vencimiento: licencia, revisión técnica y seguro.",
      values,
    };
  }

  return staffAction(
    "/repartidores",
    async (api) => {
      await api.opsSaveDriver({
        driverId: editing ? driverId.data : null,
        email: editing ? null : email,
        fullName,
        phone: phone.e164,
        idType: idType.data,
        idNumber: identification.value,
        vehicleType: vehicleType.data,
        plate: motor ? plate : null,
        capacityKg: Math.round(capacityKg * 10) / 10,
        licenseClass: licenseClass || null,
        licenseExpiresOn,
        inspectionExpiresOn,
        insuranceExpiresOn,
      });
      return editing
        ? "Datos del repartidor actualizados."
        : "Repartidor registrado. Queda por aprobar: actívelo cuando haya visto sus documentos.";
    },
    values,
  );
}

// ── Warehouse workers ───────────────────────────────────────────────────────

/** Adds a worker, changes their position, or (position "remove") takes them off the site. */
export async function setWarehouseStaff(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "email", "role");
  const warehouseId = uuid(formData, "warehouseId");
  const email = (values.email ?? "").trim().toLowerCase();
  const role = z.enum(["associate", "lead", "remove"]).safeParse(values.role);
  if (!warehouseId.success) return { error: GENERIC_ERROR, values };
  if (!EMAIL.test(email)) {
    return { error: "Escriba el correo con el que la persona ingresa a Yuntera.", values };
  }
  if (!role.success) return { error: "Elija el puesto.", values };
  return staffAction(
    "/bodegas",
    async (api) => {
      const position = role.data === "remove" ? null : role.data;
      await api.opsSetWarehouseStaff(warehouseId.data, email, position);
      return position
        ? `Listo: ${email} trabaja en esta bodega como ${WAREHOUSE_ROLE[position]}.`
        : `Listo: ${email} ya no trabaja en esta bodega.`;
    },
    values,
  );
}

// ── Sellers' bank details ───────────────────────────────────────────────────

export async function decidePayoutDetails(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestId = uuid(formData, "requestId");
  if (!requestId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const note = text(formData, "note");
  if (!approve && note.length < 10) {
    return {
      error: "Para rechazar, explique el motivo: el vendedor lo va a leer.",
      values: typed(formData, "note"),
    };
  }
  if (!(await currentStaff())) redirectTo(signInPath("/pagos-vendedores"));
  try {
    await (await sessionApi()).opsDecidePayoutDetails(requestId.data, approve, note || null);
  } catch (error) {
    return { error: messageOf(error), values: typed(formData, "note") };
  }
  // The card that held the form is gone once the request is decided, so the
  // confirmation is shown by the page itself.
  redirectTo(`/pagos-vendedores?resuelta=${approve ? "aprobada" : "rechazada"}`);
}

// ── Payouts ─────────────────────────────────────────────────────────────────

/** Creates (or completes) the run for a cut-off and opens it. */
export async function createPayoutRun(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/pagos-vendedores"));
  const cutoff = dateField(String(formData.get("cutoff") ?? ""));
  if (!cutoff) return { error: "Elija la fecha de corte." };
  let runId: string;
  try {
    runId = (await (await sessionApi()).opsCreatePayoutRun(cutoff)).run_id;
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirectTo(`/pagos-vendedores/corridas/${runId}`);
}

export async function markPayoutPaid(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const payoutId = uuid(formData, "payoutId");
  const values = typed(formData, "bankReference");
  const reference = (values.bankReference ?? "").trim();
  if (!payoutId.success) return { error: GENERIC_ERROR, values };
  if (reference.length < 4 || reference.length > 60) {
    return { error: "Escriba el número de comprobante que le dio el banco.", values };
  }
  return staffAction(
    "/pagos-vendedores",
    async (api) => {
      await api.opsMarkPayoutPaid(payoutId.data, reference);
      return "Pago registrado. El vendedor ya lo ve con este comprobante.";
    },
    values,
  );
}

export async function markPayoutFailed(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const payoutId = uuid(formData, "payoutId");
  const values = typed(formData, "note");
  const reason = (values.note ?? "").trim();
  if (!payoutId.success) return { error: GENERIC_ERROR, values };
  if (reason.length < 5) {
    return { error: "Explique por qué no se pagó: el vendedor lo va a leer.", values };
  }
  return staffAction(
    "/pagos-vendedores",
    async (api) => {
      await api.opsMarkPayoutFailed(payoutId.data, reason);
      return "Registrado. El monto vuelve a estar disponible para la próxima corrida.";
    },
    values,
  );
}
