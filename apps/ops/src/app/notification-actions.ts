"use server";

/** Retrying a stuck message. The database checks the caller is care staff or admin. */

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

export async function retryNotification(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/mensajes"));
  const id = z.uuid().safeParse(formData.get("deliveryId"));
  if (!id.success) return { error: GENERIC_ERROR };
  // No refresh() here on purpose: redrawing the list would remove this row,
  // and with it the confirmation. The row shows the outcome in place; the next
  // visit to the page shows the message's new status.
  return attempt(async () => {
    await (await sessionApi()).opsRetryNotification(id.data);
    return "Lo enviamos de nuevo en los próximos segundos.";
  });
}
