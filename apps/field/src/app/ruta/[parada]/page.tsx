import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, buttonClass, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { arrive } from "@/app/actions";
import { DeliverForm, FailForm } from "@/components/driver-forms";
import { requireDriver } from "@/lib/access";

export const metadata: Metadata = { title: "Parada" };

export default function StopPage({ params }: PageProps<"/ruta/[parada]">) {
  return (
    <div className="shell max-w-2xl py-6">
      <p className="text-sm">
        <Link href="/ruta" className="text-link underline">
          ← Mi ruta
        </Link>
      </p>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Stop params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Stop({ params }: Pick<PageProps<"/ruta/[parada]">, "params">) {
  const { parada } = await params;
  await requireDriver(`/ruta/${parada}`);
  const { routes } = await (await sessionApi()).driverToday();
  const route = routes.find((candidate) => candidate.stops.some((stop) => stop.stop_id === parada));
  const stop = route?.stops.find((candidate) => candidate.stop_id === parada);
  if (!route || !stop) notFound();

  const open = stop.status === "pending" || stop.status === "arrived";
  const digits = stop.phone.replace(/\D/g, "");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-sm text-ink-muted">
          Parada {stop.sequence} · paquete {stop.tracking_code} · {stop.package_count}{" "}
          {stop.package_count === 1 ? "bulto" : "bultos"}
        </p>
        <h1 className="text-2xl font-bold">{stop.recipient_name}</h1>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-muted">Señas</h2>
        <p className="mt-1 text-lg">{stop.senas}</p>
        {stop.plus_code ? (
          <p className="mt-1 text-sm text-ink-muted">Código Plus {stop.plus_code}</p>
        ) : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ block: true })}
          >
            Cómo llegar
          </a>
          <a
            href={`tel:${stop.phone}`}
            className={buttonClass({ variant: "secondary", block: true })}
          >
            Llamar
          </a>
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: "secondary", block: true })}
          >
            WhatsApp
          </a>
        </div>
      </section>

      {stop.cod_amount_minor > 0 && open ? (
        <Alert tone="warning" title={`Cobrar ${formatPrice(stop.cod_amount_minor)} en efectivo`}>
          Monto exacto. Si no lo tienen completo, no entregue el paquete y regístrelo abajo.
        </Alert>
      ) : null}

      {!open ? (
        <Alert tone={stop.status === "delivered" ? "success" : "warning"}>
          {stop.status === "delivered"
            ? "Esta parada ya fue entregada."
            : "Esta parada quedó como no entregada."}
        </Alert>
      ) : route.status !== "in_progress" ? (
        <Alert tone="info">Inicie la ruta para poder entregar.</Alert>
      ) : (
        <>
          {stop.status === "pending" ? (
            <ActionForm action={arrive} submit="Llegué" variant="secondary" size="lg" hideOnSuccess>
              <input type="hidden" name="stopId" value={stop.stop_id} />
            </ActionForm>
          ) : (
            <Alert tone="info">Llegada registrada. Entregue el paquete y pida el código.</Alert>
          )}

          <section className="rounded-lg border-2 border-brand bg-surface p-5">
            <h2 className="text-lg font-bold">Entregar</h2>
            {stop.pin_attempts_left <= 2 ? (
              <p className="mt-1 text-sm font-semibold text-danger">
                {stop.pin_attempts_left === 0
                  ? "Código bloqueado por demasiados intentos. Llame a Central."
                  : `Le quedan ${stop.pin_attempts_left} intento(s) de código.`}
              </p>
            ) : null}
            <div className="mt-4">
              <DeliverForm stop={stop} />
            </div>
          </section>

          <details className="rounded-lg border border-border bg-surface p-5">
            <summary className="cursor-pointer font-semibold">No se pudo entregar</summary>
            <div className="mt-4">
              <FailForm stopId={stop.stop_id} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
