import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApi, type RpcTransport } from "./api";
import { LOCK_CONFLICT_SQLSTATES } from "./areas/lock-conflicts";
import { ApiError, ERROR_MESSAGES, isErrorCode, messageFor, toApiError } from "./errors";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const sql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(`${migrationsDir}${file}`, "utf8"))
  .join("\n");

/** Every machine code the database can hand to a client. */
function codesRaisedBySql(): string[] {
  const found = new Set<string>();
  for (const pattern of [
    /private\.fail\('([a-z_]+)'/g, // application errors
    /message = '([a-z_]+)'/g, // raised directly by triggers
    /'error', '([a-z_]+)'/g, // door-side outcomes returned as data
  ]) {
    for (const match of sql.matchAll(pattern)) if (match[1]) found.add(match[1]);
  }
  // Codes the client gives PostgreSQL's own lock-conflict SQLSTATEs.
  for (const code of Object.values(LOCK_CONFLICT_SQLSTATES)) found.add(code);
  return [...found].sort();
}

describe("error messages", () => {
  const raised = codesRaisedBySql();

  it("finds the codes in the migrations", () => {
    // Guards the patterns above: if they stop matching, this suite proves nothing.
    expect(raised.length).toBeGreaterThan(70);
    expect(raised).toContain("insufficient_stock");
    expect(raised).toContain("wrong_pin");
    expect(raised).toContain("listing_needs_review");
  });

  it("has a message for every code the database can raise", () => {
    expect(raised.filter((code) => !isErrorCode(code))).toEqual([]);
  });

  it("has no message for a code that is never raised", () => {
    expect(Object.keys(ERROR_MESSAGES).filter((code) => !raised.includes(code))).toEqual([]);
  });

  it("writes every message in both languages, as a full sentence", () => {
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      for (const locale of ["es-CR", "en"] as const) {
        expect(text[locale].length, `${code} ${locale}`).toBeGreaterThan(12);
        expect(text[locale], `${code} ${locale}`).toMatch(/[.!]$/);
        // A person must never be shown the machine code itself.
        expect(text[locale], `${code} ${locale}`).not.toContain(code);
      }
    }
  });

  it("addresses the reader as usted, never tú or vos", () => {
    const informal =
      /\b(tú|tu pedido|tu cuenta|tus|vos|tenés|podés|querés|revisá|iniciá|elegí|escribí|puedes|tienes|quieres|revisa tu|inicia sesión)\b/i;
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      expect(text["es-CR"], code).not.toMatch(informal);
    }
  });
});

describe("toApiError", () => {
  it("recognises an application error and keeps its detail", () => {
    const error = toApiError({ code: "P0001", message: "price_changed", details: "1140000" }, 400);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("price_changed");
    expect(error.detail).toBe("1140000");
    expect(error.userMessage("en")).toMatch(/price changed/i);
  });

  it("treats a denied privilege as not signed in or forbidden", () => {
    expect(toApiError({ code: "42501", message: "permission denied" }, 401).code).toBe(
      "not_authenticated",
    );
    expect(toApiError({ code: "42501", message: "permission denied" }, 403).code).toBe("forbidden");
    expect(toApiError({ code: "PGRST301", message: "JWT expired" }, 401).code).toBe(
      "not_authenticated",
    );
  });

  it("never leaks raw database text to the user", () => {
    const error = toApiError(
      { code: "23505", message: 'duplicate key value violates unique constraint "orders_pkey"' },
      409,
    );
    expect(error.code).toBe("unknown");
    expect(error.userMessage("es-CR")).not.toMatch(/duplicate|constraint|orders_pkey/);
    expect(error.userMessage("es-CR")).toBe(messageFor("anything-unrecognised", "es-CR"));
  });

  it("does not trust an unknown code that arrives as P0001", () => {
    expect(toApiError({ code: "P0001", message: "<script>alert(1)</script>" }, 400).code).toBe(
      "unknown",
    );
  });
});

describe("createApi", () => {
  const transport = (response: Awaited<ReturnType<RpcTransport["rpc"]>>): RpcTransport => ({
    rpc: () => Promise.resolve(response),
  });

  it("omits undefined arguments so database defaults apply", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const api = createApi({
      rpc: (fn, args) => {
        calls.push([fn, args]);
        return Promise.resolve({ data: [], error: null });
      },
    });
    await api.searchProducts({ query: "cafe", limit: 5 });
    expect(calls).toEqual([["search_products", { p_query: "cafe", p_limit: 5 }]]);
  });

  it("throws ApiError for an error response", async () => {
    const api = createApi(
      transport({ data: null, error: { code: "P0001", message: "cart_empty" }, status: 400 }),
    );
    await expect(
      api.placeOrder({
        items: [],
        addressId: "00000000-0000-4000-8000-000000000000",
        paymentMethod: "card",
        idempotencyKey: "test-key-0001",
      }),
    ).rejects.toMatchObject({ code: "cart_empty", status: 400 });
  });

  it("reports a response of the wrong shape as a contract break", async () => {
    const api = createApi(transport({ data: [{ slug: 42 }], error: null }));
    await expect(api.listCategories()).rejects.toMatchObject({
      code: "invalid_response",
      detail: "list_categories",
    });
  });

  it("reports a thrown transport failure as a network error", async () => {
    const api = createApi({ rpc: () => Promise.reject(new TypeError("fetch failed")) });
    await expect(api.listCategories()).rejects.toMatchObject({ code: "network" });
  });

  it("maps the door-side outcomes of a delivery as data, not errors", async () => {
    const api = createApi(
      transport({ data: { ok: false, error: "wrong_pin", attempts_left: 3 }, error: null }),
    );
    const result = await api.driverCompleteStop({
      stopId: "00000000-0000-4000-8000-000000000000",
      pin: "0000",
      recipientName: "Ana",
    });
    expect(result).toEqual({ ok: false, error: "wrong_pin", attempts_left: 3 });
    expect(z.string().parse(messageFor("wrong_pin"))).toMatch(/código/);
  });
});
