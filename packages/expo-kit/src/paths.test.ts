import { describe, expect, it } from "vitest";
// The web's rule, read straight from its source, so the two cannot drift.
import * as web from "../../next-kit/src/paths";
import { oneParam, safeReturnPath, signInPath } from "./paths";

const cases: Array<[label: string, candidate: string | null | undefined]> = [
  ["a path in the app", "/pagar"],
  ["a path with a query", "/pedidos/YT-100001?nuevo=1"],
  ["an absolute URL", "https://evil.example/"],
  ["a protocol-relative URL", "//evil.example/"],
  ["a backslash trick", "/\\evil.example/"],
  ["a tab that browsers strip", "/\t/evil.example/"],
  ["a newline that browsers strip", "/\n/evil.example/"],
  ["a javascript URL", "javascript:alert(1)"],
  ["a custom scheme", "yuntera://pagar"],
  ["nothing", ""],
  ["null", null],
  ["undefined", undefined],
];

describe("safeReturnPath", () => {
  it.each(cases)("treats %s exactly like the web", (_label, candidate) => {
    expect(safeReturnPath(candidate)).toBe(web.safeReturnPath(candidate));
  });

  it("keeps app paths and drops everything else", () => {
    expect(safeReturnPath("/pagar")).toBe("/pagar");
    expect(safeReturnPath("//evil.example")).toBe("/");
  });
});

describe("signInPath", () => {
  it("matches the web's sign-in link", () => {
    expect(signInPath("/pagar")).toBe(web.signInPath("/pagar"));
    expect(signInPath("//evil.example")).toBe("/ingresar?siguiente=%2F");
  });
});

describe("oneParam", () => {
  it("takes the first of repeated parameters", () => {
    expect(oneParam(["a", "b"])).toBe("a");
    expect(oneParam("a")).toBe("a");
    expect(oneParam(undefined)).toBeUndefined();
  });
});
