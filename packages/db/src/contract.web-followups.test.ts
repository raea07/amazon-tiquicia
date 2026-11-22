/**
 * Contract tests for the apps' own sign-in limit (WEB-2): the answers of the
 * real database functions match the schemas in areas/web-followups.ts when
 * called the way the apps call them (as a visitor), a malformed request gets a
 * typed refusal, and what the tests reserve they delete again.
 */

import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();
/** A fresh 64-hex digest, standing for a keyed hash the apps would compute. */
const digest = () => createHash("sha256").update(randomBytes(16)).digest("hex");

describe.skipIf(!db.enabled)("web follow-ups contract (against a seeded database)", () => {
  const made: string[] = [];

  beforeAll(db.connect);
  afterAll(async () => {
    await db.query("delete from private.auth_attempts where id = any($1::uuid[])", [made]);
    await db.close();
  });

  it("WEB-2: reserves an attempt for a visitor, then refuses with the time to wait", async () => {
    const visitor = db.as();
    const address = digest();
    const account = digest();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const reservation = await visitor.authLimitReserve({
        action: "sign_in",
        addressHash: address,
        accountHash: account,
      });
      expect(reservation.retry_after_seconds).toBe(0);
      expect(reservation.attempt_id).toMatch(/^[0-9a-f-]{36}$/);
      made.push(reservation.attempt_id ?? "");
    }
    const refused = await visitor.authLimitReserve({
      action: "sign_in",
      addressHash: digest(),
      accountHash: account,
    });
    expect(refused.attempt_id).toBeNull();
    expect(refused.retry_after_seconds).toBeGreaterThan(800);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(900);

    // The same account from a browser that signed in to it before.
    const known = await visitor.authLimitReserve({
      action: "sign_in",
      addressHash: digest(),
      accountHash: account,
      knownDevice: true,
    });
    expect(known.attempt_id).not.toBeNull();
    made.push(known.attempt_id ?? "");
  });

  it("WEB-2: gives a successful attempt back", async () => {
    const visitor = db.as();
    const reservation = await visitor.authLimitReserve({
      action: "code",
      addressHash: digest(),
      accountHash: digest(),
    });
    expect(reservation.attempt_id).not.toBeNull();
    await visitor.authLimitRelease(reservation.attempt_id ?? "");
    const { rows } = await db.query("select 1 from private.auth_attempts where id = $1", [
      reservation.attempt_id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("WEB-2: refuses a refresh without an address, as a typed error", async () => {
    const error = await db
      .as()
      .authLimitReserve({ action: "refresh", addressHash: null, accountHash: digest() })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invalid_limit_request");
  });

  it("WEB-2: refuses anything but a digest before it reaches the database", () => {
    expect(() =>
      db
        .as()
        .authLimitReserve({ action: "sign_in", addressHash: "203.0.113.7", accountHash: null }),
    ).toThrow();
  });
});
