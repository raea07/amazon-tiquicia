import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Badge, formatDate, SelectField, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { setStaff } from "@/app/people-actions";
import { STAFF_ROLE } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Personal" };

/** What each role can do, in the words used when choosing one. */
const ROLE_HELP: Record<string, string> = {
  admin: "Todo, además de este personal, los ajustes y la auditoría",
  ops: "Pedidos, despacho, repartidores, bodegas y vendedores",
  support: "Pedidos, devoluciones, reclamos y reportes",
  finance: "Pagos, liquidaciones, reembolsos y pagos a vendedores",
  catalog: "Revisión de productos y contenido",
};

function RoleOptions() {
  return (
    <>
      {Object.entries(STAFF_ROLE).map(([role, label]) => (
        <option key={role} value={role}>
          {label}
        </option>
      ))}
    </>
  );
}

export default function StaffPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Personal">
        Quién puede entrar a esta consola y con qué rol. Un cambio aplica desde el siguiente clic de
        esa persona, y queda en la auditoría con el nombre de quien lo hizo.
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
  await requireStaff("/personal", []);
  const staff = await (await sessionApi()).opsStaff();

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="equipo">
        <h2 id="equipo" className="text-xl font-bold">
          Equipo ({staff.filter((member) => member.active).length} con acceso)
        </h2>
        <div className="mt-3">
          <DataTable caption="Personal" head={["Persona", "Rol", "Acceso", "Desde", "Cambiar"]}>
            {staff.map((member) => (
              <tr key={member.user_id}>
                <td>
                  <p className="font-semibold">
                    {member.full_name ?? "Sin nombre"}
                    {member.is_you ? <span className="font-normal"> (usted)</span> : null}
                  </p>
                  <p className="text-xs text-ink-muted">{member.email}</p>
                </td>
                <td>{STAFF_ROLE[member.role]}</td>
                <td>
                  <Badge tone={member.active ? "success" : "neutral"}>
                    {member.active ? "Con acceso" : "Sin acceso"}
                  </Badge>
                </td>
                <td className="whitespace-nowrap">
                  {formatDate(member.since, { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="min-w-64">
                  <ActionForm action={setStaff} submit="Guardar" size="sm" variant="secondary">
                    <input type="hidden" name="email" value={member.email} />
                    <SelectField
                      label={`Rol de ${member.full_name ?? member.email}`}
                      name="role"
                      defaultValue={member.role}
                    >
                      <RoleOptions />
                    </SelectField>
                    <SelectField
                      label="Acceso a la consola"
                      name="access"
                      defaultValue={member.active ? "active" : "inactive"}
                    >
                      <option value="active">Con acceso</option>
                      <option value="inactive">Sin acceso</option>
                    </SelectField>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-ink-muted">
          Siempre debe quedar al menos una persona con el rol de Administración y con acceso: el
          sistema rechaza el cambio que dejaría a la plataforma sin nadie que la administre.
        </p>
      </section>

      <section aria-labelledby="nuevo" className="max-w-xl">
        <h2 id="nuevo" className="text-xl font-bold">
          Dar acceso a una persona
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          La persona debe haber creado antes su cuenta en Yuntera; aquí no se crean cuentas. Use el
          mismo correo con el que ingresa.
        </p>
        <div className="mt-4 rounded-lg border border-border bg-surface p-5">
          <ActionForm action={setStaff} submit="Dar acceso" pendingLabel="Guardando…">
            <input type="hidden" name="access" value="active" />
            <TextField
              label="Correo de su cuenta"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
            />
            <SelectField label="Rol" name="role" defaultValue="support">
              <RoleOptions />
            </SelectField>
            <dl className="grid gap-1 text-sm text-ink-muted">
              {Object.entries(STAFF_ROLE).map(([role, label]) => (
                <div key={role} className="flex flex-wrap gap-x-2">
                  <dt className="font-semibold text-ink">{label}:</dt>
                  <dd>{ROLE_HELP[role]}</dd>
                </div>
              ))}
            </dl>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
