/*
 * Family F: is a product's listing summary ever left stale by two writers at
 * once? private.refresh_product_summary (from the offers trigger) reads the
 * product's offers and then writes the product row. Before 084400 it read
 * first and locked the row only in its UPDATE: two transactions that each take
 * the last unit of a DIFFERENT offer of the same product each computed the
 * summary without seeing the other's change, and the second, after waiting
 * for the first's row lock, wrote what it had computed before (READ COMMITTED
 * re-checks the row, not the values worked out earlier in the function).
 * From 084400 it takes the product row FOR NO KEY UPDATE before it reads, so
 * the second computes from what the first committed. All of this runs inside
 * the stock_levels trigger, in the middle of the caller's UPDATE statement;
 * the refresh is a VOLATILE function, so each of its statements takes a new
 * snapshot, which is what the lock relies on.
 *
 *   node race-f-stale-summary.cjs <database-url> [rounds] [scenario-regex]
 *
 * Fixture: product Z (lib.cjs FIXTURE), one variant sold from the warehouse by
 * Tienda Sendero ("z1", 7000) and Cafetal Los Santos ("z2", 7500).
 *
 *   F1  two checkouts, each taking the last unit of one of the two offers: both end at 0,
 *       so the product must end out of stock, its featured offer the cheaper one;
 *   F2  a staff cancellation giving back z1's last unit (0 -> 1) against a checkout taking
 *       z2's last unit (1 -> 0): the product must end in stock with z1 featured.
 * "forced": a third session holds product Z's row FOR NO KEY UPDATE (as a refresh
 * does) until both writers have reached it, then lets go.
 * Wrong: the stored summary differs from one computed from scratch (lib.cjs).
 */
"use strict";
const { main, STAFF, SHOPPER } = require("./lib.cjs");

const Z = ["z1", "z2"];
const holdZ = (h) => ({
  hold: {
    sql: "select 1 from public.products where id = $1 for no key update",
    args: [h.offer("z1").product_id],
  },
  holdMs: 200,
});
const summary = (h) => h.summaryCheck([h.offer("z1").product_id]);

function both(name, def) {
  return [
    {
      ...def,
      name: `${name} natural`,
      actors: (h, ctx, round) =>
        def.actors(h, ctx).map((a, i) => (i === 1 ? { ...a, delayMs: round % 3 } : a)),
    },
    { ...def, name: `${name} forced`, options: holdZ },
  ];
}

const scenarios = [
  ...both("F1 place_order of z1's last unit vs place_order of z2's last unit", {
    products: Z,
    setup: async (h) => {
      await h.ownFixture();
      await h.layout(Z, { "W7-01": 1 });
      return { orders: [] };
    },
    actors: (h) => [
      { ...h.placeArgs(1, [["z1", 1]], "card"), name: "place-z1" },
      { ...h.placeArgs(2, [["z2", 1]], "card"), name: "place-z2" },
    ],
    verify: summary,
  }),
  ...both("F2 staff cancel giving back z1's last unit vs place_order of z2's last unit", {
    products: Z,
    setup: async (h) => {
      await h.ownFixture();
      await h.layout(Z, { "W7-01": 1 });
      const order = await h.place(3, [["z1", 1]]);
      await h.call(SHOPPER(3), "select public.confirm_sandbox_payment($1)", [order]);
      return { order, orders: [order] };
    },
    actors: (h, ctx) => [
      {
        name: "staff-cancel",
        as: STAFF,
        sql: "select public.cancel_order($1, 'Prueba de carrera ocho')",
        args: [ctx.order],
      },
      { ...h.placeArgs(2, [["z2", 1]], "card"), name: "place-z2" },
    ],
    verify: summary,
  }),
];

main("F", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
