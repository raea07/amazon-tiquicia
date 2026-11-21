import type { AppId } from "@yuntera/brand";
import { getRoles } from "@yuntera/next-kit/server";
import { AppShell } from "@yuntera/next-kit/shell";
import { buttonClass, Skeleton } from "@yuntera/ui";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { signOut } from "@/app/actions";

/** The frame around every screen: which app this is, who is signed in, the way out. */
export function Frame({ app, children }: { app: AppId; children: ReactNode }) {
  return (
    <AppShell
      app={app}
      account={
        <Suspense fallback={<Skeleton className="h-9 w-24" />}>
          <Account />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}

async function Account() {
  const roles = await getRoles();
  if (!roles) return null;
  const both = roles.driver && roles.warehouses.length > 0;
  return (
    <>
      {both ? (
        <Link href="/" className={buttonClass({ variant: "ghost", size: "sm" })}>
          Cambiar
        </Link>
      ) : null}
      <form action={signOut}>
        <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
          Salir
        </button>
      </form>
    </>
  );
}
