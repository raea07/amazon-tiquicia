import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deletionBlocker, messageFor } from "@yuntera/db";
import { describe, expect, it } from "vitest";
// The web's rules, read straight from their source, so the two cannot drift.
import * as web from "../../../next-kit/src/auth-rules";
import {
  ACCOUNT_DELETED,
  blockerMessages,
  DELETION_CONFIRM_LABEL,
  DELETION_PASSWORD_WRONG,
  DELETION_TERMS,
  DELETION_UNTICKED,
  isEmail,
  ordersKeptText,
  PASSWORD_CHANGED,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordProblem,
} from "./rules";

const source = (path: string) => readFileSync(join(__dirname, path), "utf8").replace(/\s+/g, " ");
const webPages = source("../../../next-kit/src/account/pages.tsx");
const webForms = source("../../../next-kit/src/client/account-forms.tsx");
const webActions = source("../../../next-kit/src/server/account-actions.ts");

describe("password rules", () => {
  it("are the web's", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(web.PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX_BYTES).toBe(web.PASSWORD_MAX_BYTES);
    expect([...PASSWORD_RULES]).toEqual([...web.PASSWORD_RULES]);
  });

  const cases: Array<[string, string, { repeat?: string; email?: string | null }]> = [
    ["too short", "corta", {}],
    ["eight characters", "ocho1234", {}],
    ["eight characters with accents", "ñáéíóúüx", {}],
    ["too long in bytes", "ñ".repeat(40), {}],
    ["the e-mail itself", "ana@correo.example", { email: "Ana@Correo.example" }],
    ["a repeat that differs", "buena-clave-1", { repeat: "buena-clave-2" }],
    ["a repeat that matches", "buena-clave-1", { repeat: "buena-clave-1" }],
    ["an empty repeat", "buena-clave-1", { repeat: "" }],
  ];
  for (const [label, password, options] of cases) {
    it(`says what the web says for ${label}`, () => {
      expect(passwordProblem(password, options)).toBe(web.passwordProblem(password, options));
    });
  }

  it("checks an address as the web does", () => {
    for (const value of ["ana@correo.example", "ana@correo", "ana correo@x.cr", "a@b.c", ""]) {
      expect(isEmail(value), value).toBe(web.isEmail(value));
    }
  });
});

describe("deletion texts", () => {
  it("say what the web's deletion page says, word for word", () => {
    for (const item of DELETION_TERMS.erased.items) expect(webPages).toContain(item);
    expect(webPages).toContain(DELETION_TERMS.erased.title);
    expect(webPages).toContain(DELETION_TERMS.kept.title);
    expect(webPages).toContain(DELETION_TERMS.kept.text);
    expect(webPages).toContain(DELETION_TERMS.after.text);
    expect(webPages).toContain(ACCOUNT_DELETED.title);
    expect(webPages).toContain(ACCOUNT_DELETED.text);
    expect(webPages).toContain(ACCOUNT_DELETED.again);
    expect(webForms).toContain(DELETION_CONFIRM_LABEL);
  });

  it("answer the way the web's actions do", () => {
    expect(webActions).toContain(DELETION_UNTICKED);
    expect(webActions).toContain(DELETION_PASSWORD_WRONG);
    expect(webActions).toContain(PASSWORD_CHANGED);
  });

  it("give every blocker its own sentence, never its code", () => {
    const all = deletionBlocker.options;
    const messages = blockerMessages(all);
    expect(messages).toHaveLength(all.length);
    for (const [index, code] of all.entries()) {
      expect(messages[index]).toBe(messageFor(code, "es-CR"));
      expect(messages[index]).not.toContain(code);
    }
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("count the orders kept as the web does", () => {
    expect(ordersKeptText(0)).toBe("No tiene pedidos que debamos conservar.");
    expect(ordersKeptText(1)).toBe("Conservaremos 1 pedido sin sus datos, como se explica arriba.");
    expect(ordersKeptText(3)).toBe(
      "Conservaremos 3 pedidos sin sus datos, como se explica arriba.",
    );
    expect(webPages).toContain("sin sus datos, como se explica arriba.");
  });
});
