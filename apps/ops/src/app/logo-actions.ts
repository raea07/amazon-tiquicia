"use server";

/**
 * Catalogue staff decide on shops' logos, as they decide on product photos:
 * approving records the decision first, and only then do the storage rules
 * let this person write the logo's public sizes, made here from the copy they
 * reviewed (lib/photo-publish.ts, the same code as for photos).
 */

import type { Api } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  deleteUnneededPhotoFiles,
  GENERIC_ERROR,
  redirectTo,
  refreshShopCatalog,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { publishApprovedLogo } from "@/lib/photo-publish";
import { currentStaff } from "@/lib/staff";

async function requireCatalogStaff(): Promise<Api> {
  if (!(await currentStaff())) redirectTo(signInPath("/catalogo/logotipos"));
  return sessionApi();
}

const OUTCOME = {
  published: "Logotipo aprobado: la tienda ya lo muestra.",
  waiting:
    "Logotipo aprobado, pero sus archivos aún no se pudieron publicar; use «Publicar» para intentarlo de nuevo.",
  refused:
    "El archivo del logotipo no era la imagen revisada, así que no se publicó; la tienda ve el motivo.",
} as const;

/** Approves (and publishes) or rejects a waiting logo. */
export async function reviewLogo(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const logoId = z.uuid().safeParse(formData.get("logoId"));
  if (!logoId.success) return { error: GENERIC_ERROR };
  const approve = formData.get("decision") === "yes";
  const note = String(formData.get("note") ?? "").trim();
  const api = await requireCatalogStaff();

  const state = await attempt(
    async () => {
      await api.opsReviewLogo(logoId.data, approve, note || null);
      if (!approve) {
        await deleteUnneededPhotoFiles(null);
        return "Logotipo rechazado; la tienda ve el motivo y sigue con el que tenía.";
      }
      const outcome = await publishApprovedLogo(api, logoId.data);
      if (outcome === "published") await refreshShopCatalog();
      return OUTCOME[outcome];
    },
    typed(formData, "note"),
  );
  if (state.ok) refresh();
  return state;
}

/** Tries again to publish an approved logo whose files did not reach the public bucket. */
export async function retryLogoPublishing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const logoId = z.uuid().safeParse(formData.get("logoId"));
  if (!logoId.success) return { error: GENERIC_ERROR };
  const api = await requireCatalogStaff();
  const state = await attempt(async () => {
    const outcome = await publishApprovedLogo(api, logoId.data);
    if (outcome === "published") await refreshShopCatalog();
    return OUTCOME[outcome];
  });
  if (state.ok) refresh();
  return state;
}
