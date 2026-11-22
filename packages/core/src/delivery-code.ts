/**
 * What a driver is told when an order's delivery code is locked: after five
 * wrong codes on an ORDER (counted across its parcels, stops and routes) the
 * database refuses every code, the right one included, until Central releases
 * it, which gives the shopper a new code. One text for the drivers' app and
 * the web field app, so a driver hears the same thing on either.
 */
export const LOCKED_CODE_MESSAGE =
  "El código de este pedido quedó bloqueado por demasiados intentos. No entregue el paquete. Llame a Central: si lo desbloquean, el cliente verá un código nuevo en su pedido; si no, márquelo como no entregado.";
