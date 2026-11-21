import { describe, expect, it } from "vitest";
import { redirectFor } from "./auth/redirect.ts";

const SITE = "https://www.yuntera.cr";
const LIST = ["https://vende.yuntera.cr/auth/confirm", "https://*-yuntera.vercel.app/**"];

describe("where an e-mail link may point", () => {
  it("keeps an address on the site's own host", () => {
    expect(redirectFor("https://www.yuntera.cr/auth/confirm", SITE, [])).toBe(
      "https://www.yuntera.cr/auth/confirm",
    );
  });

  it("keeps an address on the allow-list, exactly or by pattern", () => {
    expect(redirectFor("https://vende.yuntera.cr/auth/confirm", SITE, LIST)).toBe(
      "https://vende.yuntera.cr/auth/confirm",
    );
    expect(redirectFor("https://pr-12-yuntera.vercel.app/auth/confirm", SITE, LIST)).toBe(
      "https://pr-12-yuntera.vercel.app/auth/confirm",
    );
  });

  it("falls back to the site URL for anything else", () => {
    expect(redirectFor("https://evil.example/x", SITE, LIST)).toBe(SITE);
    expect(redirectFor("https://vende.yuntera.cr.evil.example/auth/confirm", SITE, LIST)).toBe(
      SITE,
    );
    expect(redirectFor("javascript:alert(1)", SITE, LIST)).toBe(SITE);
    expect(redirectFor("not a url", SITE, LIST)).toBe(SITE);
    expect(redirectFor(null, SITE, LIST)).toBe(SITE);
  });
});
