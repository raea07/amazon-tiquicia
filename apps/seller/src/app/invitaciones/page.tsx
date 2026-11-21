import type { MyInvitation } from "@yuntera/db";
import { getRoles, requireViewer, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, EmptyState, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AnswerInvitationForm } from "@/components/team-forms";

export const metadata: Metadata = { title: "Invitaciones" };

const ROLE = {
  owner: "dueño",
  admin: "administración",
  staff: "personal",
} as const;

/** Invitations to join a shop. Open to anyone signed in: that is who gets invited. */
export default function InvitationsPage({ searchParams }: PageProps<"/invitaciones">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Invitaciones">
        Tiendas que le invitaron a trabajar en su equipo. Usted decide si se une.
      </PageHeader>
      <div className="mt-6 max-w-2xl">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Invitations searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Invitations({ searchParams }: Pick<PageProps<"/invitaciones">, "searchParams">) {
  await requireViewer("/invitaciones");
  const [invitations, query] = await Promise.all([
    (await sessionApi()).myInvitations(),
    searchParams,
  ]);
  const joined = query.unido === "1" ? (await getRoles())?.sellers : null;
  return (
    <div className="flex flex-col gap-4">
      {query.salio === "1" ? (
        <Alert tone="success" title="Salió del equipo">
          Ya no ve ni trabaja en esa tienda. Si fue un error, pida a la persona dueña que le invite
          de nuevo.
        </Alert>
      ) : null}
      {joined && joined.length > 0 ? (
        <Alert tone="success" title="Ya es parte del equipo">
          Ya puede trabajar en la tienda.{" "}
          {/* A plain link: the summary loads afresh, with the shop just joined. */}
          <a href="/?equipo=1" className="font-semibold underline">
            Ir al resumen
          </a>
          .
        </Alert>
      ) : null}
      <List invitations={invitations} hideEmpty={Boolean(joined?.length)} />
    </div>
  );
}

function List({ invitations, hideEmpty }: { invitations: MyInvitation[]; hideEmpty: boolean }) {
  if (invitations.length === 0 && hideEmpty) return null;
  if (invitations.length === 0) {
    return (
      <EmptyState title="No tiene invitaciones">
        Cuando una tienda le invite con su correo, aparece aquí.{" "}
        <Link href="/registro" className="font-semibold text-link underline">
          También puede registrar su propia tienda
        </Link>
        .
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-bold break-words">{invitation.shop.trade_name}</h2>
          <p className="mt-1 text-sm">
            {invitation.invited_by_name ?? "La tienda"} le invitó a unirse como{" "}
            <strong>{ROLE[invitation.role]}</strong>. La invitación vence el{" "}
            {formatDate(invitation.expires_at, { day: "numeric", month: "long" })}.
          </p>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            Si acepta, podrá ver y trabajar en esta tienda desde Yuntera Vende. Si no conoce a esta
            tienda, rechácela.
          </p>
          <AnswerInvitationForm invitationId={invitation.id} />
        </li>
      ))}
    </ul>
  );
}
