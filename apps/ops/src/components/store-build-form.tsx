import { STORE_APPS, STORE_BUILD, STORE_PLATFORMS, STORE_TRACKS } from "@yuntera/db";
import { ActionForm } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { saveStoreBuild } from "@/app/health-actions";
import { STORE_APP_LABEL, STORE_PLATFORM_LABEL, STORE_TRACK_LABEL } from "@/lib/health-labels";

/** An administrator records a phone build that went to the stores. Nothing is pre-chosen. */
export function StoreBuildForm({ today }: { today: string }) {
  return (
    <ActionForm action={saveStoreBuild} submit="Guardar la versión" pendingLabel="Guardando…">
      <SelectField label="Aplicación" name="app" defaultValue="">
        <option value="" disabled>
          Elija una
        </option>
        {STORE_APPS.map((app) => (
          <option key={app} value={app}>
            {STORE_APP_LABEL[app]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Plataforma" name="platform" defaultValue="">
        <option value="" disabled>
          Elija una
        </option>
        {STORE_PLATFORMS.map((platform) => (
          <option key={platform} value={platform}>
            {STORE_PLATFORM_LABEL[platform]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Versión"
        name="version"
        hint="Tres números separados por puntos, como 0.1.0."
        inputMode="decimal"
        autoComplete="off"
        maxLength={11}
      />
      <TextField
        label="Número de compilación"
        name="buildNumber"
        hint="El número entre paréntesis en la tienda, como 4."
        inputMode="numeric"
        autoComplete="off"
        maxLength={9}
      />
      <TextField
        label="Día en que salió"
        name="releasedOn"
        type="date"
        min={STORE_BUILD.firstDay}
        max={today}
      />
      <SelectField label="Dónde está" name="track" defaultValue="">
        <option value="" disabled>
          Elija una
        </option>
        {STORE_TRACKS.map((track) => (
          <option key={track} value={track}>
            {STORE_TRACK_LABEL[track]}
          </option>
        ))}
      </SelectField>
    </ActionForm>
  );
}
