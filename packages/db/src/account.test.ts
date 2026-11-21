import { describe, expect, it } from "vitest";
import { authErrorMessage, authErrors, retryAfterSeconds, waitText } from "./areas/account";

describe("Auth error messages", () => {
  it("covers the codes the screens branch on", () => {
    for (const code of [
      "invalid_credentials",
      "email_not_confirmed",
      "weak_password",
      "same_password",
      "otp_expired",
      "over_email_send_rate_limit",
      "over_request_rate_limit",
      "insufficient_aal",
      "mfa_verification_failed",
      "mfa_challenge_expired",
      "mfa_ip_address_mismatch",
    ]) {
      expect(authErrors, code).toHaveProperty(code);
    }
  });

  it("writes every message in both languages, as a sentence, without the code", () => {
    for (const [code, text] of Object.entries(authErrors)) {
      for (const locale of ["es-CR", "en"] as const) {
        expect(text[locale], `${code} ${locale}`).toMatch(/^[A-ZÁÉÍÓÚÑ¿].{10,}[.!]$/);
        expect(text[locale], `${code} ${locale}`).not.toContain(code);
      }
      expect(text["es-CR"], code).not.toMatch(/\b(tú|tu cuenta|vos|puedes|tienes|revisá)\b/i);
    }
  });

  it("never shows Auth's own text, and falls back for an unknown code", () => {
    const shown = authErrorMessage({ code: "something_new", message: "Internal details here" });
    expect(shown).not.toContain("Internal");
    expect(authErrorMessage(null)).toBe(shown);
  });

  it("says how long to wait when Auth limits e-mails", () => {
    const message = "For security purposes, you can only request this after 42 seconds.";
    expect(retryAfterSeconds(message)).toBe(42);
    expect(retryAfterSeconds("email rate limit exceeded")).toBeNull();
    expect(authErrorMessage({ code: "over_email_send_rate_limit", message })).toBe(
      "Ya le enviamos un correo hace poco. Puede pedir otro en 42 segundos.",
    );
    expect(
      authErrorMessage({
        code: "over_email_send_rate_limit",
        message: "email rate limit exceeded",
      }),
    ).toBe(authErrors.over_email_send_rate_limit["es-CR"]);
  });

  it("words the wait naturally", () => {
    expect(waitText(1)).toBe("1 segundo");
    expect(waitText(59)).toBe("59 segundos");
    expect(waitText(60)).toBe("1 minuto");
    expect(waitText(61)).toBe("2 minutos");
    expect(waitText(900, "en")).toBe("15 minutes");
  });
});
