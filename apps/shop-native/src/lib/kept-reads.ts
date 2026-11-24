/**
 * What a screen shows when a read fails, in the voice of the seller app's
 * Inicio (apps/seller-native/src/lib/today.ts): say what could not be read,
 * keep what is known, and offer to ask again.
 *
 * The cache keeps an answer under its key and asks again in the background
 * (on return to the app, on a pull, on a timer). When that second request
 * fails, the query reports an error but still holds the answer it had:
 *
 *   - nothing was ever read for this key (the first load failed): the screen
 *     shows its error state, as before;
 *   - something is on screen and asking again failed: the screen keeps it and
 *     says above it that it could not be updated, with "Intentar de nuevo".
 *
 * An answer is kept only under its own key, and no screen uses placeholder
 * data, so results of another search, brand, category, order or district
 * are never shown in place of the ones asked for.
 *
 * Pure, with no React Native import, so `kept-reads.test.ts` checks it.
 */

/** What these rules need of a query (react-query's names). */
export interface ReadState {
  isError: boolean;
  data?: unknown;
}

/** The first read failed: nothing to show but the error state. */
export const firstReadFailed = (read: ReadState) => read.isError && read.data === undefined;

/** Something is on screen and asking again failed: keep it, and say so. */
export const refreshFailed = (read: ReadState) => read.isError && read.data !== undefined;

/** The button of every notice below, as the error state says it. */
export const TRY_AGAIN = "Intentar de nuevo";

/** Above what a screen kept after a refresh failed. */
export const KEPT = {
  listing: {
    title: "No pudimos actualizar estos resultados",
    body: "Le mostramos los que ya tenía; pueden no estar al día.",
  },
  cart: {
    title: "No pudimos actualizar su carrito",
    body: "Los precios y las existencias que ve pueden no estar al día. Antes de cobrarle los revisamos de nuevo.",
  },
  checkout: {
    title: "No pudimos actualizar su total",
    body: "Lo que ve puede no estar al día. Al confirmar el pedido revisamos precios y existencias de nuevo.",
  },
  product: {
    title: "No pudimos actualizar este producto",
    body: "El precio, las existencias y la fecha de entrega que ve pueden no estar al día. Antes de cobrarle los revisamos de nuevo.",
  },
  order: {
    title: "No pudimos actualizar su pedido",
    body: "Le mostramos lo último que cargamos; puede no estar al día.",
  },
  orders: {
    title: "No pudimos actualizar sus pedidos",
    body: "Le mostramos lo último que cargamos; puede no estar al día.",
  },
  account: {
    title: "No pudimos actualizar sus datos",
    body: "Le mostramos lo último que cargamos; puede no estar al día.",
  },
  districts: {
    title: "No pudimos actualizar la lista de distritos",
    body: "Le mostramos la que ya teníamos.",
  },
  categories: {
    title: "No pudimos actualizar las categorías",
    body: "Le mostramos las que ya teníamos; pueden no estar al día.",
  },
  home: {
    title: "No pudimos actualizar esta página",
    body: "Le mostramos lo último que cargamos; puede no estar al día.",
  },
  notifications: {
    title: "No pudimos actualizar sus preferencias",
    body: "Le mostramos lo último que guardamos; puede no estar al día.",
  },
  payment: {
    title: "No pudimos actualizar su pago",
    body: "Los montos de su pago y de sus reembolsos que ve pueden no estar al día.",
  },
} as const;

/**
 * The order page while its payment cannot be read: what the order says stays,
 * and no amount of money is stated until the payment answers.
 */
export const PAYMENT_UNREAD = {
  title: "No pudimos consultar su pago",
  body: "Lo demás de su pedido sí está al día. Los montos de su pago y de sus reembolsos aparecen aquí cuando lo podamos consultar.",
} as const;

/** The refund notice of an order coming back, while the payment cannot be read. */
export const AMOUNT_UNREAD = "Todavía no le podemos decir el monto: no pudimos consultar su pago.";

/** A returned item whose return could not be read (the notice above has the button). */
export const RETURN_UNREAD = "No pudimos consultar cómo va su devolución.";

/** What the order page knows of one of its three reads. */
export type PaymentRead = "ok" | "unread" | "stale";

export interface OrderNotice {
  title: string;
  body: string;
  /** Which read failed first: its error gives the notice's last sentence. */
  cause: "order" | "payment" | "returns";
  testID: "order-kept" | "payment-unread" | "payment-kept" | "returns-unread";
}

/**
 * The order page's one notice when something could not be read: the order
 * kept after its refresh failed, the payment never read or not refreshed,
 * the returns of a returned item never read. One notice and one "Intentar de
 * nuevo" (which reads all three again), so the page never says in one place
 * that the order is up to date and in another that it may not be. Null when
 * every read the page needs answered.
 */
export function orderNotice(reads: {
  orderStale: boolean;
  payment: PaymentRead;
  /** The order has returned items and their returns could not be read. */
  returnsUnread: boolean;
}): OrderNotice | null {
  const { orderStale, payment, returnsUnread } = reads;
  const failed: Array<[verb: string, what: string]> = [];
  if (orderStale) failed.push(["actualizar", "su pedido"]);
  if (payment === "stale") failed.push(["actualizar", "su pago"]);
  if (payment === "unread") failed.push(["consultar", "su pago"]);
  if (returnsUnread) failed.push(["consultar", "sus devoluciones"]);
  if (failed.length === 0) return null;
  // The words used so far when only one read failed.
  if (failed.length === 1) {
    if (orderStale) return { ...KEPT.order, cause: "order", testID: "order-kept" };
    if (payment === "unread")
      return { ...PAYMENT_UNREAD, cause: "payment", testID: "payment-unread" };
    if (payment === "stale") return { ...KEPT.payment, cause: "payment", testID: "payment-kept" };
  }
  // "actualizar su pedido ni su pago": a verb is said once for what follows it.
  const said = failed.map(([verb, what], i) =>
    i > 0 && failed[i - 1]?.[0] === verb ? what : `${verb} ${what}`,
  );
  const title = `No pudimos ${
    said.length === 1 ? said[0] : `${said.slice(0, -1).join(", ")} ni ${said[said.length - 1]}`
  }`;
  const body = [
    orderStale
      ? "Le mostramos lo último que cargamos de su pedido; puede no estar al día."
      : "Lo demás de su pedido sí está al día.",
    payment === "unread"
      ? "Los montos de su pago y de sus reembolsos aparecen aquí cuando lo podamos consultar."
      : payment === "stale"
        ? "Los montos de su pago y de sus reembolsos que ve pueden no estar al día."
        : null,
    returnsUnread ? "Cómo va su devolución aparece aquí cuando la podamos consultar." : null,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title,
    body,
    cause: orderStale ? "order" : payment !== "ok" ? "payment" : "returns",
    testID: orderStale
      ? "order-kept"
      : payment === "unread"
        ? "payment-unread"
        : payment === "stale"
          ? "payment-kept"
          : "returns-unread",
  };
}
