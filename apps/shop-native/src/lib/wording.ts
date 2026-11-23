/**
 * Words the shopper app shares with the website for what is not there: a
 * product taken down (or never there) and a page that does not exist. The
 * website answers both with its not-found page (apps/web/src/app/not-found.tsx);
 * the app says the same. `wording.test.ts` compares them, and checks that every
 * sentence the app says about a district we do not serve is the website's.
 */

export const NOT_FOUND = {
  title: "No encontramos esa página",
  body: "Puede que el enlace esté mal escrito o que el producto ya no esté a la venta.",
  action: "Ir al inicio",
} as const;
