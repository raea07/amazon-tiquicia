import { type OpsSetting, SETTING_TEXT, SETTING_UNKNOWN } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Badge, EmptyState, formatDateTime, formatPrice, Skeleton, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { updateSetting } from "@/app/operations-actions";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { OperationsNav } from "@/components/operations-nav";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Ajustes de la plataforma" };

export default function SettingsPage() {
  return (
    <div className="shell py-8">
      <CatalogueOutcome>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Settings />
        </Suspense>
      </CatalogueOutcome>
    </div>
  );
}

const PROTECTED_SENTENCE =
  "Protegido: solo se cambia con el procedimiento de despliegue, nunca desde la consola.";

/** A setting's value as people read it. */
function shown(setting: OpsSetting): string {
  const { value } = setting;
  if (setting.unit === "minor" && typeof value === "number") return formatPrice(value);
  if (typeof value === "number") return value.toLocaleString("es-CR");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") return value;
  return "Varios valores";
}

async function Settings() {
  await requireStaff("/operacion/ajustes", []);
  const settings = await (await sessionApi()).opsSettings();
  const editable = settings.filter((setting) => setting.editable);
  const locked = settings.filter((setting) => !setting.editable);

  return (
    <>
      <OperationsNav current="/operacion/ajustes" admin />
      <PageHeader title="Ajustes de la plataforma">
        Límites que la operación ajusta sin un despliegue. Cada cambio rige de inmediato para todos
        y queda en la auditoría con el valor anterior. Los ajustes protegidos se ven aquí pero no se
        cambian desde la consola.
      </PageHeader>

      <section aria-labelledby="operativos" className="mt-6">
        <h2 id="operativos" className="text-xl font-bold">
          Ajustes que usted puede cambiar ({editable.length})
        </h2>
        {editable.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No hay ajustes que cambiar desde aquí" />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {editable.map((setting) => (
              <EditableSetting key={setting.key} setting={setting} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="protegidos" className="mt-10">
        <h2 id="protegidos" className="text-xl font-bold">
          Ajustes protegidos ({locked.length})
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{PROTECTED_SENTENCE}</p>
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {locked.map((setting) => {
            const words = SETTING_TEXT[setting.key] ?? SETTING_UNKNOWN;
            return (
              <li
                key={setting.key}
                className="rounded-lg border border-border bg-surface-muted p-4 text-sm"
                data-setting={setting.key}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">{words.label}</h3>
                  <Badge tone="neutral">Protegido</Badge>
                </div>
                <p className="mt-1 text-ink-muted">{words.help}</p>
                <p className="mt-2 break-words">
                  Valor: <span className="font-semibold">{shown(setting)}</span>
                </p>
                <p className="mt-1 text-ink-muted">{PROTECTED_SENTENCE}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function EditableSetting({ setting }: { setting: OpsSetting }) {
  const words = SETTING_TEXT[setting.key] ?? SETTING_UNKNOWN;
  const minor = setting.unit === "minor";
  const bound = (n: number | null) =>
    n === null ? "" : minor ? formatPrice(n) : n.toLocaleString("es-CR");
  const current =
    typeof setting.value === "number"
      ? String(minor ? Math.round(setting.value / 100) : setting.value)
      : "";
  return (
    <li
      className="rounded-lg border border-border bg-surface p-4 text-sm"
      data-setting={setting.key}
    >
      <h3 className="text-base font-bold">{words.label}</h3>
      <p className="mt-1 text-ink-muted">{words.help}</p>
      <p className="mt-2">
        Valor: <span className="font-semibold">{shown(setting)}</span>
        <span className="text-ink-muted">
          {" "}
          · de {bound(setting.min_value)} a {bound(setting.max_value)} · cambiado el{" "}
          {formatDateTime(setting.updated_at)}
        </span>
      </p>
      <details className="mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          Cambiar «{words.label}»
        </summary>
        <div className="mt-2">
          <CatalogueForm action={updateSetting} submit="Guardar el nuevo valor" size="sm">
            <input type="hidden" name="key" value={setting.key} />
            <input type="hidden" name="unit" value={setting.unit ?? ""} />
            <input type="hidden" name="expected" value={JSON.stringify(setting.value)} />
            <TextField
              label={minor ? "Nuevo valor (colones)" : "Nuevo valor"}
              name="value"
              inputMode="numeric"
              defaultValue={current}
              autoComplete="off"
            />
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                name="confirm"
                className="mt-0.5 size-5 accent-(--color-brand)"
              />
              <span>
                Confirmo el cambio: pasa de {shown(setting)} al valor nuevo y rige de inmediato para
                todos.
              </span>
            </label>
          </CatalogueForm>
        </div>
      </details>
    </li>
  );
}
