import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkoutEvent,
  databaseError,
  FORBIDDEN,
  orderPageEvent,
  PERSON,
  signInEvent,
  staffCustomerEvent,
} from "./fixtures";
import {
  databaseFacts,
  MAX_TEXT,
  pathOnly,
  redactText,
  scrubEvent,
  type TrackerEvent,
} from "./scrub";

const OPTIONS = {
  app: "web" as const,
  environment: "preview",
  release: "yuntera-web@0123456789ab",
};

/** Fails with the first forbidden string found anywhere in what would be sent. */
function expectClean(event: TrackerEvent | null) {
  const sent = JSON.stringify(event);
  for (const word of FORBIDDEN) expect(sent, `"${word}" was sent`).not.toContain(word);
  expect(sent).not.toMatch(/\?[\w%-]+=/);
  return sent;
}

describe("redactText: each rule", () => {
  it("removes e-mail addresses", () => {
    expect(redactText("para ana.prueba@example.com y JOSÉ_99@correo.co.cr")).toBe(
      "para [email] y [email]",
    );
  });

  it("removes Costa Rican phone numbers in every common form", () => {
    for (const phone of [
      "8888-1234",
      "88881234",
      "+506 8888-1234",
      "506-88881234",
      "00506 2222 3333",
      "6012.3456",
    ]) {
      expect(redactText(`tel ${phone} fin`), phone).toBe("tel [phone] fin");
    }
  });

  it("leaves numbers that are not phones: years, amounts in céntimos, short counts", () => {
    expect(redactText("año 2026, total 125000, 3 unidades, línea 42")).toBe(
      "año 2026, total 125000, 3 unidades, línea 42",
    );
  });

  it("removes identity numbers, bank accounts and card numbers", () => {
    expect(redactText("cédula 1-0234-0567")).toBe("cédula [number]");
    expect(redactText("cédula 102340567")).toBe("cédula [number]");
    expect(redactText("jurídica 3-101-123456")).toBe("jurídica [number]");
    expect(redactText("DIMEX 155812345678")).toBe("DIMEX [number]");
    expect(redactText("IBAN CR05015202001026284066")).toBe("IBAN [number]");
    expect(redactText("tarjeta 4111 1111 1111 1111")).toBe("tarjeta [number]");
  });

  it("removes the delivery code next to the word for it, on either side, 4 to 6 digits", () => {
    expect(redactText("código de entrega 4821")).toBe("código de entrega [code]");
    expect(redactText("Su codigo: 739204")).toBe("Su codigo: [code]");
    expect(redactText("delivery code 4821")).toBe("delivery code [code]");
    expect(redactText("4821 es su código")).toBe("[code] es su código");
    expect(redactText("PIN 4821")).toBe("PIN [code]");
    // A number far from the word, or a year, stays.
    expect(redactText("pedido 2026")).toBe("pedido 2026");
  });

  it("removes tokens, keys and secrets given by name", () => {
    expect(redactText(`Bearer ${PERSON.jwt}`)).toBe("Bearer [token]");
    expect(redactText(PERSON.jwt)).toBe("[token]");
    expect(redactText("key sb_publishable_abc123_def")).toBe("key [key]");
    expect(redactText("password=hunter2 and token: abc.def")).toBe(
      "password=[filtered] and token: [filtered]",
    );
    expect(redactText(`refresh ${PERSON.refreshToken}`)).toBe("refresh [token]");
    expect(redactText(`user ${PERSON.userId}`)).toBe("user [id]");
  });

  it("removes IP addresses", () => {
    expect(redactText("from 201.192.44.17 and 2001:db8:85a3:0:0:8a2e:370:7334")).toBe(
      "from [ip] and [ip]",
    );
  });

  it("removes query strings, fragments and credentials from addresses, keeping the path", () => {
    expect(redactText("GET https://yuntera.example/buscar?q=ana#top failed")).toBe(
      "GET https://yuntera.example/buscar failed",
    );
    expect(redactText("at /verificar?token_hash=abc&type=signup")).toBe("at /verificar");
    expect(redactText("https://user:pass@host.example/x")).toBe("https://host.example/x");
    expect(pathOnly("https://yuntera.example/pedidos/YT-1?codigo=4821#entrega")).toBe(
      "https://yuntera.example/pedidos/YT-1",
    );
  });

  it("replaces quoted text, keeping a short property name", () => {
    expect(redactText(`Unexpected token 'A', "Ana Prueba" is not valid JSON`)).toBe(
      `Unexpected token '[text]', "[text]" is not valid JSON`,
    );
    expect(redactText("Cannot read properties of undefined (reading 'name')")).toBe(
      "Cannot read properties of undefined (reading 'name')",
    );
    expect(redactText("Cliente “Ana Prueba Solís” en «San Pedro»")).toBe(
      "Cliente “[text]” en «[text]»",
    );
  });

  it("keeps the messages that help to read an error", () => {
    for (const message of [
      "insufficient_stock",
      "Minified React error #418; visit https://react.dev/errors/418",
      "TypeError: Failed to fetch",
      "Cannot read properties of null (reading 'offers')",
      "/app/node_modules/.pnpm/@sentry+core@11.12.0/node_modules/@sentry/core/build/cjs/index.js",
    ]) {
      expect(redactText(message)).toBe(message);
    }
  });

  it("shortens long text and ignores what is not text", () => {
    expect(redactText("x".repeat(2000))).toHaveLength(MAX_TEXT + 1);
    expect(redactText(undefined)).toBe("");
    expect(redactText({ email: PERSON.email })).toBe("");
  });
});

describe("scrubEvent: real-shaped events leave with none of the personal data", () => {
  const cases: Array<[string, () => TrackerEvent]> = [
    ["a checkout with an address and a phone", checkoutEvent],
    ["an order page with a delivery code", orderPageEvent],
    ["a sign-in with an e-mail and a password", signInEvent],
    ["a staff page showing a customer", staffCustomerEvent],
  ];

  for (const [name, make] of cases) {
    it(name, () => {
      const event = scrubEvent(make(), OPTIONS);
      expectClean(event);
      // What stays: the error's type, the website, environment and release.
      expect(event?.exception?.values?.[0]?.type).toBeTruthy();
      expect(event?.tags?.app).toBe("web");
      expect(event?.environment).toBe("preview");
      expect(event?.release).toBe("yuntera-web@0123456789ab");
    });
  }

  it("drops cookies, every header, the body, the query, the user and the breadcrumbs", () => {
    const event = scrubEvent(checkoutEvent(), OPTIONS);
    expect(event?.request).toEqual({ url: "https://yuntera.example/pagar", method: "POST" });
    expect(event?.user).toBeUndefined();
    expect(event?.breadcrumbs).toBeUndefined();
    expect(event?.extra).toBeUndefined();
    expect(event?.server_name).toBeUndefined();
    expect(Object.keys(event?.contexts ?? {}).sort()).toEqual(["nextjs", "runtime"]);
    expect(event?.contexts?.nextjs).toEqual({
      request_path: "/pagar",
      router_kind: "App Router",
      router_path: "/pagar",
      route_type: "action",
    });
    // Where it failed, never what was there: no local variables, no source lines.
    const frame = event?.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).toEqual({
      filename: "/var/task/apps/web/.next/server/chunks/ssr/app_pagar_actions.js",
      function: "placeOrder",
      lineno: 12,
      colno: 3,
      in_app: true,
    });
  });

  it("keeps a role from the fixed list only, and no other tag", () => {
    const event = scrubEvent(staffCustomerEvent(), { ...OPTIONS, app: "ops" });
    expect(event?.tags).toEqual({ app: "ops", role: "staff" });
    const odd = scrubEvent({ ...checkoutEvent(), tags: { role: PERSON.name } }, OPTIONS);
    expect(odd?.tags).toEqual({ app: "web" });
  });

  it("drops a message's parameters", () => {
    const event = scrubEvent(orderPageEvent(), OPTIONS);
    expect(event?.message).toBe("Su código de entrega es %s");
  });

  it("keeps a database error's short code, never its detail", () => {
    const original = databaseError();
    const event = scrubEvent(
      { exception: { values: [{ type: "ApiError", value: original.message }] } },
      { ...OPTIONS, original },
    );
    expect(event?.tags).toEqual({ app: "web", db_code: "insufficient_stock" });
    expect(event?.exception?.values?.[0]?.value).toBe("insufficient_stock");
    expectClean(event);
  });

  it("names the database function only for an answer of the wrong shape", () => {
    expect(
      databaseFacts({ name: "ApiError", code: "invalid_response", detail: "get_product" }),
    ).toEqual({
      db_code: "invalid_response",
      db_function: "get_product",
    });
    expect(databaseFacts({ name: "ApiError", code: "price_changed", detail: "125000" })).toEqual({
      db_code: "price_changed",
    });
    expect(databaseFacts({ name: "TypeError", code: "x" })).toEqual({});
    expect(databaseFacts({ name: "ApiError", code: "Not A Code" })).toEqual({});
    expect(databaseFacts(null)).toEqual({});
  });

  it("sends nothing that is not an error: transactions, replays, feedback", () => {
    for (const type of ["transaction", "replay_event", "feedback", "profile"]) {
      expect(scrubEvent({ ...checkoutEvent(), type }, OPTIONS), type).toBeNull();
    }
  });

  it("keeps the build ids that match source maps, and the SDK's name and version only", () => {
    const event = scrubEvent(
      {
        ...orderPageEvent(),
        debug_meta: {
          images: [
            {
              type: "sourcemap",
              debug_id: "a1b2c3d4-0000-4000-8000-000000000000",
              code_file: "https://yuntera.example/_next/static/chunks/a.js?v=1",
            },
          ],
        },
      },
      OPTIONS,
    );
    expect(event?.debug_meta?.images).toEqual([
      {
        type: "sourcemap",
        debug_id: "a1b2c3d4-0000-4000-8000-000000000000",
        code_file: "https://yuntera.example/_next/static/chunks/a.js",
      },
    ]);
    expect(event?.sdk).toEqual({ name: "sentry.javascript.nextjs", version: "11.12.0" });
  });
});

describe("the websites never write values into error messages", () => {
  // A name or an address written into an error message cannot be recognised
  // later, so the rule is kept at the source: no error message in the code the
  // four websites run (the shared packages they use included) is built from a
  // value that holds a person's data. Ids, amounts and codes are fine.
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const dirs = [
    "apps/web/src",
    "apps/seller/src",
    "apps/ops/src",
    "apps/field/src",
    "packages/next-kit/src",
    "packages/db/src",
    "packages/ui/src",
    "packages/core/src",
  ];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) &&
        !/\.test\.|contract\.|fixtures\.ts$|standin-scenarios\.ts$/.test(name)
        ? [path]
        : [];
    });

  const PERSONAL =
    /name|nombre|email|correo|phone|tel[eé]fono|address|direcci|street|cedula|c[eé]dula|identification|pin|delivery_?code|password|token|iban|sinpe|body|text|note|message|query|search/i;

  it("has no error message built from a person's data", () => {
    const found: string[] = [];
    for (const dir of dirs) {
      for (const file of files(join(root, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/new (?:\w*Error)\(\s*`[^`]*`/g)) {
          const values = [...match[0].matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] ?? "");
          // The name of a seller metric (on-time rate and the like), not of a person.
          if (match[0].includes("Seller metric $" + "{name}")) continue;
          if (values.some((value) => PERSONAL.test(value))) {
            found.push(`${file.slice(root.length)}: ${match[0].slice(0, 80)}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
