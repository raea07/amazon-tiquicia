import type { SellerListingEdit, SellerOverview, SellerPayoutDetails } from "@yuntera/db";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A rejected bank-account request is worth a line on Inicio for this long after the decision. */
export const REJECTED_REQUEST_DAYS = 30;

/** One thing the seller should deal with, and where it is dealt with. */
export interface TodoItem {
  key: string;
  text: string;
  href: "/pedidos" | "/inventario" | "/productos" | "/cuenta" | null;
}

/**
 * What needs doing today, for Inicio. The counts of the seller centre's
 * summary (seller_overview), plus two things the app already reads elsewhere:
 * published listings whose change was not approved (seller_listing_edits:
 * a new listing that was rejected is already in `listings_rejected`), and the
 * state of the latest bank-account request (seller_payout_details): one
 * waiting for our call, or one refused in the last 30 days.
 *
 * `edits` and `payout` may be missing (still loading, or not readable by
 * this member); the list then leaves those lines out rather than waiting.
 */
export function todayItems(
  counts: SellerOverview["counts"],
  edits: SellerListingEdit[] | undefined,
  payout: SellerPayoutDetails | undefined,
  now: Date = new Date(),
): TodoItem[] {
  const items: TodoItem[] = [];
  if (counts.to_pack > 0)
    items.push({
      key: "to-pack",
      text: plural(counts.to_pack, "paquete por empacar", "paquetes por empacar"),
      href: "/pedidos",
    });
  if (counts.offers_out_of_stock > 0)
    items.push({
      key: "out-of-stock",
      text: plural(
        counts.offers_out_of_stock,
        "producto sin existencias",
        "productos sin existencias",
      ),
      href: "/inventario",
    });
  if (counts.listings_rejected > 0)
    items.push({
      key: "rejected",
      text: plural(counts.listings_rejected, "producto rechazado", "productos rechazados"),
      href: "/productos",
    });
  const rejectedEdits = (edits ?? []).filter((edit) => edit.edit_status === "rejected").length;
  if (rejectedEdits > 0)
    items.push({
      key: "rejected-edits",
      text: plural(rejectedEdits, "cambio no aprobado", "cambios no aprobados"),
      href: "/productos",
    });
  if (counts.open_returns > 0)
    items.push({
      key: "returns",
      text: plural(counts.open_returns, "devolución abierta", "devoluciones abiertas"),
      href: null,
    });
  const request = payout?.request;
  if (request?.status === "pending")
    items.push({
      key: "payout-pending",
      text: "un cambio de cuenta bancaria en revisión",
      href: "/cuenta",
    });
  if (
    request?.status === "rejected" &&
    request.decided_at &&
    now.getTime() - new Date(request.decided_at).getTime() <=
      REJECTED_REQUEST_DAYS * 24 * 60 * 60_000
  )
    items.push({
      key: "payout-rejected",
      text: "un cambio de cuenta bancaria no aprobado",
      href: "/cuenta",
    });
  return items;
}

/** The sentence under "Por atender". */
export function todaySentence(items: TodoItem[]): string {
  if (items.length === 0)
    return "Hoy no tiene nada pendiente. Cuando entre un pedido aparece aquí.";
  const texts = items.map((item) => item.text);
  const list =
    texts.length === 1 ? texts[0] : `${texts.slice(0, -1).join(", ")} y ${texts[texts.length - 1]}`;
  return `Hoy tiene ${list}.`;
}
