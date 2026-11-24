/*
 * Family H: a shop packing a parcel it ships itself (public.seller_mark_packed)
 * against everything that can meet it on the same order, parcel, stock row or
 * offer at that moment.
 *
 *   node race-h-seller-pack.cjs <database-url> [rounds] [scenario-regex]
 *
 * Fixture: product W of the harness (lib.cjs, FIXTURE), one variant that Tienda
 * Sendero ships from its own warehouse ("ws", fulfilment 'seller'), 50 units
 * free before every round, so the offer never crosses zero. Each round places a
 * cash-on-delivery order of 1 unit of ws (shopper 1): the order is confirmed and
 * its parcel waits at the shop (pending), which is what seller_mark_packed packs.
 *
 *   H1  staff cancelling the order (cancel_order as central@) vs the shop packing it;
 *   H1b the shopper cancelling it (cancel_order as the shopper) vs the shop packing it;
 *   H2  another shopper's checkout of ws (stock row, then offer) vs the pack;
 *   H3  the shop counting its stock of ws (seller_set_stock) vs the pack;
 *   H4  the unpaid-order sweep releasing an expired card order of ws vs the pack;
 *   H5  the same order's other parcel (x1, from SJO1) packed by the warehouse
 *       (wms_pack_shipment, order first) vs the shop packing its parcel;
 *   H6  the shop pausing its offer of ws (seller_update_offer) vs the pack;
 *   H7  for comparison, the warehouse packing a picked parcel of x1 from SJO1
 *       (wms_pack_shipment, order first since 084200) vs staff cancelling its order;
 *   H8  the shop switching off the variant of ws (seller_set_variant_active: the
 *       variant FOR UPDATE, then its offers) vs the pack (offer row, then a key
 *       share on the variant for its ledger row): the E10 mechanism, which the
 *       order lock does not touch.
 *
 * H7's check is the same as H1's on its own parcel, plus x1's stock row
 * (reserved = active reservations, available = on_hand - reserved).
 *
 * Allowed outcomes: H1/H1b either the pack wins (parcel packed, the unit leaves
 * stock, the cancellation is refused: too_late_to_cancel) or the cancellation
 * wins (order and parcel cancelled, the unit back in stock, the pack refused:
 * invalid_shipment_state). Every other pair: both succeed. Wrong: a deadlock, a
 * timeout, any other refusal, a stock row whose on_hand or reserved does not
 * follow (on_hand = 50 less the units packed, or the count's 60 less them;
 * reserved = active reservations; available = on_hand - reserved), an order
 * that check() finds wrong, a product summary that differs from one computed
 * from scratch.
 *
 * "forced": a third session holds one row before the barrier opens and lets go
 * 150 ms after; the actor named first queues on it, the other starts 40 ms late.
 *   H1/H1b forced-order:    the order FOR UPDATE; the cancellation first, the pack 40 ms late.
 *   H1/H1b forced-parcel:   the parcel FOR SHARE; the pack first, the cancellation 40 ms late.
 *   H2/H3/H4 forced-stock:  the stock row of ws FOR SHARE; the pack first.
 *   H5 forced-order:        the order FOR UPDATE; the warehouse pack first.
 *   H6 forced-offer:        the offer row of ws FOR SHARE; the pack first.
 *   H7 forced-order / forced-parcel: as H1.
 *   H8 forced-offer:        as H6.
 */
"use strict";
const { main, STAFF, WORKER, SHOPPER } = require("./lib.cjs");

const SELLER = "sendero@yuntera.example";
const FREE = 50;

async function sellerParcel(h, order) {
  return (
    await h.q("select id from public.shipments where order_id = $1 and origin_warehouse_id = $2", [
      order,
      h.sellerWarehouseId,
    ])
  ).rows[0]?.id;
}

/** A confirmed cash order of 1 unit of ws (shopper 1), its parcel pending at the shop. */
async function codOrder(h, extra = []) {
  await h.ownFixture();
  await h.sellerStock("ws", FREE);
  const order = await h.place(1, [["ws", 1], ...extra], "cash_on_delivery");
  const parcel = await sellerParcel(h, order);
  const state = (
    await h.q(
      "select o.status::text as o, s.status::text as s from public.orders o join public.shipments s on s.order_id = o.id where s.id = $1",
      [parcel],
    )
  ).rows[0];
  if (!parcel || state.o !== "confirmed" || state.s !== "pending")
    throw new Error(`fixture: order ${state?.o}, parcel ${state?.s}`);
  return { order, parcel, orders: [order] };
}

const pack = (ctx) => ({
  name: "pack",
  as: SELLER,
  sql: "select public.seller_mark_packed($1, 900, 1::smallint)",
  args: [ctx.parcel],
});

/**
 * What every round must leave: the stock row of ws follows the round (on_hand
 * is the 50 free units less what was packed: a reservation or a release does
 * not move it), the orders are right (check()), W's summary too.
 */
async function stockAndSummary(h, ctx, { counted = false } = {}) {
  const bad = [];
  const st = await h.stockOf("ws");
  const packed = (
    await h.q(
      `select coalesce(sum(res.quantity), 0)::int as n
         from public.inventory_reservations res join public.order_items i on i.id = res.order_item_id
        where i.order_id = $1 and res.status = 'consumed' and res.warehouse_id = $2`,
      [ctx.order, h.sellerWarehouseId],
    )
  ).rows[0].n;
  // A count sets on_hand to 60: before the pack (then 59) or after it (60).
  const expect = counted ? [60, 60 - packed] : [FREE - packed];
  if (!expect.includes(st.on_hand))
    bad.push(`ws: on_hand ${st.on_hand}, expected ${expect.join(" or ")} (packed ${packed})`);
  if (st.reserved !== st.active)
    bad.push(`ws: reserved ${st.reserved} <> active reservations ${st.active}`);
  if (st.available !== st.on_hand - st.reserved)
    bad.push(`ws: available ${st.available} <> on_hand - reserved ${st.on_hand - st.reserved}`);
  bad.push(...(await h.summaryCheck(h.fixtureProducts)));
  return bad;
}

function allowed(results, refusals) {
  const bad = [];
  for (const r of results) {
    if (!r.outcome) continue;
    if (r.outcome === "DEADLOCK" || r.outcome === "SERIALIZATION") continue; // counted by the tally
    if (!(refusals[r.name] || []).some((re) => re.test(r.outcome)))
      bad.push(`${r.name} refused: ${r.outcome}`);
  }
  return bad;
}

async function cancelVerify(h, ctx, results) {
  const bad = allowed(results, {
    pack: [/invalid_shipment_state/],
    cancel: [/too_late_to_cancel/],
  });
  const p = results.find((r) => r.name === "pack");
  const c = results.find((r) => r.name === "cancel");
  const s = (
    await h.q(
      "select s.status::text as parcel, o.status::text as ord from public.shipments s join public.orders o on o.id = s.order_id where s.id = $1",
      [ctx.parcel],
    )
  ).rows[0];
  if (!p.outcome && !c.outcome) bad.push("both the pack and the cancellation succeeded");
  if (!p.outcome && s.parcel !== "packed") bad.push(`pack accepted, parcel ${s.parcel}`);
  if (!c.outcome && (s.parcel !== "cancelled" || s.ord !== "cancelled"))
    bad.push(`cancel accepted, parcel ${s.parcel}, order ${s.ord}`);
  bad.push(...(await stockAndSummary(h, ctx)));
  return bad;
}

const cancelBy = (who) => (ctx) => ({
  name: "cancel",
  as: who,
  sql: "select public.cancel_order($1, 'Prueba de carrera ocho')",
  args: [ctx.order],
});

const holdOrder = (_h, ctx) => ({
  hold: { sql: "select 1 from public.orders where id = $1 for update", args: [ctx.order] },
  holdMs: 150,
});
const holdParcel = (_h, ctx) => ({
  hold: { sql: "select 1 from public.shipments where id = $1 for share", args: [ctx.parcel] },
  holdMs: 150,
});
const holdStock = (h) => ({
  hold: {
    sql: "select 1 from public.stock_levels where warehouse_id = $1 and sku_id = $2 and seller_id = $3 for share",
    args: [h.sellerWarehouseId, h.offer("ws").sku_id, h.offer("ws").seller_id],
  },
  holdMs: 150,
});
const holdOffer = (h) => ({
  hold: { sql: "select 1 from public.offers where id = $1 for share", args: [h.offer("ws").id] },
  holdMs: 150,
});

/** Natural: both let go together, one of them up to 4 ms late, varied by round. Forced: `first` queues first. */
function family(name, def, forced) {
  const out = [
    {
      ...def,
      name: `${name} natural`,
      actors: (h, ctx, round) =>
        def
          .actors(h, ctx)
          .map((a, i) => (i === round % 2 ? { ...a, delayMs: Math.floor(round / 2) % 5 } : a)),
    },
  ];
  for (const [label, hold, first] of forced) {
    out.push({
      ...def,
      name: `${name} ${label}`,
      actors: (h, ctx) =>
        def.actors(h, ctx).map((a, i) => (i !== first ? { ...a, delayMs: 40 } : a)),
      options: hold,
    });
  }
  return out;
}

const scenarios = [
  ...family(
    "H1 staff cancel_order vs seller_mark_packed of the same order",
    {
      setup: (h) => codOrder(h),
      actors: (_h, ctx) => [cancelBy(STAFF)(ctx), pack(ctx)],
      verify: cancelVerify,
    },
    [
      ["forced-order", holdOrder, 0],
      ["forced-parcel", holdParcel, 1],
    ],
  ),
  ...family(
    "H1b shopper cancel_order vs seller_mark_packed of the same order",
    {
      setup: (h) => codOrder(h),
      actors: (_h, ctx) => [cancelBy(SHOPPER(1))(ctx), pack(ctx)],
      verify: cancelVerify,
    },
    [
      ["forced-order", holdOrder, 0],
      ["forced-parcel", holdParcel, 1],
    ],
  ),
  ...family(
    "H2 place_order of ws vs seller_mark_packed",
    {
      setup: (h) => codOrder(h),
      actors: (h, ctx) => [pack(ctx), { ...h.placeArgs(2, [["ws", 1]], "card"), name: "checkout" }],
      verify: async (h, ctx, results) => [
        ...allowed(results, {}),
        ...(await stockAndSummary(h, ctx)),
      ],
    },
    [["forced-stock", holdStock, 0]],
  ),
  ...family(
    "H3 seller_set_stock of ws vs seller_mark_packed",
    {
      setup: (h) => codOrder(h),
      actors: (h, ctx) => [
        pack(ctx),
        {
          name: "count",
          as: SELLER,
          sql: "select public.seller_set_stock($1, $2, 60)",
          args: [h.sellerWarehouseId, h.offer("ws").sku_id],
        },
      ],
      verify: async (h, ctx, results) => [
        ...allowed(results, {}),
        ...(await stockAndSummary(h, ctx, { counted: true })),
      ],
    },
    [["forced-stock", holdStock, 0]],
  ),
  ...family(
    "H4 sweep releasing an expired card order of ws vs seller_mark_packed",
    {
      setup: async (h) => {
        const ctx = await codOrder(h);
        const unpaid = await h.place(3, [["ws", 1]], "card");
        await h.expire([unpaid], 120);
        return { ...ctx, unpaid, orders: [...ctx.orders, unpaid] };
      },
      actors: (_h, ctx) => [
        pack(ctx),
        { name: "sweep", as: null, sql: "select private.expire_unpaid_orders() as n", args: [] },
      ],
      verify: async (h, ctx, results) => {
        const bad = allowed(results, {});
        const st = (await h.q("select status::text from public.orders where id = $1", [ctx.unpaid]))
          .rows[0].status;
        if (!results[1].outcome && st !== "cancelled") bad.push(`sweep ran, expired order ${st}`);
        bad.push(...(await stockAndSummary(h, ctx)));
        return bad;
      },
    },
    [["forced-stock", holdStock, 0]],
  ),
  ...family(
    "H5 wms_pack_shipment of the order's SJO1 parcel vs seller_mark_packed of its shop parcel",
    {
      setup: async (h) => {
        await h.ownFixture();
        await h.layout(["x1"], { "W7-01": 200 });
        const ctx = await codOrder(h, [["x1", 1]]);
        const sjo = await h.shipmentOf(ctx.order);
        await h.startPicking(sjo);
        for (const t of await h.tasks(sjo)) await h.pick(t);
        return { ...ctx, sjo };
      },
      actors: (_h, ctx) => [
        {
          name: "wms-pack",
          as: WORKER,
          sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
          args: [ctx.sjo],
        },
        pack(ctx),
      ],
      products: ["x1"],
      verify: async (h, ctx, results) => {
        const bad = allowed(results, {});
        const st = (
          await h.q(
            "select o.status::text as o, array_agg(s.status::text order by s.id) as s from public.orders o join public.shipments s on s.order_id = o.id where o.id = $1 group by o.status",
            [ctx.order],
          )
        ).rows[0];
        if (
          results.every((r) => !r.outcome) &&
          (st.o !== "processing" || st.s.some((x) => x !== "packed"))
        )
          bad.push(`both packed, order ${st.o}, parcels ${st.s}`);
        bad.push(...(await stockAndSummary(h, ctx)));
        return bad;
      },
    },
    [["forced-order", holdOrder, 0]],
  ),
  ...family(
    "H6 seller pausing its offer of ws vs seller_mark_packed",
    {
      setup: (h) => codOrder(h),
      actors: (h, ctx) => [
        pack(ctx),
        {
          name: "pause",
          as: SELLER,
          sql: "select public.seller_update_offer($1, 1100000, 'paused')",
          args: [h.offer("ws").id],
        },
      ],
      verify: async (h, ctx, results) => {
        const bad = allowed(results, {});
        bad.push(...(await stockAndSummary(h, ctx)));
        await h.q("update public.offers set status = 'active' where id = $1", [h.offer("ws").id]);
        return bad;
      },
    },
    [["forced-offer", holdOffer, 0]],
  ),
  ...family(
    "H7 staff cancel_order vs wms_pack_shipment of the same order (warehouse, picked)",
    {
      products: ["x1"],
      setup: async (h) => {
        await h.ownFixture();
        await h.layout(["x1"], { "W7-01": 200 });
        const x = await h.cashInPicking(1, [["x1", 1]], "all");
        return { order: x.order, parcel: x.shipment, orders: [x.order] };
      },
      actors: (_h, ctx) => [
        cancelBy(STAFF)(ctx),
        {
          name: "pack",
          as: WORKER,
          sql: "select public.wms_pack_shipment($1, 900, 1::smallint)",
          args: [ctx.parcel],
        },
      ],
      verify: async (h, ctx, results) => {
        const bad = allowed(results, {
          pack: [/invalid_shipment_state/],
          cancel: [/too_late_to_cancel/],
        });
        const p = results.find((r) => r.name === "pack");
        const c = results.find((r) => r.name === "cancel");
        const s = (
          await h.q(
            "select s.status::text as parcel, o.status::text as ord from public.shipments s join public.orders o on o.id = s.order_id where s.id = $1",
            [ctx.parcel],
          )
        ).rows[0];
        if (!p.outcome && !c.outcome) bad.push("both the pack and the cancellation succeeded");
        if (!p.outcome && s.parcel !== "packed") bad.push(`pack accepted, parcel ${s.parcel}`);
        if (!c.outcome && (s.parcel !== "cancelled" || s.ord !== "cancelled"))
          bad.push(`cancel accepted, parcel ${s.parcel}, order ${s.ord}`);
        const st = await h.stockOf("x1");
        if (st.reserved !== st.active)
          bad.push(`x1: reserved ${st.reserved} <> active reservations ${st.active}`);
        if (st.available !== st.on_hand - st.reserved)
          bad.push(`x1: available ${st.available} <> on_hand - reserved`);
        bad.push(...(await h.summaryCheck(h.fixtureProducts)));
        return bad;
      },
    },
    [
      ["forced-order", holdOrder, 0],
      ["forced-parcel", holdParcel, 1],
    ],
  ),
  ...family(
    "H8 the shop switching off variant W (seller_set_variant_active) vs seller_mark_packed",
    {
      // A product's last variant cannot be switched off (last_variant), so W
      // gets a second variant (no offer) for this scenario.
      setup: async (h) => {
        const ctx = await codOrder(h);
        await h.q(
          `insert into public.skus (id, product_id, code, variant_name, weight_grams, length_cm, width_cm, height_cm)
           values ('e8000000-0000-4000-8000-000000000302', $1, 'CARRERA-W2', 'Dos', 500, 20, 15, 10)
           on conflict (id) do update set active = true`,
          [h.offer("ws").product_id],
        );
        return ctx;
      },
      actors: (h, ctx) => [
        pack(ctx),
        {
          name: "variant-off",
          as: SELLER,
          sql: "select public.seller_set_variant_active($1, false)",
          args: [h.offer("ws").sku_id],
        },
      ],
      verify: async (h, ctx, results) => {
        const bad = allowed(results, {});
        bad.push(...(await stockAndSummary(h, ctx)));
        await h.q("update public.skus set active = true where id = $1", [h.offer("ws").sku_id]);
        await h.q("update public.offers set status = 'active' where id = $1", [h.offer("ws").id]);
        return bad;
      },
    },
    [["forced-offer", holdOffer, 0]],
  ),
];

main("H", scenarios).catch((e) => {
  console.error(e);
  process.exit(1);
});
