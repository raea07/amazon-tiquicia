import { redirectTo, requireRoles } from "@yuntera/next-kit/server";
import { Skeleton } from "@yuntera/ui";
import Link from "next/link";
import { Suspense } from "react";
import { Frame } from "@/components/frame";

export default function HomePage() {
  return (
    <Frame app="driver">
      <div className="shell py-8">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Choose />
        </Suspense>
      </div>
    </Frame>
  );
}

/** Sends each person straight to their work; asks only those who do both. */
async function Choose() {
  const roles = await requireRoles("/");
  const drives = roles.driver?.status === "active";
  const works = roles.warehouses.length > 0;
  if (drives && !works) redirectTo("/ruta");
  if (works && !drives) redirectTo("/bodega");
  if (!drives && !works) redirectTo("/sin-acceso");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">¿Qué va a hacer hoy?</h1>
      <Link
        href="/ruta"
        className="rounded-lg border border-border bg-surface p-5 hover:border-brand"
      >
        <span className="block font-display text-xl font-bold">Repartir</span>
        <span className="text-sm text-ink-muted">Su ruta del día y las entregas.</span>
      </Link>
      <Link
        href="/bodega"
        className="rounded-lg border border-border bg-surface p-5 hover:border-brand"
      >
        <span className="block font-display text-xl font-bold">Bodega</span>
        <span className="text-sm text-ink-muted">Alistar pedidos y recibir mercadería.</span>
      </Link>
    </div>
  );
}
