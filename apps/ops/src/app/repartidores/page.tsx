import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Badge, buttonClass, EmptyState, formatDate, SelectField, Skeleton } from "@yuntera/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { setDriverStatus } from "@/app/actions";
import { DriverForm } from "@/components/people-forms";
import { DRIVER_STATUS, VEHICLE } from "@/lib/labels";
import { ID_TYPE } from "@/lib/people-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Repartidores" };

export default function DriversPage({ searchParams }: PageProps<"/repartidores">) {
  return (
    <div className="shell py-8">
      <PageHeader title="Repartidores">
        Solo un repartidor activo puede recibir rutas. Mantenga al día licencia, revisión técnica y
        seguro: con un documento vencido no debe salir.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Drivers searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

const day = (value: string | null) =>
  value ? formatDate(value, { day: "numeric", month: "short", year: "numeric" }) : "Sin registrar";

async function Drivers({ searchParams }: Pick<PageProps<"/repartidores">, "searchParams">) {
  await requireStaff("/repartidores", ["ops"]);
  const asked = (await searchParams).editar;
  const drivers = await (await sessionApi()).opsDrivers();
  const editing = drivers.find((driver) => driver.id === (Array.isArray(asked) ? asked[0] : asked));

  return (
    <div className="flex flex-col gap-10">
      {editing ? (
        <section
          aria-labelledby="editar"
          className="rounded-lg border border-border-strong bg-surface p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="editar" className="text-xl font-bold">
              Editar a {editing.full_name}
            </h2>
            <Link href="/repartidores" className="text-sm text-link underline">
              Cerrar sin guardar
            </Link>
          </div>
          <p className="mt-1 mb-5 text-sm text-ink-muted">
            Cuenta: {editing.email}. El estado se cambia en la lista; aquí se corrigen sus datos.
            Cada cambio queda en la auditoría.
          </p>
          <DriverForm key={editing.id} driver={editing} />
        </section>
      ) : null}

      <section aria-labelledby="lista">
        <h2 id="lista" className="sr-only">
          Lista de repartidores
        </h2>
        {drivers.length === 0 ? (
          <EmptyState title="Todavía no hay repartidores registrados">
            Registre al primero con el formulario de abajo.
          </EmptyState>
        ) : (
          <DataTable
            caption="Repartidores"
            head={["Repartidor", "Vehículo", "Documentos", "Estado", "Cambiar"]}
          >
            {drivers.map((driver) => {
              const status = DRIVER_STATUS[driver.status];
              return (
                <tr key={driver.id}>
                  <td>
                    <p className="font-semibold">{driver.full_name}</p>
                    <p className="text-xs text-ink-muted">{driver.phone}</p>
                    <p className="text-xs text-ink-muted">
                      {ID_TYPE[driver.id_type]} {driver.id_number}
                    </p>
                  </td>
                  <td>
                    {VEHICLE[driver.vehicle_type]}
                    <p className="text-xs text-ink-muted">
                      {driver.plate ?? "Sin placa"} · hasta {driver.capacity_kg} kg
                    </p>
                  </td>
                  <td className="text-xs">
                    <p>
                      Licencia{driver.license_class ? ` ${driver.license_class}` : ""}:{" "}
                      {day(driver.license_expires_on)}
                    </p>
                    <p>Revisión técnica: {day(driver.inspection_expires_on)}</p>
                    <p>Seguro: {day(driver.insurance_expires_on)}</p>
                    {driver.documents_expired ? (
                      <p className="mt-1">
                        <Badge tone="danger">Documento vencido</Badge>
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? driver.status}</Badge>
                  </td>
                  <td className="min-w-56">
                    <ActionForm
                      action={setDriverStatus}
                      submit="Guardar"
                      size="sm"
                      variant="secondary"
                    >
                      <input type="hidden" name="driverId" value={driver.id} />
                      <SelectField
                        label="Nuevo estado"
                        name="status"
                        defaultValue={driver.status === "active" ? "suspended" : "active"}
                      >
                        <option value="active">Activo</option>
                        <option value="suspended">Suspendido</option>
                        <option value="offboarded">Dado de baja</option>
                      </SelectField>
                    </ActionForm>
                    <p className="mt-3">
                      <Link
                        href={`/repartidores?editar=${driver.id}` as Route}
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                      >
                        Editar datos
                        <span className="sr-only"> de {driver.full_name}</span>
                      </Link>
                    </p>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </section>

      <section aria-labelledby="nuevo" className="max-w-3xl">
        <h2 id="nuevo" className="text-xl font-bold">
          Registrar un repartidor
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          La persona debe haber creado antes su cuenta en Yuntera. Queda “por aprobar” hasta que
          usted la active en la lista, después de ver sus documentos.
        </p>
        <div className="mt-4 rounded-lg border border-border bg-surface p-5">
          <DriverForm />
        </div>
      </section>
    </div>
  );
}
