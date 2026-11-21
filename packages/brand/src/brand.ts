/**
 * Single source of truth for the brand.
 *
 * Every user-visible occurrence of the product name, the app family names,
 * taglines and domains is read from here. Renaming the product is an edit to
 * this file (plus the logo artwork in `logo.tsx`), not a find-and-replace.
 */

export const brand = {
  /** Product / company name as written. */
  name: "Yuntera",
  /** Lowercase form used in the wordmark, handles and URLs. */
  slug: "yuntera",
  /** Legal name placeholder until the entity is incorporated. */
  legalName: "Yuntera (entidad en formación)",
  /**
   * Origin of the name, kept here so product copy can reference it consistently.
   * "Yunta" is the yoked pair of oxen that pulls the Costa Rican carreta;
   * working "en yunta" means pulling together.
   */
  origin: "yunta",
  country: "CR",
  defaultLocale: "es-CR",
  locales: ["es-CR", "en"],
  currency: "CRC",
  timezone: "America/Costa_Rica",
  taglines: {
    "es-CR": {
      primary: "Lo que ocupa, a su puerta.",
      secondary: "Juntos llegamos más lejos.",
      seller: "Usted vende. Nosotros lo llevamos.",
      driver: "Cada entrega cuenta.",
    },
    en: {
      primary: "What you need, at your door.",
      secondary: "Together we go further.",
      seller: "You sell. We deliver.",
      driver: "Every delivery counts.",
    },
  },
  /**
   * Domains. `.com` and `.cr` were verified unregistered on 2026-11-21
   * (see docs/brand/naming.md). They are NOT yet purchased.
   */
  domains: {
    primary: "yuntera.cr",
    international: "yuntera.com",
    app: "yuntera.app",
  },
  support: {
    email: "ayuda@yuntera.cr",
    whatsapp: null as string | null,
  },
} as const;

export type AppId = "shop" | "seller" | "driver" | "warehouse" | "ops";

export interface AppIdentity {
  id: AppId;
  /** Full product name, e.g. "Yuntera Vende". */
  name: string;
  /** The descriptor alone, e.g. "Vende". Empty for the flagship. */
  descriptor: string;
  audience: string;
  /** Planned production hostname. */
  host: string;
  /** Accent colour token (see tokens.ts) that distinguishes the app. */
  accent: "celeste" | "guaria" | "selva" | "maiz" | "anil";
  /** Reverse-DNS identifier for the app stores. */
  bundleId: string | null;
}

/**
 * The app family. The flagship carries the bare name; every other surface is
 * "Yuntera + a plain Spanish word" that says who it is for.
 */
export const apps: Record<AppId, AppIdentity> = {
  shop: {
    id: "shop",
    name: brand.name,
    descriptor: "",
    audience: "Compradores",
    host: `www.${brand.domains.primary}`,
    accent: "celeste",
    bundleId: "cr.yuntera.shop",
  },
  seller: {
    id: "seller",
    name: `${brand.name} Vende`,
    descriptor: "Vende",
    audience: "Vendedores y PYMEs",
    host: `vende.${brand.domains.primary}`,
    accent: "guaria",
    // Chosen 21 November 2026 for the native seller app, after the descriptor
    // like the other apps (ruta, bodega). Cannot change once published.
    bundleId: "cr.yuntera.vende",
  },
  driver: {
    id: "driver",
    name: `${brand.name} Ruta`,
    descriptor: "Ruta",
    audience: "Repartidores",
    host: `ruta.${brand.domains.primary}`,
    accent: "selva",
    bundleId: "cr.yuntera.ruta",
  },
  warehouse: {
    id: "warehouse",
    name: `${brand.name} Bodega`,
    descriptor: "Bodega",
    audience: "Personal de bodega",
    host: `bodega.${brand.domains.primary}`,
    accent: "maiz",
    bundleId: "cr.yuntera.bodega",
  },
  ops: {
    id: "ops",
    name: `${brand.name} Central`,
    descriptor: "Central",
    audience: "Operaciones internas",
    host: `central.${brand.domains.primary}`,
    accent: "anil",
    bundleId: null,
  },
};
