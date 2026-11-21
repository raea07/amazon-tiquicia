"use server";

/**
 * Catalogue staff decide on a seller's change to a published listing.
 *
 * Like every staff action: re-read the session, validate the input, call the
 * API. The database checks the caller's role and that the change is still the
 * one that was on screen.
 */

import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

export async function reviewListingEdit(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/catalogo"));
  const requestId = z.uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const note = String(formData.get("note") ?? "").trim();

  const state = await attempt(
    async () => {
      await (await sessionApi()).opsReviewListingEdit(requestId.data, approve, note || null);
      if (!approve) return "Cambio rechazado; el vendedor ve el motivo.";
      // The shop keeps catalogue pages for about a minute; tell it they changed.
      await refreshShopCatalog();
      return "Cambio aprobado: la publicación ya muestra el texto nuevo.";
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}
