import { SignInForm } from "@yuntera/next-kit/client";
import {
  endedSessionNotice,
  getViewer,
  redirectTo,
  safeReturnPath,
} from "@yuntera/next-kit/server";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Frame } from "@/components/frame";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Ingresar" };

export default function SignInPage({ searchParams }: PageProps<"/ingresar">) {
  return (
    <Frame app="driver">
      <div className="shell flex justify-center py-8">
        <div className="w-full max-w-md">
          <Suspense fallback={<Skeleton className="h-80" />}>
            <Access searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </Frame>
  );
}

async function Access({ searchParams }: Pick<PageProps<"/ingresar">, "searchParams">) {
  const next = (await searchParams).siguiente;
  const returnTo = safeReturnPath(Array.isArray(next) ? next[0] : next);
  if (await getViewer()) redirectTo(returnTo);

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Ingresar</h1>
      <p className="mt-1 mb-5 text-sm text-ink-muted">
        Para repartidores y personal de bodega de Yuntera.
      </p>
      <SignInForm action={signIn} returnTo={returnTo} notice={await endedSessionNotice()} />
    </div>
  );
}
