import { ApiError, ERROR_MESSAGES, toApiError } from "@yuntera/db";
import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR,
  messageOf,
  SIGN_IN_FAILED,
  signInMessage,
  signUpMessage,
  validateSignIn,
  validateSignUp,
} from "./errors";

describe("messageOf", () => {
  it("shows the Spanish message packages/db has for a database error code", () => {
    const error = toApiError({ code: "P0001", message: "insufficient_stock" });
    expect(messageOf(error)).toBe(ERROR_MESSAGES.insufficient_stock["es-CR"]);
  });

  it("never shows the code itself", () => {
    for (const code of Object.keys(ERROR_MESSAGES)) {
      const text = messageOf(new ApiError(code as keyof typeof ERROR_MESSAGES));
      expect(text).not.toContain(code);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("says to check the connection when the request never arrived", () => {
    expect(messageOf(new ApiError("network"))).toMatch(/conexión/);
    expect(messageOf(new TypeError("Network request failed"))).toMatch(/conexión/);
  });

  it("hides the text of anything unexpected", () => {
    expect(messageOf(new Error("relation public.orders does not exist"))).toBe(GENERIC_ERROR);
    expect(messageOf("boom")).toBe(GENERIC_ERROR);
    expect(messageOf(toApiError({ code: "XX000", message: "internal" }))).toBe(GENERIC_ERROR);
  });

  it("asks a signed-out person to sign in when the token was refused", () => {
    expect(messageOf(toApiError({ code: "PGRST301", message: "JWT expired" }, 401))).toBe(
      ERROR_MESSAGES.not_authenticated["es-CR"],
    );
  });
});

describe("sign-in and sign-up messages", () => {
  it("gives one message for a wrong password and an unknown account", () => {
    expect(signInMessage({ status: 400, code: "invalid_credentials" })).toBe(SIGN_IN_FAILED);
    expect(signInMessage({ status: 400, code: "user_not_found" })).toBe(SIGN_IN_FAILED);
  });

  it("does not blame the password when the network failed", () => {
    expect(signInMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toMatch(
      /conexión/,
    );
  });

  it("says the e-mail is not confirmed yet, which Auth tells only after the password matched", () => {
    const text = signInMessage({ status: 400, code: "email_not_confirmed" });
    expect(text).toMatch(/confirmado su correo/);
    expect(text).not.toContain("email_not_confirmed");
  });

  it("explains a rate limit without a code", () => {
    expect(signInMessage({ status: 429, code: "over_request_rate_limit" })).toMatch(/minuto/);
  });

  it("tells someone who already has an account to sign in", () => {
    expect(signUpMessage({ code: "user_already_exists" })).toMatch(/Inicie sesión/);
    expect(signUpMessage({ code: "weak_password" })).not.toContain("weak_password");
  });
});

describe("form checks", () => {
  it("checks the e-mail and the password length like the web", () => {
    expect(validateSignIn("no-es-correo", "12345678")).toBe("Escriba un correo válido.");
    expect(validateSignIn("a@b.cr", "corta")).toMatch(/8 caracteres/);
    expect(validateSignIn(" a@b.cr ", "suficiente")).toBeNull();
  });

  it("refuses a sign-up without express consent", () => {
    const input = { fullName: "Ana Mora", email: "ana@b.cr", password: "suficiente" };
    expect(validateSignUp({ ...input, accepted: false })).toMatch(/aceptar/);
    expect(validateSignUp({ ...input, accepted: true })).toBeNull();
    expect(validateSignUp({ ...input, fullName: "A", accepted: true })).toMatch(/nombre/);
  });
});
