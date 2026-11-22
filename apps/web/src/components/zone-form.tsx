"use client";

import type { District } from "@yuntera/db";
import { type ActionState, DistrictPicker } from "@yuntera/next-kit/client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setLocation } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";
import { markZonePending, ZONE_UPDATING } from "./zone-freshness";

const initial: ActionState = {};

/**
 * While the new zone is saved and the page behind is drawn again for it (which
 * on a slow connection takes seconds), say what is happening, not only on the
 * button.
 */
function Updating() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm font-semibold text-ink"
    >
      <span
        aria-hidden="true"
        className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {ZONE_UPDATING}
    </p>
  );
}

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
    <form
      action={action}
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        const code = new FormData(event.currentTarget).get("postalCode");
        if (typeof code === "string" && /^[1-7]\d{4}$/.test(code)) markZonePending(code);
      }}
    >
      <input type="hidden" name="siguiente" value={returnTo} />
      <DistrictPicker districts={districts} defaultPostalCode={current} />
      <FormMessage state={state} />
      <Updating />
      <div>
        <SubmitButton pendingLabel="Actualizando…">Usar esta zona</SubmitButton>
      </div>
    </form>
  );
}
