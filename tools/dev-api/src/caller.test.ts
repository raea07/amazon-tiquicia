import { describe, expect, it } from "vitest";
import { roleFor } from "./rpc.ts";

// Every route that reaches the database (RPC and storage) runs the request as
// the role this gives, so a caller is the same caller everywhere.
describe("roleFor", () => {
  it("runs a visitor as anon", () => {
    expect(roleFor(null)).toBe("anon");
  });

  it("runs a session token as authenticated", () => {
    expect(roleFor({ sub: "8d1c0b1e-0000-4000-8000-000000000000", role: "authenticated" })).toBe(
      "authenticated",
    );
  });

  it("runs the local secret key as service_role, never as a user", () => {
    expect(roleFor({ sub: "", role: "service_role" })).toBe("service_role");
  });

  it("does not let a claim other than service_role choose a role", () => {
    expect(roleFor({ sub: "x", role: "postgres" as never })).toBe("authenticated");
  });
});
