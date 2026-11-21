import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDate, SelectField, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { setDriverStatus } from "@/app/actions";
import { DRIVER_STATUS, VEHICLE } from "@/lib/labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Repartidores" };

export default function DriversPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Repartidores">
        Solo un repartidor activo puede recibir rutas. Mantenga al día licencia, revisión técnica y
        seguro: con un documento vencido no debe salir.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Drivers />
        </Suspense>
      </div>
    </div>
  );
}

const day = (value: string | null) =>
  value ? formatDate(value, { day: "numeric", month: "short", year: "numeric" }) : "Sin registrar";

async function Drivers() {
  await requireStaff("/repartidores", ["ops"]);
  const drivers = await (await sessionApi()).opsDrivers();
  if (drivers.length === 0) return <EmptyState title="Todavía no hay repartidores registrados" />;

  return (
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
            </td>
            <td>
              {VEHICLE[driver.vehicle_type]}
              <p className="text-xs text-ink-muted">
                {driver.plate ?? "Sin placa"} · hasta {driver.capacity_kg} kg
              </p>
            </td>
            <td className="text-xs">
              <p>Licencia: {day(driver.license_expires_on)}</p>
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
              <ActionForm action={setDriverStatus} submit="Guardar" size="sm" variant="secondary">
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
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
