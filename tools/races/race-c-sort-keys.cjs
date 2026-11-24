/*
 * Family C: the new sort keys of private.cancel_order_internal (put-back by
 * product, shop, shelf; reservations by product, shop, warehouse) and
 * private.consume_shipment_stock, with one product sold by two shops from one
 * shelf; and the older cancellation weakness (a count or a receipt of the
 * same product on the same shelf; a pick).
 *
 *   node race-c-sort-keys.cjs <database-url> [rounds] [scenario-regex]
 */
"use strict";
const { main, STAFF, WORKER } = require("./lib.cjs");

const cancel = (order, name = "cancel") => ({
  name,
  as: STAFF,
  sql: "select public.cancel_order($1, 'Prueba de carrera siete')",
  args: [order],
});

/** Moves one shop's rows of an order to the end of their tables (a scan meets them last). */
async function rewrite(h, order, sellerId) {
  await h.q(
    `update public.inventory_reservations r set quantity = r.quantity from public.order_items i
      where i.id = r.order_item_id and i.order_id = $1 and r.seller_id = $2`,
    [order, sellerId],
  );
  await h.q(
    `update public.shipment_items si set quantity = si.quantity from public.order_items i
      where i.id = si.order_item_id and i.order_id = $1 and i.seller_id = $2`,
    [order, sellerId],
  );
}

/** A cash order of low (shop 1) and the same product of shop 2, from one shelf; `pickIdx` of its tasks picked. */
async function twoShopOrder(h, shopper, pickIdx) {
  const order = await h.place(
    shopper,
    [
      ["low", 1],
      ["second", 1],
    ],
    "cash_on_delivery",
  );
  const shipment = await h.shipmentOf(order);
  await h.startPicking(shipment);
  const tasks = await h.tasks(shipment);
  for (const i of pickIdx) await h.pick(tasks[i]);
  return { order, shipment, tasks };
}

const P = ["low", "second"];
const scenarios = [
  {
    name: "C1 staff cancel vs staff cancel, two orders of one product from two shops, one shelf, half picked (different halves)",
    products: P,
    setup: async (h, round) => {
      await h.layout(P, { "W7-01": 100 });
      const x = await twoShopOrder(h, 1, [0]);
      const y = await twoShopOrder(h, 2, [1]);
      await rewrite(h, x.order, h.offer("low").seller_id);
      await rewrite(h, y.order, h.offer("second").seller_id);
      if (round % 2) await rewrite(h, x.order, h.offer("second").seller_id);
      return { x, y, orders: [x.order, y.order] };
    },
    actors: (_h, ctx) => [cancel(ctx.x.order, "cancel-x"), cancel(ctx.y.order, "cancel-y")],
  },
  {
    name: "C1b staff cancel vs staff cancel, both fully picked from one shelf",
    products: P,
    setup: async (h, _round) => {
      await h.layout(P, { "W7-01": 100 });
      const x = await twoShopOrder(h, 1, [0, 1]);
      const y = await twoShopOrder(h, 2, [1, 0]);
      await rewrite(h, x.order, h.offer("low").seller_id);
      await rewrite(h, y.order, h.offer("second").seller_id);
      return { x, y, orders: [x.order, y.order] };
    },
    actors: (_h, ctx) => [cancel(ctx.x.order, "cancel-x"), cancel(ctx.y.order, "cancel-y")],
  },
  {
    name: "C2 staff cancel (half picked) vs pack of another such order (fully picked)",
    products: P,
    setup: async (h, round) => {
      await h.layout(P, { "W7-01": 100 });
      const x = await twoShopOrder(h, 1, [round % 2]);
      const y = await twoShopOrder(h, 2, [0, 1]);
      await rewrite(h, x.order, h.offer(round % 2 ? "low" : "second").seller_id);
      await rewrite(h, y.order, h.offer(round % 2 ? "second" : "low").seller_id);
      return { x, y, orders: [x.order, y.order] };
    },
    actors: (_h, ctx) => [
      cancel(ctx.x.order),
      {
        name: "pack",
        as: WORKER,
        sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
        args: [ctx.y.shipment],
      },
    ],
  },
];

/** The recorded weakness: a cancellation of a picked order against a count or receipt of the same shelf. */
function weakness(name, actor) {
  return {
    name: `C3 staff cancel (2 picked from W7-01) vs ${name}`,
    products: ["low"],
    setup: async (h) => {
      await h.layout(["low"], { "W7-01": 50 });
      const x = await h.cashInPicking(1, [["low", 2]], "all");
      let line = null;
      if (name.startsWith("wms_receive")) {
        const low = h.offer("low");
        const ship = (
          await h.q(
            `insert into public.inbound_shipments (reference, seller_id, warehouse_id, status)
             values ('W7-' || floor(random() * 1e9)::text, $1, $2, 'in_transit') returning id`,
            [low.seller_id, h.warehouseId],
          )
        ).rows[0].id;
        line = (
          await h.q(
            "insert into public.inbound_shipment_lines (inbound_shipment_id, sku_id, expected_quantity) values ($1, $2, 5) returning id",
            [ship, low.sku_id],
          )
        ).rows[0].id;
      }
      const y = name.startsWith("wms_confirm_pick")
        ? await h.cashInPicking(2, [["low", 1]], 0)
        : null;
      return { x, line, y, orders: [x.order, ...(y ? [y.order] : [])] };
    },
    actors: (h, ctx, round) => [cancel(ctx.x.order), { ...actor(h, ctx), delayMs: round % 3 }],
  };
}
/**
 * Forced: a third session holds the cancelled order's reservation FOR SHARE, so
 * the cancellation stops after its first writes (before 084400: after putting
 * the picked units back on W7-01, holding that shelf row) and before the stock
 * row; the other writer starts 40 ms late and takes the stock row, then wants
 * the shelf.
 */
function forced(sc) {
  return {
    ...sc,
    name: `${sc.name} forced`,
    actors: (h, ctx) => sc.actors(h, ctx, 0).map((a, i) => ({ ...a, delayMs: i === 1 ? 40 : 0 })),
    options: (_h, ctx) => ({
      hold: {
        sql: `select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
               where i.order_id = $1 for share of r`,
        args: [ctx.x.order],
      },
      holdMs: 150,
    }),
  };
}
const low = (h) => [h.loc.get("W7-01"), h.offer("low").sku_id, h.offer("low").seller_id];
scenarios.push(
  weakness("wms_adjust_stock +3 same shelf", (h) => ({
    name: "adjust-up",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, 3, 'Conteo de la carrera siete', null)",
    args: low(h),
  })),
  weakness("wms_adjust_stock -1 same shelf", (h) => ({
    name: "adjust-down",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, -1, 'Conteo de la carrera siete', null)",
    args: low(h),
  })),
  weakness("wms_receive into the same shelf", (h, ctx) => ({
    name: "receive",
    as: WORKER,
    sql: "select public.wms_receive($1, 3, 0, $2)",
    args: [ctx.line, h.loc.get("W7-01")],
  })),
  weakness("wms_confirm_pick of another order from the same shelf", (_h, ctx) => ({
    name: "pick",
    as: WORKER,
    sql: "select public.wms_confirm_pick($1, $2, null, $3)",
    args: [ctx.y.tasks[0].id, ctx.y.tasks[0].quantity, ctx.y.tasks[0].sku_code],
  })),
);

for (const sc of scenarios.filter((x) => x.name.startsWith("C3 "))) scenarios.push(forced(sc));

/**
 * C4: a cancellation of an order half picked (its first line picked from W7-01)
 * against the picker confirming its second line at the same moment. The
 * cancellation puts the picked units back and closes the tasks; the pick takes
 * its task, then its shelf. Allowed: the pick goes first and the cancellation
 * puts both lines back, or the cancellation goes first and the pick is refused
 * (the task is closed). Never: a unit picked and not put back (on hand would
 * then exceed the shelves plus the units in open parcels).
 */
const c4 = {
  name: "C4 staff cancel (one of two lines picked) vs wms_confirm_pick of its other line",
  products: ["low", "high"],
  setup: async (h) => {
    await h.layout(["low", "high"], { "W7-01": 50 });
    const x = await h.cashInPicking(
      1,
      [
        ["low", 1],
        ["high", 1],
      ],
      1,
    );
    return { x, orders: [x.order] };
  },
  actors: (_h, ctx, round) => [
    {
      name: "pick",
      as: WORKER,
      sql: "select public.wms_confirm_pick($1, $2, null, $3)",
      args: [ctx.x.tasks[1].id, ctx.x.tasks[1].quantity, ctx.x.tasks[1].sku_code],
    },
    { ...cancel(ctx.x.order), delayMs: round % 3 },
  ],
  verify: async (_h, _ctx, results) => {
    const pick = results.find((r) => r.name === "pick");
    if (pick.outcome && !/invalid_task_state|shipment_not_picking|DEADLOCK/.test(pick.outcome))
      return [`pick refused with ${pick.outcome}`];
    return [];
  },
};
scenarios.push(c4, {
  ...c4,
  name: `${c4.name} forced`,
  // The pick holds its task and waits for its shelf row (held FOR SHARE by a
  // third session); the cancellation starts 40 ms late.
  actors: (h, ctx) => c4.actors(h, ctx, 0).map((a, i) => ({ ...a, delayMs: i === 1 ? 40 : 0 })),
  options: (_h, ctx) => {
    const t = ctx.x.tasks[1];
    return {
      hold: {
        sql: `select 1 from public.bin_stock b join public.skus k on k.id = b.sku_id
               where b.location_id = $1 and k.code = $2 for share of b`,
        args: [t.location_id, t.sku_code],
      },
      holdMs: 150,
    };
  },
});

main("C", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
