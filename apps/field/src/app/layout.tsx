import { fontClassName } from "@yuntera/next-kit/fonts";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3003"),
  title: { default: "Yuntera Ruta y Bodega", template: "%s · Yuntera" },
  description: "La aplicación de Yuntera para repartidores y personal de bodega.",
  applicationName: "Yuntera Ruta y Bodega",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0b7f8e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR" className={fontClassName}>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
