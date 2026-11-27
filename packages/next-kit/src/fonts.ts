import localFont from "next/font/local";

// The Carreta typefaces, self-hosted (SIL Open Font License; see ../fonts/OFL-*
// and ../fonts/MODIFICATIONS.txt). No request leaves the site to load them.
//
// The files are byte-for-byte copies of docs/brand/system/fonts/web, one file
// per weight, each holding every character the apps need (₡, U+202F, Spanish
// letters, tabular digits by default), so no unicode-range split is needed.
// ../fonts/fonts.test.ts compares them with the specification's manifest.
//
// The variables are bound to today's Tailwind names (--font-sans,
// --font-display) and to the Carreta ones (--yt-font-text, --yt-font-title)
// in ../styles/base.css.

/** Fira Sans 400–700: every word people read or press. */
export const firaSans = localFont({
  src: [
    { path: "../fonts/fira-sans-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/fira-sans-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/fira-sans-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/fira-sans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fira-sans",
  display: "swap",
});

/** Epilogue 600–800: titles, prices and the delivery code. */
export const epilogue = localFont({
  src: [
    { path: "../fonts/epilogue-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/epilogue-700.woff2", weight: "700", style: "normal" },
    { path: "../fonts/epilogue-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-epilogue",
  display: "swap",
});

/** @deprecated Today's name for the text face; now Fira Sans. Removed in step 6. */
export const inter = firaSans;

/** @deprecated Today's name for the title face; now Epilogue. Removed in step 6. */
export const bricolage = epilogue;

/** Put this on <html> so both font variables are defined for the whole page. */
export const fontClassName = `${firaSans.variable} ${epilogue.variable}`;
