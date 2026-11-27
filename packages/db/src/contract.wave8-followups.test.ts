/**
 * The follow-ups of wave 8 (20261121085000_wave8_followups.sql), against a
 * seeded database, called the way the API calls them, with today's schemas
 * and with the store build's (commit 3f251c3, on testers' phones; copied word
 * for word below and compared with that commit's file when git can show it):
 *
 *   - cart_lines of an active offer whose product is archived: a visitor and
 *     another shopper get the id alone (buyable false, available 0, every
 *     other field null), which both schemas accept; the product's own shop
 *     and staff still get the whole line;
 *   - get_order of an order whose only parcel staff stopped before it left,
 *     after the warehouse checked it in: the shopper reads the new reason
 *     ("Los paquetes no salieron de la bodega", CANCEL_REASON.stopped), a
 *     string the store build reads as before;
 *   - get_order of an order the shopper cancelled through the API with a text
 *     of their own: the reason is the shopper's own sentence, not the text.
 *
 * What it leaves: a shopper of its own with two cancelled orders; the
 * archived product is made public again.
 */

import { execFileSync } from "node:child_process";
import { CANCEL_REASON, ORDER_STATUSES, SHIPMENT_STATUSES } from "@yuntera/core";
import { type Claims, callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { orderDetailWithRecall } from "./areas/order-followups";
import { contractDatabase } from "./contract.helpers";
import { cartLine as currentCartLine, orderDetail as currentOrderDetail } from "./schemas";

vi.setConfig({ testTimeout: 60_000 });

const db = contractDatabase();
const SHOPPER = "seguimiento-ola8@yuntera.example";
const PRODUCT = "taladro-inalambrico-roble-20v";
const OWN_SHOP = "vendedor@yuntera.example";

// ── The store build's schemas (commit 3f251c3, packages/db/src/schemas.ts) ──
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

describe.skipIf(!db.enabled)("wave 8 follow-ups contract (against a seeded database)", () => {
  let pool: pg.Pool;
  const ids = new Map<string, string>();

  async function rpc(email: string | null, fn: string, args: Record<string, unknown>) {
    const claims: Claims | null = email
      ? { sub: ids.get(email) ?? "", role: "authenticated", aal: "aal2" }
      : null;
    const result = await callRpc(pool, fn, args, claims);
    if (!result.ok) throw new Error(`${fn}: ${JSON.stringify(result.error)}`);
    return result.data;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await pool.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       select gen_random_uuid(), $1::text, '{"full_name": "Prueba Seguimiento Ola Ocho"}'
        where not exists (select 1 from auth.users where email = $1::text)`,
      [SHOPPER],
    );
    await pool.query(
      `insert into public.addresses (user_id, label, recipient_name, phone, postal_code, senas, lat, lng, is_default)
       select s.id, 'Casa', 'Prueba Seguimiento Ola Ocho', a.phone, a.postal_code, a.senas, a.lat, a.lng, true
         from auth.users s, public.addresses a join auth.users u on u.id = a.user_id
        where s.email = $1 and u.email = 'comprador@yuntera.example' and a.is_default and a.deleted_at is null
          and not exists (select 1 from public.addresses x where x.user_id = s.id and x.is_default and x.deleted_at is null)`,
      [SHOPPER],
    );
    await db.connect();
    const { rows } = await pool.query<{ email: string; id: string }>(
      "select email, id from auth.users where email like '%@yuntera.example'",
    );
    for (const row of rows) ids.set(row.email, row.id);
  });

  afterAll(async () => {
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
    for (const name of ["orderDetail", "cartLine"]) {
      const block = self.slice(
        self.indexOf(`// BEGIN 3f251c3 ${name}\n`) + `// BEGIN 3f251c3 ${name}\n`.length,
        self.indexOf(`// END 3f251c3 ${name}`),
      );
      expect(block.length).toBeGreaterThan(40);
      expect(original).toContain(block);
    }
  });

  it("answers a cart line of an archived product with its id alone, in both shapes", async () => {
    const { rows } = await db.query<{ id: string; title: string }>(
      `select o.id, p.title from public.offers o join public.skus k on k.id = o.sku_id
         join public.products p on p.id = k.product_id
        where p.slug = $1 and o.status = 'active' and p.status = 'active'
        order by o.id limit 1`,
      [PRODUCT],
    );
    const offer = rows[0];
    expect(offer, "the seed has an active offer of the drill").toBeDefined();
    if (!offer) return;
    await db.query("update public.products set status = 'archived' where slug = $1", [PRODUCT]);
    try {
      for (const who of [null, "comprador@yuntera.example", "cafetal@yuntera.example"]) {
        const answer = await rpc(who, "cart_lines", { p_offer_ids: [offer.id] });
        const [frozen] = z.array(cartLine).parse(answer);
        const [current] = z.array(currentCartLine).parse(answer);
        expect(frozen, who ?? "visitor").toEqual({
          offer_id: offer.id,
          buyable: false,
          product_slug: null,
          title: null,
          variant_name: null,
          image_path: null,
          seller_name: null,
          price_minor: null,
          list_price_minor: null,
          available: 0,
          fulfillment: null,
          handling_days: null,
        });
        expect(current?.buyable).toBe(false);
      }
      // A made-up id answers the same.
      const ghost = "00000000-0000-4000-8000-000000000085";
      const [unknown] = z
        .array(cartLine)
        .parse(await rpc(null, "cart_lines", { p_offer_ids: [ghost] }));
      expect(unknown).toMatchObject({ offer_id: ghost, buyable: false, title: null, available: 0 });
      // The product's own shop and staff still read the whole line.
      for (const who of [OWN_SHOP, "central@yuntera.example"]) {
        const [line] = z
          .array(currentCartLine)
          .parse(await rpc(who, "cart_lines", { p_offer_ids: [offer.id] }));
        expect(line?.buyable, who).toBe(false);
        expect(line?.title, who).toBe(offer.title);
        expect(line?.seller_name, who).not.toBeNull();
        expect(line?.price_minor, who).not.toBeNull();
      }
    } finally {
      await db.query("update public.products set status = 'active' where slug = $1", [PRODUCT]);
    }
  });

  async function paidOrder(key: string) {
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
    const placed = (await rpc(SHOPPER, "place_order", {
      p_items: [{ offer_id: offer, quantity: 1 }],
      p_address_id: address,
      p_payment_method: "card",
      p_idempotency_key: `ola8-${key}-${Date.now()}`,
    })) as { order_id: string; order_number: string };
    await rpc(SHOPPER, "confirm_sandbox_payment", { p_order_id: placed.order_id });
    return placed;
  }

  it("tells the shopper an order stopped before it left never left, in both shapes", async () => {
    const placed = await paidOrder("detenido");
    const shipment =
      (
        await db.query<{ id: string }>("select id from public.shipments where order_id = $1", [
          placed.order_id,
        ])
      ).rows[0]?.id ?? "";
    // Picked and packed in the warehouse, stopped by staff, checked in.
    await rpc("central@yuntera.example", "wms_start_picking", { p_shipment_id: shipment });
    const tasks = await db.query<{ id: string; quantity: number; code: string }>(
      `select t.id, t.quantity, k.code from public.pick_tasks t join public.skus k on k.id = t.sku_id
        where t.shipment_id = $1`,
      [shipment],
    );
    for (const task of tasks.rows) {
      await rpc("central@yuntera.example", "wms_confirm_pick", {
        p_task_id: task.id,
        p_quantity: task.quantity,
        p_location_id: null,
        p_code: task.code,
      });
    }
    await rpc("central@yuntera.example", "wms_pack_shipment", {
      p_shipment_id: shipment,
      p_weight_grams: 900,
      p_package_count: 1,
    });
    await rpc("central@yuntera.example", "ops_recall_shipment", {
      p_shipment_id: shipment,
      p_reason: "Nota interna de la prueba: lo pidió soporte",
    });
    await rpc("bodega@yuntera.example", "wms_receive_returned_shipment", {
      p_shipment_id: shipment,
      p_resellable: true,
      p_note: null,
    });

    const answer = await rpc(SHOPPER, "get_order", { p_order_number: placed.order_number });
    const frozen = orderDetail.parse(answer);
    currentOrderDetail.parse(answer);
    const withRecall = orderDetailWithRecall.parse(answer);
    expect(["cancelled", "refunded"]).toContain(frozen.status);
    expect(frozen.cancel_reason).toBe(CANCEL_REASON.stopped);
    expect(withRecall.shipments[0]?.recalled).toBe(true);
    expect(JSON.stringify(answer)).not.toContain("Nota interna");
  });

  it("keeps a shopper's own cancellation theirs, whatever text they sent", async () => {
    const placed = await paidOrder("propia");
    await rpc(SHOPPER, "cancel_order", {
      p_order_id: placed.order_id,
      p_reason: "Me arrepentí, lo vi más barato",
    });
    const answer = await rpc(SHOPPER, "get_order", { p_order_number: placed.order_number });
    const frozen = orderDetail.parse(answer);
    currentOrderDetail.parse(answer);
    expect(frozen.cancel_reason).toBe(CANCEL_REASON.shopper);
    expect(JSON.stringify(answer)).not.toContain("arrepentí");
  });
});
