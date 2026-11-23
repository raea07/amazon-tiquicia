/**
 * A stop staff took off a driver's route (status `skipped`, set only by
 * ops_remove_route_stop), as both drivers' apps (the web field app and the
 * native drivers' app) tell the driver what to do with its parcel.
 *
 * Removed before the route started, the parcel went back to dispatch and the
 * driver never had it: do not collect it. Removed after, the driver may be
 * carrying it: bring it back. The database closes a removed stop at the
 * moment of the removal (`completed_at`) and stamps the route's start
 * (`started_at`, driver_start_route, server time), so a stop removed while the
 * route was only assigned stays "before the start" after the driver starts.
 * Deciding on the route's status alone got that case wrong once the route
 * had started.
 */

export interface RouteStartFacts {
  status: string;
  started_at: string | null;
}

export interface StopRemovalFacts {
  status: string;
  completed_at: string | null;
}

/** Whether staff took the stop off before the driver started the route. */
export function removedBeforeStart(route: RouteStartFacts, stop: StopRemovalFacts): boolean {
  if (stop.status !== "skipped") return false;
  if (route.status === "assigned" || route.status === "draft" || !route.started_at) return true;
  if (!stop.completed_at) return false;
  return Date.parse(stop.completed_at) < Date.parse(route.started_at);
}

export const REMOVED_BEFORE_START_NOTE =
  "Central quitó esta parada de la ruta. No recoja este paquete: volvió a Despacho.";
export const REMOVED_AFTER_START_NOTE =
  "Central quitó esta parada de la ruta. Si lleva el paquete, devuélvalo a la bodega.";

/** What the driver reads on a stop staff removed. */
export function skippedStopNote(route: RouteStartFacts, stop: StopRemovalFacts): string {
  return removedBeforeStart(route, stop) ? REMOVED_BEFORE_START_NOTE : REMOVED_AFTER_START_NOTE;
}
