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
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

export async function retryNotification(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/mensajes"));
  const id = z.uuid().safeParse(formData.get("deliveryId"));
  if (!id.success) return { error: GENERIC_ERROR };
  const state = await attempt(async () => {
    await (await sessionApi()).opsRetryNotification(id.data);
    return "Lo enviamos de nuevo en los próximos segundos.";
  });
  if (state.ok) refresh();
  return state;
}
