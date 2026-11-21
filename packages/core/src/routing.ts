/**
 * Last-mile route planning: assigns delivery stops to drivers and orders them.
 *
 * This is a capacitated vehicle-routing problem. The planner is a classic
 * two-phase heuristic that is fast, deterministic and easy to audit:
 *
 *   1. SWEEP — sort stops by compass bearing from the depot and cut the circle
 *      into wedges, one per vehicle, closing a wedge when weight, stop count or
 *      shift time would be exceeded. Wedges keep each driver in one part of the
 *      city instead of criss-crossing it.
 *   2. SEQUENCE — inside each wedge, build a tour with nearest-neighbour, then
 *      improve it with 2-opt until no swap shortens it.
 *
 * It ignores live traffic and time windows by design: at pilot volume (tens of
 * stops per driver) the gap to an optimal plan is small, and dispatchers can
 * drag stops between routes in the ops console. The function signature is the
 * seam where a solver or routing API replaces it later.
 */

import { DEFAULT_CIRCUITY, haversineKm, type LatLng } from "./cr/geo";

export interface RouteStop {
  stopId: string;
  location: LatLng;
  weightKg: number;
  /** Minutes at the door: park, find the gate, hand over, collect cash. */
  serviceMinutes: number;
}

export interface Vehicle {
  vehicleId: string;
  capacityKg: number;
  maxStops: number;
  shiftMinutes: number;
  /** Average door-to-door speed including traffic and parking. */
  speedKmh: number;
}

/**
 * Planning assumptions per vehicle type on Gran Área Metropolitana streets.
 * They are starting values, not measurements: replace them with the fleet's own
 * averages once there are a few weeks of completed routes.
 */
export const VEHICLE_PRESETS = {
  motorcycle: { maxStops: 30, speedKmh: 22, shiftMinutes: 480 },
  car: { maxStops: 35, speedKmh: 18, shiftMinutes: 480 },
  van: { maxStops: 45, speedKmh: 16, shiftMinutes: 480 },
  bicycle: { maxStops: 15, speedKmh: 11, shiftMinutes: 360 },
} as const satisfies Record<string, Pick<Vehicle, "maxStops" | "speedKmh" | "shiftMinutes">>;

/** Minutes at the door used when a stop has no better estimate. */
export const DEFAULT_SERVICE_MINUTES = 6;

export interface RoutingOptions {
  circuity?: number;
  /** Whether the driver must return to the depot (cash and failed deliveries). */
  returnToDepot?: boolean;
}

export interface PlannedStop {
  stopId: string;
  sequence: number;
  /** Minutes after route start that the driver arrives. */
  arrivalMinute: number;
  legKm: number;
}

export interface PlannedRoute {
  vehicleId: string;
  stops: PlannedStop[];
  totalKm: number;
  totalMinutes: number;
  loadKg: number;
}

export interface RoutingPlan {
  routes: PlannedRoute[];
  /** Stops that did not fit in any vehicle: too heavy, or the fleet is full. */
  unassigned: Array<{ stopId: string; reason: "exceeds_vehicle_capacity" | "no_capacity_left" }>;
  totalKm: number;
}

/** Compass-style bearing from `from` to `to`, in radians, used only for ordering. */
function bearing(from: LatLng, to: LatLng): number {
  const dLng = (to.lng - from.lng) * Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  const dLat = to.lat - from.lat;
  return Math.atan2(dLng, dLat);
}

function tourLength(depot: LatLng, order: readonly RouteStop[], returnToDepot: boolean): number {
  let total = 0;
  let previous = depot;
  for (const stop of order) {
    total += haversineKm(previous, stop.location);
    previous = stop.location;
  }
  if (returnToDepot && order.length > 0) total += haversineKm(previous, depot);
  return total;
}

function nearestNeighbour(depot: LatLng, stops: readonly RouteStop[]): RouteStop[] {
  const pending = [...stops];
  const order: RouteStop[] = [];
  let current = depot;
  while (pending.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    pending.forEach((stop, index) => {
      const d = haversineKm(current, stop.location);
      const best = pending[bestIndex];
      if (d < bestDistance || (d === bestDistance && best && stop.stopId < best.stopId)) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    const [next] = pending.splice(bestIndex, 1);
    if (!next) break;
    order.push(next);
    current = next.location;
  }
  return order;
}

/** 2-opt: reverse segments while doing so shortens the tour. */
export function twoOpt(
  depot: LatLng,
  tour: readonly RouteStop[],
  returnToDepot: boolean,
): RouteStop[] {
  let best = [...tour];
  let bestLength = tourLength(depot, best, returnToDepot);
  let improved = true;
  // Each accepted swap strictly shortens the tour, so this terminates.
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const length = tourLength(depot, candidate, returnToDepot);
        if (length < bestLength - 1e-9) {
          best = candidate;
          bestLength = length;
          improved = true;
        }
      }
    }
  }
  return best;
}

function routeMinutes(
  depot: LatLng,
  order: readonly RouteStop[],
  vehicle: Vehicle,
  circuity: number,
  returnToDepot: boolean,
): number {
  const km = tourLength(depot, order, returnToDepot) * circuity;
  const service = order.reduce((total, s) => total + s.serviceMinutes, 0);
  return (km / vehicle.speedKmh) * 60 + service;
}

export function planRoutes(
  depot: LatLng,
  stops: readonly RouteStop[],
  vehicles: readonly Vehicle[],
  options: RoutingOptions = {},
): RoutingPlan {
  const circuity = options.circuity ?? DEFAULT_CIRCUITY;
  const returnToDepot = options.returnToDepot ?? true;

  const ids = new Set<string>();
  for (const stop of stops) {
    if (ids.has(stop.stopId)) throw new RangeError(`Duplicate stop: ${stop.stopId}`);
    ids.add(stop.stopId);
    if (stop.weightKg < 0 || stop.serviceMinutes < 0) {
      throw new RangeError(`Stop ${stop.stopId}: weight and service time must be non-negative`);
    }
  }

  const unassigned: RoutingPlan["unassigned"] = [];
  const largestCapacity = Math.max(0, ...vehicles.map((v) => v.capacityKg));
  const routable = stops.filter((stop) => {
    if (stop.weightKg > largestCapacity) {
      unassigned.push({ stopId: stop.stopId, reason: "exceeds_vehicle_capacity" });
      return false;
    }
    return true;
  });

  // Phase 1: sweep. Sorting by bearing then stopId keeps the plan reproducible.
  const swept = [...routable].sort(
    (a, b) =>
      bearing(depot, a.location) - bearing(depot, b.location) || a.stopId.localeCompare(b.stopId),
  );

  const clusters: Array<{ vehicle: Vehicle; stops: RouteStop[] }> = [];
  let cursor = 0;
  for (const vehicle of vehicles) {
    if (cursor >= swept.length) break;
    const cluster: RouteStop[] = [];
    let load = 0;
    while (cursor < swept.length) {
      const stop = swept[cursor];
      if (!stop) break;
      if (cluster.length >= vehicle.maxStops) break;
      if (load + stop.weightKg > vehicle.capacityKg) break;
      // Shift check uses a quick nearest-neighbour estimate; the final tour is never longer.
      const trial = nearestNeighbour(depot, [...cluster, stop]);
      if (routeMinutes(depot, trial, vehicle, circuity, returnToDepot) > vehicle.shiftMinutes)
        break;
      cluster.push(stop);
      load += stop.weightKg;
      cursor++;
    }
    if (cluster.length > 0) clusters.push({ vehicle, stops: cluster });
    else if (swept[cursor]) {
      // This vehicle cannot take the next stop even alone (too heavy for it, or too far
      // for its shift). Leave the stop for a later, larger vehicle rather than stalling.
      const stop = swept[cursor];
      const fitsLater = vehicles
        .slice(vehicles.indexOf(vehicle) + 1)
        .some(
          (v) =>
            stop !== undefined &&
            stop.weightKg <= v.capacityKg &&
            routeMinutes(depot, [stop], v, circuity, returnToDepot) <= v.shiftMinutes,
        );
      if (!fitsLater && stop) {
        unassigned.push({ stopId: stop.stopId, reason: "no_capacity_left" });
        cursor++;
      }
    }
  }
  for (const stop of swept.slice(cursor)) {
    unassigned.push({ stopId: stop.stopId, reason: "no_capacity_left" });
  }

  // Phase 2: sequence each cluster.
  const routes: PlannedRoute[] = clusters.map(({ vehicle, stops: cluster }) => {
    const order = twoOpt(depot, nearestNeighbour(depot, cluster), returnToDepot);
    const planned: PlannedStop[] = [];
    let previous = depot;
    let clock = 0;
    let km = 0;
    order.forEach((stop, index) => {
      const legKm = haversineKm(previous, stop.location) * circuity;
      clock += (legKm / vehicle.speedKmh) * 60;
      km += legKm;
      planned.push({
        stopId: stop.stopId,
        sequence: index + 1,
        arrivalMinute: Math.round(clock),
        legKm: round2(legKm),
      });
      clock += stop.serviceMinutes;
      previous = stop.location;
    });
    if (returnToDepot && order.length > 0) {
      const back = haversineKm(previous, depot) * circuity;
      km += back;
      clock += (back / vehicle.speedKmh) * 60;
    }
    return {
      vehicleId: vehicle.vehicleId,
      stops: planned,
      totalKm: round2(km),
      totalMinutes: Math.round(clock),
      loadKg: round2(order.reduce((total, s) => total + s.weightKg, 0)),
    };
  });

  return {
    routes,
    unassigned,
    totalKm: round2(routes.reduce((total, r) => total + r.totalKm, 0)),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Straight-line tour length in km; exported for tests and for comparing plans. */
export const measureTour = tourLength;
