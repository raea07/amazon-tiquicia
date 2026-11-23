/**
 * Withdrawing a logo that waits for review and removing the current one, in
 * the seller centre's words (apps/seller/src/app/logo-actions.ts and
 * components/logo-manager.tsx). Neither needs the phone's photo library;
 * uploading a logo stays in the seller centre.
 */

export const WITHDRAW_LOGO_LABEL = "Retirar el logotipo en revisión";
export const LOGO_WITHDRAWN = "Retiramos el logotipo que esperaba revisión.";
export const REMOVE_LOGO_LABEL = "Quitar el logotipo";
export const REMOVE_LOGO_CONFIRM = "Quiero que la tienda deje de mostrar el logotipo.";
export const REMOVE_LOGO_CONFIRM_NEEDED =
  "Marque la casilla para confirmar que quiere quitar el logotipo.";
export const LOGO_REMOVED = "Quitamos el logotipo de su tienda.";
export const LOGO_NOTHING_TO_REMOVE = "Su tienda no tenía logotipo.";

/** What the shop reads after removing: seller_remove_logo answers whether there was one. */
export const removedText = (removed: boolean) => (removed ? LOGO_REMOVED : LOGO_NOTHING_TO_REMOVE);

/** Which of the two the card offers, as the seller centre's Tienda page does. */
export function logoActions(front: {
  can_edit: boolean;
  logo: unknown;
  logo_waiting: { state: string } | null;
}): { withdraw: boolean; remove: boolean } {
  if (!front.can_edit) return { withdraw: false, remove: false };
  return { withdraw: front.logo_waiting?.state === "pending", remove: Boolean(front.logo) };
}
