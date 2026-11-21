import { type Audience, canUse } from "./roles";
import { useSession } from "./session";

export type Access = "signedOut" | "checking" | "unavailable" | "denied" | "allowed";

/**
 * Where a person stands with this app, for the root navigator's guards:
 * signed out, roles still being read, roles unreadable (offline: offer a
 * retry, never "no access"), not for them, or in.
 */
export function useAccess(audience: Audience): Access {
  const { status, roles, rolesError, rolesLoading } = useSession();
  if (status !== "signedIn") return "signedOut";
  if (roles) return canUse(audience, roles) ? "allowed" : "denied";
  if (rolesError && !rolesLoading) return "unavailable";
  return "checking";
}
