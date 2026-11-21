import localFont from "next/font/local";

// Self-hosted variable fonts (SIL Open Font License; see ../fonts/LICENSE-*).
// No request leaves the site to load them.

export const inter = localFont({
  src: [
    { path: "../fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const bricolage = localFont({
  src: [
    {
      path: "../fonts/bricolage-grotesque-latin-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
    {
      path: "../fonts/bricolage-grotesque-latin-ext-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
  ],
  variable: "--font-bricolage",
  display: "swap",
});

/** Put this on <html> so both font variables are defined for the whole page. */
export const fontClassName = `${inter.variable} ${bricolage.variable}`;
