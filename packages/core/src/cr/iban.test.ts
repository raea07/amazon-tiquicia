import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCrIban, isValidCrIban, maskIban, normalizeIban, parseCrIban } from "./iban";

describe("Costa Rican IBAN", () => {
  it("accepts a valid number however it is typed", () => {
    for (const input of [
      "CR05015202001026284066",
      "CR05 0152 0200 1026 2840 66",
      "cr05 0152 0200 1026 2840 66",
      " CR05-0152-0200-1026-2840-66 ",
    ]) {
      expect(parseCrIban(input)).toEqual({
        value: "CR05015202001026284066",
        formatted: "CR05 0152 0200 1026 2840 66",
        masked: "CR•• •••• •••• •••• 4066",
      });
    }
  });

  it("accepts the lowest and highest check digits", () => {
    expect(isValidCrIban("CR02015201000000000017")).toBe(true);
    expect(isValidCrIban("CR98015201000000000035")).toBe(true);
  });

  it("catches a wrong digit and two swapped digits", () => {
    expect(checkCrIban("CR05015202001026284067")).toEqual({ ok: false, problem: "checksum" });
    expect(checkCrIban("CR05015202001026280466")).toEqual({ ok: false, problem: "checksum" });
    expect(checkCrIban("CR06015202001026284066")).toEqual({ ok: false, problem: "checksum" });
  });

  it("rejects check digits that are never issued, even when the division works out", () => {
    // 99 leaves the same remainder as 02, and 01 and 00 the same as 98 and 97.
    for (const input of [
      "CR99015201000000000017",
      "CR01015201000000000035",
      "CR00015201000000000053",
    ]) {
      expect(checkCrIban(input)).toEqual({ ok: false, problem: "checksum" });
    }
  });

  it("says what is wrong, so the form can explain it", () => {
    expect(checkCrIban("")).toEqual({ ok: false, problem: "empty" });
    expect(checkCrIban("   ")).toEqual({ ok: false, problem: "empty" });
    expect(checkCrIban("GB82WEST12345698765432")).toEqual({ ok: false, problem: "country" });
    expect(checkCrIban("05015202001026284066")).toEqual({ ok: false, problem: "country" });
    expect(checkCrIban("CR05O152O2OO1O26284O66")).toEqual({ ok: false, problem: "characters" });
    expect(checkCrIban("CR0501520200102628406")).toEqual({ ok: false, problem: "length" });
    expect(checkCrIban("CR050152020010262840661")).toEqual({ ok: false, problem: "length" });
    expect(checkCrIban("CR")).toEqual({ ok: false, problem: "length" });
    expect(parseCrIban("CR0501520200102628406")).toBeNull();
  });

  it("masks all but the last four digits", () => {
    expect(maskIban("CR05015202001026284066")).toBe("CR•• •••• •••• •••• 4066");
    expect(maskIban("CR05015202001026284066")).not.toContain("0152");
  });

  it("normalises spaces, hyphens and case", () => {
    expect(normalizeIban(" cr05-0152 0200\t1026 ")).toBe("CR05015202001026");
  });
});

describe("IBAN parity with the database", () => {
  // The database tests assert `private.is_valid_cr_iban` on the list between
  // these markers; here the same list is run through the TypeScript rule.
  const sql = readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/085_people_payouts.sql", import.meta.url)),
    "utf8",
  );
  const block = /-- BEGIN iban_cases([\s\S]*?)-- END iban_cases/.exec(sql)?.[1] ?? "";
  const cases = [...block.matchAll(/\('([^']*)',\s*(true|false)\)/g)].map(
    (match) => [match[1] ?? "", match[2] === "true"] as const,
  );

  it("finds the shared list", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.some(([, valid]) => valid)).toBe(true);
    expect(cases.some(([, valid]) => !valid)).toBe(true);
  });

  it.each(cases)("%s → %s", (iban, valid) => {
    expect(isValidCrIban(iban)).toBe(valid);
  });
});
