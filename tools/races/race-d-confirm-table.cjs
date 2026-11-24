/*
 * Family D: the earlier race table of payment confirmations, once more.
 *
 *   node race-d-confirm-table.cjs <database-url> [rounds] [scenario-regex]
 *
 * Layouts of the product's shelves in SJO1:
 *   L1 one shelf with plenty (W7-01: 200)
 *   L2 two shelves that fill one task each (W7-01: 1, W7-02: 1)
 *   L3 a shelf and the returns area, one unit each (W7-01: 1, DEV-01: 1)
 * A pick task promised more than its location holds is a wrong result.
 */
"use strict";
const { main, STAFF, WORKER, SHOPPER } = require("./lib.cjs");

const confirm = (shopper, order, name = "confirm") => ({
  name,
  as: SHOPPER(shopper),
  sql: "select public.confirm_sandbox_payment($1)",
  args: [order],
});
const LAYOUTS = {
  L1: { "W7-01": 200 },
  L2: { "W7-01": 1, "W7-02": 1 },
  L3: { "W7-01": 1, "DEV-01": 1 },
};

const scenarios = [];
for (const [name, layout] of Object.entries(LAYOUTS)) {
  scenarios.push({
    name: `D1 confirm vs confirm, one product, layout ${name}`,
    products: ["low"],
    setup: async (h) => {
      await h.layout(["low"], layout);
      const a = await h.place(1, [["low", 1]]);
      const b = await h.place(2, [["low", 1]]);
      return { a, b, orders: [a, b] };
    },
    actors: (_h, ctx) => [confirm(1, ctx.a, "confirm-a"), confirm(2, ctx.b, "confirm-b")],
  });
}
scenarios.push(
  {
    name: "D1b confirm vs confirm, two products in opposite cart order, layout L2 for both",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], LAYOUTS.L2);
      const a = await h.place(1, [
        ["low", 1],
        ["high", 1],
      ]);
      const b = await h.place(2, [
        ["high", 1],
        ["low", 1],
      ]);
      return { a, b, orders: [a, b] };
    },
    actors: (_h, ctx) => [confirm(1, ctx.a, "confirm-a"), confirm(2, ctx.b, "confirm-b")],
  },
  {
    name: "D1c three confirms at once, one product (W7-01: 1, W7-02: 1, DEV-01: 1)",
    products: ["low"],
    setup: async (h) => {
      await h.layout(["low"], { "W7-01": 1, "W7-02": 1, "DEV-01": 1 });
      const ids = [];
      for (const s of [1, 2, 3]) ids.push(await h.place(s, [["low", 1]]));
      return { ids, orders: ids };
    },
    actors: (_h, ctx) => ctx.ids.map((id, i) => confirm(i + 1, id, `confirm-${i + 1}`)),
  },
  {
    name: "D1d confirm vs confirm, one product from two shops, opposite cart order (L1)",
    products: ["low", "second"],
    setup: async (h) => {
      await h.layout(["low", "second"], LAYOUTS.L1);
      const a = await h.place(1, [
        ["low", 1],
        ["second", 1],
      ]);
      const b = await h.place(2, [
        ["second", 1],
        ["low", 1],
      ]);
      return { a, b, orders: [a, b] };
    },
    actors: (_h, ctx) => [confirm(1, ctx.a, "confirm-a"), confirm(2, ctx.b, "confirm-b")],
  },
);

/** confirm of a card order of low+high (L1) against one other writer of the same products. */
function vs(name, prepare, actor, layout = { "W7-01": 100, "W7-02": 50 }) {
  return {
    name: `D2 confirm vs ${name}`,
    products: ["low", "high"],
    setup: async (h, round) => {
      await h.layout(["low", "high"], layout);
      const extra = prepare ? await prepare(h, round) : {};
      const paying = await h.place(1, [
        ["low", 1],
        ["high", 1],
      ]);
      return { ...extra, paying, orders: [paying, ...(extra.orders || [])] };
    },
    actors: (h, ctx, round) => [confirm(1, ctx.paying), { ...actor(h, ctx), delayMs: round % 3 }],
  };
}
const cashPicked = async (h, picked) => {
  const x = await h.cashInPicking(
    5,
    [
      ["high", 1],
      ["low", 1],
    ],
    picked,
  );
  return { ...x, orders: [x.order] };
};
const lowArgs = (h, code = "W7-01") => [
  h.loc.get(code),
  h.offer("low").sku_id,
  h.offer("low").seller_id,
];
scenarios.push(
  vs("place_order card (high+low)", null, (h) => ({
    ...h.placeArgs(
      6,
      [
        ["high", 1],
        ["low", 1],
      ],
      "card",
    ),
    name: "place_order",
  })),
  vs("place_order cash (high+low)", null, (h) => ({
    ...h.placeArgs(
      6,
      [
        ["high", 1],
        ["low", 1],
      ],
      "cash_on_delivery",
    ),
    name: "place_order",
  })),
  vs("wms_move_stock (low, W7-01 to W7-02)", null, (h) => ({
    name: "move",
    as: WORKER,
    sql: "select public.wms_move_stock($1, $2, $3, $4, 2, null)",
    args: [h.loc.get("W7-01"), h.loc.get("W7-02"), h.offer("low").sku_id, h.offer("low").seller_id],
  })),
  vs("wms_adjust_stock +2 (low)", null, (h) => ({
    name: "adjust-up",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, 2, 'Conteo de la carrera siete', null)",
    args: lowArgs(h),
  })),
  vs("wms_adjust_stock -1 (low)", null, (h) => ({
    name: "adjust-down",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, -1, 'Conteo de la carrera siete', null)",
    args: lowArgs(h),
  })),
  vs(
    "wms_receive (low)",
    async (h) => {
      const low = h.offer("low");
      const ship = (
        await h.q(
          `insert into public.inbound_shipments (reference, seller_id, warehouse_id, status)
           values ('W7-' || floor(random() * 1e9)::text, $1, $2, 'in_transit') returning id`,
          [low.seller_id, h.warehouseId],
        )
      ).rows[0].id;
      const line = (
        await h.q(
          "insert into public.inbound_shipment_lines (inbound_shipment_id, sku_id, expected_quantity) values ($1, $2, 5) returning id",
          [ship, low.sku_id],
        )
      ).rows[0].id;
      return { line };
    },
    (h, ctx) => ({
      name: "receive",
      as: WORKER,
      sql: "select public.wms_receive($1, 3, 0, $2)",
      args: [ctx.line, h.loc.get("W7-01")],
    }),
  ),
  vs(
    "wms_confirm_pick (another order, low)",
    (h) => cashPicked(h, 0),
    (_h, ctx) => ({
      name: "pick",
      as: WORKER,
      sql: "select public.wms_confirm_pick($1, $2, null, $3)",
      args: [ctx.tasks[0].id, ctx.tasks[0].quantity, ctx.tasks[0].sku_code],
    }),
  ),
  vs(
    "wms_start_picking (another order, high+low)",
    async (h) => {
      const order = await h.place(
        5,
        [
          ["high", 1],
          ["low", 1],
        ],
        "cash_on_delivery",
      );
      return { order, shipment: await h.shipmentOf(order), orders: [order] };
    },
    (_h, ctx) => ({
      name: "start",
      as: WORKER,
      sql: "select public.wms_start_picking($1)",
      args: [ctx.shipment],
    }),
  ),
  vs(
    "wms_pack_shipment (another order, high+low)",
    (h) => cashPicked(h, "all"),
    (_h, ctx) => ({
      name: "pack",
      as: WORKER,
      sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
      args: [ctx.shipment],
    }),
  ),
  vs(
    "wms_receive_returned_shipment (another order, high+low)",
    async (h) => {
      const x = await cashPicked(h, "all");
      await h.call(WORKER, "select public.wms_pack_shipment($1, 900, 1::smallint)", [x.shipment]);
      await h.call(STAFF, "select public.ops_recall_shipment($1, 'Prueba de carrera siete')", [
        x.shipment,
      ]);
      return x;
    },
    (_h, ctx) => ({
      name: "returned",
      as: WORKER,
      sql: "select public.wms_receive_returned_shipment($1, true, null)",
      args: [ctx.shipment],
    }),
  ),
  {
    name: "D3 the same order confirmed twice at once",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 100 });
      const a = await h.place(1, [
        ["low", 1],
        ["high", 1],
      ]);
      return { a, orders: [a] };
    },
    actors: (_h, ctx) => [confirm(1, ctx.a, "confirm-1"), confirm(1, ctx.a, "confirm-2")],
    verify: async (_h, _ctx, results) => {
      const ok = results.filter((r) => !r.outcome).length;
      const refused = results.filter((r) => r.outcome === "order_not_payable").length;
      return ok === 1 && refused === 1 ? [] : [`${ok} accepted, ${refused} refused as not payable`];
    },
  },
  {
    name: "D4 ops_confirm_payment vs confirm_sandbox_payment of the same SINPE order",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 100 });
      const a = await h.place(
        1,
        [
          ["low", 1],
          ["high", 1],
        ],
        "sinpe_movil",
      );
      return { a, orders: [a] };
    },
    actors: (_h, ctx, round) => [
      {
        delayMs: round % 2 ? 0 : Math.floor(round / 2) % 6,
        name: "ops-confirm",
        as: STAFF,
        sql: "select public.ops_confirm_payment($1, $2)",
        args: [ctx.a, `REF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`],
      },
      {
        ...confirm(1, ctx.a, "sandbox-confirm"),
        delayMs: round % 2 ? Math.floor(round / 2) % 6 : 0,
      },
    ],
    verify: async (_h, _ctx, results) => {
      const ok = results.filter((r) => !r.outcome).length;
      return ok === 1
        ? []
        : [`${ok} confirmations accepted (${results.map((r) => r.outcome).join(", ")})`];
    },
  },
);

main("D", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
