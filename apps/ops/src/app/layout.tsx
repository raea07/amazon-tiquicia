import { apps } from "@yuntera/brand";
import { NavLinks } from "@yuntera/next-kit/client";
import { fontClassName } from "@yuntera/next-kit/fonts";
import { AppShell } from "@yuntera/next-kit/shell";
import { buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { STAFF_ROLE } from "@/lib/labels";
import { canSee, currentStaff, SECTIONS } from "@/lib/staff";
import { signOut } from "./actions";
import "./globals.css";

const app = apps.ops;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002"),
  title: { default: app.name, template: `%s · ${app.name}` },
  description: "Consola interna de Yuntera.",
  applicationName: app.name,
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0b7f8e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR" className={fontClassName}>
      <body className="flex min-h-dvh flex-col antialiased">
        <AppShell
          app="ops"
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

async function Account() {
  const staff = await currentStaff();
  if (!staff) return null;
  return (
    <>
      <span>
        <span className="font-semibold">{staff.full_name ?? "Personal"}</span>
        <span className="ml-2 text-ink-muted">{STAFF_ROLE[staff.staff_role]}</span>
      </span>
      <form action={signOut}>
        <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
          Salir
        </button>
      </form>
    </>
  );
}

async function Sections() {
  const staff = await currentStaff();
  if (!staff) return null;
  return (
    <NavLinks
      items={SECTIONS.filter((section) => canSee(staff.staff_role, section.roles)).map(
        ({ href, label }) => ({ href, label }),
      )}
    />
  );
}
