"use server";

/**
 * Moving stock between locations and correcting a count, from a location's
 * page. Each re-reads the session and validates its input; the database
 * checks that the person works at the location's warehouse (or is in
 * operations) and refuses a move of units that orders wait for, or a count
 * made from a number the shelf no longer has.
 *
 * On success the location's page is loaded again with what was done (the
 * product may have left the shelf, and its form with it). On a refusal the
 * page behind is drawn again too, so its numbers are the database's, and the
 * form keeps what was typed.
 */

import { ApiError, reasonLetters, STOCK_LIMITS } from "@yuntera/db";
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
  locationId: z.uuid(),
  locationCode: z.string().regex(/^[A-Z0-9-]{1,20}$/),
  skuId: z.uuid(),
  sellerId: z.uuid(),
});

function productOf(formData: FormData) {
  return product.safeParse({
    locationId: formData.get("locationId"),
    locationCode: formData.get("locationCode"),
    skuId: formData.get("skuId"),
    sellerId: formData.get("sellerId"),
  });
}

const back = (code: string, outcome: Record<string, string>) =>
  safeReturnPath(`/bodega/ubicacion?${new URLSearchParams({ codigo: code, ...outcome })}`);

async function api(code: string) {
  if (!(await getViewer())) redirectTo(signInPath(back(code, {})));
  return sessionApi();
}

export async function moveStock(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = typed(formData, "quantity", "toLocationId", "note");
  const ids = productOf(formData);
  if (!ids.success) return { error: GENERIC_ERROR, values };
  const target = z.uuid().safeParse(values.toLocationId);
  if (!target.success) return { error: "Elija a qué estante lo mueve.", values };
  const [least, most] = STOCK_LIMITS.moveQuantity;
  const quantity = z.number().int().min(least).max(most).safeParse(whole(values.quantity));
  if (!quantity.success) {
    return { error: "Escriba cuántas unidades mueve: un número entero desde 1.", values };
  }
  const note = (values.note ?? "").trim();
  if (note.length > STOCK_LIMITS.moveNoteLength) {
    return { error: "La nota es demasiado larga: use menos de 200 caracteres.", values };
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
    if (error instanceof ApiError) refresh();
    return { error: messageOf(error), values };
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
  if (!ids.success || !expected.success) return { error: GENERIC_ERROR, values };
  const counted = z.number().int().min(0).max(100_000).safeParse(whole(values.counted));
  if (!counted.success) {
    return { error: "Escriba cuántas unidades contó: un número entero desde 0.", values };
  }
  const delta = counted.data - expected.data;
  if (delta === 0) {
    return { error: "Contó lo mismo que está registrado: no hay nada que corregir.", values };
  }
  if (Math.abs(delta) > STOCK_LIMITS.adjustDelta) {
    return {
      error: "Una corrección no puede cambiar más de 10 000 unidades. Avise a operaciones.",
      values,
    };
  }
  const note = (values.note ?? "").trim();
  if (reasonLetters(note) < STOCK_LIMITS.reasonLetters || note.length > STOCK_LIMITS.reasonLength) {
    return {
      error: "Escriba el motivo con al menos 5 letras, por ejemplo «faltan 2, caja rota».",
      values,
    };
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
    if (error instanceof ApiError) refresh();
    return { error: messageOf(error), values };
  }
  redirectTo(
    back(ids.data.locationCode, { contadas: String(counted.data), diferencia: String(delta) }),
  );
}
