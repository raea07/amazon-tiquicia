"use server";

/**
 * Withdrawing a return request the shopper opened by mistake. Only a request
 * still waiting for staff's decision can be withdrawn; the database checks
 * that it is the shopper's own and still waiting, and refuses otherwise with
 * a message this action passes on.
 */

import { type ActionState, GENERIC_ERROR, isRedirect, messageOf } from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer, signInUrl } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

const input = z.object({
  returnId: z.uuid(),
  orderNumber: z.string().regex(/^YT-\d{4,10}$/),
});

export async function withdrawReturn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = input.safeParse({
    returnId: formData.get("returnId"),
    orderNumber: formData.get("orderNumber"),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };
  if (!(await getViewer())) redirect(signInUrl(`/pedidos/${parsed.data.orderNumber}`));
  try {
    await (await sessionApi()).withdrawReturnRequest(parsed.data.returnId);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageOf(error) };
  }
  // The order page lists the request: redraw it closed, its units free again.
  refresh();
  return { ok: "Retiramos su solicitud. Si lo necesita, puede pedir la devolución de nuevo." };
}
