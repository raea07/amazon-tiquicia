/*
 * Family E: the lock order one level up. Every stock write updates the
 * shop's offer (private.refresh_offer_availability, from the stock_levels
 * trigger) and may update the offer's product row (private.refresh_product_summary,
 * from offers_summary_refresh). A product row is shared by every variant (SKU)
 * of the product and by every shop that sells it, so two transactions that
 * hold no stock row in common can still take two product rows in opposite
 * order.
 *
 *   node race-e-product-rows.cjs <database-url> [rounds] [scenario-regex]
 *
 * Fixture: the harness's own products (lib.cjs, FIXTURE), built with chosen
 * ids, so the order below holds on every database build:
 *   product X: variants x1 < x2 (Tienda Sendero); product Y: one variant, sold by
 *   Tienda Sendero ("low") and Cafetal Los Santos ("second"); by SKU x1 < y < x2;
 *   by product id Y < X.
 *
 * E1-E4, E2 (as in wave 7): the products STAY IN STOCK (200 units on a shelf):
 *   sweep: E1 (older) = [second] (product Y), E2 (newer) = [x2] (product X): it writes Y, then X.
 *   checkout / pack / cancel of [x1, low]: by SKU, x1 (X) then low (Y).
 * No stock row is shared. Without a fixed order of product rows the two can wait for
 * each other; with the summary refreshed only when an offer crosses zero, these never
 * touch a product row.
 *
 * E5-E9: what can still deadlock, or might, when offers DO cross zero (every
 * offer at its last unit, or a release that brings one back from zero), and
 * the writers of product rows that are not stock writers:
 *   E5  two checkouts that each take the last unit of an offer of X and of Y, in opposite order;
 *   E6  a staff cancellation that gives back the last units of x1 and x2 against the seller pausing x2
 *       (offer row, then product row);
 *   E6b a checkout of the last units of x1 and x2 against the seller pausing x2;
 *   E7  a staff cancellation giving back the last units of [x1, low] against Tienda Sendero being
 *       suspended (its products in product-id order: Y before X);
 *   E8  a staff cancellation giving back [x1, low] against catalogue staff taking product X down;
 *   E9  a checkout of the last units of [x1, low] against Tienda Sendero sending an edit of product X
 *       for review (seller_update_listing: product FOR UPDATE, then the shop FOR UPDATE).
 * After every round of E5-E9 each fixture product's stored summary must equal one
 * computed from scratch (lib.cjs summaryCheck).
 */
"use strict";
const { main, STAFF, WORKER, SHOPPER } = require("./lib.cjs");

const fixture = (h) => h.ownFixture();

const P = ["x1", "x2", "low", "second"];
async function sweepSet(h) {
  await fixture(h);
  await h.layout(P, { "W7-01": 200 });
  const e1 = await h.place(1, [["second", 1]]);
  const e2 = await h.place(2, [["x2", 1]]);
  await h.expire([e1], 120);
  await h.expire([e2], 60);
  return [e1, e2];
}
const sweep = {
  name: "sweep",
  as: null,
  sql: "select private.expire_unpaid_orders() as n",
  args: [],
};
// Forced: the sweep stops before E2's reservation (after writing Y); the other starts 40 ms late.
const holdE2 = (_h, ctx) => ({
  hold: {
    sql: `select 1 from public.inventory_reservations r join public.order_items i on i.id = r.order_item_id
           where i.order_id = $1 for share of r`,
    args: [ctx.set[1]],
  },
  holdMs: 150,
});
const late = (actors) => actors.map((a, i) => (i === 1 ? { ...a, delayMs: 40 } : a));

function pair(name, prepare, other) {
  const base = {
    products: P,
    setup: async (h, round) => {
      const set = await sweepSet(h);
      const extra = prepare ? await prepare(h, round) : {};
      return { ...extra, set, orders: [...set, ...(extra.orders || [])] };
    },
    verify: (h) => h.summaryCheck(h.fixtureProducts),
  };
  return [
    {
      ...base,
      name: `${name} natural`,
      actors: (h, ctx, round) => [sweep, { ...other(h, ctx), delayMs: round % 5 }],
    },
    {
      ...base,
      name: `${name} forced`,
      actors: (h, ctx) => late([sweep, other(h, ctx)]),
      options: holdE2,
    },
  ];
}

const cashPicked = async (h) => {
  const x = await h.cashInPicking(
    5,
    [
      ["x1", 1],
      ["low", 1],
    ],
    "all",
  );
  return { ...x, orders: [x.order] };
};

/** A paid order of `lines`, released to the warehouse, and the shelves left with nothing free. */
async function paidAtZero(h, keys, lines) {
  await fixture(h);
  await h.layout(keys, { "W7-01": 1 });
  const order = await h.place(5, lines);
  await h.call(SHOPPER(5), "select public.confirm_sandbox_payment($1)", [order]);
  return { order, orders: [order] };
}
const staffCancel = (ctx) => ({
  name: "staff-cancel",
  as: STAFF,
  sql: "select public.cancel_order($1, 'Prueba de carrera ocho')",
  args: [ctx.order],
});
// Forced (E5-E9): a third session holds product X FOR SHARE. The first actor
// queues on it (after taking its other rows); the second starts 40 ms late,
// takes what it takes first (another product row, an offer row, a key-share
// lock on the shop) and queues on X behind the first. When the third session
// lets go the first gets X and goes on to what the second holds.
const holdX = (h) => ({
  hold: {
    sql: "select 1 from public.products where id = $1 for share",
    args: [h.offer("x1").product_id],
  },
  holdMs: 150,
});
const sellerUser = "sendero@yuntera.example";

function both(name, def) {
  return [
    {
      ...def,
      name: `${name} natural`,
      actors: (h, ctx, round) =>
        def.actors(h, ctx).map((a, i) => (i === 1 ? { ...a, delayMs: round % 5 } : a)),
    },
    {
      ...def,
      name: `${name} forced`,
      actors: (h, ctx) => late(def.actors(h, ctx)),
      options: holdX,
    },
  ];
}
const summaries = (h) => h.summaryCheck(h.fixtureProducts);

const scenarios = [
  ...pair("E1 sweep (Y then X) vs place_order card [x1, low] (X then Y)", null, (h) => ({
    ...h.placeArgs(
      6,
      [
        ["low", 1],
        ["x1", 1],
      ],
      "card",
    ),
    name: "place_order",
  })),
  ...pair("E1b sweep vs place_order cash [x1, low]", null, (h) => ({
    ...h.placeArgs(
      6,
      [
        ["low", 1],
        ["x1", 1],
      ],
      "cash_on_delivery",
    ),
    name: "place_order",
  })),
  ...pair("E3 sweep vs wms_pack_shipment [x1, low]", cashPicked, (_h, ctx) => ({
    name: "pack",
    as: WORKER,
    sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
    args: [ctx.shipment],
  })),
  ...pair(
    "E4 sweep vs staff cancel of a paid order [x1, low]",
    async (h) => {
      const order = await h.place(5, [
        ["x1", 1],
        ["low", 1],
      ]);
      await h.call(SHOPPER(5), "select public.confirm_sandbox_payment($1)", [order]);
      return { order, orders: [order] };
    },
    (_h, ctx) => staffCancel(ctx),
  ),
  {
    name: "E2 place_order [x1, low] (X then Y) vs place_order [second, x2] (Y then X)",
    products: P,
    setup: async (h) => {
      await fixture(h);
      await h.layout(P, { "W7-01": 200 });
      return { orders: [] };
    },
    actors: (h, _ctx, round) => [
      {
        ...h.placeArgs(
          6,
          [
            ["low", 1],
            ["x1", 1],
          ],
          "card",
        ),
        name: "place-1",
      },
      {
        ...h.placeArgs(
          7,
          [
            ["x2", 1],
            ["second", 1],
          ],
          "card",
        ),
        name: "place-2",
        delayMs: round % 4,
      },
    ],
    verify: summaries,
  },
  // ── Offers that cross zero ──────────────────────────────────────────────
  ...both("E5 place_order [x1, low] vs place_order [second, x2], every offer at its last unit", {
    products: P,
    setup: async (h) => {
      await fixture(h);
      await h.layout(P, { "W7-01": 1 });
      return { orders: [] };
    },
    actors: (h) => [
      {
        ...h.placeArgs(
          6,
          [
            ["low", 1],
            ["x1", 1],
          ],
          "card",
        ),
        name: "place-XY",
      },
      {
        ...h.placeArgs(
          7,
          [
            ["x2", 1],
            ["second", 1],
          ],
          "card",
        ),
        name: "place-YX",
      },
    ],
    verify: summaries,
  }),
  ...both("E6 staff cancel giving back the last units of [x1, x2] vs the seller pausing x2", {
    products: ["x1", "x2"],
    setup: (h) =>
      paidAtZero(
        h,
        ["x1", "x2"],
        [
          ["x1", 1],
          ["x2", 1],
        ],
      ),
    actors: (h, ctx) => [
      staffCancel(ctx),
      {
        name: "seller-pause",
        as: sellerUser,
        sql: "select public.seller_update_offer($1, 1300000, 'paused')",
        args: [h.offer("x2").id],
      },
    ],
    verify: async (h) => {
      await h.q("update public.offers set status = 'active' where id = $1", [h.offer("x2").id]);
      return summaries(h);
    },
  }),
  ...both("E6b place_order of the last units of [x1, x2] vs the seller pausing x2", {
    products: ["x1", "x2"],
    setup: async (h) => {
      await fixture(h);
      await h.layout(["x1", "x2"], { "W7-01": 1 });
      return { orders: [] };
    },
    actors: (h) => [
      {
        ...h.placeArgs(
          6,
          [
            ["x1", 1],
            ["x2", 1],
          ],
          "card",
        ),
        name: "place_order",
      },
      {
        name: "seller-pause",
        as: sellerUser,
        sql: "select public.seller_update_offer($1, 1300000, 'paused')",
        args: [h.offer("x2").id],
      },
    ],
    verify: async (h) => {
      await h.q("update public.offers set status = 'active' where id = $1", [h.offer("x2").id]);
      return summaries(h);
    },
  }),
  ...both("E7 staff cancel giving back the last units of [x1, low] vs Tienda Sendero suspended", {
    products: ["x1", "low"],
    setup: (h) =>
      paidAtZero(
        h,
        ["x1", "low"],
        [
          ["x1", 1],
          ["low", 1],
        ],
      ),
    actors: (h, ctx) => [
      staffCancel(ctx),
      {
        name: "suspend",
        as: STAFF,
        sql: "select public.ops_set_seller_status($1, 'suspended', 'Prueba de carrera ocho')",
        args: [h.offer("x1").seller_id],
      },
    ],
    verify: async (h) => {
      const bad = await summaries(h);
      await h.q("update public.sellers set status = 'active' where slug = 'tienda-sendero'");
      return bad;
    },
  }),
  ...both(
    "E8 staff cancel giving back the last units of [x1, low] vs staff taking product X down",
    {
      products: ["x1", "low"],
      setup: (h) =>
        paidAtZero(
          h,
          ["x1", "low"],
          [
            ["x1", 1],
            ["low", 1],
          ],
        ),
      actors: (h, ctx) => [
        staffCancel(ctx),
        {
          name: "take-down",
          as: STAFF,
          sql: "select public.ops_take_down_product($1, 'Prueba de carrera ocho, retiro temporal')",
          args: [h.offer("x1").product_id],
        },
      ],
      verify: async (h) => {
        const bad = await summaries(h);
        await h.q(
          `update public.products set status = 'active', rejection_reason = null, taken_down_at = null,
                  taken_down_by = null, taken_down_fingerprint = null where id = $1`,
          [h.offer("x1").product_id],
        );
        return bad;
      },
    },
  ),
  ...both(
    "E9 place_order of the last units of [x1, low] vs Tienda Sendero sending an edit of X for review",
    {
      products: ["x1", "low"],
      setup: async (h) => {
        await fixture(h);
        await h.layout(["x1", "low"], { "W7-01": 1 });
        await h.q(
          "update public.product_change_requests set status = 'withdrawn' where product_id = $1 and status = 'pending'",
          [h.offer("x1").product_id],
        );
        const slug = (
          await h.q(
            "select c.slug from public.categories c join public.products p on p.category_id = c.id where p.id = $1",
            [h.offer("x1").product_id],
          )
        ).rows[0].slug;
        return { slug, orders: [] };
      },
      actors: (h, ctx) => [
        {
          name: "seller-edit",
          as: sellerUser,
          sql: `select public.seller_update_listing($1, 'Producto X de la carrera ' || floor(random() * 1e6)::text,
                  $3, 'Producto de la prueba de carreras.', '{}'::text[], 500, 20, 15, 10, $2, true)`,
          args: [h.offer("x1").product_id, h.offer("x1").sku_id, ctx.slug],
        },
        {
          ...h.placeArgs(
            6,
            [
              ["x1", 1],
              ["low", 1],
            ],
            "card",
          ),
          name: "place_order",
        },
      ],
      verify: summaries,
    },
  ),
  // E10: not a product-row race, found while listing the writers of product rows:
  // switching off a variant two shops sell (seller_set_variant_active) takes the
  // product row, then the variant (sku) FOR UPDATE, then pauses the shop's offer;
  // packing that offer's parcel takes the offer row (stock trigger), then a
  // key-share lock on the variant (its ledger row). Products stay in stock.
  // Forced: a third session holds the offer row FOR SHARE; the pack queues on it
  // first, the seller 40 ms later (after taking the variant).
  {
    name: "E10 wms_pack_shipment [low] vs Tienda Sendero switching off variant Y (shared) natural",
    products: ["low", "second"],
    setup: async (h) => {
      await fixture(h);
      await h.layout(["low", "second"], { "W7-01": 200 });
      const x = await h.cashInPicking(5, [["low", 1]], "all");
      return { ...x, orders: [x.order] };
    },
    actors: (h, ctx, round) => [
      {
        name: "pack",
        as: WORKER,
        sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
        args: [ctx.shipment],
      },
      {
        name: "variant-off",
        as: sellerUser,
        sql: "select public.seller_set_variant_active($1, false)",
        args: [h.offer("low").sku_id],
        delayMs: round % 5,
      },
    ],
    verify: async (h) => {
      const bad = await summaries(h);
      await h.q("update public.offers set status = 'active' where id = $1", [h.offer("low").id]);
      await h.q("update public.skus set active = true where id = $1", [h.offer("low").sku_id]);
      return bad;
    },
  },
];
const e10 = scenarios[scenarios.length - 1];
scenarios.push({
  ...e10,
  name: "E10 wms_pack_shipment [low] vs Tienda Sendero switching off variant Y (shared) forced",
  actors: (h, ctx) => late(e10.actors(h, ctx, 0)),
  options: (h) => ({
    hold: { sql: "select 1 from public.offers where id = $1 for share", args: [h.offer("low").id] },
    holdMs: 150,
  }),
});

main("E", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
