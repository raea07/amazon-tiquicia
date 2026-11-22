/**
 * Contract tests for the follow-ups (areas/followups.ts): the answers of the
 * real database functions match the client's schemas for the right caller,
 * and the wrong caller gets a typed refusal. The rules themselves are tested
 * in supabase/tests/125_followups.sql.
 *
 * What this suite writes (a return request, withdrawn) is deleted again at
 * the end, so the other suites see the seed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("follow-ups contract (against a seeded database)", () => {
  let orderNumber = "";
  let orderItemId = "";
  let returnId = "";

  beforeAll(async () => {
    await db.connect();
    // A line of a delivered order of the demo shopper with no return yet.
    const { rows } = await db.query<{ order_number: string; item_id: string }>(
      `select o.order_number, i.id as item_id
       from public.orders o
       join auth.users u on u.id = o.user_id
       join public.order_items i on i.order_id = o.id
       where u.email = 'comprador@yuntera.example' and o.status = 'delivered'
         and o.warranty_until >= current_date
         and not exists (select 1 from public.return_requests r where r.order_item_id = i.id)
       order by o.placed_at desc, i.id limit 1`,
    );
    orderNumber = rows[0]?.order_number ?? "";
    orderItemId = rows[0]?.item_id ?? "";
    expect(orderNumber, "database is not seeded — run pnpm db:local:reset").not.toBe("");
  });

  afterAll(async () => {
    if (returnId) {
      await db.query("delete from public.order_events where note like 'Retiró su solicitud%'");
      await db.query("delete from public.return_requests where id = $1", [returnId]);
    }
    await db.close();
  });

  const shopper = () => db.as("comprador@yuntera.example");

  it("gives the driver each stop's district and cantón, and nobody else a driver's day", async () => {
    const day = await db.as("repartidor@yuntera.example").driverToday();
    const stops = day.routes.flatMap((route) => route.stops);
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop.district, stop.stop_id).toEqual(expect.any(String));
      expect(stop.canton, stop.stop_id).toEqual(expect.any(String));
    }
    await expect(shopper().driverToday()).rejects.toMatchObject({ code: "not_a_driver" });
  });

  it("lets the shopper withdraw a request waiting for a decision, and says so", async () => {
    returnId = await shopper().requestReturn({
      orderItemId,
      kind: "damaged",
      quantity: 1,
      reason: "La caja llegó aplastada y rota.",
    });
    let returns = await shopper().myOrderReturns(orderNumber);
    expect(returns.find((entry) => entry.id === returnId)).toMatchObject({
      status: "requested",
      can_withdraw: true,
      withdrawn_at: null,
    });

    await expect(
      db.as("cafetal@yuntera.example").withdrawReturnRequest(returnId),
    ).rejects.toMatchObject({ code: "return_not_found" });
    await expect(db.as().withdrawReturnRequest(returnId)).rejects.toMatchObject({
      code: "not_authenticated",
    });

    const withdrawn = await shopper().withdrawReturnRequest(returnId);
    expect(withdrawn).toMatchObject({ id: returnId, status: "rejected" });
    returns = await shopper().myOrderReturns(orderNumber);
    expect(returns.find((entry) => entry.id === returnId)).toMatchObject({
      status: "rejected",
      can_withdraw: false,
      withdrawn_at: expect.any(String),
    });
    // A second withdrawal (another tab, a double submit) says the same again.
    await expect(shopper().withdrawReturnRequest(returnId)).resolves.toEqual(withdrawn);
  });

  it("gives Central each stop's door flag and received time on the dispatch board", async () => {
    const board = await db.as("central@yuntera.example").opsDispatchBoard();
    const stops = board.routes.flatMap((route) => route.stops);
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(typeof stop.pod_outside_area, stop.stop_id).toBe("boolean");
      expect(stop).toHaveProperty("completed_received_at");
    }
    await expect(shopper().opsDispatchBoard()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lists the offers a fee change paused for finance and catalogue staff only", async () => {
    const list = await db.as("central@yuntera.example").opsFeeFloorBreaches();
    expect(Array.isArray(list)).toBe(true);
    await expect(shopper().opsFeeFloorBreaches()).rejects.toMatchObject({ code: "forbidden" });
    await expect(db.as("vendedor@yuntera.example").opsFeeFloorBreaches()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a pick without a scan and a driver's position from far away, with their codes", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.pick_tasks where status in ('open', 'in_progress') order by id limit 1",
    );
    const task = rows[0]?.id;
    if (task) {
      await expect(
        db.as("bodega@yuntera.example").wmsConfirmPick(task, 1, null, null),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^(scan_required|shipment_not_picking)$/),
      });
    }
    await expect(
      db.as("repartidor@yuntera.example").driverReportPosition(40.4168, -3.7038),
    ).rejects.toMatchObject({ code: "position_outside_area" });
    await expect(
      db
        .as("repartidor@yuntera.example")
        .driverReportPosition(9.93, -84.08, 10, new Date(Date.now() + 3_600_000)),
    ).rejects.toMatchObject({ code: "action_time_in_future" });
  });
});
