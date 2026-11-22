import { sessionApi } from "@yuntera/next-kit/server";
import { DataTable, PageHeader } from "@yuntera/next-kit/shell";
import { EmptyState, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Auditoría" };

const TABLES: Record<string, string> = {
  staff_members: "Personal",
  sellers: "Vendedores",
  seller_private: "Datos fiscales y bancarios",
  seller_members: "Miembros de tiendas",
  fee_schedules: "Tarifas",
  app_settings: "Ajustes de la plataforma",
  warehouse_staff: "Personal de bodega",
  drivers: "Repartidores",
  payouts: "Pagos a vendedores",
  fee_payment_methods: "Tarifas de cobro",
  "auth.mfa_factors": "Verificación en dos pasos",
  notification_deliveries: "Mensajes reenviados",
  categories: "Categorías",
  brands: "Marcas",
  search_synonyms: "Sinónimos de búsqueda",
  reviews: "Reseñas",
  products: "Productos",
};
const ACTIONS: Record<string, string> = {
  INSERT: "Creó",
  UPDATE: "Cambió",
  DELETE: "Eliminó",
  RESET_MFA: "Reinició",
  HIDE: "Ocultó",
  SHOW: "Volvió a mostrar",
  HIDE_REPLY: "Ocultó la respuesta de",
  SHOW_REPLY: "Volvió a mostrar la respuesta de",
  MERGE: "Unió",
  CORRECT: "Corrigió",
  TAKE_DOWN: "Retiró",
  RESTORE: "Volvió a publicar",
};

// Shown as "changed" only; the values of these are never printed on screen.
const SENSITIVE = /iban|sinpe|id_number|phone|email|address/i;

export default function AuditPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Auditoría">
        Quién cambió qué en lo que no debe cambiar en silencio: permisos, repartidores, estado y
        datos bancarios de vendedores, pagos, tarifas y ajustes. Este registro no se puede editar.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Trail />
        </Suspense>
      </div>
    </div>
  );
}

// What a new or removed row was, in the few fields that say it.
const SUMMARY = ["role", "status", "active", "reference", "amount_minor", "value"];

function changes(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  if (!before || !after) {
    const row = after ?? before ?? {};
    return SUMMARY.filter((key) => row[key] !== undefined && row[key] !== null)
      .map((key) => `${key}: ${String(row[key])}`)
      .join(" · ");
  }
  return Object.keys(after)
    .filter(
      (key) => key !== "updated_at" && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    )
    .map((key) =>
      SENSITIVE.test(key)
        ? `${key}: (cambió)`
        : `${key}: ${String(before[key])} → ${String(after[key])}`,
    )
    .join(" · ");
}

async function Trail() {
  await requireStaff("/auditoria", []);
  const entries = await (await sessionApi()).auditEntries(null, 200);
  if (entries.length === 0) return <EmptyState title="Sin registros todavía" />;

  return (
    <DataTable
      caption="Registro de auditoría"
      head={["Cuándo", "Qué", "Dónde", "Detalle", "Quién"]}
    >
      {entries.map((entry) => (
        <tr key={entry.id}>
          <td className="whitespace-nowrap">{formatDateTime(entry.at)}</td>
          <td>{ACTIONS[entry.action] ?? entry.action}</td>
          <td>
            {TABLES[entry.table_name] ?? entry.table_name}
            {entry.subject ? <p className="text-xs text-ink-muted">{entry.subject}</p> : null}
          </td>
          <td className="max-w-md break-words text-xs text-ink-muted">
            {changes(entry.old_row, entry.new_row) || (entry.row_key ?? "")}
          </td>
          <td className="text-xs">
            {entry.actor_name ?? (entry.actor_id ? "Cuenta sin nombre" : "Sistema")}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
