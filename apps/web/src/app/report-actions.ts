"use server";

/**
 * Reporting a listing, a review or a shop (notice and action). Anyone can,
 * signed in or not. A visitor leaves an e-mail address as a contact detail:
 * staff may write to it about this report by hand, and nothing is ever sent
 * to it automatically, because anyone can type anyone's address.
 *
 * The database refuses reports about things that are not in the shop and
 * counts a repeat once; these checks only give a good message first.
 */

import { type ActionState, attempt, typed } from "@yuntera/next-kit/server";
import { z } from "zod";
import { getViewer } from "@/lib/session";
import { publicApi, sessionApi } from "@/lib/supabase";

const reportReason = z.enum([
  "illegal_product",
  "counterfeit",
  "unsafe",
  "misleading",
  "intellectual_property",
  "abuse",
  "other",
]);

const report = z.object({
  targetType: z.enum(["product", "review", "seller"]),
  targetId: z.uuid(),
  reason: reportReason,
  details: z.string().trim().max(2000, "Los detalles pueden tener hasta 2000 caracteres."),
  email: z.string().trim().max(254),
});

export async function reportContent(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "targetType", "targetId", "reason", "details", "email");
  const parsed = report.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "reason") return { error: "Elija qué problema tiene.", values };
    if (issue?.path[0] === "details") return { error: issue.message, values };
    return {
      error: "No sabemos qué quiere reportar. Vuelva a la página y use el enlace de nuevo.",
      values,
    };
  }
  const viewer = await getViewer();
  const email = parsed.data.email.toLowerCase();
  if (!viewer && !email) {
    return { error: "Escriba su correo para que podamos pedirle más datos si hace falta.", values };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Revise el correo: debe tener la forma nombre@dominio.com.", values };
  }

  return attempt(async () => {
    const api = viewer ? await sessionApi() : publicApi();
    await api.reportContent({
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      details: parsed.data.details || null,
      email: email || null,
    });
    return "Recibimos su reporte. Lo revisamos y, si incumple las reglas, lo retiramos de la tienda. Gracias por avisarnos.";
  }, values);
}
