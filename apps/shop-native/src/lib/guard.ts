import type { SessionStatus } from "@yuntera/expo-kit/auth";

/**
 * Whether a screen for signed-in shoppers must send the person to /ingresar.
 *
 * Not only when signed out: halfway through the second step (a password-only
 * session of an account with an authenticator app) the database refuses every
 * personal read, and the kit's personal queries stay off, so the screen would
 * wait forever. /ingresar asks for the code and then returns to `siguiente`.
 * While the stored session is still being read ("loading") the screen waits.
 */
export function needsSignIn(status: SessionStatus): boolean {
  return status === "signedOut" || status === "secondStep";
}
