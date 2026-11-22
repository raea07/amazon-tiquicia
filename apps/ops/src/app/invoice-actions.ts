"use server";

/**
 * Finance's two actions on electronic invoices. The database checks the
 * caller is finance (or an administrator) and what the rules allow: a
 * rejected document (or one held before it was ever sent) is replaced by a
 * new one with a new number, never edited; a document still in transit is
 * sent again with the same bytes.
 */

import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  isRedirect,
  messageOf,
  redirectTo,
  sessionApi,
  signInPath,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
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
  let replacementId: string;
  try {
    const replacement = await (await sessionApi()).opsReplaceInvoice(
      parsed.data.invoiceId,
      parsed.data.asTicket === "1",
    );
    replacementId = replacement.id;
  } catch (error) {
    if (isRedirect(error)) throw error;
    // Already replaced by someone else, for one: the list behind the form is stale.
    refresh();
    return { error: messageOf(error) };
  }
  // The new document's own page: its number, and that it replaces the old one.
  // The list it came from is drawn afresh on the way back.
  redirectTo(`/comprobantes/${replacementId}?emitido=1`);
}

export async function retryInvoice(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/comprobantes"));
  const id = z.uuid().safeParse(formData.get("invoiceId"));
  if (!id.success) return { error: GENERIC_ERROR };
  const state = await attempt(async () => {
    await (await sessionApi()).opsRetryInvoice(id.data);
    return "Lo enviamos de nuevo a Hacienda en los próximos segundos.";
  });
  // The counts and lists behind the form changed (or were stale): redraw them.
  // The row keeps its message while it is still listed.
  refresh();
  return state;
}
