import { describe, expect, it } from "vitest";
import { createApi, type RpcTransport } from "../api";
import { ApiError, ERROR_MESSAGES, messageFor, toApiError } from "../errors";
import { LOCK_CONFLICT_SQLSTATES, lockConflictCode } from "./lock-conflicts";

describe("lock conflicts", () => {
  it("knows the two SQLSTATEs PostgreSQL rolls a call back with, and nothing else", () => {
    expect(Object.keys(LOCK_CONFLICT_SQLSTATES).sort()).toEqual(["40001", "40P01"]);
    expect(lockConflictCode("40P01")).toBe("try_again");
    expect(lockConflictCode("40001")).toBe("try_again");
    for (const other of ["P0001", "42501", "23505", "XX000", "", null, undefined, "toString"]) {
      expect(lockConflictCode(other)).toBeNull();
    }
  });

  it("turns them into one error that says nothing was saved and to try again", () => {
    for (const sqlstate of ["40P01", "40001"]) {
      const error = toApiError({ code: sqlstate, message: "deadlock detected", details: "x" }, 500);
      expect(error.code).toBe("try_again");
      expect(error.detail).toBe(sqlstate);
      expect(error.status).toBe(500);
      expect(error.userMessage("es-CR")).toBe(ERROR_MESSAGES.try_again["es-CR"]);
      expect(error.userMessage("es-CR")).toMatch(/no se guardó nada.*Inténtelo de nuevo/);
      expect(error.userMessage("en")).toMatch(/nothing was saved.*try again/i);
    }
    // Before this mapping both read as the general "something went wrong".
    expect(messageFor("try_again")).not.toBe(messageFor("no_such_code"));
  });

  it("reaches a caller of the typed client the way the Data API reports it", async () => {
    // The hosted API (and tools/dev-api) answer HTTP 500 with the SQLSTATE in `code`.
    const transport: RpcTransport = {
      rpc: async () => ({
        data: null,
        error: { code: "40P01", message: "deadlock detected", details: null, hint: null },
        status: 500,
      }),
    };
    const api = createApi(transport);
    const failure = await api
      .wmsMoveStock({
        fromLocationId: "00000000-0000-4000-8000-000000000001",
        toLocationId: "00000000-0000-4000-8000-000000000002",
        skuId: "00000000-0000-4000-8000-000000000003",
        sellerId: "00000000-0000-4000-8000-000000000004",
        quantity: 1,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("try_again");
  });
});
