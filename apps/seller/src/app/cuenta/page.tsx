import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, Badge, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
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
  const { seller, account } = await getOverview(shop.id);
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
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 lg:col-span-2">
        <h2 className="text-lg font-bold">Dónde le pagamos</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Item label="Cuenta IBAN">{account.payout_iban_masked ?? "Sin registrar"}</Item>
          <Item label="A nombre de">{account.payout_holder_name ?? "—"}</Item>
          <Item label="SINPE Móvil">{account.sinpe_movil_number ?? "—"}</Item>
        </dl>
        <p className="mt-4 text-sm text-ink-muted">
          Por seguridad, la cuenta de depósito y los datos fiscales no se cambian desde aquí: un
          cambio de cuenta es la forma más común de fraude contra vendedores. Escríbanos desde su
          correo de contacto y lo verificamos con usted por teléfono antes de aplicarlo.
        </p>
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
