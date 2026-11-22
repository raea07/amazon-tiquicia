/**
 * Position sharing in the web export, which exists only for the browser
 * journeys. A browser has no foreground service or background task, so this
 * watches the position while the page is open and sends at most one report
 * every 15 seconds, through the same outbox as the phones. Same functions as
 * tracking.ts.
 */

import * as Location from "expo-location";
import { reportPosition } from "./outbox";

export type Permission = "granted" | "denied" | "undetermined";
export type TrackingStart = "on" | "denied" | "gps_off" | "failed";

const EVERY_MS = 15_000;
let watch: { remove(): void } | null = null;
let last = 0;

export async function locationPermission(): Promise<Permission> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
  } catch {
    return "undetermined";
  }
}

export async function askLocationPermission(): Promise<Permission> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function startTracking(): Promise<TrackingStart> {
  if ((await locationPermission()) !== "granted") return "denied";
  if (watch) return "on";
  try {
    last = 0;
    watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: EVERY_MS, distanceInterval: 0 },
      (point) => {
        const now = Date.now();
        if (now - last < EVERY_MS) return;
        last = now;
        void reportPosition({
          lat: point.coords.latitude,
          lng: point.coords.longitude,
          accuracy: point.coords.accuracy ?? null,
          at: point.timestamp,
        });
      },
    );
    return "on";
  } catch {
    return "failed";
  }
}

/** Where the phone is now, if it knows (for the record of a delivery). Never waits long. */
export async function currentPoint(): Promise<{ lat: number; lng: number } | null> {
  try {
    if ((await locationPermission()) !== "granted") return null;
    const point = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    return point ? { lat: point.coords.latitude, lng: point.coords.longitude } : null;
  } catch {
    return null;
  }
}

export async function stopTracking(): Promise<void> {
  watch?.remove();
  watch = null;
}

export async function isTracking(): Promise<boolean> {
  return watch !== null;
}

export const canOpenSettings = false;
export const openSettings = () => Promise.resolve(undefined);
