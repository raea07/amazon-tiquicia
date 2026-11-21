"use client";

import { decodePlusCode, encodePlusCode, isInCostaRica } from "@yuntera/core";
import { Alert, Button, TextField } from "@yuntera/ui";
import { useState } from "react";

interface Pin {
  lat: number;
  lng: number;
  plusCode: string;
}

/**
 * Marks an exact point in Costa Rica, for a delivery address or a pick-up
 * location. There is no street-and-number system to rely on, so the point is
 * what a driver navigates to. It comes from the device's location or from a
 * Plus Code (the short code Google Maps shows for any spot), which also works
 * when the person is not standing there.
 *
 * Submits three hidden fields with the surrounding form: `lat`, `lng`, `plusCode`.
 */
export function PinPicker({
  legend = "Ubicación exacta",
  explanation,
  emptyHint,
}: {
  legend?: string;
  explanation: string;
  emptyHint: string;
}) {
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
      setPinError("Este dispositivo no comparte la ubicación. Escriba el código Plus.");
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
          "No pudimos leer su ubicación. Revise el permiso del navegador o escriba el código Plus.",
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
    <fieldset className="rounded-lg border border-border bg-surface-muted p-4">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>
      <input type="hidden" name="lat" value={pin?.lat ?? ""} />
      <input type="hidden" name="lng" value={pin?.lng ?? ""} />
      <input type="hidden" name="plusCode" value={pin?.plusCode ?? ""} />
      <p className="text-sm text-ink-muted">{explanation}</p>
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
          <p className="text-sm text-ink-muted">{emptyHint}</p>
        )}
      </div>
    </fieldset>
  );
}
