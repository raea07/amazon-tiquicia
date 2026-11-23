"use server";

/**
 * Moving stock between locations and correcting a count, from a location's
 * page. Each re-reads the session and validates its input; the database
 * checks that the person works at the location's warehouse (or is in
 * operations) and refuses a move of units that orders wait for, or a count
 * made from a number the shelf no longer has.
 *
 * On success the location's page is loaded again with what was done (the
 * product may have left the shelf, and its form with it); the page shows it
 * once and takes it out of the address. On any refusal the page behind is
 * drawn again too, so its numbers are the database's and no earlier
 * confirmation stays next to it, and the form keeps what was typed. When
 * the database refused because the product has meanwhile left the location
 * (someone moved it all away or counted it to zero), its row and its form
 * are gone from the page, so the refusal is shown at the top of the page
 * instead, through the address (`sin`, `accion`).
 */

import { reasonLetters, STOCK_LIMITS } from "@yuntera/db";
import {
  type ActionState,
  GENERIC_ERROR,
  getViewer,
  isRedirect,
  messageOf,
  redirectTo,
  safeReturnPath,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";

const whole = (text: string | undefined) => (text?.trim() ? Number(text.trim()) : Number.NaN);

const product = z.object({
  warehouseId: z.uuid(),
  locationId: z.uuid(),
  locationCode: z.string().regex(/^[A-Z0-9-]{1,20}$/),
  skuId: z.uuid(),
  sellerId: z.uuid(),
  skuCode: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
});

type Product = z.infer<typeof product>;

function productOf(formData: FormData) {
  return product.safeParse({
    warehouseId: formData.get("warehouseId"),
    locationId: formData.get("locationId"),
    locationCode: formData.get("locationCode"),
    skuId: formData.get("skuId"),
    sellerId: formData.get("sellerId"),
    skuCode: formData.get("skuCode"),
  });
}

const back = (code: string, outcome: Record<string, string>) =>
  safeReturnPath(`/bodega/ubicacion?${new URLSearchParams({ codigo: code, ...outcome })}`);

/**
 * A refusal. The page behind is drawn again, so its numbers are the
 * database's and the confirmation of an earlier move or count (already taken
 * out of the address) is not left next to this refusal.
 */
function refuse(error: string, values: ActionState["values"]): ActionState {
  refresh();
  return { error, values };
}

/**
 * After a database refusal: whether the product is still listed in the
 * location (then its form shows the refusal). If reading fails, it is taken
 * as listed, so the refusal is never hidden.
 */
async function stillListed(client: Awaited<ReturnType<typeof sessionApi>>, ids: Product) {
  try {
    const here = await client.wmsLocationStock(ids.warehouseId, ids.locationCode);
    return Boolean(
      here?.items.some((item) => item.sku_id === ids.skuId && item.seller_id === ids.sellerId),
    );
  } catch {
    return true;
  }
}

async function api(code: string) {
  if (!(await getViewer())) redirectTo(signInPath(back(code, {})));
  return sessionApi();
}

export async function moveStock(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "quantity", "toLocationId", "note");
  const ids = productOf(formData);
  if (!ids.success) return refuse(GENERIC_ERROR, values);
  const target = z.uuid().safeParse(values.toLocationId);
  if (!target.success) return refuse("Elija a qué estante lo mueve.", values);
  const [least, most] = STOCK_LIMITS.moveQuantity;
  const quantity = z.number().int().min(least).max(most).safeParse(whole(values.quantity));
  if (!quantity.success) {
    return refuse("Escriba cuántas unidades mueve: un número entero desde 1.", values);
  }
  const note = (values.note ?? "").trim();
  if (note.length > STOCK_LIMITS.moveNoteLength) {
    return refuse("La nota es demasiado larga: use menos de 200 caracteres.", values);
  }

  const client = await api(ids.data.locationCode);
  let moved: Awaited<ReturnType<typeof client.wmsMoveStock>>;
  try {
    moved = await client.wmsMoveStock({
      fromLocationId: ids.data.locationId,
      toLocationId: target.data,
      skuId: ids.data.skuId,
      sellerId: ids.data.sellerId,
      quantity: quantity.data,
      note: note || null,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    // The shelf changed or the target was switched off meanwhile: show its numbers now.
    if (!(await stillListed(client, ids.data))) {
      redirectTo(back(ids.data.locationCode, { sin: ids.data.skuCode, accion: "mover" }));
    }
    return refuse(messageOf(error), values);
  }
  redirectTo(
    back(ids.data.locationCode, { movidas: String(moved.quantity), destino: moved.to.code }),
  );
}

export async function correctCount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "counted", "note");
  const ids = productOf(formData);
  const expected = z.coerce.number().int().min(0).safeParse(formData.get("expected"));
  if (!ids.success || !expected.success) return refuse(GENERIC_ERROR, values);
  const counted = z.number().int().min(0).max(100_000).safeParse(whole(values.counted));
  if (!counted.success) {
    return refuse("Escriba cuántas unidades contó: un número entero desde 0.", values);
  }
  const delta = counted.data - expected.data;
  if (delta === 0) {
    return refuse("Contó lo mismo que está registrado: no hay nada que corregir.", values);
  }
  if (Math.abs(delta) > STOCK_LIMITS.adjustDelta) {
    return refuse(
      "Una corrección no puede cambiar más de 10 000 unidades. Avise a operaciones.",
      values,
    );
  }
  const note = (values.note ?? "").trim();
  if (reasonLetters(note) < STOCK_LIMITS.reasonLetters || note.length > STOCK_LIMITS.reasonLength) {
    return refuse(
      "Escriba el motivo con al menos 5 letras, por ejemplo «faltan 2, caja rota».",
      values,
    );
  }

  const client = await api(ids.data.locationCode);
  try {
    await client.wmsAdjustStock({
      locationId: ids.data.locationId,
      skuId: ids.data.skuId,
      sellerId: ids.data.sellerId,
      delta,
      note,
      expected: expected.data,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (!(await stillListed(client, ids.data))) {
      redirectTo(back(ids.data.locationCode, { sin: ids.data.skuCode, accion: "contar" }));
    }
    return refuse(messageOf(error), values);
  }
  redirectTo(
    back(ids.data.locationCode, { contadas: String(counted.data), diferencia: String(delta) }),
  );
}
