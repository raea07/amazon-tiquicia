import { ORDER_STATUS_LABEL, type OrderStatus } from "@yuntera/core";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader, Stat } from "@yuntera/next-kit/shell";
import { Alert, formatPrice, Skeleton, touchLinkClass } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Resumen" };

export default function HomePage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Hoy">Lo que necesita atención, primero lo que tiene un plazo.</PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Overview />
        </Suspense>
      </div>
    </div>
  );
}

function More({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link href={href} className={touchLinkClass()}>
      {children}
    </Link>
  );
}

async function Overview() {
  const staff = await requireStaff("/");
  const api = await sessionApi();
  // Changes to published products wait in the same queue as new products, but
  // only catalogue staff may read them.
  const [o, edits, cases] = await Promise.all([
    api.opsOverview(),
    canSee(staff.staff_role, ["catalog"]) ? api.opsListingEditsForReview() : [],
    api.opsCasesDue(),
  ]);
  const statuses = Object.entries(o.orders).filter(([, count]) => count > 0);

  return (
    <div className="flex flex-col gap-8">
      {o.payments_mode === "sandbox" ? (
        <Alert tone="info" title="Pagos en modo de prueba">
          No se cobra dinero real. Los pedidos y montos de esta consola son de demostración hasta
          que se active el cobro.
        </Alert>
      ) : null}
      {o.payments_mode === "test" ? (
        <Alert tone="info" title="Pagos por el entorno de pruebas del procesador">
          Los cobros y reembolsos pasan por el procesador con tarjetas y números de prueba. No se
          mueve dinero real.
        </Alert>
      ) : null}

      <section aria-labelledby="plazo">
        <h2 id="plazo" className="text-xl font-bold">
          Con plazo
        </h2>
        <p className="mt-2 text-sm" data-testid="cases-due">
          Casos: {cases.overdue} {cases.overdue === 1 ? "atrasado" : "atrasados"} y{" "}
          {cases.due_today} {cases.due_today === 1 ? "vence" : "vencen"} hoy, de {cases.open}{" "}
          {cases.open === 1 ? "abierto" : "abiertos"}. <More href="/casos">Ver los casos</More>
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Paquetes atrasados"
            value={o.late_shipments}
            tone={o.late_shipments > 0 ? "danger" : undefined}
            hint="Pasaron la fecha prometida al cliente"
          />
          <Stat
            label="Entregas fallidas"
            value={o.failed_deliveries}
            tone={o.failed_deliveries > 0 ? "warning" : undefined}
            hint={<More href="/despacho">Reprogramar o devolver</More>}
          />
          <Stat
            label="Devoluciones abiertas"
            value={o.open_returns}
            tone={o.open_returns > 0 ? "warning" : undefined}
            hint={<More href="/atencion">El reembolso vence a los 8 días</More>}
          />
          <Stat
            label="Reclamos abiertos"
            value={o.open_complaints}
            tone={o.open_complaints > 0 ? "warning" : undefined}
            hint={<More href="/atencion">Responder</More>}
          />
        </div>
      </section>

      <section aria-labelledby="colas">
        <h2 id="colas" className="text-xl font-bold">
          Colas de trabajo
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            label="Listos para despachar"
            value={o.awaiting_dispatch}
            hint={<More href="/despacho">Armar rutas</More>}
          />
          <Stat
            label="Efectivo por liquidar"
            value={o.open_settlements}
            hint={<More href="/liquidaciones">Liquidar rutas</More>}
          />
          <Stat
            label="Vendedores por verificar"
            value={o.sellers_pending}
            hint={<More href="/vendedores">Verificar</More>}
          />
          <Stat
            label="Productos por revisar"
            value={o.listings_in_review + edits.length}
            hint={<More href="/catalogo">Nuevos y cambios a publicados</More>}
          />
          <Stat
            label="Reportes de contenido"
            value={o.open_reports}
            hint={<More href="/atencion">Atender</More>}
          />
        </div>
      </section>

      <section aria-labelledby="pedidos">
        <h2 id="pedidos" className="text-xl font-bold">
          Pedidos
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Pedidos de hoy" value={o.orders_today} />
          <Stat label="Ventas de hoy" value={formatPrice(o.revenue_today_minor)} />
        </div>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {statuses.map(([status, count]) => (
            <li key={status}>
              <Link
                href={`/pedidos?estado=${status}` as Route}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3 hover:border-border-strong"
              >
                {ORDER_STATUS_LABEL[status as OrderStatus]?.["es-CR"] ?? status}
                <span className="font-semibold tabular-nums">{count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
