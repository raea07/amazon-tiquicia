import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  InviteForm,
  MemberRoleForm,
  RemoveMemberForm,
  RevokeInvitationForm,
} from "@/components/team-forms";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Equipo" };

const ROLE = {
  owner: { label: "Dueño", tone: "info" },
  admin: { label: "Administración", tone: "neutral" },
  staff: { label: "Personal", tone: "neutral" },
} as const;

export default function TeamPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Equipo">
        Quién trabaja en su tienda. Nadie entra al equipo sin aceptar la invitación.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Team />
        </Suspense>
      </div>
    </div>
  );
}

async function Team() {
  const { shop } = await requireShop("/equipo");
  const team = await (await sessionApi()).sellerTeam(shop.id);
  const day = (value: string) => formatDate(value, { day: "numeric", month: "long" });

  return (
    <div className="grid max-w-4xl gap-6">
      <section
        aria-labelledby="miembros"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <h2 id="miembros" className="text-lg font-bold">
          Personas en el equipo
        </h2>
        <ul className="mt-3 divide-y divide-border">
          {team.members.map((member) => {
            const role = ROLE[member.role];
            const name = member.full_name ?? member.email ?? "Sin nombre";
            const canChange = team.is_owner && member.role !== "owner";
            const canRemove =
              member.role !== "owner" &&
              (team.is_owner || (team.can_manage && member.role === "staff"));
            return (
              <li key={member.user_id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">
                      {name}
                      {member.is_you ? <span className="text-ink-muted"> (usted)</span> : null}
                    </p>
                    {member.email ? (
                      <p className="text-sm break-all text-ink-muted">{member.email}</p>
                    ) : null}
                    <p className="text-sm text-ink-muted">Desde el {day(member.since)}</p>
                  </div>
                  <Badge tone={role.tone}>{role.label}</Badge>
                </div>
                {canChange || canRemove || (member.is_you && member.role !== "owner") ? (
                  <div className="flex flex-wrap items-end gap-3">
                    {canChange && member.role !== "owner" ? (
                      <MemberRoleForm userId={member.user_id} role={member.role} name={name} />
                    ) : null}
                    {canRemove && !member.is_you ? (
                      <RemoveMemberForm userId={member.user_id} leaving={false} />
                    ) : null}
                    {member.is_you && member.role !== "owner" ? (
                      <RemoveMemberForm userId={member.user_id} leaving />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {team.can_manage ? (
        <>
          <section
            aria-labelledby="pendientes"
            className="rounded-lg border border-border bg-surface p-5"
          >
            <h2 id="pendientes" className="text-lg font-bold">
              Invitaciones sin responder
            </h2>
            {team.invitations.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No hay invitaciones esperando respuesta.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {team.invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-all">{invitation.email}</p>
                      <p className="text-sm text-ink-muted">
                        {ROLE[invitation.role].label} · vence el {day(invitation.expires_at)}
                      </p>
                    </div>
                    {team.is_owner || invitation.role === "staff" ? (
                      <RevokeInvitationForm invitationId={invitation.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="invitar"
            className="rounded-lg border border-border bg-surface p-5"
          >
            <h2 id="invitar" className="text-lg font-bold">
              Invitar a alguien
            </h2>
            <p className="mt-1 mb-4 text-sm text-ink-muted">
              La persona ve la invitación al ingresar a Yuntera Vende con su correo y decide si
              acepta. Hasta entonces no ve nada de su tienda.
            </p>
            <div className="max-w-xl">
              <InviteForm canInviteAdmins={team.is_owner} />
            </div>
          </section>
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          Solo la persona dueña o administradora de la tienda puede invitar o quitar personas.
        </p>
      )}
    </div>
  );
}
