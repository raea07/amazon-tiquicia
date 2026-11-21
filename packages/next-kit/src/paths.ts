/**
 * Only same-site paths are accepted as a return target. Without this check a
 * crafted link could bounce a person to another site right after they sign in.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    // Control characters (tab, newline) are stripped by browsers when parsing a
    // URL, which would turn "/\t/evil.example" into "//evil.example".
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }
  return candidate;
}

export const signInPath = (returnTo: string) =>
  `/ingresar?siguiente=${encodeURIComponent(safeReturnPath(returnTo))}`;
