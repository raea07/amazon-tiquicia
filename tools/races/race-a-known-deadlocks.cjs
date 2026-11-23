/*
 * Family A: the deadlocks the third review found (payment confirmation
 * against the unpaid-order sweep, and against packing / cancelling an order
 * holding one product from two shops), and the older checkout ones.
 *
 *   node race-a-known-deadlocks.cjs <database-url> [rounds] [scenario-regex]
 *
 * Each scenario runs twice: "natural" (all sessions let go together by the
 * barrier) and "forced" (a third session holds the row the third review used
 * to stop the writer between its two stock rows, as
 * packages/db/src/contract.stock-lock-order-races.test.ts does, and lets go
 * 150 ms after the barrier opens; the confirmation starts 40 ms late).
 */
"use strict";
const { main, STAFF, WORKER } = require("./lib.cjs");

const confirm = (order) => ({
  name: "confirm",
  as: null, // set per scenario: the shopper who placed it
  sql: "select public.confirm_sandbox_payment($1)",
  args: [order],
});
const sweep = {
  name: "sweep",
  as: null,
  sql: "select private.expire_unpaid_orders() as n",
  args: [],
};

/** Two expired card orders, the older of the product that sorts last, and a card order of both. */
async function sweepSetup(h, _round) {
  await h.layout(["low", "high"], { "W7-01": 200 });
  const olderOfHigh = await h.place(1, [["high", 1]]);
  const newerOfLow = await h.place(2, [["low", 1]]);
  await h.expire([olderOfHigh], 120);
  await h.expire([newerOfLow], 60);
  const both = await h.place(3, [
    ["low", 1],
    ["high", 1],
  ]);
  return { olderOfHigh, newerOfLow, both, orders: [olderOfHigh, newerOfLow, both] };
}
const sweepHold = (_h, ctx) => ({
  hold: {
    sql: `select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
           where i.order_id = $1 for share of r`,
    args: [ctx.newerOfLow],
  },
  holdMs: 150,
});
async function sweepVerify(h, ctx, results) {
  const bad = [];
  const st = (
    await h.q("select id, status::text from public.orders where id = any($1)", [ctx.orders])
  ).rows;
  const s = Object.fromEntries(st.map((r) => [r.id, r.status]));
  const sw = results.find((r) => r.name === "sweep");
  if (sw && !sw.outcome) {
    if (s[ctx.olderOfHigh] !== "cancelled" || s[ctx.newerOfLow] !== "cancelled")
      bad.push("sweep committed but an expired order is not cancelled");
    if (sw.row.n !== 2) bad.push(`sweep returned ${sw.row.n}, expected 2`);
  }
  return bad;
}

/** A cash order of one product from two shops, fully picked; a card order of the same two offers. */
async function twoShopSetup(h, round, picked = "all") {
  await h.layout(["low", "second"], { "W7-01": 200 });
  const held = await h.cashInPicking(
    4,
    [
      ["low", 1],
      ["second", 1],
    ],
    picked,
  );
  const paying = await h.place(5, [
    ["second", 2],
    ["low", 2],
  ]);
  // Both shops' rows on disk in one order, then the other.
  const shop = round % 2 === 0 ? h.offer("low").seller_id : h.offer("second").seller_id;
  await h.q(
    `update public.inventory_reservations r set quantity = r.quantity from public.order_items i
      where i.id = r.order_item_id and i.order_id = $1 and r.seller_id = $2`,
    [held.order, shop],
  );
  await h.q(
    `update public.shipment_items si set quantity = si.quantity from public.order_items i
      where i.id = si.order_item_id and i.order_id = $1 and i.seller_id = $2`,
    [held.order, shop],
  );
  return { ...held, paying, orders: [held.order, paying] };
}
const offerHold = (h) => {
  const low = h.offer("low");
  const second = h.offer("second");
  const last = low.seller_id > second.seller_id ? low : second;
  return {
    hold: { sql: "select 1 from public.offers where id = $1 for update", args: [last.id] },
    holdMs: 150,
  };
};

function both(name, def) {
  return [
    { ...def, name: `${name} natural`, options: undefined },
    { ...def, name: `${name} forced`, forced: true },
  ];
}

const scenarios = [
  ...both("A1 confirm(A+B) vs sweep(two expired, opposite sku order)", {
    products: ["low", "high"],
    setup: sweepSetup,
    actors: (_h, ctx, _round) => [
      { ...sweep },
      { ...confirm(ctx.both), as: "carrera-w7-3@yuntera.example", delayMs: 0 },
    ],
    verify: sweepVerify,
  }),
  ...both("A2 confirm vs pack(one product, two shops)", {
    products: ["low", "second"],
    setup: (h, round) => twoShopSetup(h, round),
    actors: (_h, ctx) => [
      {
        name: "pack",
        as: WORKER,
        sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
        args: [ctx.shipment],
      },
      { ...confirm(ctx.paying), as: "carrera-w7-5@yuntera.example" },
    ],
  }),
  ...both("A2b confirm vs staff cancel(one product, two shops, picked)", {
    products: ["low", "second"],
    setup: (h, round) => twoShopSetup(h, round),
    actors: (_h, ctx) => [
      {
        name: "staff-cancel",
        as: STAFF,
        sql: "select public.cancel_order($1, 'Prueba de carrera siete')",
        args: [ctx.order],
      },
      { ...confirm(ctx.paying), as: "carrera-w7-5@yuntera.example" },
    ],
  }),
  ...both("A2c place_order card vs pack(one product, two shops)", {
    products: ["low", "second"],
    setup: async (h, round) => {
      const ctx = await twoShopSetup(h, round);
      return ctx;
    },
    actors: (h, ctx) => [
      {
        name: "pack",
        as: WORKER,
        sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
        args: [ctx.shipment],
      },
      {
        ...h.placeArgs(
          6,
          [
            ["second", 1],
            ["low", 1],
          ],
          "card",
        ),
        name: "place_order",
      },
    ],
  }),
  ...both("A2d place_order card vs sweep(two expired, opposite sku order)", {
    products: ["low", "high"],
    setup: sweepSetup,
    actors: (h) => [
      { ...sweep },
      {
        ...h.placeArgs(
          6,
          [
            ["low", 1],
            ["high", 1],
          ],
          "card",
        ),
        name: "place_order",
      },
    ],
    verify: sweepVerify,
  }),
];

// Forced variants: the holder, and the second actor 40 ms late.
for (const sc of scenarios) {
  if (!sc.forced) continue;
  const actors = sc.actors;
  sc.actors = (h, ctx, round) =>
    actors(h, ctx, round).map((a, i) => (i === 1 ? { ...a, delayMs: 40 } : a));
  sc.options = sc.name.startsWith("A1") || sc.name.startsWith("A2d") ? sweepHold : offerHold;
}

main("A", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
