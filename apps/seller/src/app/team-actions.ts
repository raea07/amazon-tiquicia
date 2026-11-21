"use server";

/**
 * Server Actions for the shop's team: inviting someone, answering an
 * invitation, withdrawing one, changing a member's role, removing a member.
 *
 * Nobody joins a shop without saying yes: an invitation waits until the
 * invited account accepts it. The database checks who may do each thing;
 * these checks are here to give a good message.
 */

import {
  type ActionState,
  attempt,
  getViewer,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentShop, rememberShop } from "@/lib/shop";

const role = z.enum(["admin", "staff"]);
const uuid = z.uuid();

async function shopForAction(returnTo: string) {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath(returnTo));
  return session.shop;
}

export async function inviteMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/equipo");
  const values = typed(formData, "email", "role");
  const email = (values.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return { error: "Escriba el correo con que la persona ingresa a Yuntera.", values };
  }
  const chosen = role.safeParse(values.role);
  if (!chosen.success) return { error: "Elija qué podrá hacer la persona en la tienda.", values };

  const state = await attempt(async () => {
    await (await sessionApi()).sellerInviteMember({
      sellerId: shop.id,
      email,
      role: chosen.data,
    });
    // The same words whether or not the address has an account: the screen
    // must not tell who is registered.
    return `Invitación enviada a ${email}. La persona la ve en Yuntera Vende, en Invitaciones, al ingresar con ese correo ya confirmado, y entra al equipo cuando la acepte. Vence en 14 días.`;
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function revokeInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await shopForAction("/equipo");
  const id = uuid.safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "No encontramos esa invitación. Recargue la página." };
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRevokeInvitation(id.data);
    return "Invitación retirada.";
  });
  if (state.ok) refresh();
  return state;
}

export async function setMemberRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/equipo");
  const userId = uuid.safeParse(formData.get("userId"));
  const chosen = role.safeParse(formData.get("role"));
  if (!userId.success || !chosen.success) return { error: "Elija el nuevo rol." };
  const state = await attempt(async () => {
    await (await sessionApi()).sellerSetMemberRole(shop.id, userId.data, chosen.data);
    return "Rol actualizado.";
  });
  if (state.ok) refresh();
  return state;
}

export async function removeMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/equipo");
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "No encontramos a esa persona. Recargue la página." };
  const leaving = formData.get("leaving") === "1";
  if (leaving && formData.get("confirma") !== "1") {
    return { error: "Marque la casilla para confirmar que quiere salir del equipo." };
  }
  const state = await attempt(async () => {
    await (await sessionApi()).sellerRemoveMember(shop.id, userId.data);
    return leaving ? "Salió del equipo de la tienda." : "La persona ya no es parte del equipo.";
  });
  // The invitations page says they left; the summary would send someone with
  // no shop left to registration as if they had never had one.
  if (state.ok && leaving) redirect("/invitaciones?salio=1");
  if (state.ok) refresh();
  return state;
}

/** The invited person accepts (and starts working in that shop) or declines. */
export async function answerInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getViewer())) redirectTo(signInPath("/invitaciones"));
  const id = uuid.safeParse(formData.get("invitationId"));
  const accept = formData.get("answer") === "accept";
  if (!id.success) return { error: "No encontramos esa invitación. Recargue la página." };

  let shopId = "";
  const state = await attempt(async () => {
    shopId = await (await sessionApi()).sellerAnswerInvitation(id.data, accept);
    return accept ? "Ya es parte del equipo." : "Rechazó la invitación. No se unió a la tienda.";
  });
  if (state.ok && accept) {
    await rememberShop(shopId);
    // The invitations page says so and links to the shop with a full page
    // load: what the browser kept of the summary from before, when this
    // person had no shop, would otherwise send them back to registration.
    redirect("/invitaciones?unido=1");
  }
  if (state.ok) refresh();
  return state;
}
