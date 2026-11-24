/*
 * Family G: staff stopping a parcel (public.ops_recall_shipment) at the moment
 * its driver starts the route (public.driver_start_route).
 *
 *   node race-g-recall-route.cjs <database-url> [rounds] [scenario-regex]
 *
 * Each round: two cash orders of the harness's products (shoppers 1 and 2),
 * picked and packed in SJO1, planned by staff on one route for the demo driver
 * (repartidor@yuntera.example), so the route is assigned and both parcels are
 * ready for dispatch. Then staff stop parcel A while the driver starts the
 * route.
 *
 * Allowed outcomes:
 *   - the stop wins: parcel A is coming back to the building (returning), its stop is no
 *     longer pending, and the route starts with parcel B only;
 *   - the start wins: the stop is refused in plain words (shipment_not_recallable, or
 *     shipment_on_started_route), parcel A is out for delivery and its stop pending.
 * Wrong: a parcel returning while its stop is pending (the driver would be told to
 * deliver it), a started route with a pending stop whose parcel is not out for
 * delivery, a route that did not start, any other refusal, a deadlock.
 *
 * "forced": a third session holds the route row FOR SHARE until both have
 * reached it; the driver starts first, the stop 40 ms after.
 */
"use strict";
const { main, STAFF, WORKER } = require("./lib.cjs");

const DRIVER = "repartidor@yuntera.example";
const P = ["x1", "z1"];

async function setup(h) {
  await h.ownFixture();
  await h.layout(P, { "W7-01": 200 });
  const a = await h.cashInPicking(1, [["x1", 1]], "all");
  const b = await h.cashInPicking(2, [["z1", 1]], "all");
  for (const x of [a, b])
    await h.call(WORKER, "select public.wms_pack_shipment($1, 900, 1::smallint)", [x.shipment]);
  const driver = (
    await h.q(
      "select d.id from public.drivers d join auth.users u on u.id = d.user_id where u.email = $1",
      [DRIVER],
    )
  ).rows[0].id;
  const today = (await h.q("select private.cr_today()::text as d")).rows[0].d;
  const route = (
    await h.call(STAFF, "select public.ops_create_route($1::date, $2, $3::jsonb, $4) as id", [
      today,
      h.warehouseId,
      JSON.stringify([{ shipment_id: a.shipment }, { shipment_id: b.shipment }]),
      driver,
    ])
  ).id;
  return { a, b, route, orders: [] };
}

const actors = (_h, ctx) => [
  { name: "start", as: DRIVER, sql: "select public.driver_start_route($1)", args: [ctx.route] },
  {
    name: "recall",
    as: STAFF,
    sql: "select public.ops_recall_shipment($1, 'Prueba de carrera ocho')",
    args: [ctx.a.shipment],
  },
];

async function verify(h, ctx, results) {
  const bad = [];
  const start = results.find((r) => r.name === "start");
  const recall = results.find((r) => r.name === "recall");
  const route = (await h.q("select status::text from public.routes where id = $1", [ctx.route]))
    .rows[0].status;
  const stops = (
    await h.q(
      `select rs.shipment_id, rs.status::text as stop, s.status::text as parcel
         from public.route_stops rs join public.shipments s on s.id = rs.shipment_id where rs.route_id = $1`,
      [ctx.route],
    )
  ).rows;
  const a = stops.find((s) => s.shipment_id === ctx.a.shipment);
  if (start.outcome && !["DEADLOCK", "SERIALIZATION"].includes(start.outcome))
    bad.push(`the route did not start: ${start.outcome}`);
  if (route !== "in_progress" && !start.outcome) bad.push(`start accepted, route ${route}`);
  for (const s of stops) {
    if (s.parcel === "returning" && ["pending", "arrived"].includes(s.stop))
      bad.push("a parcel coming back while its stop is still to deliver");
    if (route === "in_progress" && s.stop === "pending" && s.parcel !== "out_for_delivery")
      bad.push(`a started route with a pending stop whose parcel is ${s.parcel}`);
  }
  if (!recall.outcome) {
    if (a.parcel !== "returning") bad.push(`stop accepted, parcel ${a.parcel}`);
    if (a.stop === "pending") bad.push("stop accepted, its route stop still pending");
  } else if (/shipment_not_recallable|shipment_on_started_route/.test(recall.outcome)) {
    if (a.parcel !== "out_for_delivery" || a.stop !== "pending")
      bad.push(`stop refused, parcel ${a.parcel}, route stop ${a.stop}`);
  } else if (recall.outcome !== "DEADLOCK" && recall.outcome !== "SERIALIZATION") {
    bad.push(`stop refused with ${recall.outcome}`);
  }
  return bad;
}

const scenarios = [
  {
    name: "G1 ops_recall_shipment vs driver_start_route of its route natural",
    products: P,
    setup,
    actors: (h, ctx, round) =>
      actors(h, ctx).map((a, i) => ({
        ...a,
        delayMs: (round % 2 === 0) === (i === 1) ? Math.floor(round / 2) % 4 : 0,
      })),
    verify,
  },
  {
    name: "G1 ops_recall_shipment vs driver_start_route of its route forced",
    products: P,
    setup,
    actors: (h, ctx) => actors(h, ctx).map((a, i) => ({ ...a, delayMs: i === 1 ? 40 : 0 })),
    options: (_h, ctx) => ({
      hold: { sql: "select 1 from public.routes where id = $1 for share", args: [ctx.route] },
      holdMs: 150,
    }),
    verify,
  },
];

// G2: staff taking stop A off the route (public.ops_remove_route_stop: the
// order, then the stop and the parcel) at the moment the driver starts it.
// Found by an independent review of wave 8 (its family X6) and brought in
// here. Allowed: the removal wins (stop A skipped, parcel A back to ready for
// dispatch or wherever the function sends it, the route starts with B) or the
// start wins (the removal refused in plain words). Wrong: a started route with
// a pending stop whose parcel is not out for delivery, a parcel out for
// delivery whose stop is not pending, any other refusal, a deadlock.
async function setupStop(h) {
  const ctx = await setup(h);
  const stop = (
    await h.q("select id from public.route_stops where route_id = $1 and shipment_id = $2", [
      ctx.route,
      ctx.a.shipment,
    ])
  ).rows[0].id;
  return { ...ctx, stop };
}
const removeActors = (_h, ctx) => [
  { name: "start", as: DRIVER, sql: "select public.driver_start_route($1)", args: [ctx.route] },
  {
    name: "remove-stop",
    as: STAFF,
    sql: "select public.ops_remove_route_stop($1, 'Prueba de carrera ocho')",
    args: [ctx.stop],
  },
];
async function verifyRemove(h, ctx, results) {
  const bad = [];
  for (const r of results) {
    if (!r.outcome || r.outcome === "DEADLOCK" || r.outcome === "SERIALIZATION") continue;
    if (
      r.name === "remove-stop" &&
      /not_removable|invalid_stop_state|route_started|on_started/.test(r.outcome)
    )
      continue;
    bad.push(`${r.name} refused: ${r.outcome}`);
  }
  const route = (await h.q("select status::text from public.routes where id = $1", [ctx.route]))
    .rows[0].status;
  const stops = (
    await h.q(
      `select rs.status::text as stop, s.status::text as parcel
         from public.route_stops rs join public.shipments s on s.id = rs.shipment_id where rs.route_id = $1`,
      [ctx.route],
    )
  ).rows;
  if (route !== "in_progress" && !results[0].outcome) bad.push(`start accepted, route ${route}`);
  for (const s of stops) {
    if (route === "in_progress" && s.stop === "pending" && s.parcel !== "out_for_delivery")
      bad.push(`a started route with a pending stop whose parcel is ${s.parcel}`);
    if (s.parcel === "out_for_delivery" && s.stop !== "pending")
      bad.push(`a parcel out for delivery whose stop is ${s.stop}`);
  }
  return bad;
}
scenarios.push(
  {
    name: "G2 ops_remove_route_stop vs driver_start_route of its route natural",
    products: P,
    setup: setupStop,
    actors: (h, ctx, round) =>
      removeActors(h, ctx).map((a, i) => ({
        ...a,
        delayMs: (round % 2 === 0) === (i === 1) ? Math.floor(round / 2) % 4 : 0,
      })),
    verify: verifyRemove,
  },
  ...[
    ["forced, start first", 1],
    ["forced, removal first", 0],
  ].map(([tag, late]) => ({
    name: `G2 ops_remove_route_stop vs driver_start_route of its route ${tag}`,
    products: P,
    setup: setupStop,
    actors: (h, ctx) =>
      removeActors(h, ctx).map((a, i) => ({ ...a, delayMs: i === late ? 40 : 0 })),
    options: (_h, ctx) => ({
      hold: { sql: "select 1 from public.routes where id = $1 for share", args: [ctx.route] },
      holdMs: 150,
    }),
    verify: verifyRemove,
  })),
);

main("G", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
