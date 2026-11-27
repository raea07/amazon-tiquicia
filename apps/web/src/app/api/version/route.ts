import { versionResponse } from "@yuntera/next-kit/version";

/**
 * Which commit this app was built from, for the console's Versiones panel.
 * Answers only the console (packages/next-kit/src/version.ts); 404 for anyone else.
 */
export function GET(request: Request) {
  return versionResponse("web", request, process.env);
}
