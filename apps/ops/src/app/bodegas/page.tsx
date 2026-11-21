import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDate, SelectField, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { setWarehouseStaff } from "@/app/people-actions";
import { WAREHOUSE_ROLE } from "@/lib/people-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Bodegas" };

export default function WarehousesPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Bodegas">
        Quién trabaja en cada bodega de Yuntera. Solo las personas de esta lista pueden ver el
        tablero de esa bodega, alistar pedidos y recibir mercadería; al quitarlas pierden el acceso
        de inmediato.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Warehouses />
        </Suspense>
      </div>
    </div>
  );
}

async function Warehouses() {
  await requireStaff("/bodegas", ["ops"]);
  const warehouses = await (await sessionApi()).opsWarehouseStaff();
  if (warehouses.length === 0) return <EmptyState title="Todavía no hay bodegas de Yuntera" />;

  return (
    <ul className="flex flex-col gap-6">
      {warehouses.map((warehouse) => (
        <li key={warehouse.id} className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">
              {warehouse.name}{" "}
              <span className="font-normal text-ink-muted">· {warehouse.code}</span>
            </h2>
            {warehouse.active ? null : <Badge tone="neutral">Inactiva</Badge>}
          </div>
          <p className="text-sm text-ink-muted">{warehouse.address}</p>

          <h3 className="mt-5 font-semibold">Personal ({warehouse.staff.length})</h3>
          {warehouse.staff.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Nadie trabaja aquí todavía.</p>
          ) : (
            <ul className="mt-2 grid gap-3 lg:grid-cols-2">
              {warehouse.staff.map((worker) => (
                <li key={worker.user_id} className="rounded-md border border-border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{worker.full_name ?? "Sin nombre"}</p>
                    <Badge tone={worker.role === "lead" ? "info" : "neutral"}>
                      {WAREHOUSE_ROLE[worker.role]}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {worker.email} · desde{" "}
                    {formatDate(worker.since, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <div className="mt-3">
                    <ActionForm
                      action={setWarehouseStaff}
                      submit="Guardar"
                      size="sm"
                      variant="secondary"
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="warehouseId" value={warehouse.id} />
                      <input type="hidden" name="email" value={worker.email} />
                      <SelectField
                        label={`Puesto de ${worker.full_name ?? worker.email}`}
                        name="role"
                        defaultValue={worker.role}
                        className="min-w-48 flex-1"
                      >
                        <option value="associate">{WAREHOUSE_ROLE.associate}</option>
                        <option value="lead">{WAREHOUSE_ROLE.lead}</option>
                        <option value="remove">Quitar de esta bodega</option>
                      </SelectField>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 max-w-xl border-t border-border pt-5">
            <h3 className="font-semibold">Agregar a una persona</h3>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Debe haber creado antes su cuenta en Yuntera, con este mismo correo.
            </p>
            <ActionForm action={setWarehouseStaff} submit="Agregar a la bodega">
              <input type="hidden" name="warehouseId" value={warehouse.id} />
              <TextField
                label="Correo de su cuenta"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="off"
              />
              <SelectField label="Puesto" name="role" defaultValue="associate">
                <option value="associate">{WAREHOUSE_ROLE.associate}</option>
                <option value="lead">{WAREHOUSE_ROLE.lead}</option>
              </SelectField>
            </ActionForm>
          </div>
        </li>
      ))}
    </ul>
  );
}
