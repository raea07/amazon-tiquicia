/*
 * Family I: a count of a product into a location that does not list it
 * (public.wms_count_into_location, 20261121084500) against everything that can
 * write the same product's stock row or the same shelf at that moment.
 *
 *   node race-i-count-into-location.cjs <database-url> [rounds] [scenario-regex]
 *
 * Fixture: the seed product "low" of Tienda Sendero in SJO1 (lib.cjs). The
 * target is shelf W7-02 (I7: the returns area DEV-01), where every round
 * starts with a shelf row of "low" at 0 units and no open pick waiting there,
 * so the location does not list it and a count may go there. The count adds 3
 * units as the warehouse worker.
 *
 *   I1  staff cancelling a picked order (2 units picked from W7-02, which they
 *       emptied) vs the count: the cancellation puts the 2 units back on W7-02;
 *   I1b the shopper cancelling an order whose open pick waits at W7-01 for the
 *       same product (a shopper can cancel only before picking starts, so a
 *       shopper's cancellation never puts picked units back on a shelf; this
 *       is the closest it comes) vs the count into W7-02;
 *   I2  wms_adjust_stock +2 of the same product at W7-02 vs the count;
 *   I3  wms_move_stock of 2 units of the same product from W7-01 into W7-02 vs the count;
 *   I4  wms_confirm_pick of an open pick of the same product at W7-01 vs the count;
 *   I4b wms_confirm_pick of the open pick that waits at W7-02 itself (2 units,
 *       all the shelf holds) vs the count (the count is refused while the task
 *       is open, and may go there once the pick has emptied the shelf);
 *   I5  a second count of the same product into W7-02 (staff, 2 units) vs the
 *       worker's count (3 units): one count, never the sum;
 *   I7  wms_receive_returned_shipment of a recalled parcel of 2 units of the
 *       same product into the returns area DEV-01 vs the count into DEV-01.
 *
 * Allowed outcomes: both succeed, or the count is refused with
 * count_already_listed because the other writer put units there first (I1,
 * I2, I3, I4b, I5, I7), or I5's other count is refused the same way. Wrong: a
 * deadlock, a timeout, any other refusal, a shelf that does not hold exactly
 * what the successful writers put there (never the sum of two counts), and
 * everything check() looks at (on_hand = shelves + units picked into open
 * parcels, reserved = active reservations, available = on_hand - reserved, no
 * location promised more than it holds, the cancelled order's rows).
 *
 * "forced": a third session holds the target shelf's row FOR SHARE before the
 * barrier opens and lets go 150 ms after. In "count first" the count starts at
 * once and the other writer 40 ms late; in "other first" the other way round.
 * Whoever gets the stock row first then waits on the shelf while the other
 * waits on the stock row (or the warehouse row): with one lock order that is a
 * queue, with two orders it is a deadlock every round (as C3 was for a
 * correction before 084400).
 */
"use strict";
const { main, STAFF, WORKER, SHOPPER } = require("./lib.cjs");

const COUNT_UNITS = 3;

/** A shelf row of "low" at 0 units on `code` (what a move or a pick that empties a shelf leaves). */
async function zeroRow(h, code) {
  const o = h.offer("low");
  await h.q(
    `insert into public.bin_stock (location_id, sku_id, seller_id, quantity) values ($1, $2, $3, 0)
     on conflict (location_id, sku_id, seller_id) do update set quantity = 0`,
    [h.loc.get(code), o.sku_id, o.seller_id],
  );
}

async function shelf(h, code) {
  const o = h.offer("low");
  const { rows } = await h.q(
    "select quantity from public.bin_stock where location_id = $1 and sku_id = $2 and seller_id = $3",
    [h.loc.get(code), o.sku_id, o.seller_id],
  );
  return rows[0]?.quantity ?? 0;
}

const count = (h, code, units = COUNT_UNITS, as = WORKER, name = "count") => ({
  name,
  as,
  sql: "select public.wms_count_into_location($1, $2, $3, $4, 'Conteo de la carrera ocho')",
  args: [h.loc.get(code), h.offer("low").sku_id, h.offer("low").seller_id, units],
});

/**
 * A scenario: `prepare` builds the round and returns its context (with
 * `target`, the shelf code, and `before`, its units); `other` is the writer
 * raced against the count; `adds` says how many units the other writer puts on
 * the target shelf when it succeeds; `mayRefuse` the other writer's allowed
 * refusal.
 */
function scenario({ name, prepare, other, adds, mayRefuse = null, target = "W7-02" }) {
  return {
    name,
    products: ["low"],
    setup: async (h, round) => {
      const ctx = await prepare(h, round);
      await zeroRow(h, target);
      return { ...ctx, target, before: await shelf(h, target) };
    },
    actors: (h, ctx, round) => [
      { ...count(h, ctx.target), delayMs: round % 3 },
      { ...other(h, ctx), delayMs: (round >> 1) % 3 },
    ],
    verify: async (h, ctx, results) => {
      const bad = [];
      const c = results.find((r) => r.name === "count");
      const o = results.find((r) => r.name !== "count");
      if (c.outcome && c.outcome !== "count_already_listed")
        bad.push(`count refused with ${c.outcome}`);
      if (o.outcome && o.outcome !== mayRefuse) bad.push(`${o.name} refused with ${o.outcome}`);
      if (c.outcome && o.outcome) bad.push("both refused");
      const expected =
        ctx.before + (c.outcome ? 0 : COUNT_UNITS) + (o.outcome ? 0 : adds(ctx, results));
      const now = await shelf(h, ctx.target);
      if (now !== expected) bad.push(`${ctx.target} holds ${now}, expected ${expected}`);
      return bad;
    },
  };
}

const scenarios = [
  scenario({
    name: "I1 staff cancel of a picked order (2 units back onto W7-02) vs count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-02": 2 });
      const x = await h.cashInPicking(1, [["low", 2]], "all");
      return { x, orders: [x.order] };
    },
    other: (_h, ctx) => ({
      name: "cancel",
      as: STAFF,
      sql: "select public.cancel_order($1, 'Prueba de carrera ocho')",
      args: [ctx.x.order],
    }),
    adds: () => 2,
  }),
  scenario({
    name: "I1b shopper cancel of an order whose pick waits at W7-01 vs count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      const order = await h.place(2, [["low", 2]], "cash_on_delivery");
      return { order, orders: [order] };
    },
    other: (_h, ctx) => ({
      name: "shopper-cancel",
      as: SHOPPER(2),
      sql: "select public.cancel_order($1, 'Prueba de carrera ocho')",
      args: [ctx.order],
    }),
    adds: () => 0,
  }),
  scenario({
    name: "I2 wms_adjust_stock +2 at W7-02 vs count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      return { orders: [] };
    },
    other: (h) => ({
      name: "adjust",
      as: WORKER,
      sql: "select public.wms_adjust_stock($1, $2, $3, 2, 'Conteo de la carrera ocho', null)",
      args: [h.loc.get("W7-02"), h.offer("low").sku_id, h.offer("low").seller_id],
    }),
    adds: () => 2,
  }),
  scenario({
    name: "I3 wms_move_stock of 2 from W7-01 into W7-02 vs count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      return { orders: [] };
    },
    other: (h) => ({
      name: "move",
      as: WORKER,
      sql: "select public.wms_move_stock($1, $2, $3, $4, 2, null)",
      args: [
        h.loc.get("W7-01"),
        h.loc.get("W7-02"),
        h.offer("low").sku_id,
        h.offer("low").seller_id,
      ],
    }),
    adds: () => 2,
  }),
  scenario({
    name: "I4 wms_confirm_pick of the same product at W7-01 vs count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      const x = await h.cashInPicking(3, [["low", 2]], 0);
      return { x, orders: [x.order] };
    },
    other: (_h, ctx) => ({
      name: "pick",
      as: WORKER,
      sql: "select public.wms_confirm_pick($1, $2, null, $3)",
      args: [ctx.x.tasks[0].id, ctx.x.tasks[0].quantity, ctx.x.tasks[0].sku_code],
    }),
    adds: () => 0,
  }),
  {
    // Not through scenario(): W7-02 starts with the 2 units the open pick waits for.
    name: "I4b wms_confirm_pick of the pick waiting at W7-02 (all its units) vs count into W7-02",
    products: ["low"],
    setup: async (h) => {
      await h.layout(["low"], { "W7-02": 2 });
      const x = await h.cashInPicking(3, [["low", 2]], 0);
      return { x, target: "W7-02", orders: [x.order] };
    },
    actors: (h, ctx, round) => [
      { ...count(h, "W7-02"), delayMs: round % 3 },
      {
        name: "pick",
        as: WORKER,
        sql: "select public.wms_confirm_pick($1, $2, null, $3)",
        args: [ctx.x.tasks[0].id, ctx.x.tasks[0].quantity, ctx.x.tasks[0].sku_code],
        delayMs: (round >> 1) % 3,
      },
    ],
    verify: async (h, _ctx, results) => {
      const bad = [];
      const c = results.find((r) => r.name === "count");
      const p = results.find((r) => r.name === "pick");
      if (c.outcome && c.outcome !== "count_already_listed")
        bad.push(`count refused with ${c.outcome}`);
      if (p.outcome) bad.push(`pick refused with ${p.outcome}`);
      const expected = c.outcome ? 0 : COUNT_UNITS;
      const now = await shelf(h, "W7-02");
      if (now !== expected) bad.push(`W7-02 holds ${now}, expected ${expected}`);
      return bad;
    },
  },
  scenario({
    name: "I5 a second count (staff, 2 units) vs the worker's count into W7-02",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      return { orders: [] };
    },
    other: (h) => count(h, "W7-02", 2, STAFF, "count-2"),
    adds: () => 2,
    mayRefuse: "count_already_listed",
  }),
  scenario({
    name: "I7 wms_receive_returned_shipment (2 units into DEV-01) vs count into DEV-01",
    target: "DEV-01",
    prepare: async (h) => {
      await h.layout(["low"], { "W7-01": 10 });
      const x = await h.cashInPicking(4, [["low", 2]], "all");
      await h.call(WORKER, "select public.wms_pack_shipment($1, 900, 1::smallint)", [x.shipment]);
      await h.call(STAFF, "select public.ops_recall_shipment($1, 'Prueba de carrera ocho')", [
        x.shipment,
      ]);
      return { x, orders: [x.order] };
    },
    other: (_h, ctx) => ({
      name: "returned",
      as: WORKER,
      sql: "select public.wms_receive_returned_shipment($1, true, null)",
      args: [ctx.x.shipment],
    }),
    adds: () => 2,
  }),
];

/** Forced: the target shelf's row held FOR SHARE; one writer first, the other 40 ms late. */
function forced(sc, countFirst) {
  return {
    ...sc,
    name: `${sc.name} forced (${countFirst ? "count first" : "other first"})`,
    actors: (h, ctx) => {
      const [c, o] = sc.actors(h, ctx, 0);
      return countFirst
        ? [
            { ...c, delayMs: 0 },
            { ...o, delayMs: 40 },
          ]
        : [
            { ...o, delayMs: 0 },
            { ...c, delayMs: 40 },
          ];
    },
    options: (h, ctx) => {
      const o = h.offer("low");
      return {
        hold: {
          sql: `select 1 from public.bin_stock b
                 where b.location_id = $1 and b.sku_id = $2 and b.seller_id = $3 for share`,
          args: [h.loc.get(ctx.target), o.sku_id, o.seller_id],
        },
        holdMs: 150,
      };
    },
  };
}
for (const sc of [...scenarios]) scenarios.push(forced(sc, true), forced(sc, false));

main("I", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
