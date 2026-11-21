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
    body: "Yuntera Vende es para quienes venden en Yuntera. Si su tienda ya existe, pídale a quien la registró que lo agregue. Si todavía no vende con nosotros, registre su tienda desde el sitio de vendedores y vuelva a ingresar aquí.",
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
