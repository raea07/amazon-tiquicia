/**
 * The checks a seller's input goes through before it is sent, with the words
 * the seller centre uses for each problem.
 *
 * Each function is the app's copy of one Server Action's validation in
 * apps/seller/src/app (actions.ts, listing-actions.ts, payout-actions.ts): the
 * same rules in the same order, the same Spanish messages, and the same input
 * handed to the API. `rules.test.ts` holds the cases. The database checks the
 * caller and the values again; these exist to give a good message first.
 *
 * Pure TypeScript with no React Native import, so it runs in the unit tests.
 */

import {
  CR_IBAN_LENGTH,
  checkCrIban,
  type IbanProblem,
  type IdentificationType,
  normalizeIban,
  parseColones,
  parseIdentification,
  parsePhone,
} from "@yuntera/core";
import { z } from "zod";

/** The outcome of a check: a message to show, or the input for the API. */
export type Checked<T> = { error: string } | { input: T };

export const GENERIC_ERROR = "Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento.";

// ── Registering a shop ──────────────────────────────────────────────────────

/** The shop's address in Yuntera, from its name: "Café Doña Ana" → "cafe-dona-ana". */
export const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52)
    .replace(/-+$/g, "");

export const ID_TYPES = ["fisica", "juridica", "dimex", "nite"] as const;

export const ID_TYPE_LABEL: Record<IdentificationType, string> = {
  fisica: "Cédula física",
  juridica: "Cédula jurídica",
  dimex: "DIMEX",
  nite: "NITE",
};

export interface ShopForm {
  tradeName: string;
  legalName: string;
  idType: string;
  idNumber: string;
  contactEmail: string;
  contactPhone: string;
  fiscalAddress: string;
  declared: boolean;
}

export interface ShopInput {
  tradeName: string;
  slug: string;
  legalName: string;
  idType: IdentificationType;
  idNumber: string;
  contactEmail: string;
  contactPhone: string;
  fiscalAddress: string;
}

/** apps/seller `registerShop`. */
export function checkShop(form: ShopForm): Checked<ShopInput> {
  const tradeName = form.tradeName.trim();
  const legalName = form.legalName.trim();
  const fiscalAddress = form.fiscalAddress.trim();
  const contactEmail = form.contactEmail.trim();
  const idType = z.enum(ID_TYPES).safeParse(form.idType);

  if (tradeName.length < 2 || tradeName.length > 80) {
    return { error: "Escriba el nombre de su tienda (entre 2 y 80 letras)." };
  }
  const slug = slugOf(tradeName);
  if (!slug) return { error: "El nombre de la tienda debe tener letras o números." };
  if (legalName.length < 2) {
    return { error: "Escriba el nombre o la razón social tal como aparece en Hacienda." };
  }
  if (!idType.success) return { error: "Elija el tipo de identificación." };
  const identification = parseIdentification(form.idNumber, idType.data);
  if (!identification) return { error: "El número de identificación no es válido para ese tipo." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { error: "Escriba un correo de contacto válido." };
  }
  const phone = parsePhone(form.contactPhone);
  if (!phone) return { error: "Escriba un teléfono costarricense de 8 dígitos." };
  if (fiscalAddress.length < 15) {
    return { error: "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas." };
  }
  if (!form.declared) {
    return { error: "Debe declarar que los datos son verdaderos para enviar la solicitud." };
  }
  return {
    input: {
      tradeName,
      slug,
      legalName,
      idType: identification.type,
      idNumber: identification.value,
      contactEmail,
      contactPhone: phone.e164,
      fiscalAddress,
    },
  };
}

// ── Listings ────────────────────────────────────────────────────────────────

const packageSchema = {
  weightGrams: z.coerce
    .number("Escriba el peso en gramos.")
    .int("Escriba el peso en gramos, sin decimales.")
    .min(1, "Escriba el peso en gramos.")
    .max(30_000, "Por ahora no manejamos productos de más de 30 kg."),
  lengthCm: z.coerce.number().min(0.1, "Escriba el largo en centímetros.").max(200),
  widthCm: z.coerce.number().min(0.1, "Escriba el ancho en centímetros.").max(200),
  heightCm: z.coerce.number().min(0.1, "Escriba el alto en centímetros.").max(200),
};

const titleSchema = z
  .string()
  .trim()
  .min(5, "El título debe tener al menos 5 letras.")
  .max(200, "El título es demasiado largo.");

const listingSchema = z.object({
  title: titleSchema,
  categorySlug: z.string().min(1, "Elija la categoría."),
  description: z.string().trim().max(10_000).optional(),
  fulfillment: z.enum(["platform", "seller"], "Elija quién despacha el producto."),
  handlingDays: z.coerce.number().int().min(0).max(10),
  ...packageSchema,
});

/** The text a person types into a listing form, field by field. */
export interface ListingForm {
  title: string;
  categorySlug: string;
  description: string;
  bullets: string;
  price: string;
  fulfillment: string;
  handlingDays: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

export interface NewListingInput {
  title: string;
  categorySlug: string;
  description: string | null;
  bulletPoints: string[];
  priceMinor: number;
  fulfillment: "platform" | "seller";
  handlingDays: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  submit: boolean;
}

const bulletsOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** apps/seller `createListing`. `draft` is "Guardar como borrador". */
export function checkNewListing(form: ListingForm, draft: boolean): Checked<NewListingInput> {
  const parsed = listingSchema.safeParse({
    ...form,
    handlingDays: form.fulfillment === "seller" ? form.handlingDays : 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };

  const priceMinor = parseColones(form.price);
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500." };

  const bulletPoints = bulletsOf(form.bullets);
  if (bulletPoints.length > 8) return { error: "Use como máximo 8 características." };

  return {
    input: {
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
      submit: !draft,
    },
  };
}

const editSchema = z.object({
  title: titleSchema,
  categorySlug: z.string().min(1, "Elija la categoría."),
  description: z.string().trim().max(10_000, "La descripción es demasiado larga.").optional(),
  ...packageSchema,
});

export type ListingEditForm = Omit<ListingForm, "price" | "fulfillment" | "handlingDays">;

export interface ListingEditInput {
  title: string;
  categorySlug: string;
  description: string | null;
  bulletPoints: string[];
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  submit: boolean;
}

/** apps/seller `updateListing`. `draft` is "Guardar sin enviar" (only before publication). */
export function checkListingEdit(form: ListingEditForm, draft: boolean): Checked<ListingEditInput> {
  const parsed = editSchema.safeParse(form);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  const bulletPoints = bulletsOf(form.bullets);
  if (bulletPoints.length > 8) return { error: "Use como máximo 8 características." };
  if (bulletPoints.some((line) => line.length > 300)) {
    return { error: "Cada característica puede tener hasta 300 caracteres." };
  }
  return {
    input: {
      title: parsed.data.title,
      categorySlug: parsed.data.categorySlug,
      description: parsed.data.description || null,
      bulletPoints,
      weightGrams: parsed.data.weightGrams,
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      submit: !draft,
    },
  };
}

/** What the database answered, in the words of the seller centre. */
export function listingEditOutcome(outcome: "saved" | "submitted" | "in_review"): string {
  if (outcome === "in_review") {
    return "Enviamos sus cambios a revisión. Su publicación sigue a la venta tal como está hasta que los aprobemos.";
  }
  return outcome === "submitted"
    ? "Producto enviado a revisión con sus cambios."
    : "Cambios guardados. Todavía no lo hemos enviado a revisión.";
}

/** Céntimos as the plain number a person would type back: 1990000 → "19900". */
export const plainColones = (amountMinor: number) =>
  amountMinor % 100 === 0
    ? String(amountMinor / 100)
    : (amountMinor / 100).toFixed(2).replace(".", ",");

export interface OfferForm {
  price: string;
  listPrice: string;
  status: string;
  /** Empty for an offer Yuntera ships: the field is not shown. */
  handlingDays: string;
}

export interface OfferInput {
  priceMinor: number;
  listPriceMinor: number | null;
  status: "active" | "paused";
  handlingDays?: number;
}

/** apps/seller `updateOffer`. */
export function checkOffer(form: OfferForm): Checked<OfferInput> {
  const status = z.enum(["active", "paused"]).safeParse(form.status);
  if (!status.success) return { error: GENERIC_ERROR };
  const priceMinor = parseColones(form.price);
  if (!priceMinor) return { error: "Escriba el precio en colones, por ejemplo 12 500." };
  const listPriceMinor = form.listPrice.trim() ? parseColones(form.listPrice) : null;
  if (form.listPrice.trim() && !listPriceMinor) {
    return { error: "El precio regular no es un monto válido." };
  }
  if (listPriceMinor && listPriceMinor <= priceMinor) {
    return {
      error:
        "El precio regular debe ser mayor que el precio de venta. Si no hay rebaja, déjelo vacío.",
    };
  }
  const handlingDays = form.handlingDays ? Number(form.handlingDays) : undefined;
  if (
    handlingDays !== undefined &&
    !(Number.isInteger(handlingDays) && handlingDays >= 0 && handlingDays <= 10)
  ) {
    return { error: "Los días para alistar deben estar entre 0 y 10." };
  }
  return { input: { priceMinor, listPriceMinor, status: status.data, handlingDays } };
}

// ── Inventory ───────────────────────────────────────────────────────────────

/** apps/seller `setStock`: how many units there are now at the seller's own place. */
export function checkStock(quantity: string): Checked<number> {
  const parsed = z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000)
    .safeParse(quantity.trim() === "" ? Number.NaN : quantity);
  return parsed.success
    ? { input: parsed.data }
    : { error: "Escriba cuántas unidades tiene, de 0 en adelante." };
}

export interface LocationForm {
  name: string;
  address: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
}

export interface LocationInput {
  name: string;
  address: string;
  postalCode: string;
  lat: number;
  lng: number;
}

/** apps/seller `saveLocation`. */
export function checkLocation(form: LocationForm): Checked<LocationInput> {
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
      lat: z.number().min(8).max(11.25),
      lng: z.number().min(-86).max(-82.5),
    })
    .safeParse(form);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error:
        issue?.path[0] === "lat" || issue?.path[0] === "lng"
          ? "Marque el punto exacto: escriba el código Plus del lugar."
          : (issue?.message ?? GENERIC_ERROR),
    };
  }
  return { input: parsed.data };
}

export interface InboundForm {
  warehouseId: string;
  /** Units per variant, as typed. Empty or zero means "not this time". */
  quantities: Record<string, string>;
  /** YYYY-MM-DD, or empty. */
  expectedOn: string;
}

export interface InboundInput {
  warehouseId: string;
  lines: Array<{ skuId: string; quantity: number }>;
  expectedOn: string | null;
}

/** apps/seller `createInbound`. */
export function checkInbound(form: InboundForm): Checked<InboundInput> {
  const warehouseId = z.uuid().safeParse(form.warehouseId);
  if (!warehouseId.success) return { error: "Elija la bodega." };
  const lines: InboundInput["lines"] = [];
  for (const [skuId, value] of Object.entries(form.quantities)) {
    if (value.trim() === "") continue;
    const quantity = Number(value);
    if (
      !z.uuid().safeParse(skuId).success ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > 100_000
    ) {
      return { error: "Revise las cantidades: deben ser números enteros." };
    }
    if (quantity > 0) lines.push({ skuId, quantity });
  }
  if (lines.length === 0)
    return { error: "Indique cuántas unidades envía de al menos un producto." };
  if (form.expectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(form.expectedOn)) {
    return { error: "La fecha de llegada no es válida." };
  }
  return { input: { warehouseId: warehouseId.data, lines, expectedOn: form.expectedOn || null } };
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** apps/seller `markPacked`. */
export function checkPacked(form: {
  weightGrams: string;
  packageCount: string;
}): Checked<{ weightGrams: number; packageCount: number }> {
  const parsed = z
    .object({
      weightGrams: z.coerce.number().int().min(1).max(30_000),
      packageCount: z.coerce.number().int().min(1).max(20),
    })
    .safeParse({
      weightGrams: form.weightGrams.trim() === "" ? Number.NaN : form.weightGrams,
      packageCount: form.packageCount || 1,
    });
  return parsed.success
    ? { input: parsed.data }
    : { error: "Escriba el peso del paquete en gramos y cuántos bultos son." };
}

// ── Payout account ──────────────────────────────────────────────────────────

export const IBAN_PROBLEM: Record<IbanProblem, string> = {
  empty: "Escriba la cuenta IBAN.",
  country: "Una cuenta IBAN de Costa Rica empieza con las letras CR.",
  characters: "Después de CR solo van números. Revise que no haya una letra O en lugar de un cero.",
  length: "La cuenta IBAN tiene 22 caracteres: CR y 20 dígitos. Revise que no falte ni sobre uno.",
  checksum:
    "Los dígitos de la cuenta no coinciden: alguno está mal escrito o cambiado de lugar. Compárela con la que le da su banco.",
};

/**
 * What to say about the account number while it is being typed
 * (apps/seller `ibanFeedback`): a neutral count while it is unfinished, the
 * reason once it can no longer become valid.
 */
export function ibanFeedback(input: string): { hint?: string; error?: string } {
  const result = checkCrIban(input);
  if (result.ok) return { hint: `Cuenta válida: ${result.iban.formatted}` };
  const typed = normalizeIban(input);
  switch (result.problem) {
    case "empty":
      return { hint: "Empieza con CR y tiene 22 caracteres. Puede escribirla con espacios." };
    case "country":
      return typed === "C"
        ? { hint: "Empieza con CR y tiene 22 caracteres." }
        : { error: "Una cuenta IBAN de Costa Rica empieza con las letras CR." };
    case "characters":
      return {
        error:
          "Después de CR solo van números. Revise que no haya una letra O en lugar de un cero.",
      };
    case "length":
      return typed.length < CR_IBAN_LENGTH
        ? { hint: `Lleva ${typed.length} de ${CR_IBAN_LENGTH} caracteres.` }
        : { error: `Sobran caracteres: tiene ${typed.length} y deben ser ${CR_IBAN_LENGTH}.` };
    case "checksum":
      return {
        error:
          "Los dígitos no coinciden: alguno está mal escrito o cambiado de lugar. Compárela con la que le da su banco.",
      };
  }
}

export interface PayoutRequestInput {
  iban: string;
  holderName: string;
  sinpeNumber: string | null;
}

/** apps/seller `requestPayoutDetails`. Nothing is sent unless the IBAN passes its check. */
export function checkPayoutRequest(form: {
  iban: string;
  holderName: string;
  sinpe: string;
}): Checked<PayoutRequestInput> {
  const iban = checkCrIban(form.iban);
  if (!iban.ok) return { error: IBAN_PROBLEM[iban.problem] };
  const holderName = form.holderName.trim().replace(/\s+/g, " ");
  if (holderName.length < 3 || holderName.length > 160) {
    return { error: "Escriba el nombre completo del titular, tal como aparece en el banco." };
  }
  const sinpe = form.sinpe.trim() ? parsePhone(form.sinpe) : null;
  if (form.sinpe.trim() && sinpe?.kind !== "mobile") {
    return { error: "El número de SINPE Móvil debe ser un celular de Costa Rica: 8 dígitos." };
  }
  return { input: { iban: iban.iban.value, holderName, sinpeNumber: sinpe?.e164 ?? null } };
}
