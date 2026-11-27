import { EmptyState, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CaseAnswers } from "@/components/case-answers";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Sus consultas", robots: { index: false } };

/**
 * The shopper's reclamos, devoluciones and consultas, with what Yuntera
 * answered. This is where an answer is read while no message provider is
 * connected; the messages only say there is one.
 */
export default function CasesPage() {
  return (
    <div className="shell max-w-3xl py-8">
      <h1 className="text-3xl font-bold">Sus consultas</h1>
      <p className="mt-2 text-ink-muted">
        Sus reclamos, devoluciones y lo que nos consultó por WhatsApp, teléfono o correo, con
        nuestras respuestas.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Cases />
        </Suspense>
      </div>
    </div>
  );
}

async function Cases() {
  await requireViewer("/cuenta/casos");
  const cases = await (await sessionApi()).myCases();
  if (cases.length === 0) {
    return (
      <EmptyState title="No tiene consultas">
        Si algo no salió bien,{" "}
        <Link href="/reclamo" className="font-semibold text-link underline">
          presente un reclamo
        </Link>
        .
      </EmptyState>
    );
  }
  return <CaseAnswers cases={cases} showOrder />;
}
