import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  newSecret,
  otpauthUri,
  STEP_SECONDS,
  stepAt,
  totpCode,
  verifyTotp,
} from "./totp.ts";

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips bytes and matches RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw6ytboi======").toString()).toBe("foobar");
  });

  it("makes 32-character secrets from 20 random bytes", () => {
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newSecret()).not.toBe(secret);
  });
});

describe("codes", () => {
  it("matches the RFC 4226 test values", () => {
    const key = Buffer.from("12345678901234567890", "ascii");
    expect([0, 1, 2, 9].map((counter) => hotp(key, counter))).toEqual([
      "755224",
      "287082",
      "359152",
      "520489",
    ]);
  });

  it("matches the RFC 6238 test values (last six of the eight digits)", () => {
    expect(totpCode(RFC_SECRET, 59, 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, 1111111109, 8)).toBe("07081804");
    expect(totpCode(RFC_SECRET, 2000000000, 8)).toBe("69279037");
    expect(totpCode(RFC_SECRET, 59)).toBe("287082");
  });
});

describe("verification", () => {
  const now = 1_795_300_000;
  const secret = newSecret();

  it("accepts the current step and the one before and after", () => {
    for (const offset of [-1, 0, 1]) {
      const code = totpCode(secret, now + offset * STEP_SECONDS);
      expect(verifyTotp(secret, code, now), `offset ${offset}`).toBe(stepAt(now) + offset);
    }
  });

  it("refuses codes two steps away", () => {
    for (const offset of [-2, 2]) {
      const code = totpCode(secret, now + offset * STEP_SECONDS);
      // A different step could collide by chance (1 in a million); this secret is random.
      if (code === totpCode(secret, now)) continue;
      expect(verifyTotp(secret, code, now), `offset ${offset}`).toBeNull();
    }
  });

  it("refuses a code from a step already used, and older ones", () => {
    const code = totpCode(secret, now);
    const used = verifyTotp(secret, code, now);
    expect(used).toBe(stepAt(now));
    expect(verifyTotp(secret, code, now, used)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now - STEP_SECONDS), now, used)).toBeNull();
    // The next step is still accepted.
    expect(verifyTotp(secret, totpCode(secret, now + STEP_SECONDS), now, used)).toBe(
      stepAt(now) + 1,
    );
  });

  it("refuses anything that is not six digits", () => {
    expect(verifyTotp(secret, "", now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "12 345", now)).toBeNull();
  });
});

it("builds the otpauth address Auth returns", () => {
  expect(otpauthUri("Yuntera", "ana@example.com", "ABC")).toBe(
    "otpauth://totp/Yuntera:ana%40example.com?algorithm=SHA1&digits=6&issuer=Yuntera&period=30&secret=ABC",
  );
});
