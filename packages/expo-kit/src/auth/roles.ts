import type { Roles } from "@yuntera/db";

/**
 * Who may use which app, read the same way the web apps read it
 * (`apps/field/src/lib/access.ts`, `apps/seller/src/lib/shop.ts`).
 *
 * This decides what a screen shows. It is not access control: the database
 * checks the caller again, independently, on every call.
 */
export type Audience = "shopper" | "seller" | "driver" | "warehouse";

export function canUse(audience: Audience, roles: Roles | null): boolean {
  if (!roles) return false;
  switch (audience) {
    case "shopper":
      return true; // every account can shop
    case "seller":
      return roles.sellers.length > 0;
    case "driver":
      return roles.driver?.status === "active";
    case "warehouse":
      return roles.warehouses.length > 0;
  }
}

/** What the "no access" screen says, per app: what happened and what to do. */
export const NO_ACCESS: Record<Exclude<Audience, "shopper">, { title: string; body: string }> = {
  seller: {
    title: "Esta cuenta no administra ninguna tienda",
    body: "Yuntera Vende es para quienes venden en Yuntera. Si su tienda ya existe, pídale a quien la administra que lo invite con este correo, acepte la invitación en el sitio de vendedores y vuelva a ingresar aquí. Si todavía no vende con nosotros, registre su tienda desde el sitio de vendedores.",
  },
  driver: {
    title: "Esta cuenta no tiene acceso a Yuntera Ruta",
    body: "La aplicación es para repartidores activos de Yuntera. Si ya lo contrataron, pídale a Central que active su cuenta de repartidor y vuelva a ingresar.",
  },
  warehouse: {
    title: "Esta cuenta no tiene acceso a Yuntera Bodega",
    body: "La aplicación es para el personal de bodega. Si ya trabaja con nosotros, pídale a su encargado que lo asigne a una bodega y vuelva a ingresar.",
  },
};

/**
 * What the drivers' app says to a driver Central suspended or deactivated,
 * the way the web's no-access page says it (`apps/field/src/app/sin-acceso`).
 * Their unfinished routes went back to dispatch the moment it happened.
 */
const DRIVER_LEFT = {
  body: "No tiene acceso a rutas ni a los datos de las entregas. Las rutas que tenía pendientes volvieron a Central. Si tiene paquetes o dinero de entregas, llévelos a la bodega. Para saber más, hable con Central.",
  suspended: "Su cuenta de repartidor está suspendida",
  offboarded: "Su cuenta de repartidor está desactivada",
};

/** The no-access screen's words for this account: a suspended driver is told so plainly. */
export function noAccessText(
  app: Exclude<Audience, "shopper">,
  roles: Roles | null,
): { title: string; body: string } {
  const status = roles?.driver?.status;
  if (app === "driver" && (status === "suspended" || status === "offboarded")) {
    return { title: DRIVER_LEFT[status], body: DRIVER_LEFT.body };
  }
  return NO_ACCESS[app];
}
