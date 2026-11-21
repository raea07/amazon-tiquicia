/**
 * People management and seller payouts.
 *
 *   People   who is staff, drivers' records, who works in each warehouse.
 *   Bank     a seller asks for a new payout account; finance approves it.
 *   Payouts  the three balances, the preview for a cut-off, runs, and marking
 *            each transfer paid or failed.
 *
 * The database side is supabase/migrations/20261121082300_people_payouts.sql.
 * A full account number appears in exactly two payloads, both for finance
 * staff: a request waiting for a decision, and a run's transfer list.
 */

import { z } from "zod";
import { auditEntry, opsDriverRow, sellerStatus, staffRole } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const money = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const identificationType = z.enum(["fisica", "juridica", "dimex", "nite"]);

// ── People ──────────────────────────────────────────────────────────────────

export const opsStaffMember = z.object({
  user_id: id,
  full_name: z.string().nullable(),
  email: z.string(),
  role: staffRole,
  active: z.boolean(),
  since: timestamp,
  /** True for the row of the person asking, so the screen can say "usted". */
  is_you: z.boolean(),
});
export type OpsStaffMember = z.infer<typeof opsStaffMember>;

/** A driver's whole record: what the list shows plus what the edit form needs. */
export const opsDriverRecord = opsDriverRow.extend({
  email: z.string(),
  id_type: identificationType,
  id_number: z.string(),
  license_class: z.string().nullable(),
});
export type OpsDriverRecord = z.infer<typeof opsDriverRecord>;

export const warehouseRole = z.enum(["associate", "lead"]);
export type WarehouseRole = z.infer<typeof warehouseRole>;

export const opsWarehouseTeam = z.object({
  id,
  code: z.string(),
  name: z.string(),
  address: z.string(),
  active: z.boolean(),
  staff: z.array(
    z.object({
      user_id: id,
      full_name: z.string().nullable(),
      email: z.string(),
      role: warehouseRole,
      since: timestamp,
    }),
  ),
});
export type OpsWarehouseTeam = z.infer<typeof opsWarehouseTeam>;

/** An audit entry with the names of who did it and who or what it was done to. */
export const auditTrailEntry = auditEntry.extend({
  actor_name: z.string().nullable(),
  subject: z.string().nullable(),
});
export type AuditTrailEntry = z.infer<typeof auditTrailEntry>;

export interface SaveDriverInput {
  /** Set to correct an existing record; omit to create one for `email`. */
  driverId?: string | null;
  /** The account the new driver signs in with. Ignored when editing. */
  email?: string | null;
  fullName: string;
  /** E.164, a Costa Rican mobile: +506 and eight digits. */
  phone: string;
  idType: "fisica" | "dimex";
  idNumber: string;
  vehicleType: OpsDriverRecord["vehicle_type"];
  plate: string | null;
  capacityKg: number;
  licenseClass: string | null;
  licenseExpiresOn: string | null;
  inspectionExpiresOn: string | null;
  insuranceExpiresOn: string | null;
}

// ── Sellers' bank details ───────────────────────────────────────────────────

const currentAccount = z.object({
  iban_masked: z.string().nullable(),
  holder_name: z.string().nullable(),
  sinpe_number: z.string().nullable(),
  /**
   * Whether finance approved the account on file (limits migration). One
   * entered before approvals existed is not, and is not paid until it is.
   */
  approved: z.boolean().optional(),
});

/** What a seller sees: masked numbers and the state of their latest request. */
export const sellerPayoutDetails = z.object({
  /** Only the shop's owner or an administrator may ask for a change. */
  can_request: z.boolean(),
  current: currentAccount,
  request: z
    .object({
      id,
      status: z.enum(["pending", "approved", "rejected"]),
      iban_masked: z.string(),
      holder_name: z.string(),
      sinpe_number: z.string().nullable(),
      requested_at: timestamp,
      requested_by_name: z.string().nullable(),
      decided_at: timestamp.nullable(),
      /** Finance's explanation; always present on a rejection. */
      note: z.string().nullable(),
    })
    .nullable(),
});
export type SellerPayoutDetails = z.infer<typeof sellerPayoutDetails>;

/** A request in finance's queue. */
export const payoutDetailRequest = z.object({
  id,
  status: z.enum(["pending", "approved", "rejected"]),
  requested_at: timestamp,
  requested_by_name: z.string().nullable(),
  requested_by_email: z.string(),
  seller: z.object({
    id,
    trade_name: z.string(),
    status: sellerStatus,
    legal_name: z.string(),
    id_type: identificationType,
    id_number: z.string(),
    /** The number already on file: the one to call to confirm the change. */
    contact_phone: z.string(),
    contact_email: z.string(),
    since: timestamp,
  }),
  current: currentAccount,
  requested: z.object({
    /** In full while the request waits for a decision; null afterwards. */
    iban: z.string().nullable(),
    iban_masked: z.string(),
    holder_name: z.string(),
    sinpe_number: z.string().nullable(),
  }),
  signals: z.object({
    first_account: z.boolean(),
    holder_differs: z.boolean(),
    used_by_other_shop: z.boolean(),
    /** The shop's contact phone or e-mail changed in the 30 days before the request. */
    contact_changed_recently: z.boolean(),
  }),
  decided_at: timestamp.nullable(),
  decided_by_name: z.string().nullable(),
  note: z.string().nullable(),
});
export type PayoutDetailRequest = z.infer<typeof payoutDetailRequest>;

// ── Payouts ─────────────────────────────────────────────────────────────────

/** Why a shop with money available is not paid in a run. */
export const payoutBlock = z.enum([
  "shop_suspended",
  "no_bank_details",
  "invalid_bank_details",
  "below_minimum",
]);
export type PayoutBlock = z.infer<typeof payoutBlock>;

export const payoutStatus = z.enum(["scheduled", "paid", "failed"]);
export type PayoutStatus = z.infer<typeof payoutStatus>;

export const payoutPreview = z.object({
  cutoff_on: date,
  today: date,
  hold_days: z.number().int(),
  minimum_minor: money,
  /** Orders delivered up to this day are out of their hold at the cut-off. */
  delivered_through: date,
  /** The run that already exists for this cut-off, if any. */
  run: z.object({ id, code: z.string() }).nullable(),
  to_pay_count: z.number().int(),
  to_pay_minor: money,
  sellers: z.array(
    z.object({
      seller_id: id,
      trade_name: z.string(),
      seller_status: sellerStatus,
      payable_minor: money,
      available_minor: money,
      pending_minor: money,
      in_transit_minor: money,
      iban_masked: z.string().nullable(),
      holder_name: z.string().nullable(),
      will_pay: z.boolean(),
      reasons: z.array(payoutBlock),
      details_request_pending: z.boolean(),
    }),
  ),
});
export type PayoutPreview = z.infer<typeof payoutPreview>;

export const createdPayoutRun = z.object({
  run_id: id,
  code: z.string(),
  /** Payouts scheduled by this call; zero when the run already covered everyone. */
  created: z.number().int(),
  total_minor: money,
});
export type CreatedPayoutRun = z.infer<typeof createdPayoutRun>;

export const payoutRunSummary = z.object({
  id,
  code: z.string(),
  cutoff_on: date,
  created_at: timestamp,
  created_by_name: z.string().nullable(),
  scheduled: z.number().int(),
  paid: z.number().int(),
  failed: z.number().int(),
  scheduled_minor: money,
  paid_minor: money,
});
export type PayoutRunSummary = z.infer<typeof payoutRunSummary>;

/** One run with its payouts. Scheduled ones are the transfer list for the bank. */
export const payoutRun = z.object({
  run: z.object({
    id,
    code: z.string(),
    cutoff_on: date,
    hold_days: z.number().int(),
    minimum_minor: money,
    created_at: timestamp,
    created_by_name: z.string().nullable(),
  }),
  payouts: z.array(
    z.object({
      id,
      seller_id: id,
      trade_name: z.string(),
      legal_name: z.string(),
      id_number: z.string(),
      status: payoutStatus,
      amount_minor: money,
      /** The text for the transfer's description. */
      reference: z.string(),
      /** In full: finance types or uploads it at the bank. */
      iban: z.string(),
      holder_name: z.string(),
      bank_reference: z.string().nullable(),
      paid_at: timestamp.nullable(),
      failed_at: timestamp.nullable(),
      failure_reason: z.string().nullable(),
      /** The shop's approved account changed after this payout was scheduled. */
      account_changed: z.boolean(),
    }),
  ),
});
export type PayoutRun = z.infer<typeof payoutRun>;

/** The seller's money screen. The three balances add up to `payable_minor`. */
export const sellerPayouts = z.object({
  as_of: date,
  hold_days: z.number().int(),
  minimum_minor: money,
  payable_minor: money,
  available_minor: money,
  pending_minor: money,
  in_transit_minor: money,
  /** Sales delivered up to this day are out of their hold today. */
  delivered_through: date,
  /** The pending part by the day it becomes available … */
  releases: z.array(z.object({ on: date, amount_minor: money })),
  /** … and the part with no day yet, because the order is still on its way. */
  awaiting_delivery_minor: money,
  blocked_by: z.array(payoutBlock),
  account: z.object({
    iban_masked: z.string().nullable(),
    holder_name: z.string().nullable(),
  }),
  payouts: z.array(
    z.object({
      id,
      reference: z.string().nullable(),
      status: payoutStatus,
      amount_minor: money,
      cutoff_on: date.nullable(),
      scheduled_at: timestamp,
      paid_at: timestamp.nullable(),
      bank_reference: z.string().nullable(),
      failed_at: timestamp.nullable(),
      failure_reason: z.string().nullable(),
      iban_masked: z.string().nullable(),
    }),
  ),
});
export type SellerPayouts = z.infer<typeof sellerPayouts>;

// ── Messages ────────────────────────────────────────────────────────────────

export const errors = {
  account_not_found: {
    "es-CR":
      "No hay ninguna cuenta con ese correo. La persona debe crear su cuenta primero, con ese mismo correo.",
    en: "There is no account with that e-mail. The person must create their account first, with that same e-mail.",
  },
  staff_not_found: {
    "es-CR": "Esa persona no forma parte del personal.",
    en: "That person is not a member of staff.",
  },
  last_admin: {
    "es-CR":
      "La plataforma debe tener siempre al menos una persona administradora activa. Nombre a otra antes de hacer este cambio.",
    en: "The platform must always have at least one active administrator. Appoint another before making this change.",
  },
  driver_already_exists: {
    "es-CR": "Esa cuenta ya tiene un registro de repartidor. Búsquelo en la lista y edítelo.",
    en: "That account already has a driver record. Find it in the list and edit it.",
  },
  driver_not_found: {
    "es-CR": "No encontramos ese repartidor.",
    en: "We could not find that driver.",
  },
  invalid_driver_name: {
    "es-CR": "Escriba el nombre completo del repartidor.",
    en: "Enter the driver's full name.",
  },
  invalid_driver_phone: {
    "es-CR": "El teléfono del repartidor debe ser un celular de Costa Rica, de 8 dígitos.",
    en: "The driver's phone must be a Costa Rican mobile number, 8 digits long.",
  },
  invalid_driver_identification: {
    "es-CR":
      "La identificación no es válida: una cédula física tiene 9 dígitos y un DIMEX tiene 11 o 12.",
    en: "The identification is not valid: a cédula has 9 digits and a DIMEX has 11 or 12.",
  },
  invalid_driver_vehicle: {
    "es-CR": "Revise el vehículo: la placa y la capacidad de carga en kilos.",
    en: "Check the vehicle: the plate and the load capacity in kilos.",
  },
  invalid_driver_documents: {
    "es-CR":
      "Revise los documentos: la clase de licencia y las fechas de vencimiento de la licencia, la revisión técnica y el seguro.",
    en: "Check the documents: the licence class and the expiry dates of the licence, the technical inspection and the insurance.",
  },
  invalid_warehouse_role: {
    "es-CR": "Elija el puesto: auxiliar o líder de bodega.",
    en: "Choose the position: associate or lead.",
  },
  warehouse_staff_not_found: {
    "es-CR": "Esa persona no trabaja en esa bodega.",
    en: "That person does not work in that warehouse.",
  },
  invalid_iban: {
    "es-CR":
      "La cuenta IBAN no es válida. Empieza con CR y sigue con 20 dígitos; revise que no falte ni sobre ninguno.",
    en: "The IBAN is not valid. It starts with CR followed by 20 digits; check that none is missing or extra.",
  },
  invalid_account_holder: {
    "es-CR": "Escriba el nombre completo del titular de la cuenta, tal como aparece en el banco.",
    en: "Enter the full name of the account holder, as it appears at the bank.",
  },
  invalid_sinpe_number: {
    "es-CR": "El número de SINPE Móvil debe ser un celular de Costa Rica, de 8 dígitos.",
    en: "The SINPE Móvil number must be a Costa Rican mobile number, 8 digits long.",
  },
  payout_details_unchanged: {
    "es-CR": "Esos son los datos que ya tenemos registrados. No hay nada que cambiar.",
    en: "Those are the details we already have on file. There is nothing to change.",
  },
  payout_request_not_found: {
    "es-CR": "No encontramos esa solicitud.",
    en: "We could not find that request.",
  },
  payout_request_not_pending: {
    "es-CR": "Esa solicitud ya fue resuelta. Actualice la página.",
    en: "That request has already been decided. Refresh the page.",
  },
  cannot_decide_own_request: {
    "es-CR":
      "No puede resolver una solicitud hecha por usted. Debe revisarla otra persona de finanzas.",
    en: "You cannot decide a request you made yourself. Someone else in finance must review it.",
  },
  cannot_decide_own_shop: {
    "es-CR":
      "No puede resolver un cambio de cuenta de una tienda de la que usted forma parte. Debe revisarlo otra persona de finanzas.",
    en: "You cannot decide an account change for a shop you belong to. Someone else in finance must review it.",
  },
  invalid_cutoff: {
    "es-CR": "La fecha de corte no puede ser posterior a hoy.",
    en: "The cut-off date cannot be later than today.",
  },
  nothing_to_pay: {
    "es-CR": "Con esa fecha de corte no hay ningún vendedor por pagar.",
    en: "With that cut-off date there is no seller to pay.",
  },
  payout_run_not_found: {
    "es-CR": "No encontramos esa corrida de pagos.",
    en: "We could not find that payout run.",
  },
  payout_not_found: {
    "es-CR": "No encontramos ese pago.",
    en: "We could not find that payout.",
  },
  payout_not_scheduled: {
    "es-CR": "Ese pago ya fue marcado como pagado o como fallido. Actualice la página.",
    en: "That payout has already been marked as paid or failed. Refresh the page.",
  },
  invalid_bank_reference: {
    "es-CR": "Escriba el número de comprobante del banco, de 4 a 60 caracteres.",
    en: "Enter the bank's reference number, 4 to 60 characters long.",
  },
  bank_reference_used: {
    "es-CR": "Ese comprobante ya está registrado en otro pago. Revise el número.",
    en: "That reference is already recorded on another payout. Check the number.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const api = ({ call, run }: Caller) => ({
  // People
  opsStaff: () => call("ops_staff", {}, z.array(opsStaffMember)),
  /** Gives an existing account a staff role, changes it, or (active false) switches it off. */
  opsSetStaff: (email: string, role: z.infer<typeof staffRole>, active = true) =>
    run("ops_set_staff", { p_email: email, p_role: role, p_active: active }),
  /** Replaces the first version of this method: the rows now carry the whole record. */
  opsDrivers: () => call("ops_drivers", {}, z.array(opsDriverRecord)),
  opsSaveDriver: (input: SaveDriverInput) =>
    call(
      "ops_save_driver",
      {
        p_full_name: input.fullName,
        p_phone: input.phone,
        p_id_type: input.idType,
        p_id_number: input.idNumber,
        p_vehicle_type: input.vehicleType,
        p_plate: input.plate,
        p_capacity_kg: input.capacityKg,
        p_license_class: input.licenseClass,
        p_license_expires_on: input.licenseExpiresOn,
        p_inspection_expires_on: input.inspectionExpiresOn,
        p_insurance_expires_on: input.insuranceExpiresOn,
        p_email: input.email ?? undefined,
        p_driver_id: input.driverId ?? undefined,
      },
      z.uuid(),
    ),
  opsWarehouseStaff: () => call("ops_warehouse_staff", {}, z.array(opsWarehouseTeam)),
  /** Adds a worker, changes their position, or (role null) removes them. */
  opsSetWarehouseStaff: (warehouseId: string, email: string, role: WarehouseRole | null) =>
    run("ops_set_warehouse_staff", {
      p_warehouse_id: warehouseId,
      p_email: email,
      p_role: role,
    }),
  /** Replaces the first version of this method: entries now name who and whom. */
  auditEntries: (table?: string | null, limit?: number) =>
    call(
      "audit_entries",
      { p_table: table ?? undefined, p_limit: limit },
      z.array(auditTrailEntry),
    ),

  // Sellers' bank details
  sellerPayoutDetails: (sellerId: string) =>
    call("seller_payout_details", { p_seller_id: sellerId }, sellerPayoutDetails),
  sellerRequestPayoutDetails: (input: {
    sellerId: string;
    iban: string;
    holderName: string;
    sinpeNumber?: string | null;
  }) =>
    call(
      "seller_request_payout_details",
      {
        p_seller_id: input.sellerId,
        p_iban: input.iban,
        p_holder_name: input.holderName,
        p_sinpe_number: input.sinpeNumber ?? null,
      },
      z.uuid(),
    ),
  opsPayoutDetailRequests: (status: "pending" | "approved" | "rejected" | null = "pending") =>
    call("ops_payout_detail_requests", { p_status: status }, z.array(payoutDetailRequest)),
  opsDecidePayoutDetails: (requestId: string, approve: boolean, note?: string | null) =>
    run("ops_decide_payout_details", {
      p_request_id: requestId,
      p_approve: approve,
      p_note: note ?? undefined,
    }),

  // Payouts
  /** What a run for this cut-off (today when omitted) would pay. */
  opsPayoutPreview: (cutoff?: string | null) =>
    call("ops_payout_preview", { p_cutoff: cutoff ?? undefined }, payoutPreview),
  opsCreatePayoutRun: (cutoff: string) =>
    call("ops_create_payout_run", { p_cutoff: cutoff }, createdPayoutRun),
  opsPayoutRuns: () => call("ops_payout_runs", {}, z.array(payoutRunSummary)),
  opsPayoutRun: (runId: string) => call("ops_payout_run", { p_run_id: runId }, payoutRun),
  opsMarkPayoutPaid: (payoutId: string, bankReference: string) =>
    run("ops_mark_payout_paid", { p_payout_id: payoutId, p_bank_reference: bankReference }),
  opsMarkPayoutFailed: (payoutId: string, reason: string) =>
    run("ops_mark_payout_failed", { p_payout_id: payoutId, p_reason: reason }),
  sellerPayouts: (sellerId: string) =>
    call("seller_payouts", { p_seller_id: sellerId }, sellerPayouts),
});
