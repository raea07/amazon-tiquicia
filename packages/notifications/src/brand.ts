/**
 * What the messages need of the brand. A copy of values from packages/brand,
 * so the Edge Function bundle stays self-contained; brand.test.ts fails if
 * they drift.
 */

export const brandName = "Yuntera";
export const legalName = "Yuntera (entidad en formación)";
export const supportEmail = "ayuda@yuntera.cr";

/** Colours for e-mail, from the contrast-tested brand tokens. */
export const mailColors = {
  bg: "#fbfaf7",
  surface: "#ffffff",
  border: "#eae5da",
  ink: "#161d33",
  inkMuted: "#3f4e76",
  brand: "#0b7f8e",
  onBrand: "#ffffff",
  link: "#0c6775",
} as const;
