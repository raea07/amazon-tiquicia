/**
 * Callers written for the definitions before wave 8 (migrations 084400 to
 * 084600), against the merged database.
 *
 *   - The store build of the shopper app (commit 3f251c3, on testers'
 *     phones). Of the 29 database functions it calls, five run code that
 *     wave 8 changed: cancel_order (private.cancel_order_internal, 084400),
 *     place_order and confirm_sandbox_payment (the stock triggers that refresh
 *     a product's summary, 084400), and get_order and cart_lines (redefined
 *     directly in 084600; cart_lines now names the product of a paused
 *     offer, read here with both the store build's and today's schema).
 *     Their answers, and get_order and my_orders
 *     of an order cancelled for no payment (whose reason the new screens now
 *     show) and of one staff cancelled with their own note (whose reason
 *     get_order, since 084600, gives the shopper as null), parse with that
 *     commit's schemas, frozen below and compared word
 *     for word with that commit's file when git can show it.
 *   - The web apps of commit 717048f (on the hosted preview until the next
 *     deploy). Their schemas for these functions are the ones in
 *     packages/db/src/areas/seller-listings.ts and api.ts, unchanged since
 *     717048f: seller_set_variant_active (redefined in 084400) answers in that
 *     shape. cart_alternatives with only the offer ids (084600) is checked in
 *     contract.shopper-followups.test.ts; seller_mark_packed and
 *     driver_start_route (084400) answer nothing and take the same arguments,
 *     and are called by contract.stock-product-races.test.ts.
 *
 * What it leaves: a shopper of its own with three cancelled orders; the variant
 * it switches off is switched on again.
 */

import { execFileSync } from "node:child_process";
import { CANCEL_REASON, ORDER_STATUSES, SHIPMENT_STATUSES } from "@yuntera/core";
import { callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { variantChange } from "./areas/seller-listings";
import { contractDatabase } from "./contract.helpers";
import { cartLine as currentCartLine } from "./schemas";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const SHOPPER = "llamadas-viejas@yuntera.example";
const SELLER = "sendero@yuntera.example";

// ── The store build's schemas (commit 3f251c3, packages/db/src/schemas.ts) ──
// Copied word for word; the first test compares them with that commit's file.
const id = z.uuid();
const money = z.number().int();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(10);
const orderStatus = z.enum(ORDER_STATUSES);
const shipmentStatus = z.enum(SHIPMENT_STATUSES);
const paymentMethod = z.enum(["card", "sinpe_movil", "cash_on_delivery", "bank_transfer"]);
const paymentStatus = z.enum([
  "pending",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
const fulfillment = z.enum(["platform", "seller"]);
// BEGIN 3f251c3 orderSummary
export const orderSummary = z.object({
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  total_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  delivered_at: timestamp.nullable(),
  item_count: z.number().int(),
  first_title: z.string().nullable(),
  first_image_path: z.string().nullable(),
});
// END 3f251c3 orderSummary
// BEGIN 3f251c3 orderDetail
export const orderDetail = z.object({
  id,
  order_number: z.string(),
  status: orderStatus,
  placed_at: timestamp,
  confirmed_at: timestamp.nullable(),
  delivered_at: timestamp.nullable(),
  cancelled_at: timestamp.nullable(),
  cancel_reason: z.string().nullable(),
  items_total_minor: money,
  shipping_minor: money,
  discount_minor: money,
  total_minor: money,
  tax_included_minor: money,
  payment_method: paymentMethod,
  promise_earliest: date,
  promise_latest: date,
  withdrawal_deadline: date,
  warranty_until: date.nullable(),
  /** Present only while there is still something to hand over. */
  delivery_pin: z.string().nullable(),
  can_cancel: z.boolean(),
  address: z.object({
    recipient_name: z.string(),
    phone: z.string(),
    postal_code: z.string(),
    senas: z.string(),
    lat: z.number(),
    lng: z.number(),
    plus_code: z.string().nullable(),
    district: z.string().nullable(),
    canton: z.string().nullable(),
  }),
  payment: z
    .object({
      method: paymentMethod,
      status: paymentStatus,
      amount_minor: money,
      provider: z.string(),
      sinpe_reference: z.string().nullable(),
      captured_at: timestamp.nullable(),
    })
    .nullable(),
  items: z.array(
    z.object({
      id,
      title: z.string(),
      variant_name: z.string(),
      image_path: z.string().nullable(),
      product_slug: z.string().nullable(),
      seller_name: z.string().nullable(),
      unit_price_minor: money,
      quantity: z.number().int(),
      line_total_minor: money,
      fulfillment,
      review: z
        .object({
          rating: z.number().int(),
          title: z.string().nullable(),
          body: z.string().nullable(),
        })
        .nullable(),
      returned_quantity: z.number().int(),
    }),
  ),
  shipments: z.array(
    z.object({
      id,
      tracking_code: z.string(),
      status: shipmentStatus,
      package_count: z.number().int(),
      attempt_count: z.number().int(),
      promise_latest: date,
      delivered_at: timestamp.nullable(),
      item_ids: z.array(id).nullable(),
      driver_first_name: z.string().nullable(),
    }),
  ),
  timeline: z.array(
    z.object({
      at: timestamp,
      kind: z.enum(["order_status", "shipment_status", "payment", "note"]),
      from_status: z.string().nullable(),
      to_status: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
// END 3f251c3 orderDetail
// BEGIN 3f251c3 placedOrder
export const placedOrder = z.object({
  order_id: id,
  order_number: z.string(),
  status: orderStatus,
  total_minor: money,
  shipping_minor: money.optional(),
  promise_earliest: date.optional(),
  promise_latest: date.optional(),
  sinpe_reference: z.string().nullable().optional(),
  replayed: z.boolean(),
});
// END 3f251c3 placedOrder
// BEGIN 3f251c3 orderAction
export const orderAction = z.object({ order_id: id, status: orderStatus });
// END 3f251c3 orderAction
// BEGIN 3f251c3 cartLine
export const cartLine = z.object({
  offer_id: id,
  buyable: z.boolean(),
  product_slug: z.string().nullable(),
  title: z.string().nullable(),
  variant_name: z.string().nullable(),
  image_path: z.string().nullable(),
  seller_name: z.string().nullable(),
  price_minor: money.nullable(),
  list_price_minor: money.nullable(),
  available: z.number().int(),
  fulfillment: fulfillment.nullable(),
  handling_days: z.number().int().nullable(),
});
// END 3f251c3 cartLine

describe.skipIf(!db.enabled)("callers of before wave 8 (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();

  async function rpc(email: string, fn: string, args: Record<string, unknown>) {
    const result = await callRpc(pool, fn, args, {
      sub: ids.get(email) ?? "",
      role: "authenticated",
      aal: "aal2",
    });
    if (!result.ok) throw new Error(`${fn}: ${JSON.stringify(result.error)}`);
    return result.data;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await pool.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       select gen_random_uuid(), $1::text, '{"full_name": "Prueba Llamadas Viejas"}'
        where not exists (select 1 from auth.users where email = $1::text)`,
      [SHOPPER],
    );
    await pool.query(
      `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select s.id, 'Casa', 'Prueba Llamadas Viejas', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
         from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
        where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
          and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
      [SHOPPER],
    );
    await db.connect();
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email = any($1)",
      [[SHOPPER, SELLER]],
    );
    for (const row of rows) ids.set(row.email, row.id);
  });

  afterAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select o.id from public.orders o join auth.users u on u.id = o.user_id
        where u.email = $1
          and o.status in ('pending_payment', 'payment_review', 'confirmed', 'processing')`,
      [SHOPPER],
    );
    for (const row of rows) {
      await pool.query("select private.cancel_order_internal($1, 'Prueba de contrato')", [row.id]);
    }
    await pool?.end();
    await db.close();
  });

  it("keeps the store build's schemas word for word", () => {
    let original = "";
    try {
      original = execFileSync("git", ["show", "3f251c3:packages/db/src/schemas.ts"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // A checkout without that commit (a shallow clone): the copy stands as written.
      return;
    }
    const self = execFileSync("cat", [__filename], { encoding: "utf8" });
    for (const name of ["orderSummary", "orderDetail", "placedOrder", "orderAction", "cartLine"]) {
      const block = self.slice(
        self.indexOf(`// BEGIN 3f251c3 ${name}\n`) + `// BEGIN 3f251c3 ${name}\n`.length,
        self.indexOf(`// END 3f251c3 ${name}`),
      );
      expect(block.length).toBeGreaterThan(40);
      expect(original).toContain(block);
    }
  });

  it("answers the store build's checkout, payment, cancellation and order pages in its shape", async () => {
    const offer =
      (
        await db.query<{ id: string }>(
          `select o.id from public.offers o join public.skus k on k.id = o.sku_id
             join public.products p on p.id = k.product_id
            where p.slug = 'libreta-tapa-dura-a5' and o.fulfillment = 'platform' and o.status = 'active'`,
        )
      ).rows[0]?.id ?? "";
    const address =
      (
        await db.query<{ id: string }>(
          `select a.id from public.addresses a join auth.users u on u.id = a.user_id
            where u.email = $1 and a.is_default and a.deleted_at is null`,
          [SHOPPER],
        )
      ).rows[0]?.id ?? "";
    const place = (key: string) =>
      rpc(SHOPPER, "place_order", {
        p_items: [{ offer_id: offer, quantity: 1 }],
        p_address_id: address,
        p_payment_method: "sinpe_movil",
        p_idempotency_key: `llamadas-viejas-${key}-${Date.now()}`,
      });

    // Paid in the simulation, then cancelled by the shopper (before picking).
    const paid = placedOrder.parse(await place("pagado"));
    orderAction.parse(await rpc(SHOPPER, "confirm_sandbox_payment", { p_order_id: paid.order_id }));
    const cancelled = orderAction.parse(
      await rpc(SHOPPER, "cancel_order", {
        p_order_id: paid.order_id,
        p_reason: CANCEL_REASON.shopper,
      }),
    );
    expect(["cancelled", "refunded"]).toContain(cancelled.status);

    // Cancelled the way the unpaid-order sweep cancels it.
    const unpaid = placedOrder.parse(await place("sin-pago"));
    await db.query("select private.cancel_order_internal($1, $2)", [
      unpaid.order_id,
      CANCEL_REASON.unpaid,
    ]);
    const detail = orderDetail.parse(
      await rpc(SHOPPER, "get_order", { p_order_number: unpaid.order_number }),
    );
    expect(detail.status).toBe("cancelled");
    expect(detail.cancel_reason).toBe(CANCEL_REASON.unpaid);

    // Cancelled by staff with their own note: since 084600 the shopper gets
    // null for it, which the store build's schema accepts.
    const staffed = placedOrder.parse(await place("personal"));
    await db.query("select private.cancel_order_internal($1, $2)", [
      staffed.order_id,
      "Nota interna de la prueba: lo decidió soporte",
    ]);
    const staffedDetail = orderDetail.parse(
      await rpc(SHOPPER, "get_order", {
        p_order_number: staffed.order_number,
      }),
    );
    expect(staffedDetail.cancel_reason).toBeNull();

    const list = z
      .array(orderSummary)
      .parse(await rpc(SHOPPER, "my_orders", { p_limit: 50, p_offset: 0 }));
    expect(list.map((o) => o.order_number)).toEqual(
      expect.arrayContaining([paid.order_number, unpaid.order_number, staffed.order_number]),
    );
  });

  it("answers the store build's and the 717048f web shop's cart in their shape, naming a paused offer's product", async () => {
    // A product no other test touches, so pausing its only offer for a moment
    // disturbs nothing else.
    const { rows } = await db.query<{ id: string; title: string }>(
      `select o.id, p.title from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = 'jabon-artesanal-avena-miel-3u' and o.status = 'active'
        order by o.id limit 1`,
    );
    const offer = rows[0];
    expect(offer, "the seed has an active offer of the soap").toBeDefined();
    if (!offer) return;
    const live = z
      .array(cartLine)
      .parse(await rpc(SHOPPER, "cart_lines", { p_offer_ids: [offer.id] }));
    expect(live[0]?.buyable).toBe(true);
    await db.query("update public.offers set status = 'paused' where id = $1", [offer.id]);
    try {
      const answer = await rpc(SHOPPER, "cart_lines", { p_offer_ids: [offer.id] });
      const [frozen] = z.array(cartLine).parse(answer);
      const [current] = z.array(currentCartLine).parse(answer);
      expect(frozen?.buyable).toBe(false);
      expect(frozen?.title).toBe(offer.title);
      expect(frozen?.seller_name).toBeNull();
      expect(frozen?.price_minor).toBeNull();
      expect(current?.title).toBe(offer.title);
    } finally {
      await db.query("update public.offers set status = 'active' where id = $1", [offer.id]);
    }
  });

  it("answers the 717048f seller centre's variant switch in its shape", async () => {
    const sku =
      (
        await db.query<{ id: string }>(
          `select k.id from public.skus k join public.products p on p.id = k.product_id
             join public.sellers s on s.id = p.created_by_seller_id
            where s.slug = 'tienda-sendero' and p.status = 'active' and k.active
              and (select count(*) from public.skus x where x.product_id = p.id and x.active) >= 2
            order by k.id limit 1`,
        )
      ).rows[0]?.id ?? "";
    expect(sku, "the seed has a listing of Tienda Sendero with two variants").not.toBe("");
    const off = variantChange.parse(
      await rpc(SELLER, "seller_set_variant_active", { p_sku_id: sku, p_active: false }),
    );
    try {
      expect(["variant_off", "offer_paused"]).toContain(off.outcome);
    } finally {
      const on = variantChange.parse(
        await rpc(SELLER, "seller_set_variant_active", { p_sku_id: sku, p_active: true }),
      );
      expect(["variant_on", "offer_resumed"]).toContain(on.outcome);
    }
  });
});
