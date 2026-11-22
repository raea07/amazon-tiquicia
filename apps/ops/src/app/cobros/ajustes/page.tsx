import { ActionForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import {
  Alert,
  Badge,
  formatDateTime,
  formatPrice,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { setExpectedFee, setPaymentsMode } from "@/app/payment-actions";
import { PaymentNav } from "@/components/payment-nav";
import { MODE } from "@/lib/payment-labels";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Modo de pagos y comisiones" };

export default function PaymentSettingsPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Modo de pagos y comisiones">
        Si los pagos pasan por el procesador y con qué llaves, y la comisión que se espera que
        cobre.
      </PageHeader>
      <PaymentNav current="/cobros/ajustes" />
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Settings />
        </Suspense>
      </div>
    </div>
  );
}

const percent = (bps: number | undefined) =>
  bps === undefined
    ? "—"
    : `${(bps / 100).toLocaleString("es-CR", { maximumFractionDigits: 2 })} %`;

async function Settings() {
  await requireStaff("/cobros/ajustes", ["finance"]);
  const api = await sessionApi();
  const settings = await api.opsPaymentSettings();
  const mode = MODE[settings.mode];

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <section aria-labelledby="modo">
        <h2 id="modo" className="text-xl font-bold">
          Modo actual: {mode.label}
        </h2>
        <p className="mt-1 text-sm">{mode.text}</p>
        <h3 className="mt-5 font-bold">El servicio de pagos ({settings.gateway})</h3>
        {settings.environments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            El servicio de pagos todavía no se ha reportado. Hasta que lo haga con sus llaves, solo
            se puede usar la simulación.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {settings.environments.map((environment) => (
              <li
                key={environment.environment}
                className="rounded-md border border-border bg-surface p-3"
              >
                <span className="font-semibold">
                  {environment.environment === "live" ? "Real" : "Pruebas"}
                </span>{" "}
                <Badge
                  tone={
                    environment.keys_ready && environment.webhook_ready && environment.recent
                      ? "success"
                      : "warning"
                  }
                >
                  {environment.keys_ready && environment.webhook_ready
                    ? environment.recent
                      ? "Listo"
                      : "Sin reportarse hace más de 15 minutos"
                    : "Faltan llaves o el secreto de avisos"}
                </Badge>
                <span className="block text-ink-muted">
                  Llaves {environment.keys_ready ? "sí" : "no"} · secreto de avisos{" "}
                  {environment.webhook_ready ? "sí" : "no"} · cuenta{" "}
                  {environment.account_ref ?? "—"} · último reporte{" "}
                  {formatDateTime(environment.reported_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {settings.open_work.attempts + settings.open_work.refunds > 0 ? (
          <Alert tone="info" className="mt-3">
            Hay {settings.open_work.attempts} pagos y {settings.open_work.refunds} reembolsos en
            curso en el procesador. El modo no se puede cambiar hasta que terminen.
          </Alert>
        ) : null}

        {settings.can_change ? (
          <div className="mt-5 rounded-lg border border-border bg-surface p-5">
            <h3 className="font-bold">Cambiar el modo</h3>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Solo una persona administradora. Queda en la auditoría con su motivo. Para pasar a
              pruebas o a real, el servicio de pagos debe haberse reportado listo para ese entorno
              en los últimos 15 minutos.
            </p>
            <ActionForm action={setPaymentsMode} submit="Cambiar el modo" pendingLabel="Cambiando…">
              <SelectField label="Modo nuevo" name="mode" defaultValue="">
                <option value="" disabled>
                  Elija…
                </option>
                <option value="sandbox">{MODE.sandbox.label}</option>
                <option value="test">{MODE.test.label}</option>
                <option value="live">{MODE.live.label}</option>
              </SelectField>
              <TextAreaField label="Motivo" name="note" rows={2} hint="Al menos 10 caracteres." />
            </ActionForm>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            Solo una persona administradora puede cambiar el modo.
          </p>
        )}
      </section>

      <section aria-labelledby="comisiones">
        <h2 id="comisiones" className="text-xl font-bold">
          Comisión esperada del procesador
        </h2>
        <p className="mt-1 text-sm">
          Es lo que se compara con la comisión que el procesador reporta en cada pago. No es lo que
          se cobra a los vendedores: eso es la tabla de tarifas, que cambia en una migración.
        </p>
        <Alert tone="warning" className="mt-3" title="Pendiente de confirmar">
          Los precios publicados del procesador (3,9 % + US$0,35 por tarjeta) superan el tope de
          1,95 % que el Banco Central fija para la adquirencia local. Cómo se aplica ese tope está
          pendiente de confirmar con el procesador y un abogado; ajuste esta comisión cuando haya
          tarifa contratada.
        </Alert>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Tarjeta</dt>
          <dd>
            {percent(settings.expected_fees.card?.bps)} +{" "}
            {formatPrice(settings.expected_fees.card?.fixed_minor ?? 0)}
          </dd>
          <dt className="text-ink-muted">SINPE Móvil</dt>
          <dd>
            {percent(settings.expected_fees.sinpe_movil?.bps)} +{" "}
            {formatPrice(settings.expected_fees.sinpe_movil?.fixed_minor ?? 0)}
          </dd>
        </dl>
        {settings.can_change ? (
          <div className="mt-5 rounded-lg border border-border bg-surface p-5">
            <h3 className="font-bold">Cambiar la comisión esperada</h3>
            <ActionForm
              action={setExpectedFee}
              submit="Guardar comisión esperada"
              pendingLabel="Guardando…"
            >
              <SelectField label="Medio de pago" name="method" defaultValue="">
                <option value="" disabled>
                  Elija…
                </option>
                <option value="card">Tarjeta</option>
                <option value="sinpe_movil">SINPE Móvil</option>
              </SelectField>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Porcentaje"
                  name="percent"
                  inputMode="decimal"
                  hint="Por ejemplo 3,9."
                />
                <TextField
                  label="Monto fijo por pago (₡)"
                  name="fixed"
                  inputMode="decimal"
                  hint="Por ejemplo 180."
                />
              </div>
              <TextAreaField
                label="De dónde sale"
                name="note"
                rows={2}
                hint="Por ejemplo, el contrato o el correo del procesador. Queda en la auditoría."
              />
            </ActionForm>
          </div>
        ) : null}
      </section>
    </div>
  );
}
