import { refreshSession } from "@yuntera/next-kit/proxy";
import { type NextRequest, NextResponse } from "next/server";
import { shopPathExists, shopPathOf } from "@/lib/shop-paths";

/**
 * Runs before a page is sent. Two jobs:
 *
 * 1. An address of a product or category that does not exist is answered with
 *    the not-found page and the status 404. It has to happen here: those pages
 *    start sending their prepared shell immediately, and once a response has
 *    started its status can no longer change (it would be a "200" page that
 *    merely says "not found", which search engines treat as a real page).
 * 2. Everything else: keep a signed-in person's session fresh.
 */
export async function proxy(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") {
    const path = shopPathOf(request.nextUrl.pathname);
    if (path === "malformed" || (path && !(await shopPathExists(path)))) {
      // An address no route answers: the framework serves the not-found page
      // (src/app/not-found.tsx) with the status 404, at the address requested.
      return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
    }
  }
  return refreshSession(request);
}

/** Deliberately not a route. Underscore-prefixed folders are never routes in the App Router. */
const NOT_FOUND_PATH = "/_no-existe";

export const config = {
  // Skip static assets: they never need a session.
  matcher: [
    "/((?!_next/static|_next/image|demo/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2|ico)$).*)",
  ],
};
