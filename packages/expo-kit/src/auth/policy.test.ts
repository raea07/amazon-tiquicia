import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "./policy";

describe("POLICY_VERSION", () => {
  it("is the version the web records, so both ask for the same consent", () => {
    // Read as text: the web module imports "server-only", which refuses to load here.
    const source = readFileSync(
      fileURLToPath(new URL("../../../next-kit/src/server/actions.ts", import.meta.url).href),
      "utf8",
    );
    const web = /export const POLICY_VERSION = "([^"]+)"/.exec(source)?.[1];
    expect(web).toBeDefined();
    expect(POLICY_VERSION).toBe(web);
  });
});
