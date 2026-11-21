"use client";

import type { District } from "@yuntera/db";
import { type ActionState, DistrictPicker } from "@yuntera/next-kit/client";
import { useActionState } from "react";
import { setLocation } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

export function ZoneForm({
  districts,
  current,
  returnTo,
}: {
  districts: District[];
  current?: string;
  returnTo: string;
}) {
  const [state, action] = useActionState(setLocation, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="siguiente" value={returnTo} />
      <DistrictPicker districts={districts} defaultPostalCode={current} />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Usar esta zona</SubmitButton>
      </div>
    </form>
  );
}
