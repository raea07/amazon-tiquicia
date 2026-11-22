import { ApiError } from "@yuntera/db";
import { describe, expect, it, vi } from "vitest";
import { accountDeletedNotice } from "./deleted";
import {
  changePassword,
  type DeletionDeps,
  deleteAccount,
  type PasswordCheck,
  requestPasswordReset,
  TOO_MANY_TRIES,
} from "./flows";
import {
  CURRENT_PASSWORD_WRONG,
  DELETION_PASSWORD_WRONG,
  DELETION_UNTICKED,
  PASSWORD_CHANGED,
  RESET_SENT,
} from "./rules";

const NETWORK = "No pudimos conectarnos";
const offlineError = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };

describe("password reset request", () => {
  it("refuses an address that is not one, before calling Auth", async () => {
    const auth = { resetPasswordForEmail: vi.fn() };
    expect(await requestPasswordReset(auth, "ana@correo")).toEqual({
      error: "Escriba un correo válido.",
    });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the trimmed, lower-case address", async () => {
    const auth = { resetPasswordForEmail: vi.fn(async () => ({ error: null })) };
    await requestPasswordReset(auth, "  Ana@Correo.Example ");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@correo.example");
  });

  it("answers the same for an account, no account and Auth's e-mail limit", async () => {
    const answers = await Promise.all(
      [
        null,
        { code: "over_email_send_rate_limit", status: 429, message: "after 42 seconds" },
        { code: "unexpected_failure", status: 500 },
      ].map((error) =>
        requestPasswordReset({ resetPasswordForEmail: async () => ({ error }) }, "a@b.cr"),
      ),
    );
    for (const answer of answers) expect(answer).toEqual({ ok: RESET_SENT });
  });

  it("says when there is no connection, which reveals nothing", async () => {
    const answer = await requestPasswordReset(
      { resetPasswordForEmail: async () => ({ error: offlineError }) },
      "a@b.cr",
    );
    expect(answer.error).toContain(NETWORK);
    const thrown = await requestPasswordReset(
      {
        resetPasswordForEmail: async () => {
          throw new TypeError("Network request failed");
        },
      },
      "a@b.cr",
    );
    expect(thrown.error).toContain(NETWORK);
  });
});

describe("password change", () => {
  const right: PasswordCheck = async () => "right";
  const input = {
    email: "ana@correo.example",
    current: "vieja-clave",
    password: "nueva-clave-1",
    repeat: "nueva-clave-1",
  };

  it("checks the new password before asking Auth anything", async () => {
    const check = vi.fn(right);
    const auth = { updateUser: vi.fn() };
    expect(await changePassword({ ...input, repeat: "otra" }, { check, auth })).toEqual({
      error: "Las dos contraseñas no coinciden. Escríbala igual en ambos campos.",
    });
    expect(await changePassword({ ...input, current: "" }, { check, auth })).toEqual({
      error: "Escriba su contraseña actual.",
    });
    expect(check).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const auth = { updateUser: vi.fn() };
    expect(await changePassword(input, { check: async () => "wrong", auth })).toEqual({
      error: CURRENT_PASSWORD_WRONG,
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("says so when the check could not be made", async () => {
    const auth = { updateUser: vi.fn() };
    expect((await changePassword(input, { check: async () => "offline", auth })).error).toContain(
      NETWORK,
    );
    expect(await changePassword(input, { check: async () => "limited", auth })).toEqual({
      error: TOO_MANY_TRIES,
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes it with the current one sent along", async () => {
    const auth = { updateUser: vi.fn(async () => ({ error: null })) };
    expect(await changePassword(input, { check: right, auth })).toEqual({ ok: PASSWORD_CHANGED });
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "nueva-clave-1",
      current_password: "vieja-clave",
    });
  });

  it("puts Auth's refusal in words, never its text", async () => {
    const auth = {
      updateUser: async () => ({
        error: { code: "same_password", status: 422, message: "New password should be different" },
      }),
    };
    expect(await changePassword(input, { check: right, auth })).toEqual({
      error: "La contraseña nueva debe ser distinta de la actual.",
    });
  });
});

describe("account deletion", () => {
  const result = { orders_kept: 2, reviews_kept: 1 };
  const deps = (overrides: Partial<DeletionDeps> = {}): DeletionDeps & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      check: async () => {
        calls.push("check");
        return "right";
      },
      deleteMyAccount: async () => {
        calls.push("delete");
        return result;
      },
      forgetDevice: async () => {
        calls.push("forget");
      },
      signOutDevice: async () => {
        calls.push("sign-out");
        return true;
      },
      clearMemory: () => {
        calls.push("clear");
      },
      ...overrides,
    };
  };
  const input = { email: "ana@correo.example", password: "su-clave-1", understood: true };

  it("needs the box ticked and the password, before anything is sent", async () => {
    const d = deps();
    expect(await deleteAccount({ ...input, understood: false }, d)).toEqual({
      error: DELETION_UNTICKED,
    });
    expect(await deleteAccount({ ...input, password: "" }, d)).toEqual({
      error: DELETION_PASSWORD_WRONG,
    });
    expect(d.calls).toEqual([]);
  });

  it("refuses a wrong password and deletes nothing", async () => {
    const d = deps({ check: async () => "wrong" });
    expect(await deleteAccount(input, d)).toEqual({ error: DELETION_PASSWORD_WRONG });
    expect(d.calls).toEqual([]);
  });

  it("deletes, then forgets the phone's data, signs out and empties the cache, in that order", async () => {
    const d = deps();
    expect(await deleteAccount(input, d)).toEqual({ deleted: result, signedOut: true });
    expect(d.calls).toEqual(["check", "delete", "forget", "sign-out", "clear"]);
  });

  it("keeps everything on the phone when the database refuses, and says why", async () => {
    const d = deps({
      deleteMyAccount: async () => {
        throw new ApiError("account_has_open_orders");
      },
    });
    const outcome = await deleteAccount(input, d);
    expect(outcome).toEqual({
      error:
        "Tiene pedidos en curso. Espere a recibirlos o cancélelos, y luego podrá eliminar la cuenta.",
    });
    expect(d.calls).toEqual(["check"]);
  });

  it("still signs out when forgetting the phone's data fails", async () => {
    const d = deps({
      forgetDevice: async () => {
        throw new Error("storage refused");
      },
    });
    expect(await deleteAccount(input, d)).toEqual({ deleted: result, signedOut: true });
    expect(d.calls).toEqual(["check", "delete", "sign-out", "clear"]);
  });

  it("reports a secure store that kept the session", async () => {
    const d = deps({ signOutDevice: async () => false });
    expect(await deleteAccount(input, d)).toEqual({ deleted: result, signedOut: false });
  });
});

describe("the notice after a deletion", () => {
  it("is held in memory, announced, and dismissed once", () => {
    const heard = vi.fn();
    const stop = accountDeletedNotice.subscribe(heard);
    expect(accountDeletedNotice.current()).toBe(false);
    accountDeletedNotice.mark();
    expect(accountDeletedNotice.current()).toBe(true);
    accountDeletedNotice.dismiss();
    accountDeletedNotice.dismiss();
    expect(accountDeletedNotice.current()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
