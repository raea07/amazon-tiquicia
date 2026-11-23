import { brand, themeColor } from "@yuntera/brand";
import { fontClassName } from "@yuntera/next-kit/fonts";
import type { Metadata, Viewport } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.name} — ${brand.taglines["es-CR"].primary}`,
    template: `%s · ${brand.name}`,
  },
  description:
    "Compre a vendedores costarricenses y reciba su pedido con nuestros propios repartidores; hoy entregamos en el Gran Área Metropolitana. Pague con SINPE Móvil, tarjeta o contra entrega.",
  applicationName: brand.name,
  openGraph: { siteName: brand.name, locale: "es_CR", type: "website" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR" className={fontClassName}>
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
