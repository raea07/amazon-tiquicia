import { brand } from "@yuntera/brand";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import "./globals.css";

// Self-hosted variable fonts (SIL Open Font License; see ./fonts/LICENSE-*).
// No request leaves the site to load them.
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const bricolage = localFont({
  src: [
    {
      path: "./fonts/bricolage-grotesque-latin-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
    {
      path: "./fonts/bricolage-grotesque-latin-ext-wght-normal.woff2",
      weight: "200 800",
      style: "normal",
    },
  ],
  variable: "--font-bricolage",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.name} — ${brand.taglines["es-CR"].primary}`,
    template: `%s · ${brand.name}`,
  },
  description:
    "Compre a vendedores costarricenses y reciba al día siguiente en el Gran Área Metropolitana. Pague con SINPE Móvil, tarjeta o contra entrega.",
  applicationName: brand.name,
  openGraph: { siteName: brand.name, locale: "es_CR", type: "website" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b7f8e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-md"
        >
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
