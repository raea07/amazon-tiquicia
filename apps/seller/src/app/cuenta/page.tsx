import { parsePhone } from "@yuntera/core";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PayoutDetailsForm } from "@/components/payout-forms";
import { getOverview, requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Cuenta" };

const ID_TYPE = {
  fisica: "Cédula física",
  juridica: "Cédula jurídica",
  dimex: "DIMEX",
  nite: "NITE",
};
const KYC = {
  pending: { label: "En verificación", tone: "warning" },
  verified: { label: "Verificada", tone: "success" },
  rejected: { label: "No verificada", tone: "danger" },
} as const;
const STATUS = {
  pending: { label: "En revisión", tone: "warning" },
  active: { label: "Activa", tone: "success" },
  suspended: { label: "Suspendida", tone: "danger" },
  closed: { label: "Cerrada", tone: "neutral" },
} as const;

export default function AccountPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Cuenta">
        Los datos de su tienda tal como los tenemos registrados.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Account />
        </Suspense>
      </div>
    </div>
  );
}

async function Account() {
  const { shop } = await requireShop("/cuenta");
  const [{ seller, account }, payout] = await Promise.all([
    getOverview(shop.id),
    (await sessionApi()).sellerPayoutDetails(shop.id),
  ]);
  const request = payout.request;
  const day = (value: string) =>
    formatDate(value, { day: "numeric", month: "long", year: "numeric" });
  const kyc = KYC[account.kyc_status];
  const status = STATUS[seller.status];

  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Tienda</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <dl className="mt-3 space-y-3 text-sm">
          <Item label="Nombre">{seller.trade_name}</Item>
          <Item label="Dirección en Yuntera">/{seller.slug}</Item>
          <Item label="Correo de contacto">{account.contact_email}</Item>
          <Item label="Teléfono">{account.contact_phone}</Item>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Identidad fiscal</h2>
          <Badge tone={kyc.tone}>{kyc.label}</Badge>
        </div>
        <dl className="mt-3 space-y-3 text-sm">
          <Item label="Nombre o razón social">{account.legal_name}</Item>
          <Item label={ID_TYPE[account.id_type]}>{account.id_number}</Item>
          <Item label="Régimen tributario">
            {account.tax_regime === "simplificado" ? "Simplificado" : "General"}
          </Item>
          <Item label="Dirección fiscal">{account.fiscal_address}</Item>
        </dl>
        {account.kyc_notes ? (
          <Alert tone="warning" className="mt-4" title="Nota de la verificación">
            {account.kyc_notes}
          </Alert>
        ) : null}
        <p className="mt-4 text-sm text-ink-muted">
          Los datos fiscales no se cambian desde aquí. Si alguno cambió, escríbanos desde su correo
          de contacto y lo verificamos con usted.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 lg:col-span-2">
        <h2 className="text-lg font-bold">Dónde le pagamos</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Item label="Cuenta IBAN">{payout.current.iban_masked ?? "Sin registrar"}</Item>
          <Item label="A nombre de">{payout.current.holder_name ?? "—"}</Item>
          <Item label="SINPE Móvil">
            {payout.current.sinpe_number
              ? (parsePhone(payout.current.sinpe_number)?.formatted ?? payout.current.sinpe_number)
              : "—"}
          </Item>
        </dl>

        {request?.status === "pending" ? (
          <Alert tone="info" className="mt-4" title="Cambio de cuenta en revisión">
            El {day(request.requested_at)} se pidió cambiar a la cuenta {request.iban_masked}{" "}
            (titular: {request.holder_name}). Le vamos a llamar al teléfono registrado de la tienda
            para confirmarlo. Mientras tanto le seguimos pagando a la cuenta actual.
          </Alert>
        ) : null}
        {request?.status === "rejected" ? (
          <Alert tone="danger" className="mt-4" title="No aprobamos el cambio de cuenta">
            <p>
              Pidió cambiar a la cuenta {request.iban_masked}. {request.note}
            </p>
            <p className="mt-1">Su cuenta actual no cambió. Puede enviar una solicitud nueva.</p>
          </Alert>
        ) : null}
        {request?.status === "approved" && request.decided_at ? (
          <p className="mt-4 text-sm text-ink-muted">
            Último cambio de cuenta aprobado el {day(request.decided_at)}.
          </p>
        ) : null}

        <div className="mt-6 max-w-xl border-t border-border pt-5">
          <h3 className="font-bold">
            {payout.current.iban_masked ? "Pedir un cambio de cuenta" : "Registrar su cuenta"}
          </h3>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            Por seguridad, la cuenta no cambia al enviar este formulario: cambiarla es la forma más
            común de fraude contra vendedores. Primero la confirmamos con usted por teléfono, al
            número que ya tenemos registrado. Nunca mostramos el número completo de una cuenta.
            {request?.status === "pending"
              ? " Si envía otra solicitud, reemplaza a la que está en revisión."
              : ""}
          </p>
          {payout.can_request ? (
            <PayoutDetailsForm
              hasAccount={payout.current.iban_masked !== null}
              currentSinpe={payout.current.sinpe_number}
            />
          ) : (
            <p className="text-sm">
              Solo la persona dueña o administradora de la tienda puede pedir un cambio de cuenta.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
