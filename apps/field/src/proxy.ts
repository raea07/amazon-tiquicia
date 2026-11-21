export { refreshSession as proxy } from "@yuntera/next-kit/proxy";

export const config = {
  // Skip static assets: they never need a session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2|ico)$).*)",
  ],
};
