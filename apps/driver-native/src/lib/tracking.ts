/**
 * Sharing the driver's position while a route is in progress, on a phone.
 *
 * As docs/research/expo-native-apps.md §4a and §8 describe: only the "while
 * using the app" permission is ever requested, never "always". Updates are
 * started by the driver's own action with the app open (starting the route,
 * or the "Compartir mi ubicación" button), run as a foreground service with a
 * visible notification on Android and with the location background mode and
 * the status-bar indicator on iOS, and stop when the route ends, at sign-out
 * and when access is lost.
 *
 * Each position goes through `driver_report_position` via the outbox, so a
 * report made without signal waits (only the latest is kept) instead of being
 * lost. The web export uses tracking.web.ts instead.
 *
 * This module must be imported at the top of app/_layout.tsx: the task has to
 * be defined when the bundle loads, before any screen.
 */

import { colors } from "@yuntera/expo-kit/theme";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Linking } from "react-native";
import { reportPosition } from "./outbox";

export type Permission = "granted" | "denied" | "undetermined";
export type TrackingStart = "on" | "denied" | "gps_off" | "failed";

export const ROUTE_TASK = "yuntera-ruta-location";

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  ROUTE_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const last = data.locations[data.locations.length - 1];
    if (!last) return;
    await reportPosition({
      lat: last.coords.latitude,
      lng: last.coords.longitude,
      accuracy: last.coords.accuracy ?? null,
    });
  },
);

export async function locationPermission(): Promise<Permission> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") return "granted";
    return status === "undetermined" || canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

/** Shows the system's "while using the app" prompt. Our explanation screen comes first. */
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
  try {
    if (!(await Location.hasServicesEnabledAsync())) return "gps_off";
    if (await Location.hasStartedLocationUpdatesAsync(ROUTE_TASK)) return "on";
    // The numbers are the research note's starting points, not measured optima.
    await Location.startLocationUpdatesAsync(ROUTE_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 15_000,
      distanceInterval: 25,
      deferredUpdatesInterval: 30_000,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Yuntera Ruta",
        notificationBody: "Compartiendo su ubicación durante la ruta",
        notificationColor: colors.brand,
        killServiceOnDestroy: true,
      },
    });
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
  try {
    if (await Location.hasStartedLocationUpdatesAsync(ROUTE_TASK)) {
      await Location.stopLocationUpdatesAsync(ROUTE_TASK);
    }
  } catch {
    // Already stopped, or the task was never registered.
  }
}

/** Whether updates are running, for example after the app's JavaScript was reloaded. */
export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(ROUTE_TASK);
  } catch {
    return false;
  }
}

/** The phone's settings for this app, where a refused permission is changed. */
export const canOpenSettings = true;
export const openSettings = () => Linking.openSettings().catch(() => undefined);
