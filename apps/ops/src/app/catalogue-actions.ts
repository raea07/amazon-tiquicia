"use server";

/**
 * Catalogue staff's tools: categories, brands, search synonyms, reviews and
 * corrections to a product. Each action re-reads the session, validates its
 * input, calls the database (which checks the caller's role on every call),
 * redraws the page behind the form and asks the shop to drop its cached
 * catalogue, so shoppers see the change at once.
 */

import { ApiError, REVIEW_HIDE_REASONS } from "@yuntera/db";
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

type Api = Awaited<ReturnType<typeof sessionApi>>;

/**
 * Runs a catalogue change; on success, redraws the page and refreshes the shop.
 * `explain` may give a refusal a message that fits this form better than the
 * general one for its code.
 */
async function catalogueAction(
  returnTo: string,
  run: (api: Api) => Promise<string>,
  values?: Record<string, string>,
  explain?: (error: unknown) => string | null,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  let explained: string | null = null;
  const state = await attempt(async () => {
    let message: string;
    try {
      message = await run(await sessionApi());
    } catch (error) {
      explained = explain?.(error) ?? null;
      throw error;
    }
    // What shoppers see changed: category pages, search, ratings, and (for a
    // category, or a product moving between categories) the menu.
    await refreshShopCatalog({
      categories: returnTo === "/catalogo/categorias" || returnTo === "/catalogo/productos",
    });
    return message;
  }, values);
  if (explained) return { error: explained, values };
  if (state.ok) refresh();
  return state;
}

const uuid = z.uuid();
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const optionalId = (formData: FormData, name: string) => {
  const value = text(formData, name);
  return value === "" ? null : uuid.safeParse(value).success ? value : undefined;
};

// ── Categories ──────────────────────────────────────────────────────────────

export async function createCategory(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "name", "slug", "parentId");
  const parentId = optionalId(formData, "parentId");
  if (parentId === undefined) return { error: GENERIC_ERROR, values };
  if (text(formData, "name").length < 2) {
    return { error: "Escriba el nombre de la categoría.", values };
  }
  const name = text(formData, "name");
  const slugTyped = text(formData, "slug") !== "";
  return catalogueAction(
    "/catalogo/categorias",
    async (api) => {
      const created = await api.opsCreateCategory({
        nameEs: name,
        slug: slugTyped ? text(formData, "slug") : null,
        parentId,
      });
      return `Categoría creada en /c/${created.slug}. Ya se ve en la tienda; el menú la muestra cuando tenga productos.`;
    },
    values,
    // With the address left empty it is made from the name: say so, or the
    // refusal speaks of an address the person never wrote.
    (error) => {
      if (slugTyped || !(error instanceof ApiError)) return null;
      const from = `La dirección que hacemos a partir del nombre «${name.slice(0, 60)}»`;
      if (error.code === "category_slug_taken") {
        return `${from} ya es de otra categoría, o lo fue. Escriba otra en «Dirección en la tienda», o cambie el nombre.`;
      }
      if (error.code === "category_slug_reserved") {
        return `${from} la usa la tienda para otra página. Escriba otra en «Dirección en la tienda», o cambie el nombre.`;
      }
      if (error.code === "category_slug_invalid") {
        return "Del nombre no sale una dirección válida. Escriba una en «Dirección en la tienda», con letras sin tildes, números y guiones.";
      }
      return null;
    },
  );
}

export async function renameCategory(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("categoryId"));
  const values = typed(formData, "name", "slug");
  if (!id.success) return { error: GENERIC_ERROR, values };
  return catalogueAction(
    "/catalogo/categorias",
    async (api) => {
      const result = await api.opsUpdateCategory({
        categoryId: id.data,
        nameEs: text(formData, "name") || null,
        slug: text(formData, "slug") || null,
      });
      return result.previous_slug
        ? `Guardado. La dirección nueva es /c/${result.slug}; la anterior, /c/${result.previous_slug}, lleva a ella.`
        : "Nombre guardado.";
    },
    values,
  );
}

export async function moveCategory(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("categoryId"));
  const parentId = optionalId(formData, "parentId");
  if (!id.success || parentId === undefined) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/categorias", async (api) => {
    await api.opsMoveCategory(id.data, parentId);
    return parentId ? "Categoría movida." : "Ahora es un departamento.";
  });
}

export async function shiftCategory(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("categoryId"));
  const direction = z.enum(["-1", "1"]).safeParse(formData.get("direction"));
  if (!id.success || !direction.success) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/categorias", async (api) => {
    await api.opsShiftCategory(id.data, direction.data === "-1" ? -1 : 1);
    return direction.data === "-1" ? "Subió un lugar." : "Bajó un lugar.";
  });
}

export async function setCategoryVisible(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("categoryId"));
  const show = formData.get("visible") === "yes";
  if (!id.success) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/categorias", async (api) => {
    await api.opsSetCategoryActive(id.data, show);
    return show
      ? "La categoría vuelve a verse en la tienda."
      : "Categoría oculta. Sus productos siguen a la venta, en la búsqueda y en su propia página.";
  });
}

export async function deleteCategory(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("categoryId"));
  if (!id.success) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/categorias", async (api) => {
    await api.opsDeleteCategory(id.data);
    return "Categoría eliminada.";
  });
}

// ── Brands ──────────────────────────────────────────────────────────────────

export async function createBrand(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "name", "slug");
  if (text(formData, "name").length < 2) return { error: "Escriba el nombre de la marca.", values };
  return catalogueAction(
    "/catalogo/marcas",
    async (api) => {
      const brand = await api.opsCreateBrand(
        text(formData, "name"),
        text(formData, "slug") || null,
      );
      return `Marca «${brand.name}» creada.`;
    },
    values,
  );
}

export async function renameBrand(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("brandId"));
  const values = typed(formData, "name", "slug");
  if (!id.success) return { error: GENERIC_ERROR, values };
  return catalogueAction(
    "/catalogo/marcas",
    async (api) => {
      await api.opsUpdateBrand(
        id.data,
        text(formData, "name") || null,
        text(formData, "slug") || null,
      );
      return "Guardado. Quien busque el nombre anterior sigue encontrando sus productos.";
    },
    values,
  );
}

export async function setBrandVisible(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("brandId"));
  const show = formData.get("visible") === "yes";
  if (!id.success) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/marcas", async (api) => {
    await api.opsSetBrandActive(id.data, show);
    return show
      ? "La marca vuelve a ofrecerse en el filtro de la tienda."
      : "La marca ya no se ofrece en el filtro. Sus productos la siguen mostrando.";
  });
}

export async function mergeBrands(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const from = uuid.safeParse(formData.get("brandId"));
  const intoText = text(formData, "intoId");
  const values = typed(formData, "intoId");
  if (!from.success) return { error: GENERIC_ERROR, values };
  if (!intoText) return { error: "Elija la marca que queda.", values };
  const into = uuid.safeParse(intoText);
  if (!into.success) return { error: GENERIC_ERROR, values };
  return catalogueAction(
    "/catalogo/marcas",
    async (api) => {
      const result = await api.opsMergeBrands(from.data, into.data);
      return result.moved === 1
        ? "Marcas unidas: 1 producto pasó a la marca que queda."
        : `Marcas unidas: ${result.moved} productos pasaron a la marca que queda.`;
    },
    values,
  );
}

// ── Search synonyms ─────────────────────────────────────────────────────────

export async function addSynonym(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "term", "expansions");
  const term = text(formData, "term");
  const expansions = text(formData, "expansions")
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!term) return { error: "Escriba la palabra que la gente busca.", values };
  if (expansions.length === 0) {
    return { error: "Escriba al menos una búsqueda equivalente.", values };
  }
  return catalogueAction(
    "/catalogo/busqueda",
    async (api) => {
      const saved = await api.opsAddSearchSynonym(term, expansions);
      return `Listo: quien busque «${saved.term}» también encuentra ${saved.expansions
        .map((e) => `«${e}»`)
        .join(", ")}.`;
    },
    values,
  );
}

export async function removeSynonym(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const term = text(formData, "term");
  if (!term) return { error: GENERIC_ERROR };
  return catalogueAction("/catalogo/busqueda", async (api) => {
    await api.opsRemoveSearchSynonym(term);
    return `Quitamos los sinónimos de «${term}».`;
  });
}

// ── Reviews ─────────────────────────────────────────────────────────────────

const reason = z.enum(REVIEW_HIDE_REASONS);

export async function hideReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("reviewId"));
  const why = reason.safeParse(formData.get("reason"));
  const values = typed(formData, "reason", "note");
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (!why.success) return { error: "Elija el motivo.", values };
  const part = formData.get("part") === "reply" ? "reply" : "review";
  return catalogueAction(
    "/catalogo/resenas",
    async (api) => {
      if (part === "reply") {
        await api.opsHideReviewReply(id.data, why.data, text(formData, "note") || null);
        return "Ocultamos la respuesta del vendedor. La reseña sigue publicada.";
      }
      await api.opsHideReview(id.data, why.data, text(formData, "note") || null);
      return "Reseña oculta. Ya no cuenta en la calificación, y su autor ve el motivo en su pedido.";
    },
    values,
  );
}

export async function showReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("reviewId"));
  if (!id.success) return { error: GENERIC_ERROR };
  const part = formData.get("part") === "reply" ? "reply" : "review";
  return catalogueAction("/catalogo/resenas", async (api) => {
    if (part === "reply") {
      await api.opsShowReviewReply(id.data);
      return "La respuesta del vendedor vuelve a verse.";
    }
    await api.opsShowReview(id.data);
    return "La reseña vuelve a verse y cuenta otra vez en la calificación.";
  });
}

// ── Corrections to a product ────────────────────────────────────────────────

export async function correctProduct(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("productId"));
  const values = typed(formData, "categoryId", "brandId", "note");
  if (!id.success) return { error: GENERIC_ERROR, values };
  const categoryId = optionalId(formData, "categoryId");
  const brandValue = text(formData, "brandId");
  const clearBrand = brandValue === "none";
  const brandId = clearBrand ? null : optionalId(formData, "brandId");
  if (categoryId === undefined || brandId === undefined) return { error: GENERIC_ERROR, values };
  if (text(formData, "note").length < 10) {
    return {
      error: "Escriba el motivo, de al menos 10 caracteres: el vendedor lo lee tal cual.",
      values,
    };
  }
  return catalogueAction(
    "/catalogo/productos",
    async (api) => {
      await api.opsCorrectProduct({
        productId: id.data,
        categoryId,
        brandId,
        clearBrand,
        note: text(formData, "note"),
      });
      return "Corrección guardada. La tienda ya la muestra y el vendedor recibe un aviso con el motivo.";
    },
    values,
  );
}

export async function takeDownProduct(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("productId"));
  const values = typed(formData, "note");
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (text(formData, "note").length < 10) {
    return {
      error: "Escriba el motivo, de al menos 10 caracteres: el vendedor lo lee tal cual.",
      values,
    };
  }
  return catalogueAction(
    "/catalogo/productos",
    async (api) => {
      await api.opsTakeDownProduct(id.data, text(formData, "note"));
      return "Producto retirado de la tienda. El vendedor recibe un aviso con el motivo.";
    },
    values,
  );
}

export async function restoreProduct(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("productId"));
  const values = typed(formData, "note");
  if (!id.success) return { error: GENERIC_ERROR, values };
  if (text(formData, "note").length < 10) {
    return { error: "Escriba una nota para el vendedor, de al menos 10 caracteres.", values };
  }
  return catalogueAction(
    "/catalogo/productos",
    async (api) => {
      await api.opsRestoreProduct(id.data, text(formData, "note"));
      return "Producto publicado de nuevo. El vendedor recibe un aviso.";
    },
    values,
  );
}
