/**
 * A message that says what just happened in one shop ("Paquete …: listo",
 * "Producto enviado a revisión"). The tab screens stay mounted when the
 * person changes shop, so a message is kept with the shop it belongs to and
 * shown only while that shop is the current one.
 */
export interface ShopFlash<T = string> {
  shopId: string;
  value: T;
}

export function flashFor<T>(flash: ShopFlash<T> | null | undefined, shopId: string): T | null {
  return flash && flash.shopId === shopId ? flash.value : null;
}

/** What publicar.tsx sends back to Productos: the outcome and the shop it was made in. */
export type CreatedOutcome = "revision" | "borrador";

/** Reads the `creado` and `tienda` route parameters into a flash, if they are well formed. */
export function createdFlash(
  creado: string | undefined,
  tienda: string | undefined,
): ShopFlash<CreatedOutcome> | null {
  if (!tienda || (creado !== "revision" && creado !== "borrador")) return null;
  return { shopId: tienda, value: creado };
}
