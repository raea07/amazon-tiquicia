import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  callsAsVisitor,
  lockedMessage,
  needsSecondStep,
  normaliseCode,
  refusedMessage,
  SECOND_STEP_CALLS,
  totpFactorId,
} from "./second-step";

/** A token with this payload (the signature is not read on the phone). */
function token(payload: Record<string, unknown>): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "");
  return `${part({ alg: "HS256" })}.${part(payload)}.signature`;
}

const factor = (status: "verified" | "unverified", id = "f1") =>
  ({ id, status, factor_type: "totp" }) as never;

function session(aal: string, factors: unknown[] = []) {
  return {
    access_token: token({ sub: "u1", aal, nombre: "Pérez Ñandú" }),
    user: { id: "u1", factors } as never,
  };
}

describe("second step", () => {
  it("is needed for an account with a verified authenticator whose session is only aal1", () => {
    expect(needsSecondStep(session("aal1", [factor("verified")]))).toBe(true);
    expect(needsSecondStep(session("aal2", [factor("verified")]))).toBe(false);
  });

  it("is not needed without a verified factor, or without a session", () => {
    expect(needsSecondStep(session("aal1"))).toBe(false);
    expect(needsSecondStep(session("aal1", [factor("unverified")]))).toBe(false);
    expect(needsSecondStep(null)).toBe(false);
  });

  it("asks for it when the token cannot be read", () => {
    expect(
      needsSecondStep({
        access_token: "not-a-token",
        user: { factors: [factor("verified")] } as never,
      }),
    ).toBe(true);
  });

  it("uses the verified authenticator app", () => {
    expect(
      totpFactorId(session("aal1", [factor("unverified", "a"), factor("verified", "b")])),
    ).toBe("b");
    expect(totpFactorId(session("aal1"))).toBeNull();
  });

  it("reads a code as people type it, and nothing else", () => {
    expect(normaliseCode("123456")).toBe("123456");
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("123-456")).toBe("123456");
    expect(normaliseCode("12345")).toBeNull();
    expect(normaliseCode("12345a")).toBeNull();
  });

  it("says how many tries are left after a wrong code, then that the pause began", () => {
    const wrong = { code: "mfa_verification_failed" };
    expect(
      refusedMessage(wrong, { locked: false, attempts_left: 4, retry_after_seconds: 0 }),
    ).toMatch(
      /^El código no es correcto\..* Le quedan 4 intentos antes de una pausa de 15 minutos\.$/,
    );
    expect(
      refusedMessage(wrong, { locked: false, attempts_left: 1, retry_after_seconds: 0 }),
    ).toMatch(/Le quedan 1 intento antes/);
    expect(
      refusedMessage(wrong, { locked: true, attempts_left: 0, retry_after_seconds: 900 }),
    ).toMatch(/Por seguridad, espere 15 minutos antes de intentarlo de nuevo\.$/);
    expect(lockedMessage({ retry_after_seconds: 600 })).toMatch(
      /^Escribió demasiados códigos incorrectos\..*Podrá intentarlo de nuevo en 10 minutos\.$/,
    );
  });

  it("never shows a code for another refusal", () => {
    const text = refusedMessage(
      { code: "mfa_challenge_expired" },
      { locked: false, attempts_left: 4, retry_after_seconds: 0 },
    );
    expect(text).toBe("Pasó demasiado tiempo. Escriba el código que muestra ahora su aplicación.");
  });
});

describe("calls halfway through the second step", () => {
  const migrations = join(__dirname, "../../../../supabase/migrations");

  it("go as a visitor, except the second step's own", () => {
    for (const fn of ["search_products", "list_categories", "list_districts", "report_content"]) {
      expect(callsAsVisitor("secondStep", fn), fn).toBe(true);
    }
    for (const fn of SECOND_STEP_CALLS) expect(callsAsVisitor("secondStep", fn), fn).toBe(false);
    for (const status of ["signedIn", "signedOut", "loading"]) {
      expect(callsAsVisitor(status, "search_products"), status).toBe(false);
    }
  });

  it("let through exactly what the database lets through", () => {
    // The last migration that defines check_request holds the list.
    const defining = readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(join(migrations, name), "utf8"))
      .filter((sql) => /function public\.check_request\(\)/.test(sql));
    const sql = defining.at(-1) ?? "";
    const list = /v_function not in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const names = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(2);
    expect([...SECOND_STEP_CALLS].sort()).toEqual(names.sort());
  });

  it("are sent with the public key instead of the person's token", () => {
    const provider = readFileSync(join(__dirname, "session.tsx"), "utf8").replace(/\s+/g, " ");
    expect(provider).toContain(
      'callsAsVisitor(statusNow.current, fn) ? call.setHeader("Authorization", `Bearer ${env.supabaseKey}`) : call;',
    );
  });
});
