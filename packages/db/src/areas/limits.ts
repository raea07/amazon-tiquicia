/**
 * Limits against abuse and the rules that need a function: drivers who lose
 * access, joining a shop by invitation, changes to a shop's name, fiscal
 * details and contact that staff approve, consents, and the messages for every
 * limit the database enforces.
 *
 * SQL: supabase/migrations/20261121083000_limits.sql.
 */

import { z } from "zod";
import { careQueues, sellerStatus, wmsBoard } from "../schemas";
import type { Caller, Messages } from "./types";

const id = z.uuid();
const timestamp = z.string().min(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Drivers who left: routes back in dispatch ───────────────────────────────

export const releasedRoute = z.object({
  route_id: id,
  code: z.string(),
  status: z.enum(["draft", "assigned", "in_progress", "completed", "cancelled"]),
  service_date: date,
  released_at: timestamp,
  reason: z.enum(["driver_suspended", "driver_offboarded", "driver_pending"]).nullable(),
  from_driver_name: z.string(),
  /** For a route that was being driven: the route whose remaining stops this one took. */
  from_route_code: z.string().nullable(),
  /** Who has it now, once staff reassign it. */
  driver_name: z.string().nullable(),
  stops: z.number().int(),
  /** Parcels the driver who left still has with them. */
  parcels_out: z.number().int(),
});
export type ReleasedRoute = z.infer<typeof releasedRoute>;

// ── Shops sharing an identification number ──────────────────────────────────

export const sellerIdClash = z.object({
  seller_id: id,
  shared_with: z.array(
    z.object({
      seller_id: id,
      trade_name: z.string(),
      status: sellerStatus,
      kyc_status: z.enum(["pending", "verified", "rejected"]),
    }),
  ),
});
export type SellerIdClash = z.infer<typeof sellerIdClash>;

// ── The shop's team ─────────────────────────────────────────────────────────

export const memberRole = z.enum(["owner", "admin", "staff"]);
export type MemberRole = z.infer<typeof memberRole>;
export type InvitableRole = Exclude<MemberRole, "owner">;

export const sellerTeam = z.object({
  /** Owners and administrators manage the team. */
  can_manage: z.boolean(),
  is_owner: z.boolean(),
  members: z.array(
    z.object({
      user_id: id,
      full_name: z.string().nullable(),
      /** Shown to administrators only. */
      email: z.string().nullable(),
      role: memberRole,
      since: timestamp,
      is_you: z.boolean(),
    }),
  ),
  /** Invitations waiting for an answer; empty for members who do not manage. */
  invitations: z.array(
    z.object({
      id,
      email: z.string(),
      role: memberRole,
      created_at: timestamp,
      expires_at: timestamp,
      invited_by_name: z.string().nullable(),
    }),
  ),
});
export type SellerTeam = z.infer<typeof sellerTeam>;

export const myInvitation = z.object({
  id,
  role: memberRole,
  created_at: timestamp,
  expires_at: timestamp,
  shop: z.object({ id, trade_name: z.string(), status: sellerStatus }),
  /** The first name of who invited them. */
  invited_by_name: z.string().nullable(),
});
export type MyInvitation = z.infer<typeof myInvitation>;

// ── Changes to the shop's details ───────────────────────────────────────────

/** "description": the shop's public description (20261121083600_seller_listings.sql). */
export const shopChangeKind = z.enum(["shop_name", "fiscal", "contact", "description"]);
export type ShopChangeKind = z.infer<typeof shopChangeKind>;

/** What a request proposes, or what the shop has; the fields depend on the kind. */
export const shopDetails = z.object({
  trade_name: z.string().optional(),
  tax_regime: z.enum(["general", "simplificado"]).optional(),
  fiscal_address: z.string().optional(),
  postal_code: z.string().nullable().optional(),
  economic_activity_code: z.string().nullable().optional(),
  contact_email: z.string().optional(),
  contact_phone: z.string().optional(),
  /** Plain text, shown as text; null asks to remove it. */
  description: z.string().nullable().optional(),
});
export type ShopDetails = z.infer<typeof shopDetails>;

const shopChangeStatus = z.enum(["pending", "approved", "rejected"]);

export const shopChange = z.object({
  id,
  kind: shopChangeKind,
  status: shopChangeStatus,
  proposed: shopDetails,
  requested_at: timestamp,
  requested_by_name: z.string().nullable(),
  decided_at: timestamp.nullable(),
  /** Staff's explanation; always present on a rejection. */
  note: z.string().nullable(),
});
export type ShopChange = z.infer<typeof shopChange>;

export const sellerShopChanges = z.object({
  can_request: z.boolean(),
  /** A change of payout account is waiting, which holds back a change of contact. */
  payout_request_open: z.boolean(),
  /** What is on file, for the forms to start from; null for members who may not ask. */
  current: z
    .object({ fiscal: shopDetails, contact: shopDetails, description: shopDetails.optional() })
    .nullable()
    .optional(),
  /** The latest request of each kind. */
  requests: z.array(shopChange),
});
export type SellerShopChanges = z.infer<typeof sellerShopChanges>;

export const shopChangeRequest = shopChange.extend({
  current: shopDetails.nullable(),
  previous: shopDetails,
  requested_by_email: z.string(),
  decided_by_name: z.string().nullable(),
  seller: z.object({
    id,
    trade_name: z.string(),
    slug: z.string(),
    status: sellerStatus,
    legal_name: z.string(),
    id_type: z.enum(["fisica", "juridica", "dimex", "nite"]),
    id_number: z.string(),
    /** The number on file: the one to call. */
    contact_phone: z.string(),
    kyc_status: z.enum(["pending", "verified", "rejected"]),
  }),
  signals: z.object({
    payout_request_open: z.boolean(),
    /** Why the name could not be approved now, if it could not. */
    name_problem: z.enum(["shop_name_invalid", "shop_name_reserved", "shop_name_taken"]).nullable(),
  }),
  /** False for a request this person asked for, or for a shop they belong to. */
  can_decide: z.boolean(),
});
export type ShopChangeRequest = z.infer<typeof shopChangeRequest>;

export type ShopChangeInput =
  | { sellerId: string; kind: "shop_name"; tradeName: string }
  | {
      sellerId: string;
      kind: "fiscal";
      taxRegime: "general" | "simplificado";
      fiscalAddress: string;
      postalCode?: string | null;
      economicActivityCode?: string | null;
    }
  | { sellerId: string; kind: "contact"; contactEmail: string; contactPhone: string };

/** The care queues with how many items each has in all (each list is a page). */
export const careQueuesPaged = careQueues.extend({
  totals: z.object({
    complaints: z.number().int(),
    returns: z.number().int(),
    reports: z.number().int(),
  }),
});
export type CareQueuesPaged = z.infer<typeof careQueuesPaged>;

/** The warehouse board with how many inbound shipments are open in all. */
export const wmsBoardPaged = wmsBoard.extend({ inbound_total: z.number().int() });
export type WmsBoardPaged = z.infer<typeof wmsBoardPaged>;

/** How many items a staff list shows at most; the rest follow as these are decided. */
export const STAFF_QUEUE_PAGE = 100;

export type ConsentPurpose =
  | "terms"
  | "privacy"
  | "marketing"
  | "location"
  | "driver_terms"
  | "seller_terms";

// ── Messages ────────────────────────────────────────────────────────────────

const SUPPORT = "ayuda@yuntera.cr";

export const limitsErrors = {
  // Shops that may not trade
  shop_not_active: {
    "es-CR":
      "Su tienda no está activa, así que esto no se puede hacer por ahora. Puede seguir preparando borradores; si cree que es un error, escríbanos.",
    en: "Your shop is not active, so this cannot be done for now. You can keep preparing drafts; if you think this is a mistake, write to us.",
  },
  shop_not_approved: {
    "es-CR":
      "Su tienda todavía no está verificada. Podrá hacer esto cuando la aprobemos; mientras tanto puede preparar borradores.",
    en: "Your shop has not been verified yet. You can do this once we approve it; meanwhile you can prepare drafts.",
  },
  shop_closed: {
    "es-CR": `Su tienda está cerrada: puede consultar sus datos, pero no cambiarlos. Si quiere reabrirla, escríbanos a ${SUPPORT}.`,
    en: `Your shop is closed: you can read its data but not change it. To reopen it, write to ${SUPPORT}.`,
  },
  listing_shop_not_active: {
    "es-CR":
      "La tienda que creó este producto todavía no está verificada o no está activa, así que no se puede publicar. Verifique la tienda primero, o rechace el producto.",
    en: "The shop that created this listing is not verified or not active, so it cannot be published. Verify the shop first, or reject the listing.",
  },
  // Registration and names
  shop_registration_pending: {
    "es-CR": "Ya tiene una tienda en verificación. Cuando la revisemos podrá registrar otra.",
    en: "You already have a shop being verified. Once we review it you can register another.",
  },
  invalid_identification: {
    "es-CR": "El número de identificación no es válido para ese tipo. Revíselo e intente de nuevo.",
    en: "The identification number is not valid for that type. Check it and try again.",
  },
  invalid_shop_details: {
    "es-CR":
      "Revise los datos de la tienda: el nombre legal, el correo, el teléfono de 8 dígitos y la dirección fiscal completa.",
    en: "Check the shop's details: the legal name, the e-mail, the 8-digit phone and the full fiscal address.",
  },
  shop_name_invalid: {
    "es-CR":
      "El nombre de la tienda debe tener entre 2 y 80 caracteres, con letras, números y signos comunes.",
    en: "The shop's name must have 2 to 80 characters: letters, numbers and common punctuation.",
  },
  shop_name_reserved: {
    "es-CR":
      "Ese nombre no se puede usar porque parece de Yuntera o de su servicio al cliente. Elija otro.",
    en: "That name cannot be used because it looks like Yuntera or its customer service. Choose another.",
  },
  shop_name_taken: {
    "es-CR": "Ya hay una tienda activa con ese nombre. Elija uno que la distinga.",
    en: "An active shop already has that name. Choose one that sets yours apart.",
  },
  identification_verified_elsewhere: {
    "es-CR":
      "Otra tienda ya está verificada con esa identificación. Resuelva cuál es la legítima antes de aprobar esta.",
    en: "Another shop is already verified with that identification. Work out which one is genuine before approving this one.",
  },
  invalid_seller_status: {
    "es-CR": "Elija el estado de la tienda.",
    en: "Choose the shop's status.",
  },
  note_too_long: {
    "es-CR": "La nota es demasiado larga: use como máximo 1000 caracteres.",
    en: "The note is too long: use at most 1,000 characters.",
  },
  // Listings and stock sent to the warehouse
  too_large_for_warehouse: {
    "es-CR":
      "Ese paquete mide más de 120 cm por lado, más de lo que recibe la bodega de Yuntera. Puede venderlo con envío por su cuenta.",
    en: "That package is over 120 cm a side, more than the Yuntera warehouse takes. You can sell it shipped by yourself.",
  },
  package_over_limit: {
    "es-CR":
      "Yuntera no transporta paquetes de más de 30 kg ni de más de 200 cm por lado, con ninguna forma de envío. Revise el peso y las medidas.",
    en: "Yuntera does not carry packages over 30 kg or over 200 cm a side, with any kind of delivery. Check the weight and measurements.",
  },
  too_many_listings_in_review: {
    "es-CR":
      "Tiene muchas publicaciones esperando revisión. Guárdela como borrador y envíela cuando revisemos las que ya mandó.",
    en: "You have many listings waiting for review. Save it as a draft and send it once we review the ones already sent.",
  },
  too_many_draft_listings: {
    "es-CR": "Llegó al máximo de borradores. Envíe o archive algunos antes de crear otro.",
    en: "You reached the maximum number of drafts. Send or archive some before creating another.",
  },
  too_many_open_inbounds: {
    "es-CR":
      "Ya tiene muchos envíos a bodega sin recibir. Podrá anunciar otro en cuanto recibamos alguno de los que ya anunció.",
    en: "You already have many shipments to the warehouse not yet received. You can announce another as soon as we receive one of those.",
  },
  invalid_expected_date: {
    "es-CR": "La fecha de llegada debe ser de hoy en adelante, dentro de los próximos seis meses.",
    en: "The arrival date must be today or later, within the next six months.",
  },
  invalid_driver_status: {
    "es-CR": "Elija el estado del repartidor.",
    en: "Choose the driver's status.",
  },
  // Reports and complaints
  report_target_not_found: {
    "es-CR":
      "No encontramos eso en la tienda: puede que ya no esté publicado. Si quiere avisarnos de otra cosa, escríbanos a " +
      `${SUPPORT}.`,
    en: `We could not find that in the shop: it may no longer be published. To tell us about something else, write to ${SUPPORT}.`,
  },
  invalid_contact_email: {
    "es-CR": "Revise el correo: debe tener la forma nombre@dominio.com.",
    en: "Check the e-mail: it must look like name@domain.com.",
  },
  too_many_open_reports: {
    "es-CR":
      "Tiene muchos reportes esperando respuesta. Le avisamos cuando los revisemos; luego puede enviar otros.",
    en: "You have many reports waiting for an answer. We will let you know when we review them; then you can send more.",
  },
  reports_paused: {
    "es-CR": `En este momento no podemos recibir más reportes por aquí. Intente de nuevo en una hora, o escríbanos ahora a ${SUPPORT} y lo atendemos.`,
    en: `We cannot take more reports here right now. Try again in an hour, or write to ${SUPPORT} now and we will look into it.`,
  },
  too_many_open_complaints: {
    "es-CR":
      "Tiene varias quejas abiertas. Le respondemos pronto; si es urgente, agregue los detalles a una de ellas escribiéndonos.",
    en: "You have several open complaints. We will answer soon; if it is urgent, add the details to one of them by writing to us.",
  },
  // The team
  invalid_member_role: {
    "es-CR": "Elija si la persona será administradora o personal de la tienda.",
    en: "Choose whether the person will be an administrator or staff of the shop.",
  },
  owner_only: {
    "es-CR": "Solo la persona dueña de la tienda puede hacer esto.",
    en: "Only the shop's owner can do this.",
  },
  invalid_invitation_email: {
    "es-CR": "Escriba el correo con que la persona ingresa a Yuntera.",
    en: "Write the e-mail the person signs in to Yuntera with.",
  },
  already_a_member: {
    "es-CR": "Esa persona ya es parte del equipo de la tienda.",
    en: "That person is already on the shop's team.",
  },
  too_many_invitations: {
    "es-CR":
      "Hay muchas invitaciones esperando respuesta. Retire alguna o espere a que la acepten.",
    en: "Many invitations are waiting for an answer. Withdraw one or wait for them to be accepted.",
  },
  team_full: {
    "es-CR":
      "El equipo de la tienda llegó al máximo de personas. Retire a alguien antes de invitar.",
    en: "The shop's team reached its maximum. Remove someone before inviting.",
  },
  invitation_not_found: {
    "es-CR": "Esa invitación ya no está disponible: puede que la retiraran o que venciera.",
    en: "That invitation is no longer available: it may have been withdrawn or expired.",
  },
  member_not_found: {
    "es-CR": "Esa persona no es parte del equipo de la tienda.",
    en: "That person is not on the shop's team.",
  },
  // Changes to the shop's details
  invalid_change_kind: {
    "es-CR": "Elija qué dato de la tienda quiere cambiar.",
    en: "Choose which of the shop's details you want to change.",
  },
  invalid_fiscal_details: {
    "es-CR":
      "Revise los datos fiscales: el régimen, la dirección completa, el código postal del distrito y el código de actividad (4 a 6 dígitos).",
    en: "Check the fiscal details: the regime, the full address, the district's postal code and the activity code (4 to 6 digits).",
  },
  invalid_contact_details: {
    "es-CR": "Revise el correo y el teléfono: el teléfono es de Costa Rica, de 8 dígitos.",
    en: "Check the e-mail and the phone: the phone is Costa Rican, 8 digits.",
  },
  payout_request_open: {
    "es-CR":
      "Hay un cambio de cuenta bancaria en revisión. Para cambiar el teléfono o el correo, espere a que lo resolvamos.",
    en: "A change of bank account is being reviewed. To change the phone or e-mail, wait until we decide it.",
  },
  contact_change_waits_for_payout: {
    "es-CR":
      "Esta tienda tiene un cambio de cuenta bancaria en revisión. Resuelva primero ese cambio, llamando al teléfono actual, y luego este.",
    en: "This shop has a change of bank account under review. Decide that first, calling the current phone, and then this one.",
  },
  contact_request_open: {
    "es-CR":
      "Hay un cambio de teléfono o correo de la tienda en revisión. Para cambiar la cuenta bancaria, espere a que lo resolvamos o retire esa solicitud.",
    en: "A change of the shop's phone or e-mail is under review. To change the bank account, wait until we decide it or withdraw that request.",
  },
  shop_change_unchanged: {
    "es-CR": "Eso es lo que ya tenemos registrado. Cambie algún dato antes de enviar.",
    en: "That is what we already have on file. Change something before sending.",
  },
  shop_change_not_found: {
    "es-CR": "No encontramos esa solicitud, o no le corresponde decidirla.",
    en: "We could not find that request, or it is not yours to decide.",
  },
  shop_change_not_pending: {
    "es-CR": "Esa solicitud ya se resolvió. Recargue la página para ver cómo quedó.",
    en: "That request has already been decided. Reload the page to see the outcome.",
  },
  // Consents
  consent_history_locked: {
    "es-CR": "Un consentimiento registrado no se modifica. Puede retirarlo o dar uno nuevo.",
    en: "A recorded consent cannot be changed. You can withdraw it or give a new one.",
  },
  policy_version_outdated: {
    "es-CR": "Las condiciones cambiaron. Recargue la página y lea la versión vigente.",
    en: "The terms have changed. Reload the page and read the current version.",
  },
} as const satisfies Messages;

// ── Methods ─────────────────────────────────────────────────────────────────

export const limitsApi = ({ call, run }: Caller) => ({
  /** Routes that went back to dispatch because their driver left (last `days`, default 7). */
  opsReleasedRoutes: (days?: number) =>
    call("ops_released_routes", { p_days: days }, z.array(releasedRoute)),
  /** The care queues, a page of each, with the totals. */
  opsCareQueuesPaged: () => call("ops_care_queues", {}, careQueuesPaged),
  /** The warehouse board, a page of inbound shipments, with how many there are. */
  wmsBoardPaged: (warehouseId: string) =>
    call("wms_board", { p_warehouse_id: warehouseId }, wmsBoardPaged),
  /** Shops that share an identification number with another shop. */
  opsSellerIdClashes: () => call("ops_seller_id_clashes", {}, z.array(sellerIdClash)),

  sellerTeam: (sellerId: string) => call("seller_team", { p_seller_id: sellerId }, sellerTeam),
  /** The same answer whether or not the address has an account. */
  sellerInviteMember: (input: { sellerId: string; email: string; role: InvitableRole }) =>
    call(
      "seller_invite_member",
      { p_seller_id: input.sellerId, p_email: input.email, p_role: input.role },
      id,
    ),
  myInvitations: () => call("my_invitations", {}, z.array(myInvitation)),
  /** Accepts or declines; answers the shop's id. */
  sellerAnswerInvitation: (invitationId: string, accept: boolean) =>
    call("seller_answer_invitation", { p_invitation_id: invitationId, p_accept: accept }, id),
  sellerRevokeInvitation: (invitationId: string) =>
    run("seller_revoke_invitation", { p_invitation_id: invitationId }),
  /** Removes a member, or (naming yourself) leaves the shop. */
  sellerRemoveMember: (sellerId: string, userId: string) =>
    run("seller_remove_member", { p_seller_id: sellerId, p_user_id: userId }),
  sellerSetMemberRole: (sellerId: string, userId: string, role: InvitableRole) =>
    run("seller_set_member_role", { p_seller_id: sellerId, p_user_id: userId, p_role: role }),

  sellerShopChanges: (sellerId: string) =>
    call("seller_shop_changes", { p_seller_id: sellerId }, sellerShopChanges),
  sellerRequestShopChange: (input: ShopChangeInput) =>
    call(
      "seller_request_shop_change",
      {
        p_seller_id: input.sellerId,
        p_kind: input.kind,
        ...(input.kind === "shop_name" ? { p_trade_name: input.tradeName } : {}),
        ...(input.kind === "fiscal"
          ? {
              p_tax_regime: input.taxRegime,
              p_fiscal_address: input.fiscalAddress,
              p_postal_code: input.postalCode ?? null,
              p_economic_activity_code: input.economicActivityCode ?? null,
            }
          : {}),
        ...(input.kind === "contact"
          ? { p_contact_email: input.contactEmail, p_contact_phone: input.contactPhone }
          : {}),
      },
      id,
    ),
  sellerWithdrawShopChange: (requestId: string) =>
    run("seller_withdraw_shop_change", { p_request_id: requestId }),
  /** The staff queue: what this person may decide. `null` lists every status. */
  opsShopChangeRequests: (status: "pending" | "approved" | "rejected" | null = "pending") =>
    call("ops_shop_change_requests", { p_status: status }, z.array(shopChangeRequest)),
  opsDecideShopChange: (requestId: string, approve: boolean, note?: string | null) =>
    run("ops_decide_shop_change", { p_request_id: requestId, p_approve: approve, p_note: note }),

  /** Withdraws the signed-in person's consent for a purpose; answers how many records it closed. */
  withdrawConsent: (purpose: ConsentPurpose) =>
    call("withdraw_consent", { p_purpose: purpose }, z.number().int()),
});
