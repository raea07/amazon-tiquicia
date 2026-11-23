"use server";

/**
 * Deleting a brand nobody names (20261121084100_catalogue_followups.sql). The
 * database refuses a brand any product names, in any status, and says how
 * many; the refusal here says what to do instead.
 */

import { ApiError } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

const RETURN_TO = "/catalogo/marcas";

/** The refusal for a brand that products still name, with their number. */
function inUse(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== "brand_in_use") return null;
  const n = Number.parseInt(error.detail ?? "", 10);
  const products = Number.isFinite(n)
    ? n === 1
      ? "Hay 1 producto con esta marca"
      : `Hay ${n} productos con esta marca`
    : "Hay productos con esta marca";
  return `${products} (también cuentan los archivados y los borradores), así que no se puede eliminar. Si es la misma que otra, únala a esa; si no quiere que se ofrezca, sáquela del filtro de la tienda.`;
}

export async function deleteBrand(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(formData.get("brandId"));
  if (!id.success) return { error: GENERIC_ERROR };
  if (!(await currentStaff())) redirectTo(signInPath(RETURN_TO));
  let explained: string | null = null;
  const state = await attempt(async () => {
    try {
      const deleted = await (await sessionApi()).opsDeleteBrand(id.data);
      // A brand with no products is in no filter, but an old address of a
      // brand merged into it may be cached in the shop.
      await refreshShopCatalog();
      return deleted.merged_removed === 0
        ? `Marca «${deleted.name}» eliminada. Su dirección ?marca=${deleted.slug} queda libre.`
        : `Marca «${deleted.name}» eliminada, con ${
            deleted.merged_removed === 1
              ? "la marca que se había unido a ella"
              : `las ${deleted.merged_removed} marcas que se habían unido a ella`
          }. Sus direcciones quedan libres.`;
    } catch (error) {
      explained = inUse(error);
      throw error;
    }
  });
  // On a refusal the page is not redrawn: the form stays, with the refusal
  // under it (a redraw would take the form, and its message, away).
  if (explained) return { error: explained };
  if (state.ok) refresh();
  return state;
}
