"use server";

/**
 * Staff security, for administrators: recovering a colleague who lost the
 * phone with their authenticator. The database checks the caller is an
 * administrator who passed the second step, refuses to act on themselves and
 * writes the audit trail (ops_reset_staff_factor).
 */

import {
  type ActionState,
  attempt,
  redirectTo,
  sessionApi,
  signInPath,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { currentStaff } from "@/lib/staff";

export async function resetStaffFactor(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/seguridad"));
  const userId = z.uuid().safeParse(formData.get("userId"));
  if (!userId.success) return { error: "No encontramos a esa persona. Recargue la página." };
  const state = await attempt(async () => {
    const result = await (await sessionApi()).opsResetStaffFactor(userId.data);
    return result.factors_removed > 0
      ? "Listo: quitamos su verificación y cerramos sus sesiones. Al ingresar de nuevo con su contraseña tendrá que configurarla otra vez."
      : "No tenía verificación configurada. Cerramos sus sesiones por si acaso.";
  });
  if (state.ok) refresh();
  return state;
}
