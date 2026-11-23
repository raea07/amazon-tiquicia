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

/** A returned item whose return could not be read. */
export const RETURN_UNREAD = "No pudimos consultar cómo va su devolución.";
