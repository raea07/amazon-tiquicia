import type { ReviewFilter, ReviewHideReason } from "@yuntera/db";

/** Why a review or a reply is hidden, as staff choose it. A low rating is never a reason. */
export const REVIEW_HIDE_REASON: Record<ReviewHideReason, string> = {
  offensive: "Insultos o lenguaje ofensivo",
  personal_data: "Datos personales (teléfonos, direcciones, nombres de terceros)",
  off_topic: "No trata del producto ni de la compra",
  spam: "Publicidad o enlaces",
  not_genuine: "No describe una experiencia real con el producto",
  illegal: "Contenido ilegal",
  rules: "Otra regla de publicación",
};

export const REVIEW_FILTER: Record<ReviewFilter, string> = {
  all: "Todas",
  reported: "Reportadas",
  low: "Calificación baja (1 o 2)",
  replied: "Con respuesta del vendedor",
  hidden: "Ocultas",
};

/** 1200 basis points as "12 %". */
export function percent(bps: number): string {
  const value = bps / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
  return `${text.replace(".", ",")} %`;
}
