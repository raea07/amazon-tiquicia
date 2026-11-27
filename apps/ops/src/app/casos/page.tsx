import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { EmptyState, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CaseList } from "@/components/case-list";
import { CasesNav } from "@/components/cases-nav";
import { CASE_ROLES } from "@/lib/case-labels";
import { canSee, requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Casos" };

export default function CasesPage({ searchParams }: PageProps<"/casos">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Casos">
        Cada reclamo, devolución, reporte y contacto por WhatsApp, teléfono o correo, con su plazo.
        Los abiertos van del más antiguo al más reciente. Cada puesto ve los casos que atiende.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Cases searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Cases({ searchParams }: Pick<PageProps<"/casos">, "searchParams">) {
  const staff = await requireStaff("/casos", CASE_ROLES);
  const query = await searchParams;
  const closed = query.estado === "cerrados";
  const page = await (await sessionApi()).opsCases(closed ? "closed" : "open", 100);
  await connection();
  const now = Date.now();
  return (
    <>
      <CasesNav
        current={closed ? "/casos?estado=cerrados" : "/casos"}
        support={canSee(staff.staff_role, ["support"])}
      />
      <p className="mb-4 text-sm text-ink-muted">
        {page.total > page.cases.length
          ? `${page.cases.length} de ${page.total.toLocaleString("es-CR")}${closed ? ", los más recientes primero" : ", los más antiguos primero"}`
          : `${page.total} ${closed ? (page.total === 1 ? "cerrado" : "cerrados") : page.total === 1 ? "abierto" : "abiertos"}`}
        . Para registrar un contacto que llegó por WhatsApp, teléfono o correo, abra el pedido o el
        caso del cliente y use «Registrar un contacto».
      </p>
      {page.cases.length === 0 ? (
        <EmptyState title={closed ? "No hay casos cerrados" : "No hay casos abiertos"} />
      ) : (
        <CaseList cases={page.cases} now={now} />
      )}
    </>
  );
}
