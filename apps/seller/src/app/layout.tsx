import { apps, themeColor } from "@yuntera/brand";
import { NavLinks } from "@yuntera/next-kit/client";
import { fontClassName } from "@yuntera/next-kit/fonts";
import { getViewer } from "@yuntera/next-kit/server";
import { AppShell } from "@yuntera/next-kit/shell";
import { buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentShop, getOverview } from "@/lib/shop";
import { chooseShop, signOut } from "./actions";
import "./globals.css";

const app = apps.seller;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"),
  title: { default: app.name, template: `%s · ${app.name}` },
  description: "Venda en Yuntera: publique sus productos, despache sus pedidos y siga sus pagos.",
  applicationName: app.name,
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor, width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR" className={fontClassName}>
      <body className="flex min-h-dvh flex-col antialiased">
        <AppShell
          app="seller"
          account={
            <Suspense fallback={<Skeleton className="h-9 w-40" />}>
              <Account />
            </Suspense>
          }
          nav={
            <Suspense fallback={<div className="h-11" />}>
              <Sections />
            </Suspense>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}

/** Who is signed in, which shop they are in, and the way out. */
async function Account() {
  const session = await currentShop();
  if (!session) {
    // Signed in without a shop yet (registering one, or answering an invitation).
    if (await getViewer()) {
      return (
        <form action={signOut}>
          <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
            Salir
          </button>
        </form>
      );
    }
    return (
      <Link href="/ingresar" className={buttonClass({ variant: "ghost", size: "sm" })}>
        Ingresar
      </Link>
    );
  }
  const { roles, shop } = session;
  return (
    <>
      {roles.sellers.length > 1 ? (
        <form action={chooseShop} className="flex items-center gap-2">
          <label htmlFor="shop" className="sr-only">
            Tienda
          </label>
          <select
            id="shop"
            name="shopId"
            defaultValue={shop.id}
            className="min-h-9 max-w-44 rounded-md border border-border-strong bg-surface px-2 text-sm"
          >
            {roles.sellers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.trade_name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Cambiar
          </button>
        </form>
      ) : (
        <span className="font-semibold">{shop.trade_name}</span>
      )}
      <form action={signOut}>
        <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
          Salir
        </button>
      </form>
    </>
  );
}

/** Section links, shown once the person has a shop. */
async function Sections() {
  const session = await currentShop();
  if (!session) return null;
  const overview = await getOverview(session.shop.id);
  return (
    <NavLinks
      items={[
        { href: "/", label: "Resumen" },
        { href: "/productos", label: "Productos" },
        { href: "/inventario", label: "Inventario" },
        { href: "/pedidos", label: "Pedidos", count: overview.counts.to_pack },
        { href: "/pagos", label: "Pagos" },
        { href: "/equipo", label: "Equipo" },
        { href: "/cuenta", label: "Cuenta" },
      ]}
    />
  );
}
