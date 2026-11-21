import { SignInForm } from "@yuntera/next-kit/client";
import { getViewer, redirectTo, safeReturnPath } from "@yuntera/next-kit/server";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Ingresar" };

export default function SignInPage({ searchParams }: PageProps<"/ingresar">) {
  return (
    <div className="shell flex justify-center py-10">
      <div className="w-full max-w-md">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Access searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Access({ searchParams }: Pick<PageProps<"/ingresar">, "searchParams">) {
  const next = (await searchParams).siguiente;
  const returnTo = safeReturnPath(Array.isArray(next) ? next[0] : next);
  if (await getViewer()) redirectTo(returnTo);

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Ingresar a su tienda</h1>
      <p className="mt-1 mb-5 text-sm text-ink-muted">
        Con el mismo correo y contraseña que usa para comprar en Yuntera.
      </p>
      <SignInForm action={signIn} returnTo={returnTo} />
      <p className="mt-5 border-t border-border pt-4 text-sm">
        ¿Todavía no vende en Yuntera?{" "}
        <Link href="/registro" className="font-semibold text-link underline">
          Registre su tienda
        </Link>
      </p>
    </div>
  );
}
