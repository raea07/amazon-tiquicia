"use client";

import { useEffect, useRef, useState } from "react";
import { reportPosition } from "@/app/actions";

/**
 * Adds the device's position to the surrounding form as hidden `lat` and `lng`
 * fields, when the device gives one. A delivery is never blocked for lack of
 * it: GPS is unreliable indoors and in narrow streets.
 */
export function PositionFields() {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (position) => setPoint({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setPoint(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  return (
    <>
      <input type="hidden" name="lat" value={point?.lat ?? ""} />
      <input type="hidden" name="lng" value={point?.lng ?? ""} />
    </>
  );
}

const EVERY_MS = 60_000;

/**
 * While a route is open on screen, tells Central where the driver is, at most
 * once a minute. This is a web page, so it only works while the page is in
 * front: it stops when the phone is locked or another app is open. It says so.
 */
export function PositionReporter() {
  const last = useRef(0);
  const [state, setState] = useState<"waiting" | "sharing" | "off">("waiting");

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState("off");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setState("sharing");
        const now = Date.now();
        if (now - last.current < EVERY_MS) return;
        last.current = now;
        void reportPosition(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        );
      },
      () => setState("off"),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  return (
    <p className="text-xs text-ink-muted" aria-live="polite">
      {state === "sharing"
        ? "Compartiendo su ubicación con Central mientras esta pantalla esté abierta."
        : state === "off"
          ? "Ubicación apagada. Actívela en el navegador para que Central vea por dónde va."
          : "Buscando su ubicación…"}
    </p>
  );
}
