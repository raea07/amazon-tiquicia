// A route of the journey's own, for journeys that take stops off a route.
//
// Taking a stop off a route cannot be undone, and the database suites (and
// supabase/scripts/used-db-check.sh, which runs every journey on one database
// before them) rely on the seed's route R-1003 staying as the seed left it.
// So a journey that removes stops builds its own: as the warehouse it picks
// and packs up to `count` parcels that are waiting, as Central it plans them
// on a route for the demo driver, and as the driver it starts the route, so
// the parcels are out for delivery as R-1003's are. Not a journey itself
// (it lives outside journeys/).

const { request } = require("playwright");

const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPERS = ["comprador", "comprador2", "comprador3"].map((n) => `${n}@yuntera.example`);

/** Signs in through the API and returns a function that calls database functions as that person. */
async function as(email) {
  const ctx = await request.newContext();
  const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await token.json();
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.json().catch(() => null);
    if (r.status() >= 400)
      throw new Error(`${fn} as ${email}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

/**
 * Builds and starts the route. Returns { code, routeId, stops: [{ stopId,
 * tracking, orderNumber, shopper }] } in route order; `shopper` is the demo
 * shopper whose order it is, or null if the order is someone else's.
 */
async function ownRoute(count = 2) {
  const bodega = await as("bodega@yuntera.example");
  const roles = await bodega("my_roles");
  const warehouse = roles.warehouses[0].id;
  const board = await bodega("wms_board", { p_warehouse_id: warehouse });
  const toPick = board.shipments.filter((s) => s.status === "pending" && !s.short).slice(0, count);
  if (toPick.length === 0)
    throw new Error("no parcel is waiting to be picked for the journey's route");
  for (const shipment of toPick) {
    await bodega("wms_start_picking", { p_shipment_id: shipment.shipment_id });
    const detail = await bodega("wms_shipment", { p_shipment_id: shipment.shipment_id });
    for (const task of detail.tasks) {
      await bodega("wms_confirm_pick", {
        p_task_id: task.task_id,
        p_quantity: task.quantity,
        p_location_id: task.location_id,
        p_code: task.sku_code,
      });
    }
    await bodega("wms_pack_shipment", {
      p_shipment_id: shipment.shipment_id,
      p_weight_grams: detail.expected_weight_grams || 1000,
      p_package_count: 1,
    });
  }
  await bodega.dispose();

  const picked = new Set(toPick.map((s) => s.shipment_id));
  const central = await as("central@yuntera.example");
  const dispatch = await central("ops_dispatch_board");
  const drivers = await central("ops_drivers");
  const carlos = drivers.find((d) => d.full_name.startsWith("Carlos"));
  const ready = dispatch.ready.filter((s) => picked.has(s.shipment_id));
  await central("ops_create_route", {
    p_service_date: dispatch.date,
    p_depot_warehouse_id: dispatch.depots[0].id,
    p_stops: ready.map((s, i) => ({
      shipment_id: s.shipment_id,
      sequence: i + 1,
      eta_minute: (i + 1) * 15,
    })),
    p_driver_id: carlos.id,
    p_planned_km: 10,
    p_planned_minutes: 60,
  });
  await central.dispose();

  const driver = await as("repartidor@yuntera.example");
  const day = await driver("driver_today");
  const tracking = new Set(ready.map((s) => s.tracking_code));
  const route = day.routes.find(
    (r) => r.status === "assigned" && r.stops.some((s) => tracking.has(s.tracking_code)),
  );
  if (!route) throw new Error("the journey's route was not assigned to the driver");
  await driver("driver_start_route", { p_route_id: route.route_id });
  await driver.dispose();

  // Whose order each parcel is, among the demo shoppers.
  const owners = new Map();
  for (const email of SHOPPERS) {
    const shopper = await as(email);
    for (const order of await shopper("my_orders")) owners.set(order.order_number, email);
    await shopper.dispose();
  }
  const byTracking = new Map(ready.map((s) => [s.tracking_code, s]));
  return {
    code: route.code,
    routeId: route.route_id,
    stops: route.stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => {
        const orderNumber = byTracking.get(s.tracking_code)?.order_number ?? null;
        return {
          stopId: s.stop_id,
          tracking: s.tracking_code,
          orderNumber,
          shopper: (orderNumber && owners.get(orderNumber)) || null,
        };
      }),
  };
}

module.exports = { ownRoute };
