import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDate, Skeleton, TextAreaField } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { setSellerStatus } from "@/app/actions";
import { SELLER_STATUS } from "@/lib/labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Vendedores" };

const FILTERS = [
  ["pending", "Por verificar"],
  ["active", "Activos"],
  ["suspended", "Suspendidos"],
  ["closed", "Cerrados"],
] as const;

const ID_TYPE = {
  fisica: "Cédula física",
  juridica: "Cédula jurídica",
  dimex: "DIMEX",
  nite: "NITE",
};

export default function SellersPage({ searchParams }: PageProps<"/vendedores">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Vendedores">
        Activar a un vendedor es decidir que sabemos quién es. Antes de hacerlo, confirme el nombre
        y la identificación en la consulta de situación tributaria de Hacienda.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Sellers searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Sellers({ searchParams }: Pick<PageProps<"/vendedores">, "searchParams">) {
  const staff = await requireStaff("/vendedores", ["ops", "support", "finance"]);
  const asked = (await searchParams).estado;
  const status =
    FILTERS.find(([value]) => value === (Array.isArray(asked) ? asked[0] : asked))?.[0] ??
    "pending";
  const sellers = await (await sessionApi()).opsSellers(status);
  const canChange = canSee(staff.staff_role, ["ops"]);

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([value, label]) => (
          <li key={value}>
            <Link
              href={`/vendedores?estado=${value}` as Route}
              aria-current={value === status ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-4 ${
                value === status
                  ? "border-brand bg-brand-soft font-semibold"
                  : "border-border bg-surface hover:border-border-strong"
              }`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>

      {sellers.length === 0 ? (
        <EmptyState title="Ningún vendedor en este estado" />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {sellers.map((seller) => {
            const label = SELLER_STATUS[seller.status];
            return (
              <li
                key={seller.id}
                className="rounded-lg border border-border bg-surface p-5 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold">{seller.trade_name}</h2>
                  <Badge tone={label?.tone ?? "neutral"}>{label?.label ?? seller.status}</Badge>
                </div>
                <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-muted">Nombre o razón social</dt>
                    <dd className="font-medium">{seller.legal_name}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">{ID_TYPE[seller.id_type]}</dt>
                    <dd className="font-medium tabular-nums">{seller.id_number}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Contacto</dt>
                    <dd className="font-medium">
                      {seller.contact_email}
                      <span className="block">{seller.contact_phone}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Desde</dt>
                    <dd className="font-medium">
                      {formatDate(seller.created_at, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}{" "}
                      · {seller.listings} producto(s) · puntaje {seller.score}
                    </dd>
                  </div>
                </dl>
                {canChange && seller.status !== "closed" ? (
                  <div className="mt-4 border-t border-border pt-4">
                    {seller.status === "active" ? (
                      <ActionForm
                        action={setSellerStatus}
                        submit="Suspender"
                        variant="danger"
                        size="sm"
                        hideOnSuccess
                      >
                        <input type="hidden" name="sellerId" value={seller.id} />
                        <input type="hidden" name="status" value="suspended" />
                        <TextAreaField
                          label="Motivo de la suspensión"
                          name="note"
                          rows={2}
                          hint="Se le envía al vendedor. Sus productos dejan de mostrarse de inmediato."
                        />
                      </ActionForm>
                    ) : (
                      <ActionForm
                        action={setSellerStatus}
                        submit={seller.status === "pending" ? "Verificar y activar" : "Reactivar"}
                        size="sm"
                        hideOnSuccess
                      >
                        <input type="hidden" name="sellerId" value={seller.id} />
                        <input type="hidden" name="status" value="active" />
                        <TextAreaField
                          label="Nota de verificación"
                          name="note"
                          rows={2}
                          optional
                          hint="Qué revisó: por ejemplo, “Coincide con Hacienda, actividad 4771”."
                        />
                      </ActionForm>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
