import { describe, expect, it } from "vitest";
import { measureTour, planRoutes, type RouteStop, twoOpt, type Vehicle } from "./routing";

const DEPOT = { lat: 9.9333, lng: -84.0833 }; // San José

const moto = (vehicleId: string, over: Partial<Vehicle> = {}): Vehicle => ({
  vehicleId,
  capacityKg: 40,
  maxStops: 30,
  shiftMinutes: 480,
  speedKmh: 22,
  ...over,
});

const stop = (
  stopId: string,
  lat: number,
  lng: number,
  over: Partial<RouteStop> = {},
): RouteStop => ({
  stopId,
  location: { lat, lng },
  weightKg: 1,
  serviceMinutes: 4,
  ...over,
});

/** Deterministic pseudo-random stops scattered around the depot. */
function scatter(count: number, seedStart = 11, spread = 0.12): RouteStop[] {
  let seed = seedStart;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  return Array.from({ length: count }, (_, i) =>
    stop(
      `s${String(i).padStart(3, "0")}`,
      DEPOT.lat + (rand() - 0.5) * spread,
      DEPOT.lng + (rand() - 0.5) * spread,
      {
        weightKg: 0.5 + rand() * 3,
      },
    ),
  );
}

describe("route planning", () => {
  it("returns an empty plan for no stops", () => {
    expect(planRoutes(DEPOT, [], [moto("m1")])).toEqual({ routes: [], unassigned: [], totalKm: 0 });
  });

  it("assigns every stop exactly once when there is capacity", () => {
    const stops = scatter(60);
    const fleet = ["m1", "m2", "m3"].map((id) => moto(id, { capacityKg: 80 }));
    const plan = planRoutes(DEPOT, stops, fleet);
    const assigned = plan.routes.flatMap((r) => r.stops.map((s) => s.stopId)).sort();
    expect(plan.unassigned).toEqual([]);
    expect(assigned).toEqual(stops.map((s) => s.stopId).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("respects weight, stop-count and shift limits", () => {
    const stops = scatter(80, 5);
    const vehicles = [
      moto("m1", { capacityKg: 25, maxStops: 12 }),
      moto("m2", { maxStops: 20 }),
      moto("m3"),
      moto("m4"),
    ];
    const plan = planRoutes(DEPOT, stops, vehicles);
    for (const route of plan.routes) {
      const vehicle = vehicles.find((v) => v.vehicleId === route.vehicleId);
      expect(vehicle).toBeDefined();
      if (!vehicle) continue;
      expect(route.loadKg).toBeLessThanOrEqual(vehicle.capacityKg + 1e-9);
      expect(route.stops.length).toBeLessThanOrEqual(vehicle.maxStops);
      expect(route.totalMinutes).toBeLessThanOrEqual(vehicle.shiftMinutes);
    }
  });

  it("numbers stops in order with non-decreasing arrival times", () => {
    const plan = planRoutes(DEPOT, scatter(25), [moto("m1")]);
    const route = plan.routes[0];
    expect(route).toBeDefined();
    if (!route) return;
    expect(route.stops.map((s) => s.sequence)).toEqual(route.stops.map((_, i) => i + 1));
    for (let i = 1; i < route.stops.length; i++) {
      expect(route.stops[i]?.arrivalMinute ?? 0).toBeGreaterThanOrEqual(
        route.stops[i - 1]?.arrivalMinute ?? 0,
      );
    }
  });

  it("keeps each driver in one part of the city", () => {
    // Two tight clusters, east and west of the depot: each should get its own route.
    const east = Array.from({ length: 8 }, (_, i) =>
      stop(`e${i}`, DEPOT.lat + i * 0.001, DEPOT.lng + 0.08),
    );
    const west = Array.from({ length: 8 }, (_, i) =>
      stop(`w${i}`, DEPOT.lat + i * 0.001, DEPOT.lng - 0.08),
    );
    const plan = planRoutes(
      DEPOT,
      [...east, ...west],
      [moto("m1", { maxStops: 8 }), moto("m2", { maxStops: 8 })],
    );
    expect(plan.routes).toHaveLength(2);
    for (const route of plan.routes) {
      const sides = new Set(route.stops.map((s) => s.stopId[0]));
      expect(sides.size).toBe(1);
    }
  });

  it("reports stops that do not fit, with the reason", () => {
    const plan = planRoutes(
      DEPOT,
      [
        stop("heavy", 9.94, -84.08, { weightKg: 500 }),
        stop("a", 9.94, -84.09),
        stop("b", 9.95, -84.07),
        stop("c", 9.92, -84.1),
      ],
      [moto("m1", { maxStops: 2 })],
    );
    expect(plan.unassigned).toContainEqual({ stopId: "heavy", reason: "exceeds_vehicle_capacity" });
    expect(plan.unassigned.filter((u) => u.reason === "no_capacity_left")).toHaveLength(1);
    expect(plan.routes[0]?.stops).toHaveLength(2);
  });

  it("leaves everything unassigned when there are no vehicles", () => {
    const plan = planRoutes(DEPOT, scatter(3), []);
    expect(plan.routes).toEqual([]);
    expect(plan.unassigned).toHaveLength(3);
  });

  it("is deterministic", () => {
    const stops = scatter(40, 3);
    const vehicles = [moto("m1"), moto("m2")];
    expect(planRoutes(DEPOT, stops, vehicles)).toEqual(
      planRoutes(DEPOT, [...stops].reverse(), vehicles),
    );
  });

  it("rejects duplicate or invalid stops", () => {
    expect(() =>
      planRoutes(DEPOT, [stop("a", 9.9, -84), stop("a", 9.9, -84)], [moto("m1")]),
    ).toThrow(RangeError);
    expect(() => planRoutes(DEPOT, [stop("a", 9.9, -84, { weightKg: -1 })], [moto("m1")])).toThrow(
      RangeError,
    );
  });

  it("omits the return leg when asked", () => {
    const stops = scatter(10);
    const roundTrip = planRoutes(DEPOT, stops, [moto("m1")]);
    const oneWay = planRoutes(DEPOT, stops, [moto("m1")], { returnToDepot: false });
    expect(oneWay.totalKm).toBeLessThan(roundTrip.totalKm);
  });
});

describe("2-opt", () => {
  it("never makes a tour longer", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const tour = scatter(18, seed);
      const improved = twoOpt(DEPOT, tour, true);
      expect(measureTour(DEPOT, improved, true)).toBeLessThanOrEqual(
        measureTour(DEPOT, tour, true) + 1e-9,
      );
      expect(improved.map((s) => s.stopId).sort()).toEqual(tour.map((s) => s.stopId).sort());
    }
  });

  it("untangles a crossed route", () => {
    // Visiting corners of a square in a criss-cross order is longer than going around it.
    const a = stop("a", 9.9, -84.1);
    const b = stop("b", 9.9, -84.0);
    const c = stop("c", 10.0, -84.0);
    const d = stop("d", 10.0, -84.1);
    const depot = { lat: 9.9, lng: -84.1 };
    const crossed = [c, b, d, a];
    const fixed = twoOpt(depot, crossed, true);
    expect(measureTour(depot, fixed, true)).toBeLessThan(measureTour(depot, crossed, true));
  });
});
