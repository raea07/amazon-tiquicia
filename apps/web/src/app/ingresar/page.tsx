import { Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm, SignUpForm } from "@/components/auth-forms";
import { getViewer, safeReturnPath } from "@/lib/session";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false } };

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
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const returnTo = safeReturnPath(one(query.siguiente));
  if (await getViewer()) redirect(returnTo as Route);

  const creating = one(query.modo) === "crear";
  const other = `/ingresar?${new URLSearchParams({
    ...(creating ? {} : { modo: "crear" }),
    siguiente: returnTo,
  })}` as Route;

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <h1 className="text-2xl font-bold">{creating ? "Crear su cuenta" : "Ingresar"}</h1>
      <p className="mt-1 mb-5 text-sm text-ink-muted">
        {creating
          ? "Para comprar y seguir sus pedidos."
          : "Con el correo y la contraseña de su cuenta."}
      </p>
      {creating ? <SignUpForm returnTo={returnTo} /> : <SignInForm returnTo={returnTo} />}
      <p className="mt-5 border-t border-border pt-4 text-sm">
        {creating ? "¿Ya tiene cuenta? " : "¿Es su primera vez? "}
        <Link href={other} className="font-semibold text-link underline">
          {creating ? "Ingresar" : "Crear una cuenta"}
        </Link>
      </p>
    </div>
  );
}
