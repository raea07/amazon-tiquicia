"use server";

/**
 * Counting a product the location does not list onto it, from the location's
 * page. Re-reads the session and validates the input; the database checks
 * that the person works at the location's warehouse (or is in operations),
 * that the shop has a stock record of the product here (a first unit is a
 * receipt), that the location is switched on and takes counted units, and
 * that the location does not list the product meanwhile (another worker
 * counted or moved it there, or the same worker saved twice).
 *
 * On success the location's page is loaded again, without the search, with
 * what was counted (`nuevas`, `producto`): the product's new line is in the
 * list. On any refusal the page behind is drawn again, so its numbers are
 * the database's (a product another worker counted meanwhile now shows on
 * its own line), and the form keeps what was typed.
 */

import { COUNT_IN_LIMITS, reasonLetters, STOCK_LIMITS } from "@yuntera/db";
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

const ids = z.object({
  locationId: z.uuid(),
  locationCode: z.string().regex(/^[A-Z0-9-]{1,20}$/),
  skuId: z.uuid(),
  skuCode: z.string().regex(/^[A-Z0-9-]{4,32}$/),
});

const back = (code: string, outcome: Record<string, string>) =>
  safeReturnPath(`/bodega/ubicacion?${new URLSearchParams({ codigo: code, ...outcome })}`);

function refuse(error: string, values: ActionState["values"]): ActionState {
  refresh();
  return { error, values };
}

export async function countIntoLocation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = typed(formData, "sellerId", "quantity", "note");
  const product = ids.safeParse({
    locationId: formData.get("locationId"),
    locationCode: formData.get("locationCode"),
    skuId: formData.get("skuId"),
    skuCode: formData.get("skuCode"),
  });
  if (!product.success) return refuse(GENERIC_ERROR, values);
  const seller = z.uuid().safeParse(values.sellerId);
  if (!seller.success) return refuse("Elija de qué tienda son las unidades.", values);
  const [least, most] = COUNT_IN_LIMITS.quantity;
  const text = values.quantity?.trim() ?? "";
  const quantity = z
    .number()
    .int()
    .min(least)
    .max(most)
    .safeParse(/^\d{1,6}$/.test(text) ? Number(text) : Number.NaN);
  if (!quantity.success) {
    return refuse(
      "Escriba cuántas unidades contó: un número entero desde 1 hasta 10 000. Si son más, avise a operaciones.",
      values,
    );
  }
  const note = (values.note ?? "").trim();
  if (reasonLetters(note) < STOCK_LIMITS.reasonLetters || note.length > STOCK_LIMITS.reasonLength) {
    return refuse(
      "Escriba el motivo con al menos 5 letras, por ejemplo «estaban detrás de otra caja».",
      values,
    );
  }

  if (!(await getViewer())) redirectTo(signInPath(back(product.data.locationCode, {})));
  const client = await sessionApi();
  let counted: Awaited<ReturnType<typeof client.wmsCountIntoLocation>>;
  try {
    counted = await client.wmsCountIntoLocation({
      locationId: product.data.locationId,
      skuId: product.data.skuId,
      sellerId: seller.data,
      quantity: quantity.data,
      note,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    return refuse(messageOf(error), values);
  }
  redirectTo(
    back(product.data.locationCode, {
      nuevas: String(counted.quantity),
      producto: counted.sku_code,
    }),
  );
}
