import { describe, expect, it } from "vitest";
import { safeReturnPath, signInPath } from "./paths";

describe("safeReturnPath", () => {
  it("keeps paths on this site", () => {
    expect(safeReturnPath("/pagar")).toBe("/pagar");
    expect(safeReturnPath("/pedidos/YT-100001?nuevo=1")).toBe("/pedidos/YT-100001?nuevo=1");
  });

  it.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash trick", "/\\evil.example/"],
    ["a tab that browsers strip", "/\t/evil.example/"],
    ["a newline that browsers strip", "/\n/evil.example/"],
    ["a javascript URL", "javascript:alert(1)"],
    ["nothing", ""],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, candidate) => {
    expect(safeReturnPath(candidate)).toBe("/");
  });
});

describe("signInPath", () => {
  it("carries the return path, encoded", () => {
    expect(signInPath("/pagar")).toBe("/ingresar?siguiente=%2Fpagar");
  });
  it("drops an unsafe return path", () => {
    expect(signInPath("//evil.example")).toBe("/ingresar?siguiente=%2F");
  });
});
