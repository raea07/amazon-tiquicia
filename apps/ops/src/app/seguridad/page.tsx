import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { resetStaffFactor } from "@/app/security-actions";
import { STAFF_ROLE } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Seguridad del personal" };

export default function StaffSecurityPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Seguridad del personal">
        Quién del personal tiene la verificación en dos pasos. Si alguien perdió el teléfono con su
        aplicación de autenticación, reinicie aquí su verificación: tendrá que configurarla de nuevo
        al ingresar. Queda registrado en la auditoría con su nombre.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Staff />
        </Suspense>
      </div>
    </div>
  );
}

async function Staff() {
  await requireStaff("/seguridad", []);
  const people = await (await sessionApi()).opsStaffSecurity();
  // Nobody can reset their own factor here, so an administrator who loses the
  // phone needs another administrator who can still sign in.
  const guardedAdmins = people.filter(
    (person) => person.active && person.role === "admin" && person.factors > 0,
  ).length;
  return (
    <div className="flex flex-col gap-4">
      {guardedAdmins < 2 ? (
        <Alert tone="warning" title="Conviene tener dos personas administradoras">
          Hoy{" "}
          {guardedAdmins === 1
            ? "solo una persona administradora tiene"
            : "ninguna persona administradora tiene"}{" "}
          la verificación en dos pasos. Si quien administra pierde su teléfono, nadie podrá
          reiniciar su verificación desde aquí. Dé el puesto de administración a una segunda persona
          de confianza y pídale que active la verificación antes de exigirla a todo el personal.
        </Alert>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {people.map((person) => (
          <li
            key={person.user_id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  {person.full_name ?? person.email}
                  {person.is_self ? (
                    <span className="ml-1 font-normal text-ink-muted">(usted)</span>
                  ) : null}
                </p>
                <p className="break-all text-sm text-ink-muted">{person.email}</p>
                <p className="text-sm text-ink-muted">
                  {STAFF_ROLE[person.role]}
                  {person.active ? "" : " · inactivo"}
                </p>
              </div>
              <Badge tone={person.factors > 0 ? "success" : "warning"}>
                {person.factors > 0 ? "Con verificación" : "Sin verificación"}
              </Badge>
            </div>
            {person.is_self ? (
              <p className="text-sm text-ink-muted">
                Su propia verificación se administra desde Su cuenta, con un código de su
                aplicación.
              </p>
            ) : (
              <ActionForm
                action={resetStaffFactor}
                submit="Reiniciar su verificación"
                pendingLabel="Reiniciando…"
                variant="secondary"
                size="sm"
                hideOnSuccess
              >
                <input type="hidden" name="userId" value={person.user_id} />
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
