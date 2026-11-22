import { describe, expect, it } from "vitest";
import {
  ACTIVITY_COOKIE,
  accountHash,
  activityValue,
  addressHash,
  checkSecret,
  clientAddress,
  endedSessionMessage,
  guardKey,
  isKnownDevice,
  isLocalRun,
  LOCAL_GUARD_KEY,
  limitMessage,
  normaliseAddress,
  readActivity,
  rememberDevice,
  SESSION_POLICIES,
  sessionPolicy,
  sessionVerdict,
  signedInAt,
} from "./guard";

const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
const DEPLOYED = {
  VERCEL: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SITE_URL: "https://www.yuntera.cr",
};
const headers = (entries: Record<string, string>) => new Headers(entries);

describe("WEB-2: which header says who the visitor is", () => {
  it("on Vercel, trusts the header Vercel writes itself", () => {
    const request = headers({
      "x-vercel-forwarded-for": "198.51.100.23",
      "x-forwarded-for": "203.0.113.9, 198.51.100.23",
      "x-real-ip": "198.51.100.23",
    });
    expect(clientAddress(request, DEPLOYED)).toBe("198.51.100.23");
  });

  it("on Vercel, falls back to x-real-ip, never to what the visitor wrote in x-forwarded-for", () => {
    expect(clientAddress(headers({ "x-real-ip": "198.51.100.24" }), DEPLOYED)).toBe(
      "198.51.100.24",
    );
    expect(clientAddress(headers({ "x-forwarded-for": "203.0.113.9" }), DEPLOYED)).toBeNull();
  });

  it("elsewhere, trusts nothing unless the operator names the header", () => {
    const request = headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" });
    expect(clientAddress(request, LOCAL)).toBeNull();
    expect(
      clientAddress(request, { ...LOCAL, NEXT_PUBLIC_SITE_URL: "https://shop.example" }),
    ).toBeNull();
  });

  it("behind a named proxy, takes the entry that proxy wrote, not the visitor's", () => {
    const request = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.10" });
    const env = { ...LOCAL, AUTH_CLIENT_IP_HEADER: "X-Forwarded-For" };
    expect(clientAddress(request, env)).toBe("203.0.113.10");
    // Two proxies of ours: the second from the right.
    const two = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.11, 10.0.0.2" });
    expect(clientAddress(two, { ...env, AUTH_CLIENT_IP_HOPS: "2" })).toBe("203.0.113.11");
  });

  it("refuses anything that is not an address", () => {
    expect(normaliseAddress("unknown")).toBeNull();
    expect(normaliseAddress("")).toBeNull();
    expect(normaliseAddress("1.2.3.4; drop table")).toBeNull();
  });

  it("counts an IPv6 subscriber by its /64 and an IPv4 address written as IPv6 as IPv4", () => {
    expect(normaliseAddress("2001:db8:1234:5678:aaaa::1")).toBe("2001:0db8:1234:5678::/64");
    expect(normaliseAddress("2001:db8:1234:5678:bbbb::2")).toBe("2001:0db8:1234:5678::/64");
    expect(normaliseAddress("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normaliseAddress("[2001:db8::1]")).toBe("2001:0db8:0000:0000::/64");
    expect(normaliseAddress("198.51.100.7:51234")).toBe("198.51.100.7");
  });
});

describe("WEB-2: only keyed hashes are stored", () => {
  it("hashes an address and an account with the key, never in clear", () => {
    const a = addressHash("key-one", "198.51.100.7");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("198");
    expect(addressHash("key-two", "198.51.100.7")).not.toBe(a);
  });

  it("counts an e-mail the same however it was typed", () => {
    expect(accountHash("k", " Ana@Correo.Example ")).toBe(accountHash("k", "ana@correo.example"));
    expect(accountHash("k", "ana@correo.example")).not.toBe(addressHash("k", "ana@correo.example"));
  });

  it("recognises a browser that signed in to the account before, and nothing else", () => {
    const account = accountHash("k", "ana@correo.example");
    const other = accountHash("k", "beto@correo.example");
    const cookie = rememberDevice("k", undefined, account);
    expect(isKnownDevice("k", cookie, account)).toBe(true);
    expect(isKnownDevice("k", cookie, other)).toBe(false);
    expect(isKnownDevice("another key", cookie, account)).toBe(false);
    expect(isKnownDevice("k", "forged.value", account)).toBe(false);
    expect(isKnownDevice("k", undefined, account)).toBe(false);
    // Up to three accounts per browser, the latest first.
    const both = rememberDevice("k", cookie, other);
    expect(isKnownDevice("k", both, account)).toBe(true);
    expect(isKnownDevice("k", both, other)).toBe(true);
    expect(both.split(".")).toHaveLength(2);
  });
});

describe("WEB-2: what the person is told", () => {
  it("says when to try again, in Spanish, and points to the reset", () => {
    const text = limitMessage("sign_in", 840);
    expect(text).toContain("14 minutos");
    expect(text).toContain("Olvidé mi contraseña");
    expect(limitMessage("code", 45)).toContain("45 segundos");
    expect(limitMessage("sign_up", 3600)).toContain("60 minutos");
  });

  it("never says whether the account exists or which limit was reached", () => {
    for (const action of ["sign_in", "sign_up", "email", "code", "reauth"] as const) {
      const text = limitMessage(action, 60);
      expect(text).not.toMatch(/cuenta (no )?existe|no tiene cuenta|esta dirección|su red/i);
    }
  });
});

describe("WEB-8: server-only keys", () => {
  it("knows a local run from a deployment, and counts anything unsure as deployed", () => {
    expect(isLocalRun(LOCAL)).toBe(true);
    expect(isLocalRun({ ...LOCAL, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe(true);
    expect(isLocalRun(DEPLOYED)).toBe(false);
    expect(isLocalRun({ ...LOCAL, VERCEL: "1" })).toBe(false);
    expect(isLocalRun({ ...LOCAL, NEXT_PUBLIC_SITE_URL: "https://www.yuntera.cr" })).toBe(false);
    expect(isLocalRun({})).toBe(false);
  });

  it("refuses the example values and short keys when deployed", () => {
    for (const value of [
      "local-development-only",
      "LOCAL-DEVELOPMENT-ONLY",
      "local-refresh-key-lane-3",
      "short",
      "",
      undefined,
    ]) {
      expect(checkSecret("SHOP_REFRESH_KEY", value, DEPLOYED).ok, String(value)).toBe(false);
    }
    const strong = "5f0c9d7e2b4a41c88d3e6a1b9f7c2d40e8a6b3c1";
    expect(checkSecret("SHOP_REFRESH_KEY", strong, DEPLOYED)).toEqual({ ok: true, value: strong });
  });

  it("never names the value in the reason it gives", () => {
    const result = checkSecret("SHOP_REFRESH_KEY", "local-development-only", DEPLOYED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("local-development-only");
  });

  it("accepts the readable local values on a developer's machine", () => {
    expect(checkSecret("SHOP_REFRESH_KEY", "local-development-only", LOCAL).ok).toBe(true);
    expect(guardKey(LOCAL)).toEqual({ ok: true, value: LOCAL_GUARD_KEY });
    expect(guardKey(DEPLOYED).ok).toBe(false);
    expect(guardKey({ ...DEPLOYED, AUTH_GUARD_KEY: LOCAL_GUARD_KEY }).ok).toBe(false);
  });
});

describe("WEB-5: session lifetimes", () => {
  it("gives the staff console and the field app a short life, the shop and sellers a longer one", () => {
    expect(SESSION_POLICIES.ops.maxAgeSeconds).toBe(12 * 3600);
    expect(SESSION_POLICIES.ops.idleSeconds).toBe(30 * 60);
    expect(SESSION_POLICIES.field.maxAgeSeconds).toBe(12 * 3600);
    expect(SESSION_POLICIES.seller.maxAgeSeconds).toBe(30 * 86400);
    expect(SESSION_POLICIES.web.maxAgeSeconds).toBe(90 * 86400);
    // None keeps @supabase/ssr's 400 days.
    for (const policy of Object.values(SESSION_POLICIES)) {
      expect(policy.maxAgeSeconds).toBeLessThan(400 * 86400);
    }
  });

  it("gives an app that does not say which it is the strictest rule", () => {
    expect(sessionPolicy(undefined)).toEqual(SESSION_POLICIES.ops);
    expect(sessionPolicy("shop")).toEqual(SESSION_POLICIES.ops);
  });

  it("reads the sign-in time from Auth's signed amr claim", () => {
    expect(
      signedInAt({
        amr: [
          { method: "totp", timestamp: 2000 },
          { method: "password", timestamp: 1000 },
        ],
      }),
    ).toBe(1000);
    expect(signedInAt({})).toBeNull();
    expect(signedInAt({ amr: [{ method: "password" }] })).toBeNull();
  });

  it("ends a session past its lifetime, and one without a sign-in time", () => {
    const ops = SESSION_POLICIES.ops;
    const start = 1_000_000;
    expect(sessionVerdict(ops, start, start, start + 60)).toBe("ok");
    expect(sessionVerdict(ops, start, start + 12 * 3600, start + 12 * 3600 + 1)).toBe("expired");
    expect(sessionVerdict(ops, null, null, start)).toBe("expired");
  });

  it("ends a console session idle for more than half an hour, but not a shop session", () => {
    const start = 1_000_000;
    expect(sessionVerdict(SESSION_POLICIES.ops, start, start + 60, start + 60 + 30 * 60)).toBe(
      "ok",
    );
    expect(sessionVerdict(SESSION_POLICIES.ops, start, start + 60, start + 61 + 30 * 60)).toBe(
      "idle",
    );
    // Without an activity cookie, the sign-in counts as the last activity.
    expect(sessionVerdict(SESSION_POLICIES.ops, start, null, start + 31 * 60)).toBe("idle");
    expect(sessionVerdict(SESSION_POLICIES.web, start, null, start + 5 * 86400)).toBe("ok");
  });

  it("trusts an activity cookie only when signed for this session", () => {
    const value = activityValue("k", "session-a", 1234);
    expect(readActivity("k", "session-a", value)).toBe(1234);
    expect(readActivity("k", "session-b", value)).toBeNull();
    expect(readActivity("other", "session-a", value)).toBeNull();
    expect(readActivity("k", "session-a", "9999999999.deadbeef")).toBeNull();
    expect(readActivity("k", "session-a", value.replace("1234", "9999"))).toBeNull();
    expect(ACTIVITY_COOKIE).toBe("yt-actividad");
  });

  it("tells the person why they must sign in again, with a way back", () => {
    expect(endedSessionMessage("idle")).toContain("sin actividad");
    expect(endedSessionMessage("expired")).toContain("tiempo máximo");
    expect(endedSessionMessage("idle")).toContain("seguir donde estaba");
    expect(endedSessionMessage(undefined)).toBeNull();
    expect(endedSessionMessage("anything")).toBeNull();
  });
});
