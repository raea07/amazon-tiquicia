/**
 * System health and versions (20261121084800_system_health.sql), against a
 * seeded database, called the way the API calls them:
 *
 *   - ops_system_health answers an administrator in the shape of
 *     areas/system-health.ts, with every line, in good states and with the
 *     fields a bad state fills (a time, a pause's end, channel names);
 *   - health_ping answers a visitor with exactly {"ok": true};
 *   - ops_versions and ops_set_store_build answer an administrator and refuse
 *     a shopper; an invalid build is refused with its own code.
 *
 * What it changes and puts back: a WhatsApp pause and the invoice worker's
 * report are written and removed again; the phone build it records (an
 * unlikely version, 9.9.9) is deleted at the end.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HEALTH_LINE_KEYS } from "./areas/system-health";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();
const ADMIN = "central@yuntera.example";
const SHOPPER = "comprador@yuntera.example";

describe.skipIf(!db.enabled)("system health contract (against a seeded database)", () => {
  let hadHealth = false;

  beforeAll(async () => {
    await db.connect();
    hadHealth = (await db.query("select 1 from private.invoice_worker_health")).rowCount === 1;
  });

  afterAll(async () => {
    await db.query("delete from private.notify_channel_pauses where reason = 'contract-185'");
    if (!hadHealth) await db.query("delete from private.invoice_worker_health");
    await db.query("delete from private.store_builds where version = '9.9.9'");
    await db.close();
  });

  it("gives an administrator every line in the client's shape", async () => {
    const health = await db.as(ADMIN, "aal2").opsSystemHealth();
    expect(health.lines.map((line) => line.key).sort()).toEqual([...HEALTH_LINE_KEYS].sort());
    expect(health.jobs?.items).toHaveLength(7);
  });

  it("parses the fields a bad state fills", async () => {
    await db.query(
      `insert into private.notify_channel_pauses (channel, paused_until, reason)
       values ('whatsapp', now() + interval '1 hour', 'contract-185')
       on conflict (channel) do nothing`,
    );
    if (!hadHealth) {
      await db.query(
        `insert into private.invoice_worker_health (id, reported_at, certificate_not_after)
         values (true, now(), now() + interval '10 days')`,
      );
    }
    const health = await db.as(ADMIN, "aal2").opsSystemHealth();
    const late = health.lines.find((line) => line.key === "messages_late");
    expect(late?.state).toBe("problem");
    expect(late?.refs).toContain("whatsapp");
    expect(late?.until).toBeTruthy();
    const certificate = health.lines.find((line) => line.key === "invoice_certificate");
    expect(certificate?.until).toBeTruthy();
    expect(JSON.stringify(health)).not.toMatch(/@/);
  });

  it("answers a visitor's ping with nothing but ok", async () => {
    expect(await db.as().healthPing()).toEqual({ ok: true });
  });

  it("refuses the health page to a visitor and a shopper", async () => {
    await expect(db.as().opsSystemHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(db.as(SHOPPER).opsSystemHealth()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reads versions and records a phone build", async () => {
    const admin = db.as(ADMIN, "aal2");
    const before = await admin.opsVersions();
    expect(before.migration_history).toBe("available");
    expect((before.migration?.version ?? "") >= "20261121084800").toBe(true);
    const build = await admin.opsSetStoreBuild({
      app: "seller",
      platform: "ios",
      version: "9.9.9",
      buildNumber: 12,
      releasedOn: "2026-11-20",
      track: "internal",
    });
    expect(build).toMatchObject({ app: "seller", platform: "ios", build_number: 12 });
    const after = await admin.opsVersions();
    expect(after.store_builds.some((row) => row.id === build.id)).toBe(true);
  });

  it("refuses an invalid build and anyone but an administrator", async () => {
    const input = {
      app: "shop",
      platform: "android",
      version: "1.0",
      buildNumber: 1,
      releasedOn: "2026-11-20",
      track: "public",
    } as const;
    await expect(db.as(ADMIN, "aal2").opsSetStoreBuild(input)).rejects.toMatchObject({
      code: "store_build_invalid",
    });
    await expect(db.as(SHOPPER).opsVersions()).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      db.as(SHOPPER).opsSetStoreBuild({ ...input, version: "1.0.0" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
