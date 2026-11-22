/**
 * Reporting a listing, a review or a shop (notice and action), with the
 * reasons, limits and words of the website's /reportar
 * (apps/web/src/components/report-form.tsx and src/app/report-actions.ts).
 * Anyone can report, signed in or not; a visitor leaves an e-mail address as
 * a contact detail, which staff may write to by hand and nothing ever writes
 * to automatically. The database refuses reports about things that are not
 * in the shop and counts a repeat once.
 *
 * Pure: `report.test.ts` runs it in Node.
 */

export const REPORT_REASONS = [
  ["illegal_product", "Es ilegal venderlo"],
  ["counterfeit", "Es falsificado"],
  ["unsafe", "Es peligroso"],
  ["misleading", "La información es engañosa"],
  ["intellectual_property", "Usa una marca, fotos o textos ajenos"],
  ["abuse", "Tiene contenido ofensivo"],
  ["other", "Otro problema"],
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number][0];
export type ReportTarget = "product" | "review" | "seller";

/** What is being reported, from the link that brought the person here. */
export const REPORT_KINDS = {
  producto: { type: "product", label: "esta publicación" },
  resena: { type: "review", label: "esta reseña" },
  tienda: { type: "seller", label: "esta tienda" },
} as const satisfies Record<string, { type: ReportTarget; label: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The target named by the route's parameters, or null when they name nothing usable. */
export function reportTarget(
  params: Partial<Record<keyof typeof REPORT_KINDS, string | undefined>>,
): { type: ReportTarget; id: string; label: string } | null {
  const entry = (Object.keys(REPORT_KINDS) as Array<keyof typeof REPORT_KINDS>).find(
    (key) => params[key] !== undefined,
  );
  const id = entry ? params[entry] : undefined;
  if (!entry || !id || !UUID.test(id)) return null;
  return { type: REPORT_KINDS[entry].type, id, label: REPORT_KINDS[entry].label };
}

export const REPORT_SENT =
  "Recibimos su reporte. Lo revisamos y, si incumple las reglas, lo retiramos de la tienda. Gracias por avisarnos.";

export interface ReportInput {
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  email: string | null;
}

/** The checks the website's action makes before calling the API, with its words. */
export function checkReport(
  form: { reason: ReportReason | null; details: string; email: string },
  target: { type: ReportTarget; id: string },
  signedIn: boolean,
): { error: string } | { input: ReportInput } {
  if (!form.reason) return { error: "Elija qué problema tiene." };
  const details = form.details.trim();
  if (details.length > 2000) return { error: "Los detalles pueden tener hasta 2000 caracteres." };
  const email = form.email.trim().toLowerCase();
  if (email.length > 254) {
    return {
      error: "No sabemos qué quiere reportar. Vuelva a la página y use el enlace de nuevo.",
    };
  }
  if (!signedIn && !email) {
    return { error: "Escriba su correo para que podamos pedirle más datos si hace falta." };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Revise el correo: debe tener la forma nombre@dominio.com." };
  }
  return {
    input: {
      targetType: target.type,
      targetId: target.id,
      reason: form.reason,
      details: details || null,
      email: email || null,
    },
  };
}
