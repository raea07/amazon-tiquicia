/**
 * On a phone the brand's fonts are embedded in the binary by the expo-font
 * config plugin (see `src/config.ts`), so they are there at the first frame
 * and nothing has to load. The web export loads them at run time instead
 * (`fonts.web.ts`).
 */
export function useBrandFonts(): boolean {
  return true;
}
