"use server";

/**
 * The Versiones panel of Salud del sistema: an administrator records a phone
 * build that went to the stores, or removes one recorded by mistake. The database checks the caller is an
 * administrator and the values again (ops_set_store_build); this checks them
 * first so the form can say which one is wrong and keep what was typed.
 */

import { STORE_APPS, STORE_BUILD, STORE_PLATFORMS, STORE_TRACKS } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { STORE_APP_LABEL, STORE_PLATFORM_LABEL, STORE_TRACK_LABEL } from "@/lib/health-labels";
import { currentStaff } from "@/lib/staff";

/** Today in Costa Rica, YYYY-MM-DD. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" }).format(new Date());

const storeBuildForm = z.object({
  app: z.enum(STORE_APPS, { error: "Elija la aplicación." }),
  platform: z.enum(STORE_PLATFORMS, { error: "Elija la plataforma." }),
  version: z.string().trim().regex(STORE_BUILD.version, {
    error: "Escriba la versión con tres números, como 1.2.0.",
  }),
  buildNumber: z.coerce
    .number({
      error: "Escriba el número de compilación, un número entero desde 1.",
    })
    .int({
      error: "Escriba el número de compilación, un número entero desde 1.",
    })
    .min(STORE_BUILD.buildNumber[0], {
      error: "Escriba el número de compilación, un número entero desde 1.",
    })
    .max(STORE_BUILD.buildNumber[1], {
      error: "Ese número de compilación es demasiado grande.",
    }),
  releasedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Elija el día en que salió." })
    .refine((value) => value >= STORE_BUILD.firstDay && value <= today(), {
      error: "El día debe ser de 2026 en adelante y no después de hoy.",
    }),
  track: z.enum(STORE_TRACKS, { error: "Elija dónde está." }),
});

export async function saveStoreBuild(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/salud"));
  const values = typed(
    formData,
    "app",
    "platform",
    "version",
    "buildNumber",
    "releasedOn",
    "track",
  );
  const parsed = storeBuildForm.safeParse(values);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revise los datos.",
      values,
    };
  }
  const input = parsed.data;
  const state = await attempt(async () => {
    await (await sessionApi()).opsSetStoreBuild(input);
    return `Guardamos ${STORE_APP_LABEL[input.app]} ${input.version} (${input.buildNumber}) para ${STORE_PLATFORM_LABEL[input.platform]}: ${STORE_TRACK_LABEL[input.track].toLowerCase()}.`;
  }, values);
  if (state.ok) refresh();
  return state;
}

/** Removes a build recorded by mistake, so it no longer shows as the current one. */
export async function removeStoreBuild(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/salud"));
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "No encontramos esa versión. Vuelva a cargar la página." };
  const state = await attempt(async () => {
    const removed = await (await sessionApi()).opsRemoveStoreBuild(id.data);
    return `Quitamos ${STORE_APP_LABEL[removed.app]} ${removed.version} (${removed.build_number}) para ${STORE_PLATFORM_LABEL[removed.platform]}. Sigue en el registro de auditoría.`;
  });
  if (state.ok) refresh();
  return state;
}
