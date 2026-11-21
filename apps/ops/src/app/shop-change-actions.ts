"use server";

/**
 * Server Actions for the queue of changes sellers ask for: the shop's public
 * name, its fiscal details, its contact phone and e-mail. Same rules as the
 * other actions: re-read the session, check the input so the message is
 * specific, and let the database decide who may decide what.
 */

import {
  type ActionState,
  GENERIC_ERROR,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

export async function decideShopChange(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestId = z.uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const raw = formData.get("note");
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!approve && note.length < 10) {
    return {
      error: "Para rechazar, explique el motivo: el vendedor lo va a leer.",
      values: typed(formData, "note"),
    };
  }
  if (note.length > 1000) {
    return {
      error: "La nota es demasiado larga: use como máximo 1000 caracteres.",
      values: typed(formData, "note"),
    };
  }
  if (!(await currentStaff())) redirectTo(signInPath("/cambios-tienda"));
  try {
    await (await sessionApi()).opsDecideShopChange(requestId.data, approve, note || null);
  } catch (error) {
    return { error: messageOf(error), values: typed(formData, "note") };
  }
  // The card that held the form is gone once the request is decided, so the
  // confirmation is shown by the page itself.
  redirectTo(`/cambios-tienda?resuelta=${approve ? "aprobada" : "rechazada"}`);
}
