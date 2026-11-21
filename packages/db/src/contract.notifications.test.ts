/**
 * Contract tests for the notifications area: the real functions' answers
 * match the client's schemas, per role. Planning is done the way the worker
 * does it (as the service role), and undone at the end so the database is
 * left as the seed made it.
 */

import { callRpc } from "@yuntera/dev-api/rpc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();

describe.skipIf(!db.enabled)("notifications contract", () => {
  let pool: pg.Pool;
  let orderNumber = "";

  beforeAll(async () => {
    await db.connect();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const planned = await callRpc(
      pool,
      "worker_notify_plan",
      { p_limit: 1000 },
      { sub: "", role: "service_role" },
    );
    expect(planned.ok).toBe(true);
    const { rows } = await db.query<{ order_number: string }>(
      `select o.order_number from public.orders o join auth.users u on u.id = o.user_id
       where u.email = 'comprador@yuntera.example' order by o.placed_at limit 1`,
    );
    orderNumber = rows[0]?.order_number ?? "";
  });

  afterAll(async () => {
    // Put the queue and the shopper's choices back as the seed left them.
    await db.query(`delete from private.notification_deliveries`);
    await db.query(
      `update private.outbox_jobs set status = 'pending', attempts = 0, done_at = null where consumer = 'notify'`,
    );
    await db.query(`delete from private.notification_preferences`);
    await db.query(
      `delete from private.push_tokens where expo_token like 'ExponentPushToken[contract%'`,
    );
    await pool.end();
    await db.close();
  });

  it("returns a shopper's settings and saves them", async () => {
    const api = db.as("comprador2@yuntera.example");
    const before = await api.myNotificationSettings();
    expect(before.commercial.opt_in).toBe(false);
    const after = await api.setMyNotificationSettings({
      email: true,
      whatsapp: true,
      sms: false,
      push: true,
      phone: "8701 2345",
    });
    expect(after.phone).toBe("+50687012345");
    const consented = await api.setMyCommercialConsent(true);
    expect(consented.commercial.opt_in).toBe(true);
    expect(consented.commercial.text_version).toBe("comercial-2026-11");
    expect((await api.setMyCommercialConsent(false)).commercial.opt_in).toBe(false);
  });

  it("saves channels and consent together, and refuses a save from an out-of-date page", async () => {
    const api = db.as("comprador2@yuntera.example");
    const loaded = await api.myNotificationSettings();
    const saved = await api.setMyNotificationSettings({
      email: true,
      whatsapp: false,
      sms: false,
      push: true,
      phone: loaded.phone,
      commercial: true,
      version: loaded.version,
    });
    expect(saved.commercial.opt_in).toBe(true);
    expect(saved.version).toBeGreaterThan(loaded.version);
    await expect(
      api.setMyNotificationSettings({
        email: true,
        whatsapp: true,
        sms: false,
        push: true,
        phone: loaded.phone,
        commercial: false,
        version: loaded.version,
      }),
    ).rejects.toMatchObject({ code: "notify_settings_changed" });
    expect((await api.myNotificationSettings()).commercial.opt_in).toBe(true);
    await api.setMyCommercialConsent(false);
  });

  it("refuses a visitor", async () => {
    await expect(db.as().myNotificationSettings()).rejects.toBeInstanceOf(ApiError);
  });

  it("registers and removes the caller's own push token", async () => {
    const api = db.as("comprador3@yuntera.example");
    await api.registerPushToken({
      app: "shop",
      token: "ExponentPushToken[contract-0001]",
      platform: "ios",
    });
    expect((await api.myNotificationSettings()).push_devices).toBe(1);
    await expect(
      db.as("comprador2@yuntera.example").unregisterPushToken("ExponentPushToken[contract-0001]"),
    ).rejects.toMatchObject({ code: "push_token_not_found" });
    await api.unregisterPushToken("ExponentPushToken[contract-0001]");
    expect((await api.myNotificationSettings()).push_devices).toBe(0);
  });

  it("returns a shop's settings to its members", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.sellers where slug = 'tecnocasa'`,
    );
    const shop = rows[0]?.id ?? "";
    const settings = await db.as("vendedor@yuntera.example").sellerNotificationSettings(shop);
    expect(settings.can_edit).toBe(true);
    expect(settings.email_locked).toBe(true);
    const saved = await db
      .as("vendedor@yuntera.example")
      .sellerSetNotificationSettings(shop, { whatsapp: false, push: true, commercial: false });
    expect(saved.push_enabled).toBe(true);
    expect(saved.sms_enabled).toBe(false);
    await expect(
      db.as("comprador@yuntera.example").sellerNotificationSettings(shop),
    ).rejects.toMatchObject({ code: "seller_not_found" });
  });

  it("shows staff an order's messages and the dead letters, never their content", async () => {
    const staff = db.as("central@yuntera.example");
    const rows = await staff.opsOrderNotifications(orderNumber);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).not.toHaveProperty("request_body");
    const dead = await staff.opsNotificationDeadLetters();
    expect(dead.dead_count).toBe(0);
    expect(dead.failed_count).toBe(0);
    await expect(
      db.as("comprador@yuntera.example").opsOrderNotifications(orderNumber),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("lists a message the provider failed after accepting it, and retries it", async () => {
    const { rows } = await db.query<{ id: string }>(
      `update private.notification_deliveries set status = 'failed', last_error_code = 'undeliverable'
       where id = (select id from private.notification_deliveries order by created_at desc limit 1) returning id`,
    );
    const staff = db.as("central@yuntera.example");
    const dead = await staff.opsNotificationDeadLetters();
    expect(dead.failed_count).toBe(1);
    expect(dead.items.find((row) => row.id === rows[0]?.id)?.status).toBe("failed");
    expect((await staff.opsRetryNotification(rows[0]?.id ?? "")).status).toBe("pending");
  });

  it("retries a dead letter", async () => {
    const { rows } = await db.query<{ id: string }>(
      `update private.notification_deliveries set status = 'dead', last_error_code = '422'
       where id = (select id from private.notification_deliveries order by created_at limit 1) returning id`,
    );
    const retried = await db.as("central@yuntera.example").opsRetryNotification(rows[0]?.id ?? "");
    expect(retried.status).toBe("pending");
    expect(retried.generation).toBe(1);
  });
});
