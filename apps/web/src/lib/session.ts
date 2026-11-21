import { signInPath } from "@yuntera/next-kit/server";
import type { Route } from "next";

export { getViewer, requireViewer, safeReturnPath, type Viewer } from "@yuntera/next-kit/server";

/** The sign-in page, set to come back to `returnTo` afterwards. */
export const signInUrl = (returnTo: string) => signInPath(returnTo) as Route;
