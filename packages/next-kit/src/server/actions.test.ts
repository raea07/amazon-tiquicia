import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
};
const succeeded = vi.fn();
const reserveAttempt = vi.fn();

vi.mock("./supabase", () => ({
  sessionClient: async () => ({ auth }),
  sessionApi: async () => ({ recordConsent: vi.fn() }),
}));
vi.mock("./account", () => ({ confirmUrl: () => "http://localhost:3000/auth/confirm" }));
vi.mock("./session", () => ({
  redirectTo: (path: string) => {
    throw Object.assign(new Error("redirect"), { digest: `NEXT_REDIRECT;${path}` });
  },
}));
vi.mock("./auth-guard", () => ({
  reserveAttempt: (...args: unknown[]) => reserveAttempt(...args),
  captchaToken: (form: FormData) => form.get("cf-turnstile-response") ?? undefined,
}));

const { passwordSignIn, passwordSignUp } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const signUpForm = (email: string) =>
  form({ email, password: "una-clave-larga-9", fullName: "Ana Mora", acepta: "on" });

beforeEach(() => {
  vi.clearAllMocks();
  reserveAttempt.mockResolvedValue({ attemptId: "a", succeeded });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" } });
});

describe("WEB-M1: sign-up does not tell whether an address has an account", () => {
  it("answers an existing address exactly as a new one that waits for its e-mail", async () => {
    auth.signUp.mockResolvedValueOnce({ data: { user: { id: "u" }, session: null }, error: null });
    const fresh = await passwordSignUp(signUpForm("nueva@correo.example"));
    auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "user_already_exists", message: "User already registered" },
    });
    const existing = await passwordSignUp(signUpForm("nueva@correo.example"));
    expect(existing).toEqual(fresh);
    expect(existing.step).toBe("confirm-email");
    expect(existing.error).toBeUndefined();
    expect(JSON.stringify(existing)).not.toMatch(/existe|ya tiene/i);
  });
});

describe("WEB-2: the apps' own limit in front of Auth", () => {
  it("does not send the password to Auth once the limit is reached, and says when to try again", async () => {
    reserveAttempt.mockResolvedValueOnce({ error: "Espere 14 minutos." });
    const state = await passwordSignIn(
      form({ email: "ana@correo.example", password: "x".repeat(9) }),
    );
    expect(state.error).toBe("Espere 14 minutos.");
    expect(state.values).toEqual({ email: "ana@correo.example" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(reserveAttempt).toHaveBeenCalledWith("sign_in", { email: "ana@correo.example" });
  });

  it("keeps a wrong password counted and gives a right one back", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials" } });
    const wrong = await passwordSignIn(
      form({ email: "ana@correo.example", password: "x".repeat(9) }),
    );
    expect(wrong.error).toBe("El correo o la contraseña no coinciden.");
    expect(succeeded).not.toHaveBeenCalled();

    auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    await expect(
      passwordSignIn(
        form({ email: "ana@correo.example", password: "x".repeat(9), siguiente: "/cuenta" }),
      ),
    ).rejects.toMatchObject({ digest: "NEXT_REDIRECT;/cuenta" });
    expect(succeeded).toHaveBeenCalledOnce();
  });

  it("passes the human check's token to Auth when the form has one", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials" } });
    await passwordSignIn(
      form({
        email: "ana@correo.example",
        password: "x".repeat(9),
        "cf-turnstile-response": "tok",
      }),
    );
    expect(auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ options: { captchaToken: "tok" } }),
    );
  });

  it("counts a sign-up before Auth is asked, and stops it at the limit", async () => {
    reserveAttempt.mockResolvedValueOnce({ error: "Espere 60 minutos." });
    const state = await passwordSignUp(signUpForm("nueva@correo.example"));
    expect(state.error).toBe("Espere 60 minutos.");
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(reserveAttempt).toHaveBeenCalledWith("sign_up", { email: "nueva@correo.example" });
  });
});

describe("a lock conflict reaches the form as 'nothing was saved, try again'", () => {
  it("maps deadlock (40P01) and serialisation failure (40001) to one plain sentence", async () => {
    const { messageOf } = await import("./actions");
    const { ERROR_MESSAGES, toApiError } = await import("@yuntera/db");
    for (const sqlstate of ["40P01", "40001"]) {
      const text = messageOf(toApiError({ code: sqlstate, message: "deadlock detected" }, 500));
      expect(text).toBe(ERROR_MESSAGES.try_again["es-CR"]);
      expect(text).not.toMatch(/deadlock|40P01|40001/);
    }
  });
});
