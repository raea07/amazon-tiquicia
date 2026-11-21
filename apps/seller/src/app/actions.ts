"use server";

/**
 * Everything a seller can change, as Server Actions.
 *
 * Each action re-reads the session and the shop itself rather than trusting the
 * page that rendered the form, validates its input, and calls the API. The
 * database decides whether the person may do it; these checks exist to give a
 * good message. Errors come back as text safe to show.
 */

import { parseColones, parseIdentification, parsePhone } from "@yuntera/core";
import { ApiError } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  endSession,
  GENERIC_ERROR,
  getViewer,
  messageOf,
  passwordSignIn,
  passwordSignUp,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentShop, rememberShop } from "@/lib/shop";

// ── Session ─────────────────────────────────────────────────────────────────

export async function signIn(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignIn(formData);
}

export async function signUp(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return passwordSignUp(formData);
}

export async function signOut(): Promise<void> {
  await endSession("/ingresar");
}

export async function chooseShop(formData: FormData): Promise<void> {
  const shopId = z.uuid().safeParse(formData.get("shopId"));
  const session = await currentShop();
  // Only a shop the person belongs to can be chosen.
  if (shopId.success && session?.roles.sellers.some((shop) => shop.id === shopId.data)) {
    await rememberShop(shopId.data);
  }
  redirect("/");
}

/** The shop the action applies to, or a redirect to sign in. */
async function shopForAction(returnTo: string) {
  const session = await currentShop();
  if (!session) redirectTo((await getViewer()) ? "/registro" : signInPath(returnTo));
  return session.shop;
}

// ── Registering a shop ──────────────────────────────────────────────────────

const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52)
    .replace(/-+$/g, "");

const ID_TYPES = ["fisica", "juridica", "dimex", "nite"] as const;

export async function registerShop(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getViewer())) redirectTo(signInPath("/registro"));
  const values = typed(
    formData,
    "tradeName",
    "legalName",
    "idType",
    "idNumber",
    "contactEmail",
    "contactPhone",
    "fiscalAddress",
  );

  const tradeName = (values.tradeName ?? "").trim();
  const legalName = (values.legalName ?? "").trim();
  const fiscalAddress = (values.fiscalAddress ?? "").trim();
  const contactEmail = (values.contactEmail ?? "").trim();
  const idType = z.enum(ID_TYPES).safeParse(values.idType);

  if (tradeName.length < 2 || tradeName.length > 80) {
    return { error: "Escriba el nombre de su tienda (entre 2 y 80 letras).", values };
  }
  const slug = slugOf(tradeName);
  if (!slug) return { error: "El nombre de la tienda debe tener letras o números.", values };
  if (legalName.length < 2) {
    return { error: "Escriba el nombre o la razón social tal como aparece en Hacienda.", values };
  }
  if (!idType.success) return { error: "Elija el tipo de identificación.", values };
  const identification = parseIdentification(values.idNumber ?? "", idType.data);
  if (!identification) {
    return { error: "El número de identificación no es válido para ese tipo.", values };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { error: "Escriba un correo de contacto válido.", values };
  }
  const phone = parsePhone(values.contactPhone ?? "");
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos.", values };
  if (fiscalAddress.length < 15) {
    return {
      error: "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas.",
      values,
    };
  }
  if (formData.get("declara") !== "on") {
    return {
      error: "Debe declarar que los datos son verdaderos para enviar la solicitud.",
      values,
    };
  }

  const api = await sessionApi();
  const create = (withSlug: string) =>
    api.createSeller({
      tradeName,
      slug: withSlug,
      legalName,
      idType: identification.type,
      idNumber: identification.value,
      contactEmail,
      contactPhone: phone.e164,
      fiscalAddress,
    });

  let shopId: string;
  try {
    shopId = await create(slug);
  } catch (error) {
    // Two shops can share a name; their addresses cannot. Try once with a suffix.
    if (error instanceof ApiError && error.code === "slug_taken") {
      try {
        shopId = await create(`${slug}-${crypto.randomUUID().slice(0, 4)}`);
      } catch (retryError) {
        return { error: messageOf(retryError), values };
      }
    } else {
      return { error: messageOf(error), values };
    }
  }
  await rememberShop(shopId);
  redirect("/?bienvenida=1");
}

// ── Listings ────────────────────────────────────────────────────────────────

const listingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "El título debe tener al menos 5 letras.")
    .max(200, "El título es demasiado largo."),
  categorySlug: z.string().min(1, "Elija la categoría."),
  description: z.string().trim().max(10_000).optional(),
  fulfillment: z.enum(["platform", "seller"], "Elija quién despacha el producto."),
  handlingDays: z.coerce.number().int().min(0).max(10),
  weightGrams: z.coerce
    .number("Escriba el peso en gramos.")
    .int("Escriba el peso en gramos, sin decimales.")
    .min(1, "Escriba el peso en gramos.")
    .max(30_000, "Por ahora no manejamos productos de más de 30 kg."),
  lengthCm: z.coerce.number().min(0.1, "Escriba el largo en centímetros.").max(200),
  widthCm: z.coerce.number().min(0.1, "Escriba el ancho en centímetros.").max(200),
  heightCm: z.coerce.number().min(0.1, "Escriba el alto en centímetros.").max(200),
});

const LISTING_FIELDS = [
  "title",
  "categorySlug",
  "description",
  "bullets",
  "price",
  "fulfillment",
  "handlingDays",
  "weightGrams",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const;

export async function createListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/productos/nuevo");
  const values = typed(formData, ...LISTING_FIELDS);

  const parsed = listingSchema.safeParse({
    ...values,
    handlingDays: values.fulfillment === "seller" ? values.handlingDays : 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR, values };

  const priceMinor = parseColones(values.price ?? "");
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500.", values };

  const bulletPoints = (values.bullets ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (bulletPoints.length > 8) return { error: "Use como máximo 8 características.", values };

  const draft = formData.get("intent") === "draft";
  // With photos chosen, the listing is saved as a draft first: the browser
  // uploads the photos to it and only then sends it to review (or not).
  const withPhotos = formData.get("fotos") === "1";
  try {
    const api = await sessionApi();
    const created = await api.sellerCreateListing({
      sellerId: shop.id,
      title: parsed.data.title,
      categorySlug: parsed.data.categorySlug,
      description: parsed.data.description || null,
      bulletPoints,
      priceMinor,
      fulfillment: parsed.data.fulfillment,
      handlingDays: parsed.data.handlingDays,
      weightGrams: parsed.data.weightGrams,
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      submit: !draft && !withPhotos,
    });
    if (withPhotos) {
      return {
        ok: "Producto guardado. Subiendo las fotos…",
        values: { ...values, productId: created.product_id, intent: draft ? "draft" : "submit" },
      };
    }
  } catch (error) {
    return { error: messageOf(error), values };
  }
  redirect(draft ? "/productos?creado=borrador" : "/productos?creado=revision");
}

export async function updateOffer(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await shopForAction("/productos");
  const values = typed(formData, "price", "listPrice", "status", "handlingDays");
  const offerId = z.uuid().safeParse(formData.get("offerId"));
  const status = z.enum(["active", "paused"]).safeParse(values.status);
  if (!offerId.success || !status.success) return { error: GENERIC_ERROR, values };

  const priceMinor = parseColones(values.price ?? "");
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500.", values };
  const listPriceMinor = values.listPrice?.trim() ? parseColones(values.listPrice) : null;
  if (values.listPrice?.trim() && !listPriceMinor) {
    return { error: "El precio regular no es un monto válido.", values };
  }
  if (listPriceMinor && listPriceMinor <= priceMinor) {
    return {
      error:
        "El precio regular debe ser mayor que el precio de venta. Si no hay rebaja, déjelo vacío.",
      values,
    };
  }
  const handlingDays = values.handlingDays ? Number(values.handlingDays) : undefined;
  if (
    handlingDays !== undefined &&
    !(Number.isInteger(handlingDays) && handlingDays >= 0 && handlingDays <= 10)
  ) {
    return { error: "Los días para alistar deben estar entre 0 y 10.", values };
  }

  const state = await attempt(async () => {
    await (await sessionApi()).sellerUpdateOffer({
      offerId: offerId.data,
      priceMinor,
      listPriceMinor,
      status: status.data,
      handlingDays,
    });
    return "Cambios guardados.";
  }, values);
  if (state.ok) refresh();
  return state;
}

// ── Inventory ───────────────────────────────────────────────────────────────

export async function setStock(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await shopForAction("/inventario");
  const values = typed(formData, "quantity");
  const parsed = z
    .object({
      warehouseId: z.uuid(),
      skuId: z.uuid(),
      quantity: z.coerce.number().int().min(0).max(100_000),
    })
    .safeParse({
      warehouseId: formData.get("warehouseId"),
      skuId: formData.get("skuId"),
      quantity: values.quantity === "" ? Number.NaN : values.quantity,
    });
  if (!parsed.success)
    return { error: "Escriba cuántas unidades tiene, de 0 en adelante.", values };

  const state = await attempt(async () => {
    await (await sessionApi()).sellerSetStock(
      parsed.data.warehouseId,
      parsed.data.skuId,
      parsed.data.quantity,
    );
    return "Existencias actualizadas.";
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function saveLocation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/inventario");
  const values = typed(formData, "name", "address");
  const parsed = z
    .object({
      name: z
        .string()
        .trim()
        .min(3, "Póngale un nombre al lugar, por ejemplo “Local Heredia”.")
        .max(80),
      address: z
        .string()
        .trim()
        .min(15, "Agregue más detalle a las señas: el repartidor debe poder llegar.")
        .max(500),
      postalCode: z.string().regex(/^[1-7]\d{4}$/, "Elija la provincia, el cantón y el distrito."),
      lat: z.coerce.number().min(8).max(11.25),
      lng: z.coerce.number().min(-86).max(-82.5),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error:
        issue?.path[0] === "lat" || issue?.path[0] === "lng"
          ? "Marque el punto exacto: use su ubicación actual o escriba el código Plus."
          : (issue?.message ?? GENERIC_ERROR),
      values,
    };
  }

  const state = await attempt(async () => {
    await (await sessionApi()).sellerSaveLocation({ sellerId: shop.id, ...parsed.data });
    return "Ubicación guardada. Ya puede indicar sus existencias.";
  }, values);
  if (state.ok) refresh();
  return state;
}

export async function createInbound(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shop = await shopForAction("/inventario");
  const warehouseId = z.uuid().safeParse(formData.get("warehouseId"));
  if (!warehouseId.success) return { error: "Elija la bodega." };

  // One field per product, named "qty:<sku id>". Empty or zero means "not this time".
  const lines: Array<{ skuId: string; quantity: number }> = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("qty:") || typeof value !== "string" || value.trim() === "") continue;
    const skuId = z.uuid().safeParse(name.slice(4));
    const quantity = Number(value);
    if (!skuId.success || !Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) {
      return { error: "Revise las cantidades: deben ser números enteros." };
    }
    if (quantity > 0) lines.push({ skuId: skuId.data, quantity });
  }
  if (lines.length === 0)
    return { error: "Indique cuántas unidades envía de al menos un producto." };

  const expectedOn = String(formData.get("expectedOn") ?? "");
  if (expectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(expectedOn)) {
    return { error: "La fecha de llegada no es válida." };
  }

  const state = await attempt(async () => {
    await (await sessionApi()).sellerCreateInbound({
      warehouseId: warehouseId.data,
      sellerId: shop.id,
      lines,
      expectedOn: expectedOn || null,
    });
    return "Envío registrado. Rotule las cajas con la referencia que aparece abajo.";
  });
  if (state.ok) refresh();
  return state;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export async function markPacked(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await shopForAction("/pedidos");
  const values = typed(formData, "weightGrams", "packageCount");
  const parsed = z
    .object({
      shipmentId: z.uuid(),
      weightGrams: z.coerce.number().int().min(1).max(30_000),
      packageCount: z.coerce.number().int().min(1).max(20),
    })
    .safeParse({
      shipmentId: formData.get("shipmentId"),
      weightGrams: values.weightGrams === "" ? Number.NaN : values.weightGrams,
      packageCount: values.packageCount || 1,
    });
  if (!parsed.success) {
    return { error: "Escriba el peso del paquete en gramos y cuántos bultos son.", values };
  }

  const state = await attempt(async () => {
    await (await sessionApi()).sellerMarkPacked(
      parsed.data.shipmentId,
      parsed.data.weightGrams,
      parsed.data.packageCount,
    );
    return "Listo. Un repartidor de Yuntera pasa a recogerlo.";
  }, values);
  if (state.ok) refresh();
  return state;
}
