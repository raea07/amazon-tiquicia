import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, EmptyState, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { retryNotification } from "@/app/notification-actions";
import { NotificationLine } from "@/components/notification-list";
import { CHANNEL } from "@/lib/notification-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Mensajes detenidos" };

export default function DeadLettersPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Mensajes detenidos">
        Avisos que no se pudieron enviar después de varios intentos, o que el proveedor rechazó.
        Revise el motivo, corrija lo que haga falta y vuelva a enviarlos.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <DeadLetters />
        </Suspense>
      </div>
    </div>
  );
}

async function DeadLetters() {
  await requireStaff("/mensajes", ["support"]);
  const dead = await (await sessionApi()).opsNotificationDeadLetters(100);

  return (
    <div className="flex flex-col gap-5">
      {dead.paused_channels.map((pause) => (
        <Alert key={pause.channel} tone="warning" title={`${CHANNEL[pause.channel]} en pausa`}>
          El proveedor rechazó las credenciales o la configuración. No se envía nada por este canal
          hasta las {formatDateTime(pause.until)}. Revise la configuración del proveedor.
        </Alert>
      ))}
      {dead.items.length === 0 ? (
        <EmptyState title="No hay mensajes detenidos">
          Todo lo que se planeó enviar salió o se descartó por una buena razón.
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {dead.dead_count === 1
              ? "1 mensaje detenido."
              : `${dead.dead_count} mensajes detenidos.`}{" "}
            Reenviar crea un envío nuevo: si el primero sí llegó, la persona lo recibirá dos veces.
          </p>
          <ul className="flex flex-col gap-2">
            {dead.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <NotificationLine row={row} />
                <div className="flex flex-wrap items-center gap-3">
                  {row.order_number ? (
                    <Link href={`/pedidos/${row.order_number}`} className="text-link underline">
                      Pedido {row.order_number}
                    </Link>
                  ) : null}
                  <ActionForm
                    action={retryNotification}
                    submit="Reenviar"
                    variant="secondary"
                    pendingLabel="Reenviando…"
                    hideOnSuccess
                    className="flex flex-wrap items-center gap-3"
                  >
                    <input type="hidden" name="deliveryId" value={row.id} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
