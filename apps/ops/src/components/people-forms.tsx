"use client";

import { parsePhone } from "@yuntera/core";
import type { OpsDriverRecord } from "@yuntera/db";
import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { saveDriver } from "@/app/people-actions";
import { VEHICLE } from "@/lib/labels";

const initial: ActionState = {};

/** "+50688110011" as the eight digits a person types back. */
const nationalPhone = (e164: string) => parsePhone(e164)?.formatted ?? e164;

/**
 * A driver's record: every field the operation must have before giving someone
 * a route. Without `driver` it registers a new one for an existing account;
 * with it, it corrects that record (the account and the status stay as they are).
 */
export function DriverForm({ driver }: { driver?: OpsDriverRecord }) {
  const [state, action] = useActionState(saveDriver, initial);
  const kept = state.values;
  const [vehicleType, setVehicleType] = useState<string>(
    kept?.vehicleType ?? driver?.vehicle_type ?? "motorcycle",
  );
  const motor = vehicleType !== "bicycle";
  // After a refusal the form shows what was typed; otherwise what is on record.
  const value = (name: string, saved: string | number | null | undefined) =>
    kept?.[name] ?? (saved === null || saved === undefined ? "" : String(saved));

  return (
    <form action={action} className="flex flex-col gap-5">
      {driver ? <input type="hidden" name="driverId" value={driver.id} /> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-bold">Persona</legend>
        {driver ? null : (
          <TextField
            label="Correo de su cuenta"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            defaultValue={value("email", "")}
            hint="La persona debe haber creado ya su cuenta en Yuntera con este correo."
            className="sm:col-span-2"
          />
        )}
        <TextField
          label="Nombre completo"
          name="fullName"
          defaultValue={value("fullName", driver?.full_name)}
          maxLength={120}
          autoComplete="off"
        />
        <TextField
          label="Celular"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="8888-1234"
          defaultValue={value("phone", driver ? nationalPhone(driver.phone) : "")}
          autoComplete="off"
        />
        <SelectField
          label="Tipo de identificación"
          name="idType"
          defaultValue={value("idType", driver?.id_type ?? "fisica")}
        >
          <option value="fisica">Cédula física</option>
          <option value="dimex">DIMEX</option>
        </SelectField>
        <TextField
          label="Número de identificación"
          name="idNumber"
          inputMode="numeric"
          placeholder="1-0234-0567"
          defaultValue={value("idNumber", driver?.id_number)}
          autoComplete="off"
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-bold">Vehículo</legend>
        <SelectField
          label="Tipo de vehículo"
          name="vehicleType"
          value={vehicleType}
          onChange={(event) => setVehicleType(event.target.value)}
        >
          {Object.entries(VEHICLE).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Capacidad de carga (kg)"
          name="capacityKg"
          inputMode="decimal"
          placeholder="40"
          defaultValue={value("capacityKg", driver?.capacity_kg)}
        />
        {motor ? (
          <TextField
            label="Placa"
            name="plate"
            placeholder="MOT-482913"
            defaultValue={value("plate", driver?.plate)}
            autoComplete="off"
          />
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-bold">Documentos</legend>
        {motor ? null : (
          <p className="text-sm text-ink-muted sm:col-span-2">
            Una bicicleta no necesita licencia, revisión técnica ni seguro. Si la persona tiene
            alguno, puede anotarlo.
          </p>
        )}
        <TextField
          label="Clase de licencia"
          name="licenseClass"
          placeholder="A2"
          maxLength={2}
          optional={!motor}
          defaultValue={value("licenseClass", driver?.license_class)}
          hint="Como aparece en la licencia: A2 para moto, B1 para carro."
          autoComplete="off"
        />
        <TextField
          label="Vence la licencia"
          name="licenseExpiresOn"
          type="date"
          optional={!motor}
          defaultValue={value("licenseExpiresOn", driver?.license_expires_on)}
        />
        <TextField
          label="Vence la revisión técnica"
          name="inspectionExpiresOn"
          type="date"
          optional={!motor}
          defaultValue={value("inspectionExpiresOn", driver?.inspection_expires_on)}
        />
        <TextField
          label="Vence el seguro"
          name="insuranceExpiresOn"
          type="date"
          optional={!motor}
          defaultValue={value("insuranceExpiresOn", driver?.insurance_expires_on)}
        />
      </fieldset>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">
          {driver ? "Guardar cambios" : "Registrar repartidor"}
        </SubmitButton>
      </div>
    </form>
  );
}
