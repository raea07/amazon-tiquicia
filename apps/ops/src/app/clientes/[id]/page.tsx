import { ORDER_STATUS_LABEL, type OrderStatus } from "@yuntera/core";
import { ApiError, type CustomerView } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { Alert, formatDateTime, formatPrice, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RecordContactForm, RevealContactForm } from "@/components/case-forms";
import { CaseList } from "@/components/case-list";
import { COMPLAINT_CATEGORY, RETURN_KIND, RETURN_STATUS } from "@/lib/labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Cliente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPLAINT_STATUS: Record<string, string> = {
  open: "Sin responder",
  in_progress: "En curso",
  resolved: "Resuelto",
};

/**
 * One customer across their orders, reached from an order or a case (there
 * is no list of all customers). First name and district only; the e-mail
 * and phone only behind "Mostrar contacto", with a reason on the audit trail.
 */
export default function CustomerPage({ params }: PageProps<"/clientes/[id]">) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Customer params={params} />
      </Suspense>
    </div>
  );
}

async function Customer({ params }: Pick<PageProps<"/clientes/[id]">, "params">) {
  const { id } = await params;
  const staff = await requireStaff(`/clientes/${id}`, ["support", "ops", "finance"]);
  if (!UUID.test(id)) notFound();
  let customer: CustomerView;
  try {
    customer = await (await sessionApi()).opsCustomer(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "customer_not_found") notFound();
    throw error;
  }
  await connection();
  const now = Date.now();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="text-3xl font-bold">{customer.first_name ?? "Cliente sin nombre"}</h1>
          <p className="mt-1 text-ink-muted">
            {customer.district ?? "Sin distrito"} · {customer.order_count}{" "}
            {customer.order_count === 1 ? "pedido" : "pedidos"}
          </p>
          {customer.account_deleted ? (
            <Alert tone="info" className="mt-3" title="La cuenta se eliminó">
              Sus pedidos se conservan sin sus datos personales.
            </Alert>
          ) : null}
        </header>

        <section aria-labelledby="casos">
          <h2 id="casos" className="text-xl font-bold">
            Casos
          </h2>
          {customer.cases.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Ningún caso que su puesto atienda.</p>
          ) : (
            <div className="mt-3">
              <CaseList cases={customer.cases} now={now} />
            </div>
          )}
        </section>

        <section aria-labelledby="pedidos">
          <h2 id="pedidos" className="text-xl font-bold">
            Pedidos
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {customer.orders.map((order) => (
              <li
                key={order.order_number}
                className="flex flex-wrap justify-between gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <Link
                  href={`/pedidos/${order.order_number}` as Route}
                  className="inline-flex min-h-11 items-center font-semibold text-link underline"
                >
                  {order.order_number}
                </Link>
                <span className="inline-flex items-center text-ink-muted">
                  {ORDER_STATUS_LABEL[order.status as OrderStatus]?.["es-CR"] ?? order.status} ·{" "}
                  {formatDateTime(order.placed_at)} · {formatPrice(order.total_minor)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="devoluciones">
          <h2 id="devoluciones" className="text-xl font-bold">
            Devoluciones
          </h2>
          {customer.returns.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Ninguna.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {customer.returns.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-surface p-3">
                  <p className="font-semibold">
                    {RETURN_KIND[item.kind] ?? item.kind}: {item.quantity} × {item.title}
                  </p>
                  <p className="text-ink-muted">
                    {RETURN_STATUS[item.status]?.label ?? item.status} · pedido {item.order_number}{" "}
                    · {formatDateTime(item.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="reclamos">
          <h2 id="reclamos" className="text-xl font-bold">
            Reclamos
          </h2>
          {customer.complaints.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Ninguno.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {customer.complaints.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-surface p-3">
                  <p className="font-semibold">
                    {COMPLAINT_CATEGORY[item.category] ?? item.category}
                  </p>
                  <p className="text-ink-muted">
                    {COMPLAINT_STATUS[item.status] ?? item.status}
                    {item.order_number ? ` · pedido ${item.order_number}` : ""} ·{" "}
                    {formatDateTime(item.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside aria-label="Contacto" className="flex h-fit flex-col gap-5">
        {customer.can_reveal_contact && !customer.account_deleted ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-bold">Contacto</h2>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              El correo y el teléfono no se muestran hasta que usted diga para qué los necesita.
            </p>
            <RevealContactForm userId={customer.id} />
          </div>
        ) : null}
        {canSee(staff.staff_role, ["support"]) && !customer.account_deleted ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-bold">Registrar un contacto</h2>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Una conversación por WhatsApp, teléfono o correo que no es de un pedido en particular.
            </p>
            <RecordContactForm userId={customer.id} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
