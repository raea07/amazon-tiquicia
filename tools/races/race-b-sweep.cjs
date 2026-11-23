/*
 * Family B: the unpaid-order sweep's new shape (private.expire_unpaid_orders
 * takes its expired orders FOR UPDATE SKIP LOCKED, then every stock row of
 * their active reservations, then cancels them one by one).
 *
 *   node race-b-sweep.cjs <database-url> [rounds] [scenario-regex]
 *
 * B1 sweep against sweep; B2 against paying an order of its set; B3 against
 * cancellations in and outside its set; B4 against every stock writer of the
 * same products; B5 a large sweep (200 orders, 20 products) with a checkout
 * and a payment confirmation of one of its products started 20 ms after it;
 * B6 odd expired orders (no reservation left, none at all, a seller-shipped
 * product, an empty sweep).
 */
"use strict";
const { main, STAFF, WORKER, SHOPPER } = require("./lib.cjs");

const sweep = (name = "sweep") => ({
  name,
  as: null,
  sql: "select private.expire_unpaid_orders() as n",
  args: [],
});
const confirm = (shopper, order, name = "confirm") => ({
  name,
  as: SHOPPER(shopper),
  sql: "select public.confirm_sandbox_payment($1)",
  args: [order],
});

/** Expired card orders: older of `high`, newer of `low`, and one of both. */
async function expiredSet(h, extra = []) {
  const a = await h.place(1, [["high", 1]]);
  const b = await h.place(2, [["low", 1]]);
  const c = await h.place(3, [
    ["low", 1],
    ["high", 1],
  ]);
  await h.expire([a], 120);
  await h.expire([b], 90);
  await h.expire([c], 60);
  return [a, b, c, ...extra];
}

/** Even rounds: the second actor 0-4 ms late; odd rounds: the first. */
function late(actors, round) {
  const ms = Math.floor(round / 2) % 5;
  return actors.map((a, i) => ({ ...a, delayMs: (round % 2 === 0) === (i === 1) ? ms : 0 }));
}

async function statuses(h, ids) {
  const { rows } = await h.q("select id, status::text from public.orders where id = any($1)", [
    ids,
  ]);
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

/** Every order of `set` cancelled once, and the sweeps' counts plus the other winners add up. */
async function setAccounted(h, set, results, othersCancelled = 0, othersKept = 0) {
  const bad = [];
  const s = await statuses(h, set);
  const cancelled = set.filter((id) => s[id] === "cancelled").length;
  const counted = results
    .filter((r) => r.name.startsWith("sweep") && !r.outcome)
    .reduce((n, r) => n + r.row.n, 0);
  if (counted + othersCancelled !== cancelled)
    bad.push(`sweeps counted ${counted} + others ${othersCancelled}, cancelled ${cancelled}`);
  if (cancelled + othersKept !== set.length)
    bad.push(`${set.length - cancelled - othersKept} expired order(s) neither cancelled nor kept`);
  return bad;
}

/**
 * For a large set: a sweep may cancel only the oldest part of it (from
 * 20261121084400, at most 200 orders per run). What it cancelled is what it
 * counted, every order it cancelled is older than every one it left, and the
 * rest still wait for their payment, untouched.
 */
async function cappedAccounted(h, set, results) {
  const bad = [];
  const s = await statuses(h, set);
  const cancelled = set.filter((id) => s[id] === "cancelled");
  const counted = results
    .filter((r) => r.name.startsWith("sweep") && !r.outcome)
    .reduce((n, r) => n + r.row.n, 0);
  if (counted !== cancelled.length)
    bad.push(`sweep counted ${counted}, cancelled ${cancelled.length}`);
  const left = set.filter((id) => s[id] !== "cancelled");
  if (left.some((id) => s[id] !== "pending_payment"))
    bad.push("an expired order left by the sweep is no longer waiting for payment");
  // `set` is in the order placed (oldest first): what was cancelled is a prefix of it.
  const firstLeft = set.findIndex((id) => s[id] !== "cancelled");
  if (firstLeft >= 0 && set.slice(firstLeft).some((id) => s[id] === "cancelled"))
    bad.push("the sweep skipped an older expired order for a newer one");
  if (left.length) {
    // The next runs take the rest (not timed): nothing is lost.
    for (let i = 0; i < 10; i++) {
      const n = (await h.q("select private.expire_unpaid_orders() as n")).rows[0].n;
      if (n === 0) break;
    }
    const after = await statuses(h, left);
    if (left.some((id) => after[id] !== "cancelled"))
      bad.push("later sweeps did not cancel the rest of the backlog");
  }
  return bad;
}

const B1 = [2, 3].map((n) => ({
  name: `B1 ${n} sweeps at once over 12 expired orders`,
  products: ["low", "high", "second"],
  setup: async (h) => {
    await h.layout(["low", "high", "second"], { "W7-01": 300 });
    const set = [];
    for (let i = 0; i < 12; i++) {
      const lines = [
        [["low", 1]],
        [["high", 1]],
        [
          ["second", 1],
          ["low", 1],
        ],
        [
          ["high", 1],
          ["low", 1],
        ],
      ][i % 4];
      set.push(await h.place((i % 8) + 1, lines));
    }
    for (let i = 0; i < set.length; i++) await h.expire([set[i]], 200 - i);
    return { set, orders: set };
  },
  actors: () => Array.from({ length: n }, (_, i) => sweep(`sweep${i + 1}`)),
  verify: (h, ctx, results) => setAccounted(h, ctx.set, results),
}));

const B2 = [
  {
    name: "B2 sweep vs confirm_sandbox_payment of an order in its set",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 200 });
      const set = await expiredSet(h);
      return { set, target: set[2], orders: set };
    },
    actors: (_h, ctx, round) => late([sweep(), confirm(3, ctx.target)], round),
    verify: async (h, ctx, results) => {
      const bad = [];
      const c = results.find((r) => r.name === "confirm");
      const s = (await statuses(h, [ctx.target]))[ctx.target];
      if (!c.outcome && s !== "confirmed") bad.push(`confirm accepted, order ${s}`);
      if (c.outcome && s !== "cancelled") bad.push(`confirm refused (${c.outcome}), order ${s}`);
      if (c.outcome && c.outcome !== "order_not_payable")
        bad.push(`confirm refused with ${c.outcome}`);
      return [...bad, ...(await setAccounted(h, ctx.set, results, 0, c.outcome ? 0 : 1))];
    },
  },
  {
    name: "B2b sweep vs ops_confirm_payment of a SINPE order in its set",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 200 });
      const t = await h.place(
        3,
        [
          ["low", 1],
          ["high", 1],
        ],
        "sinpe_movil",
      );
      const set = await expiredSet(h, [t]);
      await h.expire([t], 45);
      return { set, target: t, orders: set };
    },
    actors: (_h, ctx, round) =>
      late(
        [
          sweep(),
          {
            name: "ops-confirm",
            as: STAFF,
            sql: "select public.ops_confirm_payment($1, $2)",
            args: [ctx.target, `REF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`],
          },
        ],
        round,
      ),
    verify: async (h, ctx, results) => {
      const bad = [];
      const c = results.find((r) => r.name === "ops-confirm");
      const s = (await statuses(h, [ctx.target]))[ctx.target];
      if (!c.outcome && s !== "confirmed") bad.push(`confirm accepted, order ${s}`);
      if (c.outcome && s !== "cancelled") bad.push(`confirm refused (${c.outcome}), order ${s}`);
      return [...bad, ...(await setAccounted(h, ctx.set, results, 0, c.outcome ? 0 : 1))];
    },
  },
];

const B3 = [
  {
    name: "B3a sweep vs the shopper's cancel_order of an order in its set",
    who: SHOPPER(3),
  },
  { name: "B3b sweep vs staff cancel_order of an order in its set", who: STAFF },
].map((x) => ({
  name: x.name,
  products: ["low", "high"],
  setup: async (h) => {
    await h.layout(["low", "high"], { "W7-01": 200 });
    const set = await expiredSet(h);
    return { set, target: set[2], orders: set };
  },
  actors: (_h, ctx, round) =>
    late(
      [
        sweep(),
        {
          name: "cancel",
          as: x.who,
          sql: "select public.cancel_order($1, 'Prueba de carrera siete')",
          args: [ctx.target],
        },
      ],
      round,
    ),
  verify: async (h, ctx, results) => {
    const bad = [];
    const c = results.find((r) => r.name === "cancel");
    if (c.outcome && c.outcome !== "too_late_to_cancel")
      bad.push(`cancel refused with ${c.outcome}`);
    return [...bad, ...(await setAccounted(h, ctx.set, results, c.outcome ? 0 : 1))];
  },
}));
B3.push(
  {
    name: "B3c sweep vs staff cancel of a half-picked paid order outside its set (same products)",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 200 });
      const set = await expiredSet(h);
      const outside = await h.place(4, [
        ["low", 2],
        ["high", 2],
      ]);
      await h.call(SHOPPER(4), "select public.confirm_sandbox_payment($1)", [outside]);
      const ship = await h.shipmentOf(outside);
      await h.startPicking(ship);
      const tasks = await h.tasks(ship);
      await h.pick(tasks[0]);
      return { set, outside, orders: [...set, outside] };
    },
    actors: (_h, ctx, round) => [
      sweep(),
      {
        name: "staff-cancel",
        as: STAFF,
        sql: "select public.cancel_order($1, 'Prueba de carrera siete')",
        args: [ctx.outside],
        delayMs: round % 5,
      },
    ],
    verify: (h, ctx, results) => setAccounted(h, ctx.set, results),
  },
  {
    name: "B3d sweep vs the shopper's cancel of an unexpired unpaid order outside its set (same products)",
    products: ["low", "high"],
    setup: async (h) => {
      await h.layout(["low", "high"], { "W7-01": 200 });
      const set = await expiredSet(h);
      const outside = await h.place(4, [
        ["high", 1],
        ["low", 1],
      ]);
      return { set, outside, orders: [...set, outside] };
    },
    actors: (_h, ctx, round) => [
      sweep(),
      {
        name: "cancel",
        as: SHOPPER(4),
        sql: "select public.cancel_order($1, 'Prueba de carrera siete')",
        args: [ctx.outside],
        delayMs: round % 5,
      },
    ],
    verify: (h, ctx, results) => setAccounted(h, ctx.set, results),
  },
);

/** B4: the sweep of three expired orders against one stock writer of the same products. */
function b4(name, prepare, actor) {
  return {
    name: `B4 sweep vs ${name}`,
    products: ["low", "high"],
    setup: async (h, round) => {
      await h.layout(["low", "high"], { "W7-01": 200, "W7-02": 50 });
      const extra = await prepare(h, round);
      const set = await expiredSet(h);
      return { ...extra, set, orders: [...set, ...(extra.orders || [])] };
    },
    actors: (h, ctx, round) => late([sweep(), actor(h, ctx, round)], round),
    verify: (h, ctx, results) => setAccounted(h, ctx.set, results),
  };
}
const nothing = async () => ({});
const cashPicked = async (h, picked) => {
  const x = await h.cashInPicking(
    5,
    [
      ["low", 1],
      ["high", 1],
    ],
    picked,
  );
  return { ...x, orders: [x.order] };
};
const B4 = [
  b4("place_order card (low+high)", nothing, (h) => ({
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
  b4("place_order cash (low+high, released inside)", nothing, (h) => ({
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
  b4(
    "wms_pack_shipment (low+high)",
    (h) => cashPicked(h, "all"),
    (_h, ctx) => ({
      name: "pack",
      as: WORKER,
      sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
      args: [ctx.shipment],
    }),
  ),
  b4(
    "wms_confirm_pick (low)",
    (h) => cashPicked(h, 0),
    (_h, ctx) => ({
      name: "pick",
      as: WORKER,
      sql: "select public.wms_confirm_pick($1, $2, null, $3)",
      args: [ctx.tasks[0].id, ctx.tasks[0].quantity, ctx.tasks[0].sku_code],
    }),
  ),
  b4(
    "wms_start_picking (low+high)",
    async (h) => {
      const order = await h.place(
        5,
        [
          ["low", 1],
          ["high", 1],
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
  b4(
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
  b4("wms_adjust_stock +3 (low)", nothing, (h) => ({
    name: "adjust-up",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, 3, 'Conteo de la carrera siete', null)",
    args: [h.loc.get("W7-01"), h.offer("low").sku_id, h.offer("low").seller_id],
  })),
  b4("wms_adjust_stock -1 (low)", nothing, (h) => ({
    name: "adjust-down",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, -1, 'Conteo de la carrera siete', null)",
    args: [h.loc.get("W7-01"), h.offer("low").sku_id, h.offer("low").seller_id],
  })),
  b4("wms_adjust_stock -1 (high)", nothing, (h) => ({
    name: "adjust-down",
    as: WORKER,
    sql: "select public.wms_adjust_stock($1, $2, $3, -1, 'Conteo de la carrera siete', null)",
    args: [h.loc.get("W7-01"), h.offer("high").sku_id, h.offer("high").seller_id],
  })),
  b4("wms_move_stock (low)", nothing, (h) => ({
    name: "move",
    as: WORKER,
    sql: "select public.wms_move_stock($1, $2, $3, $4, 2, null)",
    args: [h.loc.get("W7-01"), h.loc.get("W7-02"), h.offer("low").sku_id, h.offer("low").seller_id],
  })),
  b4(
    "wms_receive_returned_shipment (low+high, recalled parcel)",
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
];

const large = (N, cap, tail = false) => ({
  name: `B5 large sweep (${N} expired orders, 20 products) with a checkout and a payment of ${tail ? "a product only its LAST order holds" : "one of them"} 20 ms later`,
  rounds: cap,
  products: [],
  setup: async (h) => {
    const P = h.pool20;
    await h.layout(P, { "W7-01": Math.max(100, N) });
    const set = [];
    for (let i = 0; i < N; i++) {
      let lines =
        i % 2 === 0
          ? [[P[i % 20], 1]]
          : [
              [P[i % 20], 1],
              [P[(i + 7) % 20], 1],
            ];
      // tail: product 19 appears only in the last (newest) expired order.
      if (tail)
        lines =
          i === N - 1
            ? [[P[19], 1]]
            : lines
                .map(([o, q]) => [o === P[19] ? P[0] : o, q])
                .filter((l, k, all) => all.findIndex((x) => x[0] === l[0]) === k);
      set.push(await h.place((i % 8) + 1, lines));
    }
    await h.q(
      "update public.orders set placed_at = now() - interval '3 hours' + (interval '1 second' * x.n) from unnest($1::uuid[]) with ordinality x(id, n) where orders.id = x.id",
      [set],
    );
    // A card order of the product of the LAST expired order, waiting for its payment.
    const paying = await h.place(8, [[P[19], 1]]);
    return { set, paying, orders: [paying] };
  },
  actors: (h, ctx) => [
    sweep(),
    { ...h.placeArgs(7, [[h.pool20[19], 1]], "card"), name: "place_order", delayMs: 20 },
    { ...confirm(8, ctx.paying), delayMs: 20 },
  ],
  verify: async (h, ctx, results) => [
    ...(await cappedAccounted(h, ctx.set, results)),
    ...(await h.check(h.pool20)),
  ],
});
const B5 = [large(200), large(200, undefined, true), large(1000, 5)];
for (const sc of B5) sc.products = []; // checked per round in verify (20 products)

const B6 = [
  {
    name: "B6 odd expired orders (reservation released, consumed, none, seller-shipped) and an empty sweep",
    products: ["low", "high"],
    setup: async (h, round) => {
      await h.layout(["low", "high"], { "W7-01": 200 });
      if (round % 2 === 1) return { set: [], orders: [] };
      const released = await h.place(1, [["low", 1]]);
      const consumed = await h.place(2, [["high", 1]]);
      const none = await h.place(3, [["low", 1]]);
      const seller = (
        await h.q(
          `select o.id, o.sku_id, o.seller_id from public.offers o join public.skus k on k.id = o.sku_id join public.products p on p.id = k.product_id
            where p.slug = 'juego-desatornilladores-roble-32' and o.fulfillment = 'seller'`,
        )
      ).rows[0];
      const sellerOrder = await h.place(4, [[seller, 1]]);
      // Odd states made by hand, the stock rows kept consistent with them.
      const resOf = async (id) =>
        (
          await h.q(
            "select r.* from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id where i.order_id = $1",
            [id],
          )
        ).rows;
      for (const r of await resOf(released)) {
        await h.q(
          "update public.inventory_reservations set status = 'released', resolved_at = now() where id = $1",
          [r.id],
        );
        await h.q(
          "update public.stock_levels set reserved = reserved - $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
          [r.warehouse_id, r.sku_id, r.seller_id, r.quantity],
        );
      }
      for (const r of await resOf(consumed)) {
        await h.q(
          "update public.inventory_reservations set status = 'consumed', resolved_at = now() where id = $1",
          [r.id],
        );
        await h.q(
          "update public.stock_levels set reserved = reserved - $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
          [r.warehouse_id, r.sku_id, r.seller_id, r.quantity],
        );
      }
      for (const r of await resOf(none)) {
        await h.q("delete from public.inventory_reservations where id = $1", [r.id]);
        await h.q(
          "update public.stock_levels set reserved = reserved - $4 where warehouse_id = $1 and sku_id = $2 and seller_id = $3",
          [r.warehouse_id, r.sku_id, r.seller_id, r.quantity],
        );
      }
      const sellerStock = async () =>
        (
          await h.q(
            "select coalesce(sum(reserved), 0)::int as r from public.stock_levels where sku_id = $1 and seller_id = $2",
            [seller.sku_id, seller.seller_id],
          )
        ).rows[0].r;
      const before = await sellerStock();
      const set = [released, consumed, none, sellerOrder];
      await h.expire(set, 120);
      return { set, orders: set, sellerStock, before };
    },
    actors: () => [sweep()],
    verify: async (h, ctx, results) => {
      const bad = await setAccounted(h, ctx.set, results);
      if (ctx.sellerStock && (await ctx.sellerStock()) !== ctx.before - 1)
        bad.push("the seller-shipped reservation was not given back");
      return bad;
    },
  },
];

main("B", [...B1, ...B2, ...B3, ...B4, ...B5, ...B6]).catch((e) => {
  console.error(e);
  process.exit(1);
});
