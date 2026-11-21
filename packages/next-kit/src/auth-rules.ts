/**
 * The rules every sign-in screen applies before anything reaches Auth, in one
 * place so sign-up, password reset and password change say exactly the same
 * thing. Pure functions: used by the forms in the browser and by the Server
 * Actions, and unit-tested.
 */

/** Matches the project's Auth setting (`password_min_length`, runbook step 6). */
export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt, which Auth uses, reads only the first 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

/** Shown next to every new-password field, before anything is sent. */
export const PASSWORD_RULES = [
  `Al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  "Que no sea su correo ni una palabra fácil de adivinar.",
] as const;

export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/** What is wrong with a new password, in words a person can act on, or null. */
export function passwordProblem(
  password: string,
  options: { repeat?: string; email?: string | null } = {},
): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return "La contraseña es demasiado larga. Use una de menos de 70 caracteres.";
  }
  if (options.email && password.trim().toLowerCase() === options.email.trim().toLowerCase()) {
    return "La contraseña no puede ser su correo.";
  }
  if (options.repeat !== undefined && options.repeat !== password) {
    return "Las dos contraseñas no coinciden. Escríbala igual en ambos campos.";
  }
  return null;
}

/**
 * A 6-digit code as people type it ("123 456", "123-456"), or null when it is
 * not one.
 */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The e-mail link types this project sends, and what each one leads to. */
export const LINK_TYPES = [
  "recovery",
  "email",
  "signup",
  "invite",
  "magiclink",
  "email_change",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const isLinkType = (value: unknown): value is LinkType =>
  typeof value === "string" && (LINK_TYPES as readonly string[]).includes(value);

/** A token hash from an e-mail link: hex, optionally with Auth's `pkce_` prefix. */
export const isTokenHash = (value: unknown): value is string =>
  typeof value === "string" && /^(pkce_)?[0-9a-f]{40,128}$/.test(value);
