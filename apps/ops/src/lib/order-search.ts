/**
 * The console's order search keeps what staff typed out of URLs (WEB-4): it
 * lives in this cookie, sent only to /pedidos, for a quarter of an hour.
 */
// Removed whenever a session ends or begins (PER_PERSON_COOKIES), so the
// next person at a shared desk does not see the previous one's search.
export { ORDER_SEARCH_COOKIE } from "@yuntera/next-kit/guard";
export const ORDER_SEARCH_MAX = 80;
