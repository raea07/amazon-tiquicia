import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signOnvoWebhook, TOLERANCE_SECONDS, verifyOnvoSignature } from "./signature.ts";

const SECRET = "whsec_test_one";
const OTHER = "whsec_test_two";
const BODY = '{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_1"}}}';
const NOW = 1_785_758_400;

/** The note's own algorithm, written independently with Node's crypto. */
const reference = (secret: string, t: number, body: string) =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(`${t}.${body}`).digest("hex");

describe("ONVO webhook signatures (note §6.6)", () => {
  it("signs t + '.' + raw body with HMAC-SHA256 of the whole whsec_ secret, in hex", async () => {
    const header = await signOnvoWebhook(BODY, [SECRET], NOW);
    expect(header).toBe(`t=${NOW},v1=${reference(SECRET, NOW, BODY)}`);
  });

  it("accepts a valid signature", async () => {
    const header = `t=${NOW},v1=${reference(SECRET, NOW, BODY)}`;
    expect(await verifyOnvoSignature(BODY, header, [SECRET], NOW + 10)).toEqual({
      ok: true,
      timestamp: NOW,
    });
  });

  it("accepts spaces around the parts and upper-case hex", async () => {
    const header = ` t=${NOW} , v1=${reference(SECRET, NOW, BODY).toUpperCase()}`;
    expect((await verifyOnvoSignature(BODY, header, [SECRET], NOW)).ok).toBe(true);
  });

  it("refuses a tampered body, even by one character or re-serialised JSON", async () => {
    const header = await signOnvoWebhook(BODY, [SECRET], NOW);
    expect(await verifyOnvoSignature(BODY.replace("pi_1", "pi_2"), header, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
    expect((await verifyOnvoSignature(reserialised, header, [SECRET], NOW)).ok).toBe(false);
  });

  it("refuses a tampered timestamp", async () => {
    const header = (await signOnvoWebhook(BODY, [SECRET], NOW)).replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect((await verifyOnvoSignature(BODY, header, [SECRET], NOW)).ok).toBe(false);
  });

  it("refuses the wrong secret", async () => {
    const header = await signOnvoWebhook(BODY, [OTHER], NOW);
    expect(await verifyOnvoSignature(BODY, header, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a stale or future timestamp beyond 300 seconds", async () => {
    const header = await signOnvoWebhook(BODY, [SECRET], NOW);
    expect((await verifyOnvoSignature(BODY, header, [SECRET], NOW + TOLERANCE_SECONDS)).ok).toBe(
      true,
    );
    expect(await verifyOnvoSignature(BODY, header, [SECRET], NOW + TOLERANCE_SECONDS + 1)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verifyOnvoSignature(BODY, header, [SECRET], NOW - TOLERANCE_SECONDS - 1)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("refuses a missing or malformed header, and an endpoint with no secret", async () => {
    expect(await verifyOnvoSignature(BODY, null, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(await verifyOnvoSignature(BODY, `v1=${"a".repeat(64)}`, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyOnvoSignature(BODY, `t=abc,v1=${"a".repeat(64)}`, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyOnvoSignature(BODY, `t=${NOW}`, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyOnvoSignature(BODY, `t=${NOW},v1=zz`, [SECRET], NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const header = await signOnvoWebhook(BODY, [SECRET], NOW);
    expect(await verifyOnvoSignature(BODY, header, [], NOW)).toEqual({
      ok: false,
      reason: "no_secret",
    });
  });

  it("during a rotation: two v1 values from the gateway, either of two secrets here", async () => {
    // The gateway signs with old and new; we still hold only the old one.
    const both = await signOnvoWebhook(BODY, [OTHER, SECRET], NOW);
    expect(both.split(",").filter((part) => part.startsWith("v1=")).length).toBe(2);
    expect((await verifyOnvoSignature(BODY, both, [SECRET], NOW)).ok).toBe(true);
    // We hold both while the gateway already signs with the new one only.
    const onlyNew = await signOnvoWebhook(BODY, [OTHER], NOW);
    expect((await verifyOnvoSignature(BODY, onlyNew, [SECRET, OTHER], NOW)).ok).toBe(true);
    // A secret neither side shares.
    expect((await verifyOnvoSignature(BODY, onlyNew, [SECRET, "whsec_third"], NOW)).ok).toBe(false);
  });
});
