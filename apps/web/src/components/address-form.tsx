"use client";

import { decodePlusCode, encodePlusCode, isInCostaRica } from "@yuntera/core";
import type { District } from "@yuntera/db";
import type { ActionState } from "@yuntera/next-kit/client";
import { Alert, Button, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState, useState } from "react";
import { saveAddress } from "@/app/actions";
import { DistrictPicker } from "./district-picker";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

interface Pin {
  lat: number;
  lng: number;
  plusCode: string;
}

/**
 * A delivery address the Costa Rican way.
 *
 * There is no street-and-number system to rely on, so the address has three
 * parts: the district, the "señas" a neighbour would give, and an exact point.
 * The point is what the driver navigates to; it comes from the phone's location
 * or from a Plus Code (the short code Google Maps shows for any spot), which
 * also works for someone ordering for another house.
 */
export function AddressForm({
  districts,
  defaultName,
  defaultPostalCode,
  returnTo,
}: {
  districts: District[];
  defaultName?: string | null;
  defaultPostalCode?: string;
  returnTo: string;
}) {
  const [state, action] = useActionState(saveAddress, initial);
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [plusInput, setPlusInput] = useState("");

  function place(lat: number, lng: number) {
    if (!isInCostaRica({ lat, lng })) {
      setPin(null);
      setPinError("Esa ubicación está fuera de Costa Rica.");
      return;
    }
    setPin({ lat, lng, plusCode: encodePlusCode({ lat, lng }) });
    setPinError(null);
  }

  function locateMe() {
    if (!("geolocation" in navigator)) {
      setPinError("Este dispositivo no comparte la ubicación. Escriba su código Plus.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        place(position.coords.latitude, position.coords.longitude);
      },
      () => {
        setLocating(false);
        setPinError(
          "No pudimos leer su ubicación. Revise el permiso del navegador o escriba su código Plus.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  function applyPlusCode() {
    const decoded = decodePlusCode(plusInput);
    if (!decoded) {
      setPin(null);
      setPinError("Ese código Plus no es válido. Tiene esta forma: 66XQWWMX+GG.");
      return;
    }
    place(decoded.lat, decoded.lng);
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="siguiente" value={returnTo} />
      <input type="hidden" name="lat" value={pin?.lat ?? ""} />
      <input type="hidden" name="lng" value={pin?.lng ?? ""} />
      <input type="hidden" name="plusCode" value={pin?.plusCode ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nombre de quien recibe"
          name="recipientName"
          autoComplete="name"
          defaultValue={state.values?.recipientName ?? defaultName ?? ""}
        />
        <TextField
          label="Teléfono"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="8888-1234"
          defaultValue={state.values?.phone}
          hint="El repartidor llama o escribe a este número si no encuentra la casa."
        />
      </div>

      <DistrictPicker districts={districts} defaultPostalCode={defaultPostalCode} />

      <TextAreaField
        label="Señas"
        name="senas"
        rows={3}
        defaultValue={state.values?.senas}
        placeholder="De la iglesia 200 metros al sur y 50 al este, casa esquinera con portón negro"
        hint="Como se las daría a un vecino: referencias, color de la casa, portón, número de apartamento."
      />

      <fieldset className="rounded-lg border border-border bg-surface-muted p-4">
        <legend className="px-1 text-sm font-semibold">Ubicación exacta de la entrega</legend>
        <p className="text-sm text-ink-muted">
          Las señas ayudan al repartidor; el punto en el mapa es lo que lo lleva hasta su puerta.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Button variant="secondary" onClick={locateMe} disabled={locating}>
            {locating ? "Buscando su ubicación…" : "Usar mi ubicación actual"}
          </Button>
          <span className="text-sm text-ink-muted sm:pb-3">o</span>
          <div className="flex flex-1 items-end gap-2">
            <TextField
              label="Código Plus"
              optional
              value={plusInput}
              onChange={(event) => setPlusInput(event.target.value)}
              placeholder="66XQWWMX+GG"
              autoCapitalize="characters"
              className="flex-1"
            />
            <Button variant="secondary" onClick={applyPlusCode} disabled={!plusInput.trim()}>
              Usar
            </Button>
          </div>
        </div>
        <div className="mt-3" aria-live="polite">
          {pin ? (
            <Alert tone="success" title="Ubicación marcada">
              Código Plus {pin.plusCode} ({pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}).
            </Alert>
          ) : pinError ? (
            <Alert tone="danger">{pinError}</Alert>
          ) : (
            <p className="text-sm text-ink-muted">
              Si pide para otra casa, abra ese lugar en Google Maps y copie el código Plus que
              aparece.
            </p>
          )}
        </div>
      </fieldset>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar dirección</SubmitButton>
      </div>
    </form>
  );
}
