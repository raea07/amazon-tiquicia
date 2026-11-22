/**
 * Contract tests for the native-accounts area: the settings saved from the
 * shopper and seller apps answer the notifications schemas, with the consent
 * recorded as given in the app. The settings and consent records they write
 * are removed at the end; the consent log is append-only and keeps its rows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import type { ApiError } from "./errors";

const db = contractDatabase();
const SHOPPER = "comprador3@yuntera.example";
const OWNER = "vendedor@yuntera.example";

describe.skipIf(!db.enabled)("native-accounts contract", () => {
  let shopper = "";
  let shop = "";
  let logBefore = 0;

  beforeAll(async () => {
    await db.connect();
    shopper = (
      await db.query<{ id: string }>("select id from auth.users where email = $1", [SHOPPER])
    ).rows[0]?.id as string;
    shop = (
      await db.query<{ seller_id: string }>(
        `select m.seller_id from public.seller_members m join auth.users u on u.id = m.user_id
         where u.email = $1 and m.role = 'owner' order by m.seller_id limit 1`,
        [OWNER],
      )
    ).rows[0]?.seller_id as string;
    logBefore = Number(
      (
        await db.query<{ max: string }>(
          "select coalesce(max(id), 0) as max from private.commercial_consent_log",
        )
      ).rows[0]?.max,
    );
  });

  afterAll(async () => {
    // The consent log is append-only (a trigger refuses deletes): its rows
    // stay, as after any consent; the tests read only rows after `logBefore`.
    await db.query(
      `delete from private.notification_preferences where user_id = $1 or seller_id = $2`,
      [shopper, shop],
    );
    await db.query(
      `delete from public.consents where user_id = $1 and purpose = 'marketing' and policy_version = 'comercial-2026-11'`,
      [shopper],
    );
    await db.query(`update public.profiles set marketing_opt_in = false where id = $1`, [shopper]);
    await db.close();
  });

  it("saves a shopper's settings from the app, recording the consent as given there", async () => {
    const api = db.as(SHOPPER);
    const saved = await api.setMyNotificationSettingsFrom("shop_app", {
      email: true,
      whatsapp: true,
      sms: false,
      push: true,
      phone: "8702 3456",
      commercial: true,
    });
    expect(saved.whatsapp_enabled).toBe(true);
    expect(saved.phone).toBe("+50687023456");
    expect(saved.commercial).toMatchObject({ opt_in: true, source: "shop_app" });
    const withdrawn = await api.setMyNotificationSettingsFrom("shop_app", {
      email: true,
      whatsapp: false,
      sms: false,
      push: true,
      commercial: false,
      version: saved.version,
    });
    expect(withdrawn.commercial.opt_in).toBe(false);
    const { rows } = await db.query<{ entry: string }>(
      `select action || ':' || source as entry from private.commercial_consent_log
       where user_id = $1 and id > $2 order by id`,
      [shopper, logBefore],
    );
    expect(rows.map((row) => row.entry)).toEqual(["granted:shop_app", "withdrawn:shop_app"]);
  });

  it("saves a shop's settings from the seller app, recording the consent as given there", async () => {
    const api = db.as(OWNER);
    // Start without consent (the seed gives none; another run may have).
    await api.sellerSetNotificationSettingsFrom("seller_app", shop, {
      whatsapp: false,
      push: true,
      commercial: false,
    });
    const saved = await api.sellerSetNotificationSettingsFrom("seller_app", shop, {
      whatsapp: false,
      push: true,
      commercial: true,
    });
    expect(saved.can_edit).toBe(true);
    expect(saved.commercial).toMatchObject({ opt_in: true, source: "seller_app" });
    const { rows } = await db.query<{ entry: string }>(
      `select action || ':' || source as entry from private.commercial_consent_log
       where seller_id = $1 and id > $2 and action = 'granted' order by id`,
      [shop, logBefore],
    );
    expect(rows.map((row) => row.entry)).toEqual(["granted:seller_app"]);
  });

  it("refuses another audience's place", async () => {
    await expect(
      db
        .as(SHOPPER)
        // @ts-expect-error: a shopper cannot name the seller app
        .setMyNotificationSettingsFrom("seller_app", {
          email: true,
          whatsapp: false,
          sms: false,
          push: true,
        }),
    ).rejects.toMatchObject({ code: "notify_consent_invalid" } satisfies Partial<ApiError>);
  });
});
