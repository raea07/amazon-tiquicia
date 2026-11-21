import { describe, expect, it } from "vitest";
import {
  isLinkType,
  isTokenHash,
  normaliseCode,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordProblem,
} from "./auth-rules";

describe("new passwords", () => {
  it("accepts a password that meets the rules", () => {
    expect(passwordProblem("cafe con leche 2026")).toBeNull();
    expect(passwordProblem("exactly8", { repeat: "exactly8" })).toBeNull();
  });

  it("asks for the minimum length the rules state", () => {
    expect(PASSWORD_RULES[0]).toContain(String(PASSWORD_MIN_LENGTH));
    expect(passwordProblem("corta")).toMatch(/al menos 8 caracteres/);
    // Counted in characters, not bytes: accents do not count double.
    expect(passwordProblem("ñandúñan")).toBeNull();
  });

  it("refuses what bcrypt would silently cut", () => {
    expect(passwordProblem("a".repeat(73))).toMatch(/demasiado larga/);
    expect(passwordProblem("a".repeat(72))).toBeNull();
  });

  it("refuses the e-mail as a password and a mistyped repeat", () => {
    expect(passwordProblem("Ana@Example.com", { email: "ana@example.com" })).toMatch(/correo/);
    expect(passwordProblem("una clave larga", { repeat: "una clave larg" })).toMatch(
      /no coinciden/,
    );
  });
});

describe("codes", () => {
  it("accepts six digits the way people type them", () => {
    expect(normaliseCode("123456")).toBe("123456");
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("123-456")).toBe("123456");
  });

  it("refuses anything else", () => {
    for (const value of ["12345", "1234567", "12a456", "", null, undefined, 123456]) {
      expect(normaliseCode(value), String(value)).toBeNull();
    }
  });
});

describe("e-mail links", () => {
  it("knows the link types", () => {
    expect(isLinkType("recovery")).toBe(true);
    expect(isLinkType("email")).toBe(true);
    expect(isLinkType("phone_change")).toBe(false);
    expect(isLinkType(undefined)).toBe(false);
  });

  it("accepts Auth's token hashes and nothing else", () => {
    const hash = "986df449d1d2a5189e867c6eda4c5da80239e3aa7dcad8c03be2a46a";
    expect(isTokenHash(hash)).toBe(true);
    expect(isTokenHash(`pkce_${hash}`)).toBe(true);
    expect(isTokenHash("<script>")).toBe(false);
    expect(isTokenHash(`${hash}&type=x`)).toBe(false);
  });
});
