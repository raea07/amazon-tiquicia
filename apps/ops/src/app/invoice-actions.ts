"use server";

/**
 * Finance's two actions on electronic invoices. The database checks the
 * caller is finance (or an administrator) and what the rules allow: a
 * rejected document is replaced by a new one with a new number, never
 * edited; a document still in transit is sent again with the same bytes.
 */

import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  redirectTo,
  sessionApi,
  signInPath,
} from "@yuntera/next-kit/server";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

const form = z.object({ invoiceId: z.uuid(), asTicket: z.enum(["0", "1"]).default("0") });

export async function replaceInvoice(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/comprobantes"));
  const parsed = form.safeParse({
    invoiceId: formData.get("invoiceId"),
    asTicket: formData.get("asTicket") ?? undefined,
  });
  if (!parsed.success) return { error: GENERIC_ERROR };
  // No refresh(): the row shows the new number in place; the next visit lists it among the others.
  return attempt(async () => {
    const replacement = await (await sessionApi()).opsReplaceInvoice(
      parsed.data.invoiceId,
      parsed.data.asTicket === "1",
    );
    return `Emitimos el comprobante ${replacement.consecutivo}, que reemplaza al rechazado. Sale hacia Hacienda en unos segundos.`;
  });
}

export async function retryInvoice(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/comprobantes"));
  const id = z.uuid().safeParse(formData.get("invoiceId"));
  if (!id.success) return { error: GENERIC_ERROR };
  // No refresh(): the row shows the outcome in place, as for stuck messages.
  return attempt(async () => {
    await (await sessionApi()).opsRetryInvoice(id.data);
    return "Lo enviamos de nuevo a Hacienda en los próximos segundos.";
  });
}
