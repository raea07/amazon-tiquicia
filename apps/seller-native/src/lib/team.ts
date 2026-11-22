/**
 * The shop's team and the reviewed changes to its details: who may do what,
 * and the checks made before anything is sent, with the seller centre's
 * words (apps/seller/src/app/equipo/page.tsx, team-actions.ts,
 * shop-change-actions.ts, cuenta/page.tsx). The database decides again; these
 * only give a good message first.
 *
 * Pure: `team.test.ts` runs it in Node and reads the seller centre's files.
 */

import { parsePhone } from "@yuntera/core";
import type { SellerShopChanges, SellerTeam, ShopChangeKind } from "@yuntera/db";

type Member = SellerTeam["members"][number];
type Invitation = SellerTeam["invitations"][number];
export type InvitableRole = "admin" | "staff";

export const ROLE_LABEL = {
  owner: "Dueño",
  admin: "Administración",
  staff: "Personal",
} as const;

/** As the invitation describes the role ("le invitó a unirse como personal"). */
export const ROLE_INVITED_AS = {
  owner: "dueño",
  admin: "administración",
  staff: "personal",
} as const;

/** What the signed-in person may do to one member, as the seller centre's team page decides. */
export function memberActions(team: Pick<SellerTeam, "is_owner" | "can_manage">, member: Member) {
  const canChange = team.is_owner && member.role !== "owner";
  const canRemove =
    member.role !== "owner" && (team.is_owner || (team.can_manage && member.role === "staff"));
  return {
    changeRole: canChange,
    remove: canRemove && !member.is_you,
    leave: member.is_you && member.role !== "owner",
  };
}

/** Only the owner may withdraw an invitation to administration. */
export const canRevoke = (team: Pick<SellerTeam, "is_owner">, invitation: Invitation) =>
  team.is_owner || invitation.role === "staff";

export function checkInvite(
  form: { email: string; role: InvitableRole | null },
  isOwner: boolean,
): { error: string } | { email: string; role: InvitableRole } {
  const email = form.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return { error: "Escriba el correo con que la persona ingresa a Yuntera." };
  }
  if (form.role !== "staff" && !(form.role === "admin" && isOwner)) {
    return { error: "Elija qué podrá hacer la persona en la tienda." };
  }
  return { email, role: form.role };
}

/** The same words whether or not the address has an account: the screen must not tell who is registered. */
export const invitationSent = (email: string) =>
  `Invitación enviada a ${email}. La persona la ve en Yuntera Vende, en Invitaciones, al ingresar con ese correo ya confirmado, y entra al equipo cuando la acepte. Vence en 14 días.`;

export const LEAVE_UNTICKED = "Marque la casilla para confirmar que quiere salir del equipo.";

/**
 * The confirmations of a removal and of a withdrawn invitation. The row they
 * are about disappears with the answer, so the list shows them, not the row.
 */
export const MEMBER_REMOVED = "La persona ya no es parte del equipo.";
export const INVITATION_REVOKED = "Invitación retirada.";

// ── Requests to change the shop's details ───────────────────────────────────

export const CHANGE_SENT =
  "Solicitud enviada. La revisamos y le avisamos aquí; mientras tanto sigue vigente lo que ya teníamos.";
export const CONTACT_SENT =
  "Solicitud enviada. Le llamamos al teléfono que ya teníamos para confirmarla; mientras tanto ese sigue siendo el de la tienda.";

export function checkShopName(raw: string): { error: string } | { tradeName: string } {
  const tradeName = raw.trim().replace(/\s+/g, " ");
  if (tradeName.length < 2 || tradeName.length > 80) {
    return { error: "Escriba el nombre nuevo de la tienda (entre 2 y 80 letras)." };
  }
  return { tradeName };
}

export function checkContact(form: {
  email: string;
  phone: string;
}): { error: string } | { contactEmail: string; contactPhone: string } {
  const contactEmail = form.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail) || contactEmail.length > 254) {
    return { error: "Escriba un correo de contacto válido." };
  }
  const phone = parsePhone(form.phone);
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos." };
  return { contactEmail, contactPhone: phone.e164 };
}

export interface FiscalInput {
  taxRegime: "general" | "simplificado";
  fiscalAddress: string;
  postalCode: string | null;
  economicActivityCode: string | null;
}

export function checkFiscal(form: {
  taxRegime: string | null;
  fiscalAddress: string;
  postalCode: string;
  economicActivityCode: string;
}): { error: string } | { input: FiscalInput } {
  if (form.taxRegime !== "general" && form.taxRegime !== "simplificado") {
    return { error: "Elija el régimen tributario." };
  }
  const fiscalAddress = form.fiscalAddress.trim();
  if (fiscalAddress.length < 15) {
    return { error: "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas." };
  }
  if (fiscalAddress.length > 500) return { error: "La dirección fiscal es demasiado larga." };
  const postalCode = form.postalCode.trim();
  if (!/^(\d{5})?$/.test(postalCode)) return { error: "El código postal tiene 5 dígitos." };
  const activity = form.economicActivityCode.trim();
  if (!/^(\d{4,6})?$/.test(activity)) {
    return { error: "El código de actividad económica tiene de 4 a 6 dígitos." };
  }
  return {
    input: {
      taxRegime: form.taxRegime,
      fiscalAddress,
      postalCode: postalCode || null,
      economicActivityCode: activity || null,
    },
  };
}

export const CHANGE_KIND: Record<ShopChangeKind, string> = {
  shop_name: "nombre de la tienda",
  fiscal: "datos fiscales",
  contact: "correo y teléfono",
};

type Request = SellerShopChanges["requests"][number];

/** "“Ferretería Nueva”", "x@y.cr y 2222-3333", "los datos fiscales nuevos": what was asked for. */
export function askedFor(request: Request): string {
  if (request.kind === "shop_name") return `“${request.proposed.trade_name}”`;
  if (request.kind === "contact") {
    const phone = request.proposed.contact_phone ?? "";
    return `${request.proposed.contact_email} y ${parsePhone(phone)?.formatted ?? phone}`;
  }
  return "los datos fiscales nuevos";
}

/** The latest request of one kind, if any. */
export const latestRequest = (changes: SellerShopChanges, kind: ShopChangeKind) =>
  changes.requests.find((item) => item.kind === kind) ?? null;
