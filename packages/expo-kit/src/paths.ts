/**
 * Only paths inside the app are accepted as a place to return to after
 * signing in. A link that opens the app (later: from an e-mail or a website)
 * carries its own `siguiente`, so it is input like any other.
 *
 * The same rule as `packages/next-kit/src/paths.ts`; `paths.test.ts` runs the
 * web's cases against this copy. (It is a copy because next-kit depends on
 * Next.js, which a native bundle must not pull in.)
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }
  return candidate;
}

/** The sign-in screen, set to come back to `returnTo` afterwards. */
export const signInPath = (returnTo: string) =>
  `/ingresar?siguiente=${encodeURIComponent(safeReturnPath(returnTo))}`;

/** A route parameter as one string (expo-router gives `string | string[]`). */
export function oneParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
