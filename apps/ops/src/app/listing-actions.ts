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
  // Ticked when the edit would pause other shops' offers and staff confirm it.
  const pauseOffers = formData.get("pausaOfertas") === "on";

  const state = await attempt(
    async () => {
      await (await sessionApi()).opsReviewListingEdit(
        requestId.data,
        approve,
        note || null,
        pauseOffers,
      );
      if (!approve) return "Cambio rechazado; el vendedor ve el motivo.";
      if (pauseOffers) {
        await refreshShopCatalog();
        return "Cambio aprobado. Las ofertas que ya no cubrían las tarifas quedaron en pausa y avisamos a sus tiendas.";
      }
      // The shop keeps catalogue pages for about a minute; tell it they changed.
      await refreshShopCatalog();
      return "Cambio aprobado: la publicación ya muestra el texto nuevo.";
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}
